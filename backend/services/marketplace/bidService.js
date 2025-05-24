const { PublicKey, Transaction } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');
const ListingModel = require('../../models/Listing');
const BidModel = require('../../models/Bid');
const UserModel = require('../../models/User');
const NotificationService = require('../notifications/notificationService');
const PaymentService = require('../payment/paymentService');
const BlockchainService = require('../blockchain/blockchainService');
const CacheService = require('../cache/cacheService');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const { sendEmail } = require('../../utils/email');

class BidService {
  constructor() {
    this.notificationService = new NotificationService();
    this.paymentService = new PaymentService();
    this.blockchainService = new BlockchainService();
    this.cacheService = new CacheService();
    
    // Bidding configuration
    this.MIN_BID_INCREMENT_PERCENTAGE = 5; // 5% minimum increment
    this.MIN_BID_INCREMENT_AMOUNT = 0.01; // 0.01 SOL minimum
    this.ESCROW_LOCK_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
    this.AUTO_BID_CHECK_INTERVAL = 30000; // 30 seconds
    
    // Start auto-bid processor
    this.startAutoBidProcessor();
  }

  /**
   * Place a new bid on a listing
   */
  async placeBid(listingId, amount, bidderId, options = {}) {
    const session = await ListingModel.startSession();
    session.startTransaction();

    try {
      // Get listing with lock to prevent race conditions
      const listing = await ListingModel.findById(listingId).session(session);
      
      if (!listing) {
        throw new AppError('Listing not found', 404);
      }

      if (listing.status !== 'active') {
        throw new AppError('Listing is not active', 400);
      }

      if (listing.type !== 'auction') {
        throw new AppError('This listing does not accept bids', 400);
      }

      // Check if auction has expired
      if (listing.expiresAt && new Date(listing.expiresAt) < new Date()) {
        throw new AppError('Auction has ended', 400);
      }

      // Validate bidder
      const bidder = await UserModel.findById(bidderId);
      if (!bidder) {
        throw new AppError('Bidder not found', 404);
      }

      // Prevent self-bidding
      if (listing.sellerId.toString() === bidderId) {
        throw new AppError('Cannot bid on your own listing', 400);
      }

      // Validate bid
      const validationResult = await this.validateBid(
        { amount, bidderId, listingId },
        listing
      );

      if (!validationResult.isValid) {
        throw new AppError(validationResult.error, 400);
      }

      // Check bidder's balance
      const hasBalance = await this.checkBidderBalance(bidderId, amount);
      if (!hasBalance) {
        throw new AppError('Insufficient balance for bid', 400);
      }

      // Get current highest bid
      const currentHighestBid = listing.auction.bids.length > 0 ?
        listing.auction.bids[listing.auction.bids.length - 1] : null;

      // Create escrow for bid amount
      const escrowResult = await this.createBidEscrow({
        listingId,
        bidderId,
        amount,
        listingAddress: listing.blockchain.listingAddress
      });

      // Create bid record
      const bid = new BidModel({
        listingId,
        bidderId,
        amount,
        status: 'active',
        escrow: {
          address: escrowResult.escrowAddress,
          transactionSignature: escrowResult.signature,
          lockedUntil: new Date(Date.now() + this.ESCROW_LOCK_DURATION)
        },
        metadata: {
          bidNumber: listing.auction.bids.length + 1,
          isAutoBid: options.isAutoBid || false,
          deviceInfo: options.deviceInfo || {},
          ipAddress: options.ipAddress
        }
      });

      await bid.save({ session });

      // Update listing with new bid
      listing.auction.bids.push({
        bidId: bid._id,
        bidderId,
        amount,
        timestamp: new Date()
      });

      listing.auction.currentBid = amount;
      listing.auction.highestBidder = bidderId;
      listing.analytics.bidCount += 1;

      // Extend auction if bid placed in final minutes
      if (listing.expiresAt) {
        const timeRemaining = new Date(listing.expiresAt) - new Date();
        const extensionThreshold = 5 * 60 * 1000; // 5 minutes
        
        if (timeRemaining < extensionThreshold) {
          listing.expiresAt = new Date(Date.now() + extensionThreshold);
          logger.info(`Extended auction ${listingId} by 5 minutes due to last-minute bid`);
        }
      }

      await listing.save({ session });

      // Process outbid notification and refund for previous highest bidder
      if (currentHighestBid) {
        await this.handleOutbid(
          currentHighestBid.bidderId,
          listing,
          currentHighestBid.amount,
          amount
        );
      }

      await session.commitTransaction();

      // Clear caches
      await this.clearBidCaches(listingId);

      // Send notifications
      await this.sendBidNotifications(listing, bid, currentHighestBid);

      // Process auto-bids from other users
      setImmediate(() => {
        this.processAutoBidsForListing(listingId, bid._id).catch(err => 
          logger.error('Error processing auto-bids:', err)
        );
      });

      // Track analytics
      await this.trackBidEvent('bid_placed', {
        bidId: bid._id,
        listingId,
        bidderId,
        amount,
        previousBid: currentHighestBid?.amount || 0
      });

      logger.info('Bid placed successfully', {
        bidId: bid._id,
        listingId,
        bidderId,
        amount
      });

      return {
        success: true,
        bid: await this.getBidDetails(bid._id),
        listing: {
          currentBid: listing.auction.currentBid,
          bidCount: listing.auction.bids.length,
          timeRemaining: listing.expiresAt ? 
            Math.max(0, new Date(listing.expiresAt) - new Date()) : null
        }
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error placing bid:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update an existing bid
   */
  async updateBid(bidId, newAmount, bidderId) {
    const session = await BidModel.startSession();
    session.startTransaction();

    try {
      const bid = await BidModel.findOne({
        _id: bidId,
        bidderId,
        status: 'active'
      }).session(session);

      if (!bid) {
        throw new AppError('Bid not found or unauthorized', 404);
      }

      const listing = await ListingModel.findById(bid.listingId).session(session);
      
      if (!listing || listing.status !== 'active') {
        throw new AppError('Listing is not active', 400);
      }

      // Check if bidder is still the highest bidder
      const isHighestBidder = listing.auction.highestBidder.toString() === bidderId;
      if (!isHighestBidder) {
        throw new AppError('You have been outbid. Place a new bid instead.', 400);
      }

      // Validate new amount
      if (newAmount <= bid.amount) {
        throw new AppError('New bid must be higher than current bid', 400);
      }

      const increment = this.calculateBidIncrement(bid.amount);
      if (newAmount < bid.amount + increment.minimum) {
        throw new AppError(
          `Bid must be increased by at least ${increment.minimum} SOL`,
          400
        );
      }

      // Check balance for additional amount
      const additionalAmount = newAmount - bid.amount;
      const hasBalance = await this.checkBidderBalance(bidderId, additionalAmount);
      if (!hasBalance) {
        throw new AppError('Insufficient balance for bid increase', 400);
      }

      // Update escrow with additional amount
      await this.updateBidEscrow({
        escrowAddress: bid.escrow.address,
        additionalAmount,
        bidderId
      });

      // Update bid
      bid.amount = newAmount;
      bid.updatedAt = new Date();
      bid.updateHistory.push({
        previousAmount: bid.amount,
        newAmount,
        timestamp: new Date()
      });

      await bid.save({ session });

      // Update listing
      const bidIndex = listing.auction.bids.findIndex(
        b => b.bidId.toString() === bidId
      );
      
      if (bidIndex !== -1) {
        listing.auction.bids[bidIndex].amount = newAmount;
        listing.auction.currentBid = newAmount;
      }

      await listing.save({ session });

      await session.commitTransaction();

      // Clear caches
      await this.clearBidCaches(listing._id);

      // Send notification
      await this.notificationService.sendNotification({
        userId: listing.sellerId,
        type: 'bid_updated',
        title: 'Bid Updated',
        message: `Highest bid increased to ${newAmount} SOL`,
        data: { listingId: listing._id, bidId }
      });

      logger.info('Bid updated successfully', {
        bidId,
        previousAmount: bid.amount,
        newAmount
      });

      return {
        success: true,
        bid: await this.getBidDetails(bidId)
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error updating bid:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Cancel a bid and process refund
   */
  async cancelBid(bidId, bidderId) {
    const session = await BidModel.startSession();
    session.startTransaction();

    try {
      const bid = await BidModel.findOne({
        _id: bidId,
        bidderId,
        status: 'active'
      }).session(session);

      if (!bid) {
        throw new AppError('Bid not found or unauthorized', 404);
      }

      const listing = await ListingModel.findById(bid.listingId).session(session);

      // Check if bidder is the current highest bidder
      const isHighestBidder = listing.auction.highestBidder.toString() === bidderId;
      
      // Generally, highest bidder cannot cancel to maintain auction integrity
      if (isHighestBidder && listing.status === 'active') {
        const timeRemaining = listing.expiresAt ? 
          new Date(listing.expiresAt) - new Date() : Infinity;
        
        // Allow cancellation only if more than 24 hours remain
        if (timeRemaining < 24 * 60 * 60 * 1000) {
          throw new AppError(
            'Cannot cancel bid within 24 hours of auction end',
            400
          );
        }
      }

      // Process refund from escrow
      await this.processRefund(bid);

      // Update bid status
      bid.status = 'cancelled';
      bid.cancelledAt = new Date();
      bid.cancellationReason = 'user_cancelled';
      await bid.save({ session });

      // Update listing if highest bidder
      if (isHighestBidder) {
        // Find next highest bid
        const activeBids = listing.auction.bids
          .filter(b => b.bidId.toString() !== bidId)
          .sort((a, b) => b.amount - a.amount);

        if (activeBids.length > 0) {
          const nextHighest = activeBids[0];
          listing.auction.currentBid = nextHighest.amount;
          listing.auction.highestBidder = nextHighest.bidderId;
        } else {
          // No other bids, reset to starting price
          listing.auction.currentBid = listing.auction.startingPrice;
          listing.auction.highestBidder = null;
        }

        // Remove cancelled bid from bids array
        listing.auction.bids = listing.auction.bids.filter(
          b => b.bidId.toString() !== bidId
        );
      }

      await listing.save({ session });

      await session.commitTransaction();

      // Clear caches
      await this.clearBidCaches(listing._id);

      // Send notifications
      await this.notificationService.sendNotification({
        userId: bidderId,
        type: 'bid_cancelled',
        title: 'Bid Cancelled',
        message: `Your bid of ${bid.amount} SOL has been cancelled and refunded`,
        data: { bidId, listingId: listing._id }
      });

      logger.info('Bid cancelled successfully', { bidId, bidderId });

      return {
        success: true,
        message: 'Bid cancelled and refunded successfully',
        refundAmount: bid.amount
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error cancelling bid:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get bids for a listing with pagination
   */
  async getBids(listingId, pagination = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = 'amount',
        sortOrder = 'desc',
        includeInactive = false
      } = pagination;

      const query = { listingId };
      
      if (!includeInactive) {
        query.status = 'active';
      }

      const [bids, total] = await Promise.all([
        BidModel.find(query)
          .populate('bidderId', 'username walletAddress profileImage')
          .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
          .limit(limit)
          .skip((page - 1) * limit)
          .lean(),
        BidModel.countDocuments(query)
      ]);

      // Get listing for context
      const listing = await ListingModel.findById(listingId).lean();

      // Enhance bid data
      const enhancedBids = bids.map((bid, index) => ({
        ...bid,
        isHighestBid: listing?.auction?.highestBidder?.toString() === bid.bidderId._id.toString(),
        rank: index + 1 + ((page - 1) * limit),
        outbidAmount: listing?.auction?.currentBid ? 
          Math.max(0, listing.auction.currentBid - bid.amount) : 0
      }));

      return {
        bids: enhancedBids,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasMore: page < Math.ceil(total / limit)
        },
        summary: {
          totalBids: total,
          highestBid: listing?.auction?.currentBid || 0,
          uniqueBidders: await this.getUniqueBiddersCount(listingId),
          averageBid: await this.getAverageBid(listingId)
        }
      };
    } catch (error) {
      logger.error('Error getting bids:', error);
      throw error;
    }
  }

  /**
   * Validate bid constraints
   */
  async validateBid(bidData, listing) {
    const errors = [];

    // Amount validation
    if (!bidData.amount || bidData.amount <= 0) {
      errors.push('Invalid bid amount');
    }

    // Check minimum bid
    const currentBid = listing.auction.currentBid || listing.auction.startingPrice;
    if (bidData.amount <= currentBid) {
      errors.push(`Bid must be higher than current bid of ${currentBid} SOL`);
    }

    // Check bid increment
    const increment = this.calculateBidIncrement(currentBid);
    if (bidData.amount < currentBid + increment.minimum) {
      errors.push(`Minimum bid increment is ${increment.minimum} SOL`);
    }

    // Check reserve price (only visible to seller)
    if (listing.auction.reservePrice && bidData.amount < listing.auction.reservePrice) {
      // Don't reveal reserve price to bidders
      logger.info(`Bid ${bidData.amount} is below reserve price ${listing.auction.reservePrice}`);
    }

    // Check bidding limits
    const bidderHistory = await this.getBidderActivity(bidData.bidderId);
    if (bidderHistory.activeBids >= 10) {
      errors.push('Maximum active bids limit reached');
    }

    // Check for suspicious activity
    const isSuspicious = await this.checkSuspiciousActivity(bidData.bidderId, listing._id);
    if (isSuspicious) {
      errors.push('Bidding temporarily restricted due to unusual activity');
    }

    return {
      isValid: errors.length === 0,
      errors,
      error: errors[0] || null
    };
  }

  /**
   * Process automatic bidding for users with max bids set
   */
  async processAutomaticBidding(bidderId, maxBid, listingId = null) {
    try {
      // Create or update auto-bid configuration
      const autoBidConfig = await this.createOrUpdateAutoBid({
        bidderId,
        maxBid,
        listingId,
        isActive: true
      });

      // If specific listing provided, process immediately
      if (listingId) {
        await this.processAutoBidForListing(listingId, bidderId, maxBid);
      }

      logger.info('Automatic bidding configured', {
        bidderId,
        maxBid,
        listingId
      });

      return {
        success: true,
        autoBidId: autoBidConfig._id,
        message: 'Automatic bidding activated'
      };
    } catch (error) {
      logger.error('Error processing automatic bidding:', error);
      throw error;
    }
  }

  /**
   * Handle auction end and determine winner
   */
  async handleAuctionEnd(listingId) {
    const session = await ListingModel.startSession();
    session.startTransaction();

    try {
      const listing = await ListingModel.findById(listingId).session(session);
      
      if (!listing || listing.type !== 'auction') {
        throw new AppError('Invalid auction listing', 400);
      }

      if (listing.status !== 'active') {
        throw new AppError('Auction is not active', 400);
      }

      // Check if auction has actually ended
      if (listing.expiresAt && new Date(listing.expiresAt) > new Date()) {
        throw new AppError('Auction has not ended yet', 400);
      }

      const highestBid = listing.auction.bids.length > 0 ?
        listing.auction.bids[listing.auction.bids.length - 1] : null;

      if (!highestBid) {
        // No bids received
        listing.status = 'expired';
        listing.auction.endedAt = new Date();
        listing.auction.result = 'no_bids';
        await listing.save({ session });

        await session.commitTransaction();

        // Notify seller
        await this.notificationService.sendNotification({
          userId: listing.sellerId,
          type: 'auction_ended_no_bids',
          title: 'Auction Ended',
          message: 'Your auction ended with no bids',
          data: { listingId }
        });

        return {
          success: true,
          result: 'no_bids',
          message: 'Auction ended with no bids'
        };
      }

      // Check if reserve price was met
      const reserveMet = !listing.auction.reservePrice || 
        highestBid.amount >= listing.auction.reservePrice;

      if (!reserveMet) {
        // Reserve not met
        listing.status = 'expired';
        listing.auction.endedAt = new Date();
        listing.auction.result = 'reserve_not_met';
        await listing.save({ session });

        // Refund all bids
        await this.processRefunds(listing.auction.bids);

        await session.commitTransaction();

        // Notify participants
        await this.sendAuctionEndNotifications(listing, 'reserve_not_met');

        return {
          success: true,
          result: 'reserve_not_met',
          message: 'Auction ended - reserve price not met',
          highestBid: highestBid.amount,
          reservePrice: listing.auction.reservePrice
        };
      }

      // Auction successful - process winner
      const winner = await UserModel.findById(highestBid.bidderId);
      const winningBid = await BidModel.findById(highestBid.bidId);

      // Update listing
      listing.status = 'sold';
      listing.auction.endedAt = new Date();
      listing.auction.result = 'sold';
      listing.auction.winnerId = winner._id;
      listing.auction.winningBid = highestBid.amount;
      listing.soldTo = winner._id;
      listing.soldAt = new Date();
      listing.finalPrice = highestBid.amount;

      await listing.save({ session });

      // Update winning bid
      winningBid.status = 'won';
      winningBid.wonAt = new Date();
      await winningBid.save({ session });

      // Process payment from escrow to seller
      await this.processAuctionPayment(listing, winningBid);

      // Refund unsuccessful bidders
      const unsuccessfulBids = listing.auction.bids.filter(
        b => b.bidId.toString() !== highestBid.bidId.toString()
      );
      await this.processRefunds(unsuccessfulBids);

      await session.commitTransaction();

      // Transfer NFT to winner
      await this.transferNFTToWinner(listing, winner);

      // Send notifications
      await this.sendAuctionEndNotifications(listing, 'sold', winner);

      // Clear caches
      await this.clearBidCaches(listingId);

      logger.info('Auction ended successfully', {
        listingId,
        winnerId: winner._id,
        winningBid: highestBid.amount
      });

      return {
        success: true,
        result: 'sold',
        winner: {
          userId: winner._id,
          username: winner.username,
          bid: highestBid.amount
        },
        totalBids: listing.auction.bids.length,
        finalPrice: highestBid.amount
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error handling auction end:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Process refunds for unsuccessful bids
   */
  async processRefunds(bids) {
    try {
      const refundPromises = bids.map(async (bid) => {
        try {
          const bidRecord = await BidModel.findById(bid.bidId);
          if (bidRecord && bidRecord.status === 'active') {
            await this.processRefund(bidRecord);
            
            // Update bid status
            bidRecord.status = 'refunded';
            bidRecord.refundedAt = new Date();
            await bidRecord.save();

            // Send notification
            await this.notificationService.sendNotification({
              userId: bidRecord.bidderId,
              type: 'bid_refunded',
              title: 'Bid Refunded',
              message: `Your bid of ${bidRecord.amount} SOL has been refunded`,
              data: { bidId: bidRecord._id }
            });
          }
        } catch (error) {
          logger.error(`Error refunding bid ${bid.bidId}:`, error);
        }
      });

      await Promise.all(refundPromises);

      logger.info(`Processed ${bids.length} refunds`);

      return {
        success: true,
        refundCount: bids.length
      };
    } catch (error) {
      logger.error('Error processing refunds:', error);
      throw error;
    }
  }

  /**
   * Get user's bidding history
   */
  async getBiddingHistory(bidderId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status = 'all',
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      const query = { bidderId };
      
      if (status !== 'all') {
        query.status = status;
      }

      const [bids, total] = await Promise.all([
        BidModel.find(query)
          .populate({
            path: 'listingId',
            populate: {
              path: 'eventId',
              select: 'name venue startDate'
            }
          })
          .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
          .limit(limit)
          .skip((page - 1) * limit)
          .lean(),
        BidModel.countDocuments(query)
      ]);

      // Calculate statistics
      const stats = await BidModel.aggregate([
        { $match: { bidderId: bidderId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        }
      ]);

      const statistics = {
        totalBids: total,
        wonBids: stats.find(s => s._id === 'won')?.count || 0,
        activeBids: stats.find(s => s._id === 'active')?.count || 0,
        totalSpent: stats.find(s => s._id === 'won')?.totalAmount || 0,
        successRate: total > 0 ? 
          ((stats.find(s => s._id === 'won')?.count || 0) / total * 100).toFixed(2) : 0
      };

      return {
        bids,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasMore: page < Math.ceil(total / limit)
        },
        statistics
      };
    } catch (error) {
      logger.error('Error getting bidding history:', error);
      throw error;
    }
  }

  /**
   * Calculate minimum bid increment based on current bid
   */
  calculateBidIncrement(currentBid) {
    let minimum;
    let suggested;

    if (currentBid < 1) {
      minimum = 0.01;
      suggested = 0.05;
    } else if (currentBid < 5) {
      minimum = 0.05;
      suggested = 0.25;
    } else if (currentBid < 10) {
      minimum = 0.10;
      suggested = 0.50;
    } else if (currentBid < 50) {
      minimum = 0.50;
      suggested = 2.50;
    } else if (currentBid < 100) {
      minimum = 1.00;
      suggested = 5.00;
    } else {
      // For high-value items, use percentage-based increment
      minimum = Math.max(
        this.MIN_BID_INCREMENT_AMOUNT,
        currentBid * (this.MIN_BID_INCREMENT_PERCENTAGE / 100)
      );
      suggested = minimum * 2;
    }

    return {
      minimum: Math.round(minimum * 100) / 100,
      suggested: Math.round(suggested * 100) / 100,
      percentage: this.MIN_BID_INCREMENT_PERCENTAGE
    };
  }

  // Helper methods

  async createBidEscrow(escrowData) {
    try {
      const result = await this.blockchainService.createBidEscrow({
        listing: new PublicKey(escrowData.listingAddress),
        bidder: new PublicKey(escrowData.bidderId),
        amount: new BN(escrowData.amount * 1e9)
      });

      return result;
    } catch (error) {
      logger.error('Error creating bid escrow:', error);
      throw new AppError('Failed to create bid escrow', 500);
    }
  }

  async updateBidEscrow(escrowData) {
    try {
      const result = await this.blockchainService.updateBidEscrow({
        escrow: new PublicKey(escrowData.escrowAddress),
        additionalAmount: new BN(escrowData.additionalAmount * 1e9),
        bidder: new PublicKey(escrowData.bidderId)
      });

      return result;
    } catch (error) {
      logger.error('Error updating bid escrow:', error);
      throw new AppError('Failed to update bid escrow', 500);
    }
  }

  async processRefund(bid) {
    try {
      const result = await this.blockchainService.refundBid({
        escrow: new PublicKey(bid.escrow.address),
        bidder: new PublicKey(bid.bidderId),
        amount: new BN(bid.amount * 1e9)
      });

      return result;
    } catch (error) {
      logger.error('Error processing refund:', error);
      throw new AppError('Failed to process refund', 500);
    }
  }

  async checkBidderBalance(bidderId, amount) {
    try {
      const balance = await this.paymentService.getUserBalance(bidderId);
      return balance >= amount;
    } catch (error) {
      logger.error('Error checking bidder balance:', error);
      return false;
    }
  }

  async handleOutbid(previousBidderId, listing, previousAmount, newAmount) {
    try {
      // Send notification
      await this.notificationService.sendNotification({
        userId: previousBidderId,
        type: 'outbid',
        title: 'You\'ve been outbid!',
        message: `Someone bid ${newAmount} SOL on "${listing.metadata.eventName}"`,
        data: { 
          listingId: listing._id,
          previousBid: previousAmount,
          currentBid: newAmount
        }
      });

      // Check if user has auto-bid enabled
      const autoBid = await this.getActiveAutoBid(previousBidderId, listing._id);
      if (autoBid && autoBid.maxBid > newAmount) {
        // User has auto-bid with room to increase
        logger.info(`Auto-bid will be processed for user ${previousBidderId}`);
      }
    } catch (error) {
      logger.error('Error handling outbid:', error);
    }
  }

  async clearBidCaches(listingId) {
    try {
      await this.cacheService.delete(`listing:${listingId}`);
      await this.cacheService.delete(`bids:${listingId}:*`);
      await this.cacheService.delete(`listings:*`);
    } catch (error) {
      logger.error('Error clearing bid caches:', error);
    }
  }

  async sendBidNotifications(listing, bid, previousHighestBid) {
    try {
      // Notify seller
      await this.notificationService.sendNotification({
        userId: listing.sellerId,
        type: 'new_bid',
        title: 'New Bid Received',
        message: `${bid.amount} SOL bid on your listing`,
        data: { listingId: listing._id, bidId: bid._id }
      });

      // Notify watchers
      const watchers = await this.getListingWatchers(listing._id);
      const watcherNotifications = watchers.map(watcherId =>
        this.notificationService.sendNotification({
          userId: watcherId,
          type: 'watched_listing_bid',
          title: 'New Bid on Watched Item',
          message: `Current bid: ${bid.amount} SOL`,
          data: { listingId: listing._id }
        })
      );

      await Promise.all(watcherNotifications);
    } catch (error) {
      logger.error('Error sending bid notifications:', error);
    }
  }

  async getUniqueBiddersCount(listingId) {
    try {
      const uniqueBidders = await BidModel.distinct('bidderId', { listingId });
      return uniqueBidders.length;
    } catch (error) {
      logger.error('Error getting unique bidders count:', error);
      return 0;
    }
  }

  async getAverageBid(listingId) {
    try {
      const result = await BidModel.aggregate([
        { $match: { listingId: listingId } },
        { $group: { _id: null, avgBid: { $avg: '$amount' } } }
      ]);

      return result[0]?.avgBid || 0;
    } catch (error) {
      logger.error('Error getting average bid:', error);
      return 0;
    }
  }

  async getBidderActivity(bidderId) {
    try {
      const [activeBids, totalBids, wonBids] = await Promise.all([
        BidModel.countDocuments({ bidderId, status: 'active' }),
        BidModel.countDocuments({ bidderId }),
        BidModel.countDocuments({ bidderId, status: 'won' })
      ]);

      return {
        activeBids,
        totalBids,
        wonBids,
        winRate: totalBids > 0 ? (wonBids / totalBids) : 0
      };
    } catch (error) {
      logger.error('Error getting bidder activity:', error);
      return { activeBids: 0, totalBids: 0, wonBids: 0, winRate: 0 };
    }
  }

  async checkSuspiciousActivity(bidderId, listingId) {
    try {
      // Check for rapid bidding
      const recentBids = await BidModel.countDocuments({
        bidderId,
        createdAt: { $gte: new Date(Date.now() - 60000) } // Last minute
      });

      if (recentBids > 5) {
        return true;
      }

      // Check for pattern of immediate cancellations
      const cancelledBids = await BidModel.countDocuments({
        bidderId,
        status: 'cancelled',
        createdAt: { $gte: new Date(Date.now() - 86400000) } // Last 24 hours
      });

      if (cancelledBids > 10) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking suspicious activity:', error);
      return false;
    }
  }

  async getBidDetails(bidId) {
    try {
      const bid = await BidModel.findById(bidId)
        .populate('bidderId', 'username walletAddress')
        .populate('listingId', 'metadata auction')
        .lean();

      return bid;
    } catch (error) {
      logger.error('Error getting bid details:', error);
      return null;
    }
  }

  async processAuctionPayment(listing, winningBid) {
    try {
      // Calculate fees
      const fees = await this.calculateFees(winningBid.amount, listing);
      
      // Process payment from escrow
      await this.blockchainService.processAuctionPayment({
        escrow: new PublicKey(winningBid.escrow.address),
        seller: new PublicKey(listing.sellerId),
        amount: new BN(winningBid.amount * 1e9),
        platformFee: new BN(fees.platformFee * 1e9),
        royaltyFee: new BN(fees.royaltyFee * 1e9)
      });

      logger.info('Auction payment processed', {
        listingId: listing._id,
        amount: winningBid.amount,
        fees
      });
    } catch (error) {
      logger.error('Error processing auction payment:', error);
      throw error;
    }
  }

  async calculateFees(amount, listing) {
    // Reuse fee calculation logic from listing service
    const ListingService = require('./listingService');
    return ListingService.calculateFees(amount, listing.ticketId);
  }

  async transferNFTToWinner(listing, winner) {
    try {
      await this.blockchainService.transferNFT({
        mint: new PublicKey(listing.ticketId.mintAddress),
        from: new PublicKey(listing.sellerId),
        to: new PublicKey(winner.walletAddress),
        listing: new PublicKey(listing.blockchain.listingAddress)
      });

      // Update ticket ownership in database
      await TicketModel.findByIdAndUpdate(listing.ticketId._id, {
        userId: winner._id,
        previousOwners: { $push: listing.sellerId },
        transferredAt: new Date()
      });

      logger.info('NFT transferred to winner', {
        listingId: listing._id,
        winnerId: winner._id
      });
    } catch (error) {
      logger.error('Error transferring NFT to winner:', error);
      throw error;
    }
  }

  async sendAuctionEndNotifications(listing, result, winner = null) {
    try {
      // Notify seller
      let sellerMessage;
      switch (result) {
        case 'sold':
          sellerMessage = `Your auction sold for ${listing.auction.winningBid} SOL!`;
          break;
        case 'reserve_not_met':
          sellerMessage = 'Your auction ended - reserve price was not met';
          break;
        case 'no_bids':
          sellerMessage = 'Your auction ended with no bids';
          break;
      }

      await this.notificationService.sendNotification({
        userId: listing.sellerId,
        type: 'auction_ended',
        title: 'Auction Ended',
        message: sellerMessage,
        data: { listingId: listing._id, result }
      });

      // Notify winner
      if (winner) {
        await this.notificationService.sendNotification({
          userId: winner._id,
          type: 'auction_won',
          title: 'Congratulations! You Won!',
          message: `You won the auction with a bid of ${listing.auction.winningBid} SOL`,
          data: { listingId: listing._id }
        });

        // Send email
        await sendEmail({
          to: winner.email,
          subject: 'Congratulations! You Won the Auction',
          template: 'auction-won',
          data: {
            username: winner.username,
            itemName: listing.metadata.eventName,
            winningBid: listing.auction.winningBid,
            listingUrl: `${process.env.APP_URL}/listing/${listing._id}`
          }
        });
      }

      // Notify all bidders
      const bidders = await BidModel.distinct('bidderId', { 
        listingId: listing._id,
        bidderId: { $ne: winner?._id }
      });

      const bidderNotifications = bidders.map(bidderId =>
        this.notificationService.sendNotification({
          userId: bidderId,
          type: 'auction_ended_participant',
          title: 'Auction Has Ended',
          message: result === 'sold' ? 
            'The auction you participated in has ended' :
            'The auction you participated in ended without a sale',
          data: { listingId: listing._id, result }
        })
      );

      await Promise.all(bidderNotifications);
    } catch (error) {
      logger.error('Error sending auction end notifications:', error);
    }
  }

  async getListingWatchers(listingId) {
    // Implement watchlist functionality
    return [];
  }

  async createOrUpdateAutoBid(autoBidData) {
    // Implement auto-bid configuration storage
    return { _id: 'autobid-id' };
  }

  async getActiveAutoBid(bidderId, listingId) {
    // Implement auto-bid retrieval
    return null;
  }

  async processAutoBidsForListing(listingId, excludeBidId) {
    // Implement auto-bid processing for other users
    logger.info(`Processing auto-bids for listing ${listingId}`);
  }

  async processAutoBidForListing(listingId, bidderId, maxBid) {
    // Implement single auto-bid processing
    logger.info(`Processing auto-bid for user ${bidderId} on listing ${listingId}`);
  }

  startAutoBidProcessor() {
    setInterval(async () => {
      try {
        // Process all active auto-bids
        logger.debug('Running auto-bid processor');
      } catch (error) {
        logger.error('Error in auto-bid processor:', error);
      }
    }, this.AUTO_BID_CHECK_INTERVAL);
  }

  async trackBidEvent(eventType, data) {
    try {
      // Implement event tracking
      logger.info(`Tracking bid event: ${eventType}`, data);
    } catch (error) {
      logger.error('Error tracking bid event:', error);
    }
  }
}

module.exports = new BidService();
