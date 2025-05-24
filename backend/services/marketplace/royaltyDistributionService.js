const { PublicKey, Transaction } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');
const RoyaltyModel = require('../../models/Royalty');
const ArtistModel = require('../../models/Artist');
const EventModel = require('../../models/Event');
const TransactionModel = require('../../models/Transaction');
const DistributionModel = require('../../models/Distribution');
const BlockchainService = require('../blockchain/blockchainService');
const PaymentService = require('../payment/paymentService');
const NotificationService = require('../notifications/notificationService');
const CacheService = require('../cache/cacheService');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const BigNumber = require('bignumber.js');

class RoyaltyDistributionService {
  constructor() {
    this.blockchainService = new BlockchainService();
    this.paymentService = new PaymentService();
    this.notificationService = new NotificationService();
    this.cacheService = new CacheService();
    
    // Configuration
    this.DEFAULT_PLATFORM_FEE = 2.5; // 2.5%
    this.MAX_ROYALTY_PERCENTAGE = 10; // 10% max
    this.MIN_ROYALTY_PERCENTAGE = 0; // 0% min
    this.BATCH_SIZE = 100; // Process 100 distributions at a time
    this.RETRY_ATTEMPTS = 3;
    this.RETRY_DELAY = 5000; // 5 seconds
    
    // Distribution thresholds
    this.MIN_DISTRIBUTION_AMOUNT = 0.001; // 0.001 SOL minimum
    this.DISTRIBUTION_BATCH_INTERVAL = 3600000; // 1 hour
    
    // Start batch processor
    this.startBatchProcessor();
  }

  /**
   * Calculate royalty amounts for a sale
   */
  async calculateRoyalty(salePrice, ticketData) {
    try {
      if (!salePrice || salePrice <= 0) {
        throw new AppError('Invalid sale price', 400);
      }

      // Get event and royalty configuration
      const event = await EventModel.findById(ticketData.eventId)
        .populate('royaltyConfiguration')
        .lean();

      if (!event) {
        throw new AppError('Event not found', 404);
      }

      // Initialize calculation with BigNumber for precision
      const salePriceBN = new BigNumber(salePrice);
      const distributions = [];
      let totalRoyaltyAmount = new BigNumber(0);

      // Get royalty configuration
      const royaltyConfig = event.royaltyConfiguration || {
        primaryArtist: {
          artistId: event.primaryArtistId,
          percentage: event.royaltyPercentage || 5
        },
        splits: []
      };

      // Calculate primary artist royalty
      if (royaltyConfig.primaryArtist) {
        const artistRoyalty = this.calculateIndividualRoyalty(
          salePriceBN,
          royaltyConfig.primaryArtist.percentage
        );

        distributions.push({
          recipientId: royaltyConfig.primaryArtist.artistId,
          recipientType: 'artist',
          amount: artistRoyalty.toNumber(),
          percentage: royaltyConfig.primaryArtist.percentage,
          role: 'primary_artist'
        });

        totalRoyaltyAmount = totalRoyaltyAmount.plus(artistRoyalty);
      }

      // Calculate split royalties (collaborators, producers, etc.)
      for (const split of royaltyConfig.splits || []) {
        const splitRoyalty = this.calculateIndividualRoyalty(
          salePriceBN,
          split.percentage
        );

        distributions.push({
          recipientId: split.recipientId,
          recipientType: split.recipientType || 'collaborator',
          amount: splitRoyalty.toNumber(),
          percentage: split.percentage,
          role: split.role || 'collaborator'
        });

        totalRoyaltyAmount = totalRoyaltyAmount.plus(splitRoyalty);
      }

      // Calculate platform fee
      const platformFee = salePriceBN
        .multipliedBy(this.DEFAULT_PLATFORM_FEE)
        .dividedBy(100);

      // Calculate seller proceeds
      const sellerProceeds = salePriceBN
        .minus(totalRoyaltyAmount)
        .minus(platformFee);

      // Validate calculations
      const total = totalRoyaltyAmount.plus(platformFee).plus(sellerProceeds);
      if (!total.isEqualTo(salePriceBN)) {
        logger.error('Royalty calculation mismatch', {
          salePrice,
          calculated: total.toNumber(),
          difference: salePriceBN.minus(total).toNumber()
        });
      }

      const result = {
        salePrice: salePriceBN.toNumber(),
        royalties: {
          total: totalRoyaltyAmount.toNumber(),
          distributions,
          percentage: totalRoyaltyAmount.dividedBy(salePriceBN).multipliedBy(100).toNumber()
        },
        platformFee: {
          amount: platformFee.toNumber(),
          percentage: this.DEFAULT_PLATFORM_FEE
        },
        sellerProceeds: sellerProceeds.toNumber(),
        breakdown: {
          salePrice: salePriceBN.toNumber(),
          totalRoyalties: totalRoyaltyAmount.toNumber(),
          platformFee: platformFee.toNumber(),
          sellerProceeds: sellerProceeds.toNumber()
        },
        metadata: {
          eventId: event._id,
          eventName: event.name,
          ticketId: ticketData._id,
          calculatedAt: new Date()
        }
      };

      // Cache calculation for audit trail
      await this.cacheService.set(
        `royalty:calculation:${ticketData._id}:${Date.now()}`,
        result,
        86400 // 24 hours
      );

      logger.info('Royalty calculated', {
        ticketId: ticketData._id,
        salePrice,
        totalRoyalty: totalRoyaltyAmount.toNumber()
      });

      return result;
    } catch (error) {
      logger.error('Error calculating royalty:', error);
      throw error;
    }
  }

  /**
   * Process royalty distributions
   */
  async distributeRoyalty(transactionId, amounts) {
    const session = await DistributionModel.startSession();
    session.startTransaction();

    try {
      // Get transaction details
      const transaction = await TransactionModel.findById(transactionId)
        .session(session);

      if (!transaction) {
        throw new AppError('Transaction not found', 404);
      }

      if (transaction.royaltiesDistributed) {
        throw new AppError('Royalties already distributed', 400);
      }

      // Validate distribution amounts
      const validation = await this.validateDistribution({
        transactionId,
        amounts,
        transactionAmount: transaction.amount
      });

      if (!validation.isValid) {
        throw new AppError(validation.error, 400);
      }

      // Create distribution records
      const distributions = [];
      const blockchainTransactions = [];

      for (const distribution of amounts.distributions) {
        // Skip if amount is below minimum
        if (distribution.amount < this.MIN_DISTRIBUTION_AMOUNT) {
          logger.info(`Skipping distribution below minimum: ${distribution.amount}`);
          continue;
        }

        // Get recipient wallet
        const recipient = await this.getRecipientWallet(
          distribution.recipientId,
          distribution.recipientType
        );

        if (!recipient.walletAddress) {
          logger.error(`No wallet address for recipient ${distribution.recipientId}`);
          continue;
        }

        // Create distribution record
        const dist = new DistributionModel({
          transactionId,
          recipientId: distribution.recipientId,
          recipientType: distribution.recipientType,
          amount: distribution.amount,
          percentage: distribution.percentage,
          role: distribution.role,
          status: 'pending',
          metadata: {
            eventId: transaction.eventId,
            ticketId: transaction.ticketId,
            salePrice: transaction.amount,
            calculatedAt: new Date()
          }
        });

        await dist.save({ session });
        distributions.push(dist);

        // Prepare blockchain transaction
        blockchainTransactions.push({
          distributionId: dist._id,
          recipient: new PublicKey(recipient.walletAddress),
          amount: new BN(distribution.amount * 1e9) // Convert to lamports
        });
      }

      // Execute blockchain distributions
      const blockchainResults = await this.executeBlockchainDistributions(
        blockchainTransactions
      );

      // Update distribution records with blockchain results
      for (let i = 0; i < distributions.length; i++) {
        const dist = distributions[i];
        const blockchainResult = blockchainResults[i];

        if (blockchainResult.success) {
          dist.status = 'completed';
          dist.blockchain = {
            transactionSignature: blockchainResult.signature,
            processedAt: new Date()
          };
        } else {
          dist.status = 'failed';
          dist.error = blockchainResult.error;
          dist.retryCount = 0;
        }

        await dist.save({ session });
      }

      // Update transaction
      transaction.royaltiesDistributed = true;
      transaction.royaltyDistributions = distributions.map(d => d._id);
      await transaction.save({ session });

      await session.commitTransaction();

      // Send notifications
      await this.sendDistributionNotifications(distributions);

      // Clear caches
      await this.clearDistributionCaches(transactionId);

      logger.info('Royalty distribution completed', {
        transactionId,
        distributionCount: distributions.length,
        totalAmount: amounts.royalties.total
      });

      return {
        success: true,
        distributions: distributions.map(d => ({
          id: d._id,
          recipientId: d.recipientId,
          amount: d.amount,
          status: d.status,
          transactionSignature: d.blockchain?.transactionSignature
        })),
        summary: {
          total: distributions.length,
          successful: distributions.filter(d => d.status === 'completed').length,
          failed: distributions.filter(d => d.status === 'failed').length,
          totalAmount: distributions.reduce((sum, d) => sum + d.amount, 0)
        }
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error distributing royalty:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Track royalty payments for an artist
   */
  async trackRoyaltyPayments(artistId, period = 'all') {
    try {
      const cacheKey = `royalty:tracking:${artistId}:${period}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached;

      // Build date filter based on period
      const dateFilter = this.buildDateFilter(period);
      
      const query = {
        recipientId: artistId,
        recipientType: 'artist',
        status: 'completed'
      };

      if (dateFilter) {
        query.createdAt = dateFilter;
      }

      // Get distributions
      const distributions = await DistributionModel.find(query)
        .populate('transactionId')
        .sort({ createdAt: -1 })
        .lean();

      // Aggregate data
      const aggregation = await DistributionModel.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
            avgAmount: { $avg: '$amount' },
            maxAmount: { $max: '$amount' },
            minAmount: { $min: '$amount' }
          }
        }
      ]);

      const stats = aggregation[0] || {
        totalAmount: 0,
        count: 0,
        avgAmount: 0,
        maxAmount: 0,
        minAmount: 0
      };

      // Group by time period
      const timeGrouping = this.groupDistributionsByPeriod(distributions, period);

      // Get pending distributions
      const pendingDistributions = await DistributionModel.find({
        recipientId: artistId,
        recipientType: 'artist',
        status: 'pending'
      }).lean();

      const pendingAmount = pendingDistributions.reduce(
        (sum, d) => sum + d.amount,
        0
      );

      const result = {
        artistId,
        period,
        summary: {
          totalReceived: stats.totalAmount,
          distributionCount: stats.count,
          averagePayment: stats.avgAmount,
          highestPayment: stats.maxAmount,
          lowestPayment: stats.minAmount,
          pendingAmount,
          pendingCount: pendingDistributions.length
        },
        distributions: distributions.slice(0, 100), // Latest 100
        timeGrouping,
        lastUpdated: new Date()
      };

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, result, 300);

      return result;
    } catch (error) {
      logger.error('Error tracking royalty payments:', error);
      throw error;
    }
  }

  /**
   * Generate detailed royalty report
   */
  async generateRoyaltyReport(artistId, dateRange) {
    try {
      const { startDate, endDate } = dateRange;

      if (!startDate || !endDate) {
        throw new AppError('Invalid date range', 400);
      }

      // Get artist details
      const artist = await ArtistModel.findById(artistId).lean();
      if (!artist) {
        throw new AppError('Artist not found', 404);
      }

      // Get all distributions in date range
      const distributions = await DistributionModel.find({
        recipientId: artistId,
        recipientType: 'artist',
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      })
      .populate({
        path: 'transactionId',
        populate: {
          path: 'eventId ticketId'
        }
      })
      .sort({ createdAt: -1 })
      .lean();

      // Group by event
      const eventGrouping = {};
      distributions.forEach(dist => {
        const eventId = dist.transactionId?.eventId?._id?.toString();
        if (!eventId) return;

        if (!eventGrouping[eventId]) {
          eventGrouping[eventId] = {
            eventName: dist.transactionId.eventId.name,
            distributions: [],
            totalAmount: 0,
            count: 0
          };
        }

        eventGrouping[eventId].distributions.push(dist);
        eventGrouping[eventId].totalAmount += dist.amount;
        eventGrouping[eventId].count += 1;
      });

      // Calculate tax summary (if applicable)
      const taxSummary = await this.calculateTaxSummary(distributions);

      // Generate detailed breakdown
      const breakdown = {
        byStatus: await this.groupByStatus(distributions),
        byRole: await this.groupByRole(distributions),
        byMonth: await this.groupByMonth(distributions, startDate, endDate),
        byEvent: Object.values(eventGrouping)
      };

      // Calculate totals
      const totals = {
        grossRevenue: distributions
          .filter(d => d.status === 'completed')
          .reduce((sum, d) => sum + d.amount, 0),
        pendingRevenue: distributions
          .filter(d => d.status === 'pending')
          .reduce((sum, d) => sum + d.amount, 0),
        failedDistributions: distributions
          .filter(d => d.status === 'failed')
          .reduce((sum, d) => sum + d.amount, 0),
        platformFees: 0, // Calculate if needed
        netRevenue: 0 // Calculate after fees
      };

      totals.netRevenue = totals.grossRevenue - totals.platformFees;

      // Generate report document
      const report = {
        reportId: `ROYALTY-${artistId}-${Date.now()}`,
        artist: {
          id: artist._id,
          name: artist.name,
          walletAddress: artist.walletAddress
        },
        period: {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          days: Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000)
        },
        summary: {
          totalDistributions: distributions.length,
          completedDistributions: distributions.filter(d => d.status === 'completed').length,
          ...totals
        },
        breakdown,
        taxSummary,
        distributions: distributions.map(d => ({
          id: d._id,
          date: d.createdAt,
          amount: d.amount,
          status: d.status,
          event: d.transactionId?.eventId?.name,
          ticket: d.transactionId?.ticketId?.ticketNumber,
          transactionSignature: d.blockchain?.transactionSignature
        })),
        metadata: {
          generatedAt: new Date(),
          reportType: 'royalty_distribution',
          format: 'detailed'
        }
      };

      // Store report
      await this.storeReport(report);

      logger.info('Royalty report generated', {
        artistId,
        reportId: report.reportId,
        period: dateRange
      });

      return report;
    } catch (error) {
      logger.error('Error generating royalty report:', error);
      throw error;
    }
  }

  /**
   * Process delayed distributions in batches
   */
  async processDelayedDistribution() {
    try {
      // Get pending distributions older than threshold
      const pendingDistributions = await DistributionModel.find({
        status: 'pending',
        createdAt: { $lt: new Date(Date.now() - this.DISTRIBUTION_BATCH_INTERVAL) },
        retryCount: { $lt: this.RETRY_ATTEMPTS }
      })
      .limit(this.BATCH_SIZE)
      .sort({ createdAt: 1 });

      logger.info(`Processing ${pendingDistributions.length} delayed distributions`);

      const results = {
        successful: 0,
        failed: 0,
        skipped: 0
      };

      // Process in batches
      for (const distribution of pendingDistributions) {
        try {
          // Get recipient wallet
          const recipient = await this.getRecipientWallet(
            distribution.recipientId,
            distribution.recipientType
          );

          if (!recipient.walletAddress) {
            distribution.status = 'failed';
            distribution.error = 'No wallet address found';
            await distribution.save();
            results.skipped++;
            continue;
          }

          // Execute blockchain distribution
          const blockchainResult = await this.executeSingleDistribution({
            distributionId: distribution._id,
            recipient: new PublicKey(recipient.walletAddress),
            amount: new BN(distribution.amount * 1e9)
          });

          if (blockchainResult.success) {
            distribution.status = 'completed';
            distribution.blockchain = {
              transactionSignature: blockchainResult.signature,
              processedAt: new Date()
            };
            results.successful++;
          } else {
            distribution.retryCount += 1;
            distribution.lastRetryAt = new Date();
            distribution.error = blockchainResult.error;
            
            if (distribution.retryCount >= this.RETRY_ATTEMPTS) {
              distribution.status = 'failed';
            }
            results.failed++;
          }

          await distribution.save();

          // Send notification
          if (distribution.status === 'completed') {
            await this.sendDistributionNotification(distribution);
          }

        } catch (error) {
          logger.error(`Error processing distribution ${distribution._id}:`, error);
          results.failed++;
        }

        // Add delay between transactions
        await this.sleep(1000);
      }

      logger.info('Delayed distribution processing completed', results);

      return results;
    } catch (error) {
      logger.error('Error processing delayed distributions:', error);
      throw error;
    }
  }

  /**
   * Validate distribution calculations
   */
  async validateDistribution(distributionData) {
    try {
      const errors = [];

      // Validate transaction exists
      if (!distributionData.transactionId) {
        errors.push('Transaction ID is required');
      }

      // Validate amounts
      if (!distributionData.amounts || !distributionData.amounts.distributions) {
        errors.push('Distribution amounts are required');
      }

      // Calculate total distribution amount
      const totalDistribution = distributionData.amounts.distributions.reduce(
        (sum, d) => sum + d.amount,
        0
      );

      // Validate against transaction amount
      const expectedRoyalty = distributionData.transactionAmount * 
        (distributionData.amounts.royalties.percentage / 100);
      
      const tolerance = 0.001; // Allow 0.001 SOL tolerance for rounding
      if (Math.abs(totalDistribution - expectedRoyalty) > tolerance) {
        errors.push(
          `Distribution total ${totalDistribution} does not match expected ${expectedRoyalty}`
        );
      }

      // Validate individual distributions
      for (const dist of distributionData.amounts.distributions) {
        if (!dist.recipientId) {
          errors.push('Recipient ID is required for all distributions');
        }

        if (dist.amount < 0) {
          errors.push('Distribution amounts must be positive');
        }

        if (dist.percentage < 0 || dist.percentage > 100) {
          errors.push('Distribution percentage must be between 0 and 100');
        }
      }

      // Validate total percentage
      const totalPercentage = distributionData.amounts.distributions.reduce(
        (sum, d) => sum + d.percentage,
        0
      );

      if (Math.abs(totalPercentage - distributionData.amounts.royalties.percentage) > 0.01) {
        errors.push('Distribution percentages do not sum to total royalty percentage');
      }

      return {
        isValid: errors.length === 0,
        errors,
        error: errors[0] || null
      };
    } catch (error) {
      logger.error('Error validating distribution:', error);
      return {
        isValid: false,
        error: 'Validation error occurred'
      };
    }
  }

  /**
   * Handle failed distribution with retry logic
   */
  async handleFailedDistribution(distributionId) {
    try {
      const distribution = await DistributionModel.findById(distributionId);
      
      if (!distribution) {
        throw new AppError('Distribution not found', 404);
      }

      if (distribution.status !== 'failed') {
        throw new AppError('Distribution is not in failed state', 400);
      }

      if (distribution.retryCount >= this.RETRY_ATTEMPTS) {
        throw new AppError('Maximum retry attempts exceeded', 400);
      }

      // Get recipient wallet
      const recipient = await this.getRecipientWallet(
        distribution.recipientId,
        distribution.recipientType
      );

      if (!recipient.walletAddress) {
        throw new AppError('Recipient wallet not found', 404);
      }

      // Retry blockchain distribution
      const blockchainResult = await this.executeSingleDistribution({
        distributionId: distribution._id,
        recipient: new PublicKey(recipient.walletAddress),
        amount: new BN(distribution.amount * 1e9)
      });

      if (blockchainResult.success) {
        distribution.status = 'completed';
        distribution.blockchain = {
          transactionSignature: blockchainResult.signature,
          processedAt: new Date()
        };
        distribution.error = null;
      } else {
        distribution.retryCount += 1;
        distribution.lastRetryAt = new Date();
        distribution.error = blockchainResult.error;
      }

      await distribution.save();

      // Send notification if successful
      if (distribution.status === 'completed') {
        await this.sendDistributionNotification(distribution);
      }

      logger.info('Failed distribution retry processed', {
        distributionId,
        status: distribution.status,
        retryCount: distribution.retryCount
      });

      return {
        success: distribution.status === 'completed',
        distribution: {
          id: distribution._id,
          status: distribution.status,
          retryCount: distribution.retryCount,
          transactionSignature: distribution.blockchain?.transactionSignature
        }
      };
    } catch (error) {
      logger.error('Error handling failed distribution:', error);
      throw error;
    }
  }

  /**
   * Update royalty rates for a contract
   */
  async updateRoyaltyRates(contractId, newRates) {
    const session = await EventModel.startSession();
    session.startTransaction();

    try {
      // Get event/contract
      const event = await EventModel.findById(contractId).session(session);
      
      if (!event) {
        throw new AppError('Contract/Event not found', 404);
      }

      // Validate new rates
      const validation = this.validateRoyaltyRates(newRates);
      if (!validation.isValid) {
        throw new AppError(validation.error, 400);
      }

      // Store old rates for audit
      const oldRates = {
        primaryArtist: event.royaltyConfiguration?.primaryArtist,
        splits: event.royaltyConfiguration?.splits || []
      };

      // Update rates
      event.royaltyConfiguration = {
        primaryArtist: {
          artistId: newRates.primaryArtist.artistId,
          percentage: newRates.primaryArtist.percentage
        },
        splits: newRates.splits || [],
        updatedAt: new Date(),
        updatedBy: newRates.updatedBy
      };

      // Create audit log
      const auditLog = {
        contractId,
        changeType: 'royalty_rate_update',
        oldValues: oldRates,
        newValues: newRates,
        timestamp: new Date(),
        updatedBy: newRates.updatedBy,
        reason: newRates.updateReason
      };

      event.royaltyAuditLogs = event.royaltyAuditLogs || [];
      event.royaltyAuditLogs.push(auditLog);

      await event.save({ session });

      // Update blockchain if applicable
      if (event.blockchain?.contractAddress) {
        await this.updateBlockchainRoyaltyRates({
          contractAddress: new PublicKey(event.blockchain.contractAddress),
          newRates: newRates
        });
      }

      await session.commitTransaction();

      // Clear caches
      await this.cacheService.delete(`event:${contractId}`);
      await this.cacheService.delete(`royalty:config:${contractId}`);

      // Send notifications
      await this.sendRateUpdateNotifications(event, oldRates, newRates);

      logger.info('Royalty rates updated', {
        contractId,
        oldRates,
        newRates
      });

      return {
        success: true,
        contractId,
        oldRates,
        newRates,
        effectiveDate: new Date()
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error updating royalty rates:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Audit royalty payments for a period
   */
  async auditRoyaltyPayments(period) {
    try {
      const { startDate, endDate } = this.getPeriodDates(period);

      // Get all distributions in period
      const distributions = await DistributionModel.find({
        createdAt: {
          $gte: startDate,
          $lte: endDate
        }
      })
      .populate('transactionId')
      .lean();

      // Get all transactions in period
      const transactions = await TransactionModel.find({
        createdAt: {
          $gte: startDate,
          $lte: endDate
        },
        type: 'sale'
      }).lean();

      // Audit checks
      const auditResults = {
        period,
        startDate,
        endDate,
        checks: [],
        issues: [],
        summary: {
          totalTransactions: transactions.length,
          totalDistributions: distributions.length,
          totalAmount: 0,
          discrepancies: 0
        }
      };

      // Check 1: All sales have distributions
      const salesWithoutDistributions = [];
      for (const transaction of transactions) {
        const hasDistribution = distributions.some(
          d => d.transactionId?._id?.toString() === transaction._id.toString()
        );

        if (!hasDistribution && transaction.amount > 0) {
          salesWithoutDistributions.push({
            transactionId: transaction._id,
            amount: transaction.amount,
            date: transaction.createdAt
          });
        }
      }

      if (salesWithoutDistributions.length > 0) {
        auditResults.issues.push({
          type: 'missing_distributions',
          severity: 'high',
          count: salesWithoutDistributions.length,
          details: salesWithoutDistributions
        });
      }

      // Check 2: Distribution amounts match calculations
      const incorrectDistributions = [];
      for (const distribution of distributions) {
        if (!distribution.transactionId) continue;

        const expectedRoyalty = await this.calculateRoyalty(
          distribution.transactionId.amount,
          distribution.transactionId.ticketId
        );

        const actualTotal = distributions
          .filter(d => d.transactionId?._id?.toString() === distribution.transactionId._id.toString())
          .reduce((sum, d) => sum + d.amount, 0);

        if (Math.abs(actualTotal - expectedRoyalty.royalties.total) > 0.01) {
          incorrectDistributions.push({
            transactionId: distribution.transactionId._id,
            expected: expectedRoyalty.royalties.total,
            actual: actualTotal,
            difference: actualTotal - expectedRoyalty.royalties.total
          });
        }
      }

      if (incorrectDistributions.length > 0) {
        auditResults.issues.push({
          type: 'incorrect_calculations',
          severity: 'high',
          count: incorrectDistributions.length,
          details: incorrectDistributions
        });
      }

      // Check 3: Failed distributions
      const failedDistributions = distributions.filter(d => d.status === 'failed');
      if (failedDistributions.length > 0) {
        auditResults.issues.push({
          type: 'failed_distributions',
          severity: 'medium',
          count: failedDistributions.length,
          totalAmount: failedDistributions.reduce((sum, d) => sum + d.amount, 0)
        });
      }

      // Check 4: Blockchain verification
      const blockchainMismatches = [];
      for (const distribution of distributions.filter(d => d.status === 'completed')) {
        if (distribution.blockchain?.transactionSignature) {
          const verified = await this.verifyBlockchainDistribution(
            distribution.blockchain.transactionSignature,
            distribution.amount
          );

          if (!verified) {
            blockchainMismatches.push({
              distributionId: distribution._id,
              signature: distribution.blockchain.transactionSignature,
              amount: distribution.amount
            });
          }
        }
      }

      if (blockchainMismatches.length > 0) {
        auditResults.issues.push({
          type: 'blockchain_mismatch',
          severity: 'critical',
          count: blockchainMismatches.length,
          details: blockchainMismatches
        });
      }

      // Calculate summary
      auditResults.summary.totalAmount = distributions.reduce((sum, d) => sum + d.amount, 0);
      auditResults.summary.discrepancies = auditResults.issues.length;

      // Generate audit report
      const auditReport = {
        id: `AUDIT-${period}-${Date.now()}`,
        ...auditResults,
        generatedAt: new Date(),
        recommendations: this.generateAuditRecommendations(auditResults)
      };

      // Store audit report
      await this.storeAuditReport(auditReport);

      logger.info('Royalty audit completed', {
        period,
        issues: auditResults.issues.length,
        totalAmount: auditResults.summary.totalAmount
      });

      return auditReport;
    } catch (error) {
      logger.error('Error auditing royalty payments:', error);
      throw error;
    }
  }

  /**
   * Get royalty analytics for an artist
   */
  async getRoyaltyAnalytics(artistId) {
    try {
      const cacheKey = `royalty:analytics:${artistId}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached;

      // Get all distributions
      const distributions = await DistributionModel.find({
        recipientId: artistId,
        recipientType: 'artist',
        status: 'completed'
      })
      .populate({
        path: 'transactionId',
        populate: {
          path: 'eventId'
        }
      })
      .lean();

      // Time series analysis
      const timeSeries = await this.generateTimeSeries(distributions);

      // Revenue by event
      const eventRevenue = {};
      distributions.forEach(dist => {
        const eventId = dist.transactionId?.eventId?._id?.toString();
        if (!eventId) return;

        if (!eventRevenue[eventId]) {
          eventRevenue[eventId] = {
            eventName: dist.transactionId.eventId.name,
            revenue: 0,
            distributionCount: 0,
            firstPayment: dist.createdAt,
            lastPayment: dist.createdAt
          };
        }

        eventRevenue[eventId].revenue += dist.amount;
        eventRevenue[eventId].distributionCount += 1;
        eventRevenue[eventId].lastPayment = new Date(
          Math.max(eventRevenue[eventId].lastPayment, dist.createdAt)
        );
      });

      // Growth metrics
      const growthMetrics = await this.calculateGrowthMetrics(distributions);

      // Predictive analytics
      const predictions = await this.generateRevenuePredictions(
        artistId,
        timeSeries
      );

      // Performance indicators
      const kpis = {
        totalRevenue: distributions.reduce((sum, d) => sum + d.amount, 0),
        averagePayment: distributions.length > 0 ?
          distributions.reduce((sum, d) => sum + d.amount, 0) / distributions.length : 0,
        paymentFrequency: this.calculatePaymentFrequency(distributions),
        topRevenueEvent: Object.values(eventRevenue)
          .sort((a, b) => b.revenue - a.revenue)[0],
        revenueConcentration: this.calculateRevenueConcentration(eventRevenue)
      };

      const analytics = {
        artistId,
        summary: kpis,
        timeSeries,
        eventBreakdown: Object.values(eventRevenue),
        growthMetrics,
        predictions,
        insights: await this.generateInsights(kpis, growthMetrics, eventRevenue),
        lastUpdated: new Date()
      };

      // Cache for 30 minutes
      await this.cacheService.set(cacheKey, analytics, 1800);

      return analytics;
    } catch (error) {
      logger.error('Error getting royalty analytics:', error);
      throw error;
    }
  }

  // Helper methods

  calculateIndividualRoyalty(salePrice, percentage) {
    return salePrice
      .multipliedBy(percentage)
      .dividedBy(100)
      .decimalPlaces(3, BigNumber.ROUND_DOWN);
  }

  async getRecipientWallet(recipientId, recipientType) {
    try {
      let recipient;
      
      switch (recipientType) {
        case 'artist':
          recipient = await ArtistModel.findById(recipientId);
          break;
        case 'collaborator':
        case 'producer':
          recipient = await UserModel.findById(recipientId);
          break;
        default:
          throw new AppError(`Unknown recipient type: ${recipientType}`, 400);
      }

      return {
        walletAddress: recipient?.walletAddress,
        email: recipient?.email,
        name: recipient?.name || recipient?.username
      };
    } catch (error) {
      logger.error('Error getting recipient wallet:', error);
      return { walletAddress: null };
    }
  }

  async executeBlockchainDistributions(transactions) {
    try {
      // Batch transactions for efficiency
      const results = await this.blockchainService.batchDistributeRoyalties(
        transactions
      );

      return results;
    } catch (error) {
      logger.error('Error executing blockchain distributions:', error);
      // Return individual failures
      return transactions.map(() => ({
        success: false,
        error: error.message
      }));
    }
  }

  async executeSingleDistribution(transaction) {
    try {
      const result = await this.blockchainService.distributeRoyalty(transaction);
      return result;
    } catch (error) {
      logger.error('Error executing single distribution:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendDistributionNotifications(distributions) {
    try {
      const notifications = distributions.map(dist => {
        if (dist.status !== 'completed') return null;

        return this.notificationService.sendNotification({
          userId: dist.recipientId,
          type: 'royalty_received',
          title: 'Royalty Payment Received',
          message: `You received ${dist.amount} SOL in royalties`,
          data: {
            distributionId: dist._id,
            amount: dist.amount,
            transactionSignature: dist.blockchain?.transactionSignature
          }
        });
      }).filter(Boolean);

      await Promise.all(notifications);
    } catch (error) {
      logger.error('Error sending distribution notifications:', error);
    }
  }

  async sendDistributionNotification(distribution) {
    try {
      await this.notificationService.sendNotification({
        userId: distribution.recipientId,
        type: 'royalty_received',
        title: 'Royalty Payment Received',
        message: `You received ${distribution.amount} SOL in royalties`,
        data: {
          distributionId: distribution._id,
          amount: distribution.amount,
          transactionSignature: distribution.blockchain?.transactionSignature
        }
      });
    } catch (error) {
      logger.error('Error sending distribution notification:', error);
    }
  }

  buildDateFilter(period) {
    const now = new Date();
    let startDate;

    switch (period) {
      case 'day':
        startDate = new Date(now.setDate(now.getDate() - 1));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'quarter':
        startDate = new Date(now.setMonth(now.getMonth() - 3));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      case 'all':
      default:
        return null;
    }

    return { $gte: startDate };
  }

  groupDistributionsByPeriod(distributions, period) {
    const grouping = {};

    distributions.forEach(dist => {
      const date = new Date(dist.createdAt);
      let key;

      switch (period) {
        case 'day':
          key = date.toISOString().split('T')[0];
          break;
        case 'week':
          const week = this.getWeekNumber(date);
          key = `${date.getFullYear()}-W${week}`;
          break;
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        case 'year':
          key = date.getFullYear().toString();
          break;
        default:
          key = date.toISOString().split('T')[0];
      }

      if (!grouping[key]) {
        grouping[key] = {
          period: key,
          amount: 0,
          count: 0,
          distributions: []
        };
      }

      grouping[key].amount += dist.amount;
      grouping[key].count += 1;
      grouping[key].distributions.push(dist);
    });

    return Object.values(grouping).sort((a, b) => b.period.localeCompare(a.period));
  }

  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  async calculateTaxSummary(distributions) {
    // Implement tax calculation logic based on jurisdiction
    return {
      grossIncome: distributions.reduce((sum, d) => sum + d.amount, 0),
      estimatedTax: 0, // Calculate based on tax rates
      netIncome: 0 // Gross - tax
    };
  }

  async groupByStatus(distributions) {
    const grouping = {};
    
    distributions.forEach(dist => {
      if (!grouping[dist.status]) {
        grouping[dist.status] = {
          status: dist.status,
          count: 0,
          amount: 0
        };
      }
      
      grouping[dist.status].count += 1;
      grouping[dist.status].amount += dist.amount;
    });

    return grouping;
  }

  async groupByRole(distributions) {
    const grouping = {};
    
    distributions.forEach(dist => {
      const role = dist.role || 'unknown';
      if (!grouping[role]) {
        grouping[role] = {
          role,
          count: 0,
          amount: 0
        };
      }
      
      grouping[role].count += 1;
      grouping[role].amount += dist.amount;
    });

    return grouping;
  }

  async groupByMonth(distributions, startDate, endDate) {
    const months = [];
    const current = new Date(startDate);
    
    while (current <= new Date(endDate)) {
      const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        month: monthKey,
        amount: 0,
        count: 0
      });
      current.setMonth(current.getMonth() + 1);
    }

    distributions.forEach(dist => {
      const date = new Date(dist.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthData = months.find(m => m.month === monthKey);
      
      if (monthData) {
        monthData.amount += dist.amount;
        monthData.count += 1;
      }
    });

    return months;
  }

  async storeReport(report) {
    // Implement report storage logic
    logger.info('Report stored', { reportId: report.reportId });
  }

  validateRoyaltyRates(rates) {
    const errors = [];

    if (!rates.primaryArtist || !rates.primaryArtist.percentage) {
      errors.push('Primary artist percentage is required');
    }

    const totalPercentage = (rates.primaryArtist?.percentage || 0) +
      (rates.splits || []).reduce((sum, split) => sum + split.percentage, 0);

    if (totalPercentage > this.MAX_ROYALTY_PERCENTAGE) {
      errors.push(`Total royalty percentage cannot exceed ${this.MAX_ROYALTY_PERCENTAGE}%`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      error: errors[0] || null
    };
  }

  async updateBlockchainRoyaltyRates(data) {
    try {
      await this.blockchainService.updateRoyaltyRates(data);
    } catch (error) {
      logger.error('Error updating blockchain royalty rates:', error);
      throw error;
    }
  }

  async sendRateUpdateNotifications(event, oldRates, newRates) {
    // Send notifications to affected parties
    const notifications = [];

    // Notify primary artist if changed
    if (oldRates.primaryArtist?.artistId !== newRates.primaryArtist?.artistId ||
        oldRates.primaryArtist?.percentage !== newRates.primaryArtist?.percentage) {
      notifications.push(
        this.notificationService.sendNotification({
          userId: newRates.primaryArtist.artistId,
          type: 'royalty_rate_updated',
          title: 'Royalty Rate Updated',
          message: `Your royalty rate for ${event.name} has been updated to ${newRates.primaryArtist.percentage}%`,
          data: { eventId: event._id }
        })
      );
    }

    await Promise.all(notifications);
  }

  getPeriodDates(period) {
    const now = new Date();
    let startDate, endDate;

    switch (period) {
      case 'day':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        endDate = new Date(now.setHours(23, 59, 59, 999));
        break;
      case 'week':
        const firstDay = now.getDate() - now.getDay();
        startDate = new Date(now.setDate(firstDay));
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        endDate.setHours(23, 59, 59, 999);
        break;
      default:
        throw new AppError(`Invalid period: ${period}`, 400);
    }

    return { startDate, endDate };
  }

  async verifyBlockchainDistribution(signature, expectedAmount) {
    try {
      const verified = await this.blockchainService.verifyTransaction(
        signature,
        expectedAmount
      );
      return verified;
    } catch (error) {
      logger.error('Error verifying blockchain distribution:', error);
      return false;
    }
  }

  generateAuditRecommendations(auditResults) {
    const recommendations = [];

    if (auditResults.issues.some(i => i.type === 'missing_distributions')) {
      recommendations.push({
        priority: 'high',
        action: 'Process missing royalty distributions immediately',
        impact: 'Legal compliance and artist satisfaction'
      });
    }

    if (auditResults.issues.some(i => i.type === 'failed_distributions')) {
      recommendations.push({
        priority: 'medium',
        action: 'Retry failed distributions with manual review',
        impact: 'Revenue recovery and system reliability'
      });
    }

    if (auditResults.issues.some(i => i.type === 'blockchain_mismatch')) {
      recommendations.push({
        priority: 'critical',
        action: 'Investigate blockchain discrepancies immediately',
        impact: 'Financial integrity and trust'
      });
    }

    return recommendations;
  }

  async storeAuditReport(report) {
    // Implement audit report storage
    logger.info('Audit report stored', { reportId: report.id });
  }

  async generateTimeSeries(distributions) {
    // Group by day for time series
    const series = {};
    
    distributions.forEach(dist => {
      const date = new Date(dist.createdAt).toISOString().split('T')[0];
      if (!series[date]) {
        series[date] = {
          date,
          revenue: 0,
          count: 0
        };
      }
      series[date].revenue += dist.amount;
      series[date].count += 1;
    });

    return Object.values(series).sort((a, b) => a.date.localeCompare(b.date));
  }

  async calculateGrowthMetrics(distributions) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
    const sixtyDaysAgo = new Date(now.setDate(now.getDate() - 60));

    const last30Days = distributions.filter(d => d.createdAt > thirtyDaysAgo);
    const previous30Days = distributions.filter(
      d => d.createdAt > sixtyDaysAgo && d.createdAt <= thirtyDaysAgo
    );

    const currentRevenue = last30Days.reduce((sum, d) => sum + d.amount, 0);
    const previousRevenue = previous30Days.reduce((sum, d) => sum + d.amount, 0);

    const growth = previousRevenue > 0 ?
      ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;

    return {
      currentPeriodRevenue: currentRevenue,
      previousPeriodRevenue: previousRevenue,
      growthRate: growth,
      trend: growth > 0 ? 'increasing' : growth < 0 ? 'decreasing' : 'stable'
    };
  }

  async generateRevenuePredictions(artistId, timeSeries) {
    // Simple prediction based on trend
    // In production, use more sophisticated ML models
    if (timeSeries.length < 7) {
      return null;
    }

    const recentData = timeSeries.slice(-30);
    const avgDailyRevenue = recentData.reduce((sum, d) => sum + d.revenue, 0) / recentData.length;

    return {
      next30Days: avgDailyRevenue * 30,
      next90Days: avgDailyRevenue * 90,
      nextYear: avgDailyRevenue * 365,
      confidence: 'medium',
      basedOn: 'historical_average'
    };
  }

  calculatePaymentFrequency(distributions) {
    if (distributions.length < 2) return 0;

    const sortedDists = distributions.sort((a, b) => 
      new Date(a.createdAt) - new Date(b.createdAt)
    );

    let totalDays = 0;
    for (let i = 1; i < sortedDists.length; i++) {
      const daysBetween = (new Date(sortedDists[i].createdAt) - 
        new Date(sortedDists[i-1].createdAt)) / 86400000;
      totalDays += daysBetween;
    }

    return totalDays / (sortedDists.length - 1);
  }

  calculateRevenueConcentration(eventRevenue) {
    const revenues = Object.values(eventRevenue).map(e => e.revenue);
    const totalRevenue = revenues.reduce((sum, r) => sum + r, 0);
    
    if (totalRevenue === 0) return 0;

    const sortedRevenues = revenues.sort((a, b) => b - a);
    const top20Percent = Math.ceil(sortedRevenues.length * 0.2);
    const top20Revenue = sortedRevenues.slice(0, top20Percent).reduce((sum, r) => sum + r, 0);

    return (top20Revenue / totalRevenue) * 100;
  }

  async generateInsights(kpis, growthMetrics, eventRevenue) {
    const insights = [];

    // Growth insights
    if (growthMetrics.growthRate > 20) {
      insights.push({
        type: 'positive',
        message: `Revenue growing at ${growthMetrics.growthRate.toFixed(1)}% month-over-month`,
        importance: 'high'
      });
    } else if (growthMetrics.growthRate < -10) {
      insights.push({
        type: 'warning',
        message: `Revenue declining by ${Math.abs(growthMetrics.growthRate).toFixed(1)}%`,
        importance: 'high'
      });
    }

    // Concentration insights
    if (kpis.revenueConcentration > 80) {
      insights.push({
        type: 'warning',
        message: 'Revenue highly concentrated in few events - consider diversification',
        importance: 'medium'
      });
    }

    // Payment frequency insights
    if (kpis.paymentFrequency < 7) {
      insights.push({
        type: 'positive',
        message: 'Receiving royalties frequently - good cash flow',
        importance: 'low'
      });
    }

    return insights;
  }

  async clearDistributionCaches(transactionId) {
    await this.cacheService.delete(`royalty:*${transactionId}*`);
    await this.cacheService.delete(`transaction:${transactionId}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  startBatchProcessor() {
    setInterval(async () => {
      try {
        await this.processDelayedDistribution();
      } catch (error) {
        logger.error('Error in batch processor:', error);
      }
    }, this.DISTRIBUTION_BATCH_INTERVAL);
  }
}

module.exports = new RoyaltyDistributionService();
