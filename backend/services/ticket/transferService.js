const { PublicKey, Transaction } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const TicketModel = require('../../models/Ticket');
const TransferModel = require('../../models/Transfer');
const UserModel = require('../../models/User');
const EventModel = require('../../models/Event');
const BlockchainService = require('../blockchain/blockchainService');
const NotificationService = require('../notifications/notificationService');
const EmailService = require('../email/emailService');
const CacheService = require('../cache/cacheService');
const RoyaltyService = require('../marketplace/royaltyDistributionService');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const crypto = require('crypto');
const BigNumber = require('bignumber.js');

class TransferService {
  constructor() {
    this.blockchainService = new BlockchainService();
    this.notificationService = new NotificationService();
    this.emailService = new EmailService();
    this.cacheService = new CacheService();
    this.royaltyService = new RoyaltyService();
    
    // Configuration
    this.config = {
      transferFee: {
        percentage: 2.5, // 2.5% platform fee
        minimum: 0.1, // 0.1 SOL minimum
        maximum: 10 // 10 SOL maximum
      },
      artistRoyalty: {
        percentage: 5, // 5% to original artist/organizer
        enabled: true
      },
      transferTimeout: 24 * 60 * 60 * 1000, // 24 hours
      maxTransfersPerTicket: 5, // Maximum number of transfers allowed
      cooldownPeriod: 60 * 60 * 1000, // 1 hour between transfers
      restrictedPeriod: 48 * 60 * 60 * 1000, // 48 hours before event
      verificationRequired: true,
      antiScalpingEnabled: true
    };
    
    // Start background job for expired transfers
    this.startTransferCleanup();
  }

  /**
   * Initiate a ticket transfer
   */
  async initiateTransfer(ticketId, fromUserId, toUserId, options = {}) {
    const session = await TransferModel.startSession();
    session.startTransaction();
    
    const transferId = crypto.randomBytes(16).toString('hex');
    
    try {
      logger.info('Initiating ticket transfer', {
        transferId,
        ticketId,
        fromUserId,
        toUserId
      });

      // Get ticket details
      const ticket = await TicketModel.findById(ticketId)
        .populate('eventId')
        .populate('userId')
        .session(session);
      
      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      // Verify ownership
      if (ticket.userId._id.toString() !== fromUserId) {
        throw new AppError('You do not own this ticket', 403);
      }

      // Get recipient details
      const recipient = await UserModel.findById(toUserId).session(session);
      if (!recipient) {
        throw new AppError('Recipient not found', 404);
      }

      // Validate transfer
      const validation = await this.validateTransfer({
        ticket,
        fromUser: ticket.userId,
        toUser: recipient,
        event: ticket.eventId,
        options
      });

      if (!validation.isValid) {
        throw new AppError(validation.error, 400);
      }

      // Check transfer restrictions
      const restrictions = await this.validateTransferRestrictions(ticket);
      if (restrictions.restricted) {
        throw new AppError(restrictions.reason, 400);
      }

      // Calculate transfer fees
      const fees = await this.calculateTransferFees({
        ticket,
        event: ticket.eventId,
        transferType: options.transferType || 'sale',
        price: options.price || 0
      });

      // Create transfer record
      const transfer = new TransferModel({
        transferId,
        ticketId,
        fromUserId,
        toUserId,
        status: 'pending',
        type: options.transferType || 'sale',
        fees: {
          platformFee: fees.platformFee,
          royaltyFee: fees.royaltyFee,
          totalFees: fees.totalFees,
          netAmount: fees.netAmount
        },
        price: options.price || 0,
        verification: {
          required: this.config.verificationRequired,
          fromUserVerified: false,
          toUserVerified: false,
          code: this.generateVerificationCode()
        },
        metadata: {
          eventName: ticket.eventId.name,
          ticketTier: ticket.tier,
          seatInfo: ticket.seatInfo,
          originalPrice: ticket.price,
          transferCount: ticket.transferHistory?.length || 0
        },
        expiresAt: new Date(Date.now() + this.config.transferTimeout)
      });

      await transfer.save({ session });

      // Lock ticket to prevent concurrent transfers
      ticket.status = 'locked';
      ticket.lockedFor = 'transfer';
      ticket.lockedUntil = transfer.expiresAt;
      ticket.pendingTransferId = transfer._id;
      await ticket.save({ session });

      // If immediate transfer (gift), process it
      if (options.immediate && options.transferType === 'gift') {
        await this.processImmediateTransfer(transfer, ticket, session);
      } else {
        // Send verification requests
        await this.sendVerificationRequests(transfer, ticket);
      }

      await session.commitTransaction();

      // Clear caches
      await this.clearTransferCaches(ticketId, fromUserId, toUserId);

      logger.info('Transfer initiated successfully', {
        transferId,
        type: transfer.type,
        requiresVerification: !options.immediate
      });

      return {
        success: true,
        transfer: {
          id: transfer._id,
          transferId: transfer.transferId,
          status: transfer.status,
          type: transfer.type,
          fees: transfer.fees,
          verification: options.immediate ? null : {
            required: transfer.verification.required,
            code: transfer.verification.code
          },
          expiresAt: transfer.expiresAt
        }
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error initiating transfer:', error);
      
      // Clean up on failure
      await this.handleTransferFailure(transferId, error);
      
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Validate transfer eligibility
   */
  async validateTransfer(transferData) {
    const errors = [];

    // Check if ticket exists and is active
    if (!transferData.ticket) {
      errors.push('Invalid ticket');
    } else if (transferData.ticket.status !== 'active' && transferData.ticket.status !== 'locked') {
      errors.push('Ticket is not available for transfer');
    }

    // Check event status
    if (!transferData.event) {
      errors.push('Event information missing');
    } else {
      if (transferData.event.status === 'cancelled') {
        errors.push('Cannot transfer tickets for cancelled events');
      }

      // Check if event has already occurred
      if (new Date(transferData.event.startDate) < new Date()) {
        errors.push('Cannot transfer tickets for past events');
      }

      // Check if within restricted period
      const hoursUntilEvent = (new Date(transferData.event.startDate) - new Date()) / (1000 * 60 * 60);
      if (hoursUntilEvent < 48 && transferData.event.restrictLastMinuteTransfers) {
        errors.push('Transfers are restricted within 48 hours of the event');
      }
    }

    // Validate users
    if (!transferData.fromUser) {
      errors.push('Sender information missing');
    } else {
      // Check if sender is verified (if required)
      if (this.config.verificationRequired && !transferData.fromUser.isVerified) {
        errors.push('Sender account must be verified');
      }

      // Check if sender is suspended
      if (transferData.fromUser.status === 'suspended') {
        errors.push('Sender account is suspended');
      }
    }

    if (!transferData.toUser) {
      errors.push('Recipient information missing');
    } else {
      // Check if recipient can receive transfers
      if (transferData.toUser.status === 'suspended') {
        errors.push('Recipient account is suspended');
      }

      // Check if recipient has wallet address
      if (!transferData.toUser.walletAddress) {
        errors.push('Recipient must have a wallet address');
      }

      // Check recipient limits
      const recipientTickets = await this.getRecipientEventTickets(
        transferData.toUser._id,
        transferData.event._id
      );

      const maxTicketsPerUser = transferData.event.maxTicketsPerUser || 10;
      if (recipientTickets.length >= maxTicketsPerUser) {
        errors.push(`Recipient already has maximum tickets (${maxTicketsPerUser}) for this event`);
      }
    }

    // Validate transfer type and price
    if (transferData.options?.transferType === 'sale') {
      if (!transferData.options.price || transferData.options.price <= 0) {
        errors.push('Sale price must be specified');
      }

      // Check anti-scalping rules
      if (this.config.antiScalpingEnabled) {
        const scalpingCheck = await this.checkAntiScalpingRules(
          transferData.ticket,
          transferData.options.price
        );
        if (scalpingCheck.violated) {
          errors.push(scalpingCheck.reason);
        }
      }
    }

    // Check transfer cooldown
    if (transferData.ticket.lastTransferredAt) {
      const timeSinceLastTransfer = Date.now() - new Date(transferData.ticket.lastTransferredAt);
      if (timeSinceLastTransfer < this.config.cooldownPeriod) {
        const remainingTime = Math.ceil((this.config.cooldownPeriod - timeSinceLastTransfer) / 60000);
        errors.push(`Please wait ${remainingTime} minutes before transferring again`);
      }
    }

    // Check maximum transfers
    const transferCount = transferData.ticket.transferHistory?.length || 0;
    if (transferCount >= this.config.maxTransfersPerTicket) {
      errors.push('Maximum transfer limit reached for this ticket');
    }

    return {
      isValid: errors.length === 0,
      errors,
      error: errors[0] || null
    };
  }

  /**
   * Process blockchain NFT transfer
   */
  async processBlockchainTransfer(ticketId, fromWallet, toWallet) {
    try {
      logger.info('Processing blockchain transfer', {
        ticketId,
        from: fromWallet,
        to: toWallet
      });

      // Get ticket NFT details
      const ticket = await TicketModel.findById(ticketId);
      if (!ticket || !ticket.blockchain?.mintAddress) {
        throw new AppError('Ticket NFT not found', 404);
      }

      // Execute NFT transfer on blockchain
      const transferResult = await this.blockchainService.transferNFT({
        mint: new PublicKey(ticket.blockchain.mintAddress),
        from: new PublicKey(fromWallet),
        to: new PublicKey(toWallet),
        programId: TOKEN_PROGRAM_ID
      });

      // Wait for confirmation
      const confirmed = await this.blockchainService.confirmTransaction(
        transferResult.signature,
        'finalized'
      );

      if (!confirmed) {
        throw new AppError('Blockchain transfer not confirmed', 500);
      }

      // Verify new ownership on chain
      const ownershipVerified = await this.blockchainService.verifyNFTOwnership(
        new PublicKey(ticket.blockchain.mintAddress),
        new PublicKey(toWallet)
      );

      if (!ownershipVerified) {
        throw new AppError('Ownership verification failed', 500);
      }

      logger.info('Blockchain transfer completed', {
        ticketId,
        signature: transferResult.signature
      });

      return {
        success: true,
        signature: transferResult.signature,
        confirmedAt: new Date()
      };
    } catch (error) {
      logger.error('Blockchain transfer error:', error);
      throw error;
    }
  }

  /**
   * Update ticket ownership in database
   */
  async updateTicketOwnership(ticketId, newOwnerId, transferId) {
    const session = await TicketModel.startSession();
    session.startTransaction();

    try {
      const ticket = await TicketModel.findById(ticketId).session(session);
      const transfer = await TransferModel.findById(transferId).session(session);
      
      if (!ticket || !transfer) {
        throw new AppError('Ticket or transfer not found', 404);
      }

      // Store previous owner in history
      ticket.transferHistory = ticket.transferHistory || [];
      ticket.transferHistory.push({
        transferId: transfer._id,
        fromUserId: ticket.userId,
        toUserId: newOwnerId,
        transferredAt: new Date(),
        type: transfer.type,
        price: transfer.price
      });

      // Update ownership
      ticket.userId = newOwnerId;
      ticket.lastTransferredAt = new Date();
      ticket.status = 'active';
      ticket.lockedFor = null;
      ticket.lockedUntil = null;
      ticket.pendingTransferId = null;

      await ticket.save({ session });

      // Update transfer status
      transfer.status = 'completed';
      transfer.completedAt = new Date();
      transfer.blockchain = {
        transactionSignature: transfer.blockchain?.transactionSignature,
        confirmedAt: new Date()
      };

      await transfer.save({ session });

      await session.commitTransaction();

      // Clear caches
      await this.clearOwnershipCaches(ticketId, ticket.userId, newOwnerId);

      logger.info('Ticket ownership updated', {
        ticketId,
        newOwnerId,
        transferId
      });

      return {
        success: true,
        ticket,
        transfer
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error updating ownership:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Notify transfer parties
   */
  async notifyTransferParties(transferData) {
    try {
      const { transfer, ticket, fromUser, toUser, event } = transferData;

      // Notify sender
      await this.notificationService.sendNotification({
        userId: fromUser._id,
        type: 'transfer_completed',
        title: 'Ticket Transfer Completed',
        message: `Your ticket for ${event.name} has been successfully transferred`,
        data: {
          transferId: transfer._id,
          ticketId: ticket._id,
          recipientName: toUser.username
        }
      });

      // Notify recipient
      await this.notificationService.sendNotification({
        userId: toUser._id,
        type: 'ticket_received',
        title: 'Ticket Received!',
        message: `You have received a ticket for ${event.name}`,
        data: {
          transferId: transfer._id,
          ticketId: ticket._id,
          senderName: fromUser.username
        }
      });

      // Send email confirmations
      await Promise.all([
        this.emailService.sendTransferConfirmation({
          to: fromUser.email,
          type: 'sender',
          ticketDetails: {
            eventName: event.name,
            eventDate: event.startDate,
            ticketTier: ticket.tier,
            recipientName: toUser.username
          },
          transferId: transfer.transferId
        }),
        this.emailService.sendTransferConfirmation({
          to: toUser.email,
          type: 'recipient',
          ticketDetails: {
            eventName: event.name,
            eventDate: event.startDate,
            ticketTier: ticket.tier,
            senderName: fromUser.username,
            seatInfo: ticket.seatInfo
          },
          transferId: transfer.transferId,
          ticketUrl: `${process.env.APP_URL}/tickets/${ticket._id}`
        })
      ]);

      // Notify event organizer if configured
      if (event.notifyOnTransfers) {
        await this.notificationService.sendNotification({
          userId: event.organizerId,
          type: 'ticket_transferred',
          title: 'Ticket Transfer Alert',
          message: `A ticket for ${event.name} was transferred`,
          data: {
            transferId: transfer._id,
            from: fromUser.username,
            to: toUser.username
          }
        });
      }

      logger.info('Transfer notifications sent', {
        transferId: transfer._id
      });

      return { success: true };
    } catch (error) {
      logger.error('Error sending notifications:', error);
      // Don't throw - notifications are not critical
      return { success: false, error: error.message };
    }
  }

  /**
   * Log transfer history for audit trail
   */
  async logTransferHistory(transferData) {
    try {
      const auditLog = {
        transferId: transferData.transferId,
        ticketId: transferData.ticketId,
        fromUserId: transferData.fromUserId,
        toUserId: transferData.toUserId,
        type: transferData.type,
        price: transferData.price,
        fees: transferData.fees,
        timestamp: new Date(),
        metadata: {
          eventId: transferData.eventId,
          eventName: transferData.eventName,
          ticketTier: transferData.ticketTier,
          seatInfo: transferData.seatInfo,
          blockchainSignature: transferData.blockchainSignature,
          ipAddress: transferData.ipAddress,
          userAgent: transferData.userAgent
        }
      };

      // Store in audit collection
      await this.storeAuditLog(auditLog);

      // Update analytics
      await this.updateTransferAnalytics(transferData);

      logger.info('Transfer history logged', {
        transferId: transferData.transferId
      });

      return { success: true };
    } catch (error) {
      logger.error('Error logging transfer history:', error);
      // Don't throw - logging is not critical
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle transfer failure and cleanup
   */
  async handleTransferFailure(transferId, error) {
    try {
      const transfer = await TransferModel.findOne({ transferId });
      if (!transfer) return;

      // Update transfer status
      transfer.status = 'failed';
      transfer.failureReason = error.message;
      transfer.failedAt = new Date();
      await transfer.save();

      // Unlock ticket if it was locked
      if (transfer.ticketId) {
        await TicketModel.findByIdAndUpdate(transfer.ticketId, {
          status: 'active',
          lockedFor: null,
          lockedUntil: null,
          pendingTransferId: null
        });
      }

      // Notify parties of failure
      await this.notifyTransferFailure(transfer, error);

      logger.info('Transfer failure handled', {
        transferId,
        reason: error.message
      });
    } catch (cleanupError) {
      logger.error('Error handling transfer failure:', cleanupError);
    }
  }

  /**
   * Calculate transfer fees
   */
  async calculateTransferFees(ticketData) {
    try {
      const basePrice = new BigNumber(ticketData.price || 0);
      let platformFee = new BigNumber(0);
      let royaltyFee = new BigNumber(0);

      // Calculate platform fee only for sales
      if (ticketData.transferType === 'sale' && ticketData.price > 0) {
        // Percentage-based fee
        platformFee = basePrice
          .multipliedBy(this.config.transferFee.percentage)
          .dividedBy(100);

        // Apply minimum and maximum
        platformFee = BigNumber.max(
          platformFee,
          new BigNumber(this.config.transferFee.minimum)
        );
        platformFee = BigNumber.min(
          platformFee,
          new BigNumber(this.config.transferFee.maximum)
        );

        // Calculate artist royalty
        if (this.config.artistRoyalty.enabled) {
          royaltyFee = basePrice
            .multipliedBy(this.config.artistRoyalty.percentage)
            .dividedBy(100);
        }
      }

      const totalFees = platformFee.plus(royaltyFee);
      const netAmount = basePrice.minus(totalFees);

      return {
        price: basePrice.toNumber(),
        platformFee: platformFee.toNumber(),
        royaltyFee: royaltyFee.toNumber(),
        totalFees: totalFees.toNumber(),
        netAmount: netAmount.toNumber(),
        breakdown: {
          platformFeePercentage: this.config.transferFee.percentage,
          royaltyPercentage: this.config.artistRoyalty.percentage,
          currency: 'SOL'
        }
      };
    } catch (error) {
      logger.error('Error calculating transfer fees:', error);
      throw error;
    }
  }

  /**
   * Validate transfer restrictions
   */
  async validateTransferRestrictions(ticket) {
    const restrictions = {
      restricted: false,
      reasons: []
    };

    // Check if ticket is non-transferable
    if (ticket.restrictions?.nonTransferable) {
      restrictions.restricted = true;
      restrictions.reasons.push('This ticket is non-transferable');
    }

    // Check event-specific restrictions
    const event = ticket.eventId;
    if (event.transferRestrictions) {
      // Name match requirement
      if (event.transferRestrictions.requireNameMatch) {
        restrictions.restricted = true;
        restrictions.reasons.push('Ticket holder name must match ID at entry');
      }

      // Time-based restrictions
      if (event.transferRestrictions.blackoutDates) {
        const now = new Date();
        const isBlackout = event.transferRestrictions.blackoutDates.some(
          period => now >= new Date(period.start) && now <= new Date(period.end)
        );
        
        if (isBlackout) {
          restrictions.restricted = true;
          restrictions.reasons.push('Transfers are restricted during this period');
        }
      }

      // Geographic restrictions
      if (event.transferRestrictions.allowedCountries) {
        // Would need to check recipient's country
        // Implementation depends on user data structure
      }
    }

    // Check if ticket has already been used
    if (ticket.status === 'used') {
      restrictions.restricted = true;
      restrictions.reasons.push('Used tickets cannot be transferred');
    }

    // Check pending transfers
    if (ticket.pendingTransferId) {
      restrictions.restricted = true;
      restrictions.reasons.push('Ticket has a pending transfer');
    }

    return {
      restricted: restrictions.restricted,
      reason: restrictions.reasons[0] || null,
      reasons: restrictions.reasons
    };
  }

  /**
   * Generate transfer receipt
   */
  async generateTransferReceipt(transferId) {
    try {
      const transfer = await TransferModel.findById(transferId)
        .populate('ticketId')
        .populate('fromUserId')
        .populate('toUserId');

      if (!transfer) {
        throw new AppError('Transfer not found', 404);
      }

      const ticket = await TicketModel.findById(transfer.ticketId)
        .populate('eventId');

      const receipt = {
        receiptNumber: `TRF-${transfer.transferId}`,
        date: transfer.completedAt || transfer.createdAt,
        type: transfer.type,
        parties: {
          from: {
            name: transfer.fromUserId.name || transfer.fromUserId.username,
            email: transfer.fromUserId.email,
            userId: transfer.fromUserId._id
          },
          to: {
            name: transfer.toUserId.name || transfer.toUserId.username,
            email: transfer.toUserId.email,
            userId: transfer.toUserId._id
          }
        },
        ticket: {
          ticketNumber: ticket.ticketNumber,
          event: ticket.eventId.name,
          eventDate: ticket.eventId.startDate,
          tier: ticket.tier,
          seat: ticket.seatInfo
        },
        financial: transfer.type === 'sale' ? {
          price: transfer.price,
          platformFee: transfer.fees.platformFee,
          royaltyFee: transfer.fees.royaltyFee,
          totalFees: transfer.fees.totalFees,
          netAmount: transfer.fees.netAmount,
          currency: 'SOL'
        } : null,
        blockchain: {
          transactionSignature: transfer.blockchain?.transactionSignature,
          mintAddress: ticket.blockchain.mintAddress,
          confirmedAt: transfer.blockchain?.confirmedAt
        },
        verification: {
          transferId: transfer.transferId,
          completedAt: transfer.completedAt
        }
      };

      // Generate PDF receipt
      const pdfUrl = await this.generatePDFReceipt(receipt);
      receipt.pdfUrl = pdfUrl;

      // Generate verification QR code
      const qrCode = await this.generateTransferQRCode(transfer);
      receipt.qrCode = qrCode;

      return receipt;
    } catch (error) {
      logger.error('Error generating transfer receipt:', error);
      throw error;
    }
  }

  // Helper methods

  async getRecipientEventTickets(userId, eventId) {
    return await TicketModel.find({
      userId,
      eventId,
      status: { $in: ['active', 'locked'] }
    });
  }

  async checkAntiScalpingRules(ticket, salePrice) {
    const rules = {
      violated: false,
      reasons: []
    };

    // Check price markup
    const originalPrice = ticket.price;
    const markup = ((salePrice - originalPrice) / originalPrice) * 100;
    
    const maxMarkup = ticket.eventId.maxResaleMarkup || 20; // 20% default
    if (markup > maxMarkup) {
      rules.violated = true;
      rules.reasons.push(`Price markup exceeds ${maxMarkup}% limit`);
    }

    // Check seller history
    const sellerTransfers = await TransferModel.find({
      fromUserId: ticket.userId,
      type: 'sale',
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });

    if (sellerTransfers.length > 10) {
      rules.violated = true;
      rules.reasons.push('Excessive selling activity detected');
    }

    return {
      violated: rules.violated,
      reason: rules.reasons[0] || null,
      markup,
      sellerActivity: sellerTransfers.length
    };
  }

  generateVerificationCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  async processImmediateTransfer(transfer, ticket, session) {
    try {
      // Skip verification for immediate transfers (gifts)
      transfer.verification.fromUserVerified = true;
      transfer.verification.toUserVerified = true;
      transfer.verification.verifiedAt = new Date();

      // Get wallet addresses
      const fromUser = await UserModel.findById(transfer.fromUserId);
      const toUser = await UserModel.findById(transfer.toUserId);

      // Process blockchain transfer
      const blockchainResult = await this.processBlockchainTransfer(
        ticket._id,
        fromUser.walletAddress,
        toUser.walletAddress
      );

      transfer.blockchain = {
        transactionSignature: blockchainResult.signature,
        confirmedAt: blockchainResult.confirmedAt
      };

      await transfer.save({ session });

      // Update ownership will be handled after transaction commits
    } catch (error) {
      logger.error('Error processing immediate transfer:', error);
      throw error;
    }
  }

  async sendVerificationRequests(transfer, ticket) {
    try {
      const fromUser = await UserModel.findById(transfer.fromUserId);
      const toUser = await UserModel.findById(transfer.toUserId);

      // Send verification email to sender
      await this.emailService.sendTransferVerification({
        to: fromUser.email,
        type: 'sender',
        transferId: transfer.transferId,
        verificationCode: transfer.verification.code,
        ticketDetails: {
          eventName: transfer.metadata.eventName,
          ticketTier: transfer.metadata.ticketTier,
          recipientName: toUser.username
        },
        verificationUrl: `${process.env.APP_URL}/transfers/verify/${transfer.transferId}`
      });

      // Send notification to recipient
      await this.notificationService.sendNotification({
        userId: transfer.toUserId,
        type: 'transfer_pending',
        title: 'Ticket Transfer Pending',
        message: `${fromUser.username} wants to transfer a ticket to you`,
        data: {
          transferId: transfer._id,
          verificationRequired: true
        }
      });

      logger.info('Verification requests sent', {
        transferId: transfer.transferId
      });
    } catch (error) {
      logger.error('Error sending verification requests:', error);
      throw error;
    }
  }

  async clearTransferCaches(ticketId, fromUserId, toUserId) {
    await Promise.all([
      this.cacheService.delete(`ticket:${ticketId}`),
      this.cacheService.delete(`user:${fromUserId}:tickets`),
      this.cacheService.delete(`user:${toUserId}:tickets`),
      this.cacheService.delete(`transfers:${fromUserId}:*`),
      this.cacheService.delete(`transfers:${toUserId}:*`)
    ]);
  }

  async clearOwnershipCaches(ticketId, oldOwnerId, newOwnerId) {
    await Promise.all([
      this.cacheService.delete(`ticket:${ticketId}`),
      this.cacheService.delete(`user:${oldOwnerId}:tickets`),
      this.cacheService.delete(`user:${newOwnerId}:tickets`)
    ]);
  }

  async notifyTransferFailure(transfer, error) {
    try {
      await this.notificationService.sendNotification({
        userId: transfer.fromUserId,
        type: 'transfer_failed',
        title: 'Transfer Failed',
        message: `Your ticket transfer could not be completed: ${error.message}`,
        data: {
          transferId: transfer._id,
          reason: error.message
        }
      });
    } catch (notifyError) {
      logger.error('Error sending failure notification:', notifyError);
    }
  }

  async storeAuditLog(auditLog) {
    // Store in audit collection
    // Implementation depends on audit system
    logger.info('Audit log stored', { transferId: auditLog.transferId });
  }

  async updateTransferAnalytics(transferData) {
    // Update analytics
    // Implementation depends on analytics system
    logger.info('Analytics updated', { transferId: transferData.transferId });
  }

  async generatePDFReceipt(receipt) {
    // Generate PDF receipt
    // Return URL to PDF
    return `${process.env.APP_URL}/transfers/receipts/${receipt.receiptNumber}.pdf`;
  }

  async generateTransferQRCode(transfer) {
    // Generate QR code for transfer verification
    const qrData = {
      transferId: transfer.transferId,
      type: 'transfer_receipt',
      verificationCode: crypto.randomBytes(8).toString('hex')
    };

    // Implementation depends on QR service
    return `data:image/png;base64,${Buffer.from(JSON.stringify(qrData)).toString('base64')}`;
  }

  /**
   * Verify transfer request
   */
  async verifyTransfer(transferId, userId, verificationCode) {
    try {
      const transfer = await TransferModel.findOne({ transferId });
      
      if (!transfer) {
        throw new AppError('Transfer not found', 404);
      }

      if (transfer.status !== 'pending') {
        throw new AppError('Transfer already processed', 400);
      }

      if (transfer.verification.code !== verificationCode) {
        throw new AppError('Invalid verification code', 400);
      }

      // Check which party is verifying
      if (userId === transfer.fromUserId.toString()) {
        transfer.verification.fromUserVerified = true;
      } else if (userId === transfer.toUserId.toString()) {
        transfer.verification.toUserVerified = true;
      } else {
        throw new AppError('Unauthorized', 403);
      }

      transfer.verification.lastVerifiedAt = new Date();
      await transfer.save();

      // If both parties verified, complete the transfer
      if (transfer.verification.fromUserVerified && transfer.verification.toUserVerified) {
        await this.completeTransfer(transfer);
      }

      return {
        success: true,
        bothVerified: transfer.verification.fromUserVerified && transfer.verification.toUserVerified
      };
    } catch (error) {
      logger.error('Error verifying transfer:', error);
      throw error;
    }
  }

  /**
   * Complete the transfer after verification
   */
  async completeTransfer(transfer) {
    try {
      // Get users
      const fromUser = await UserModel.findById(transfer.fromUserId);
      const toUser = await UserModel.findById(transfer.toUserId);
      const ticket = await TicketModel.findById(transfer.ticketId).populate('eventId');

      // Process blockchain transfer
      const blockchainResult = await this.processBlockchainTransfer(
        transfer.ticketId,
        fromUser.walletAddress,
        toUser.walletAddress
      );

      // Update transfer record
      transfer.blockchain = {
        transactionSignature: blockchainResult.signature,
        confirmedAt: blockchainResult.confirmedAt
      };

      // Update ownership
      await this.updateTicketOwnership(
        transfer.ticketId,
        transfer.toUserId,
        transfer._id
      );

      // Process payments if it's a sale
      if (transfer.type === 'sale' && transfer.price > 0) {
        await this.processTransferPayments(transfer);
      }

      // Send notifications
      await this.notifyTransferParties({
        transfer,
        ticket,
        fromUser,
        toUser,
        event: ticket.eventId
      });

      // Log history
      await this.logTransferHistory({
        ...transfer.toObject(),
        eventId: ticket.eventId._id,
        eventName: ticket.eventId.name,
        blockchainSignature: blockchainResult.signature
      });

      logger.info('Transfer completed', {
        transferId: transfer.transferId,
        signature: blockchainResult.signature
      });
    } catch (error) {
      logger.error('Error completing transfer:', error);
      await this.handleTransferFailure(transfer.transferId, error);
      throw error;
    }
  }

  async processTransferPayments(transfer) {
    try {
      // Distribute funds
      if (transfer.fees.royaltyFee > 0) {
        await this.royaltyService.distributeRoyalty(
          transfer._id,
          {
            royalties: {
              total: transfer.fees.royaltyFee,
              distributions: [{
                recipientId: transfer.eventId.organizerId,
                recipientType: 'organizer',
                amount: transfer.fees.royaltyFee,
                percentage: this.config.artistRoyalty.percentage,
                role: 'event_organizer'
              }]
            }
          }
        );
      }

      logger.info('Transfer payments processed', {
        transferId: transfer.transferId,
        netAmount: transfer.fees.netAmount
      });
    } catch (error) {
      logger.error('Error processing transfer payments:', error);
      throw error;
    }
  }

  /**
   * Cancel a pending transfer
   */
  async cancelTransfer(transferId, userId, reason) {
    try {
      const transfer = await TransferModel.findOne({ transferId });
      
      if (!transfer) {
        throw new AppError('Transfer not found', 404);
      }

      if (transfer.status !== 'pending') {
        throw new AppError('Only pending transfers can be cancelled', 400);
      }

      // Check authorization
      if (userId !== transfer.fromUserId.toString() && userId !== transfer.toUserId.toString()) {
        throw new AppError('Unauthorized', 403);
      }

      // Update transfer status
      transfer.status = 'cancelled';
      transfer.cancelledAt = new Date();
      transfer.cancelledBy = userId;
      transfer.cancellationReason = reason;
      await transfer.save();

      // Unlock ticket
      await TicketModel.findByIdAndUpdate(transfer.ticketId, {
        status: 'active',
        lockedFor: null,
        lockedUntil: null,
        pendingTransferId: null
      });

      // Send notifications
      await this.notifyTransferCancellation(transfer, userId, reason);

      logger.info('Transfer cancelled', {
        transferId,
        cancelledBy: userId,
        reason
      });

      return { success: true };
    } catch (error) {
      logger.error('Error cancelling transfer:', error);
      throw error;
    }
  }

  async notifyTransferCancellation(transfer, cancelledBy, reason) {
    const otherParty = cancelledBy === transfer.fromUserId.toString() ?
      transfer.toUserId : transfer.fromUserId;

    await this.notificationService.sendNotification({
      userId: otherParty,
      type: 'transfer_cancelled',
      title: 'Transfer Cancelled',
      message: `The ticket transfer has been cancelled: ${reason}`,
      data: {
        transferId: transfer._id,
        cancelledBy,
        reason
      }
    });
  }

  startTransferCleanup() {
    setInterval(async () => {
      try {
        // Find expired pending transfers
        const expiredTransfers = await TransferModel.find({
          status: 'pending',
          expiresAt: { $lt: new Date() }
        });

        for (const transfer of expiredTransfers) {
          await this.handleTransferExpiry(transfer);
        }
      } catch (error) {
        logger.error('Error in transfer cleanup:', error);
      }
    }, 60000); // Run every minute
  }

  async handleTransferExpiry(transfer) {
    try {
      transfer.status = 'expired';
      transfer.expiredAt = new Date();
      await transfer.save();

      // Unlock ticket
      await TicketModel.findByIdAndUpdate(transfer.ticketId, {
        status: 'active',
        lockedFor: null,
        lockedUntil: null,
        pendingTransferId: null
      });

      // Notify parties
      await Promise.all([
        this.notificationService.sendNotification({
          userId: transfer.fromUserId,
          type: 'transfer_expired',
          title: 'Transfer Expired',
          message: 'Your ticket transfer request has expired',
          data: { transferId: transfer._id }
        }),
        this.notificationService.sendNotification({
          userId: transfer.toUserId,
          type: 'transfer_expired',
          title: 'Transfer Expired',
          message: 'The ticket transfer request has expired',
          data: { transferId: transfer._id }
        })
      ]);

      logger.info('Expired transfer handled', {
        transferId: transfer.transferId
      });
    } catch (error) {
      logger.error('Error handling transfer expiry:', error);
    }
  }
}

module.exports = new TransferService();
