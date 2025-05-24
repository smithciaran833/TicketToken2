const { PublicKey, Transaction } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');
const ListingModel = require('../../models/Listing');
const TicketModel = require('../../models/Ticket');
const UserModel = require('../../models/User');
const NotificationService = require('../notifications/notificationService');
const CacheService = require('../cache/cacheService');
const BlockchainService = require('../blockchain/blockchainService');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class ListingService {
  constructor() {
    this.notificationService = new NotificationService();
    this.cacheService = new CacheService();
    this.blockchainService = new BlockchainService();
    
    // Fee configuration
    this.PLATFORM_FEE_PERCENTAGE = 2.5; // 2.5%
    this.MIN_LISTING_PRICE = 0.01; // Minimum price in SOL
    this.MAX_LISTING_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
    this.DEFAULT_AUCTION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
  }

  /**
   * Create a new marketplace listing
   */
  async createListing(ticketId, price, type = 'fixed', duration = null, options = {}) {
    try {
      // Validate listing data
      const validationResult = await this.validateListing({
        ticketId,
        price,
        type,
        duration,
        ...options
      });

      if (!validationResult.isValid) {
        throw new AppError(validationResult.error, 400);
      }

      // Check ownership
      const ownership = await this.checkOwnership(ticketId, options.sellerId);
      if (!ownership.isOwner) {
        throw new AppError('You do not own this ticket', 403);
      }

      // Get ticket details
      const ticket = await TicketModel.findById(ticketId)
        .populate('eventId')
        .populate('userId');

      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      // Check if ticket is already listed
      const existingListing = await ListingModel.findOne({
        ticketId,
        status: 'active'
      });

      if (existingListing) {
        throw new AppError('Ticket is already listed', 400);
      }

      // Calculate fees
      const fees = await this.calculateFees(price, ticket);

      // Create blockchain listing
      const blockchainResult = await this.createBlockchainListing({
        ticketMint: new PublicKey(ticket.mintAddress),
        price: new BN(price * 1e9), // Convert to lamports
        type,
        duration: duration ? new BN(duration) : null,
        seller: new PublicKey(options.sellerId)
      });

      // Create database listing
      const listing = new ListingModel({
        ticketId,
        sellerId: options.sellerId,
        eventId: ticket.eventId._id,
        price,
        type,
        status: 'active',
        fees: {
          platformFee: fees.platformFee,
          royaltyFee: fees.royaltyFee,
          totalFees: fees.totalFees,
          sellerProceeds: fees.sellerProceeds
        },
        blockchain: {
          listingAddress: blockchainResult.listingAddress,
          escrowAddress: blockchainResult.escrowAddress,
          transactionSignature: blockchainResult.signature
        },
        metadata: {
          ticketType: ticket.ticketType,
          originalPrice: ticket.price,
          eventName: ticket.eventId.name,
          eventDate: ticket.eventId.startDate,
          section: ticket.metadata?.section,
          row: ticket.metadata?.row,
          seat: ticket.metadata?.seat
        },
        expiresAt: type === 'auction' ? 
          new Date(Date.now() + (duration || this.DEFAULT_AUCTION_DURATION)) : 
          null,
        analytics: {
          views: 0,
          watchlistCount: 0,
          bidCount: 0
        }
      });

      if (type === 'auction') {
        listing.auction = {
          startingPrice: price,
          currentBid: 0,
          bidIncrement: options.bidIncrement || price * 0.05, // 5% increment
          reservePrice: options.reservePrice || price,
          bids: []
        };
      }

      await listing.save();

      // Update ticket status
      ticket.status = 'listed';
      ticket.listingId = listing._id;
      await ticket.save();

      // Clear cache
      await this.cacheService.delete(`listings:*`);
      await this.cacheService.delete(`ticket:${ticketId}`);

      // Send notification
      await this.notificationService.sendNotification({
        userId: options.sellerId,
        type: 'listing_created',
        title: 'Listing Created',
        message: `Your ticket for ${ticket.eventId.name} has been listed for ${price} SOL`,
        data: { listingId: listing._id }
      });

      // Track analytics
      await this.trackListingEvent('listing_created', {
        listingId: listing._id,
        ticketId,
        price,
        type,
        eventId: ticket.eventId._id
      });

      logger.info('Listing created successfully', {
        listingId: listing._id,
        ticketId,
        sellerId: options.sellerId
      });

      return {
        success: true,
        listing: await this.getListingById(listing._id),
        fees
      };
    } catch (error) {
      logger.error('Error creating listing:', error);
      throw error;
    }
  }

  /**
   * Update an existing listing
   */
  async updateListing(listingId, updates, sellerId) {
    try {
      const listing = await ListingModel.findOne({
        _id: listingId,
        sellerId,
        status: 'active'
      });

      if (!listing) {
        throw new AppError('Listing not found or unauthorized', 404);
      }

      // Validate updates
      const allowedUpdates = ['price', 'description', 'images'];
      const updateKeys = Object.keys(updates);
      const isValidUpdate = updateKeys.every(key => allowedUpdates.includes(key));

      if (!isValidUpdate) {
        throw new AppError('Invalid updates', 400);
      }

      // Validate new price if provided
      if (updates.price !== undefined) {
        if (updates.price < this.MIN_LISTING_PRICE) {
          throw new AppError(`Price must be at least ${this.MIN_LISTING_PRICE} SOL`, 400);
        }

        // Update blockchain listing
        await this.updateBlockchainListing(
          new PublicKey(listing.blockchain.listingAddress),
          new BN(updates.price * 1e9),
          new PublicKey(sellerId)
        );

        // Recalculate fees
        const ticket = await TicketModel.findById(listing.ticketId);
        const fees = await this.calculateFees(updates.price, ticket);
        
        listing.fees = {
          platformFee: fees.platformFee,
          royaltyFee: fees.royaltyFee,
          totalFees: fees.totalFees,
          sellerProceeds: fees.sellerProceeds
        };
      }

      // Apply updates
      Object.keys(updates).forEach(key => {
        listing[key] = updates[key];
      });

      listing.updatedAt = new Date();
      await listing.save();

      // Clear cache
      await this.cacheService.delete(`listing:${listingId}`);
      await this.cacheService.delete(`listings:*`);

      // Track analytics
      await this.trackListingEvent('listing_updated', {
        listingId,
        updates,
        sellerId
      });

      logger.info('Listing updated successfully', { listingId, updates });

      return {
        success: true,
        listing: await this.getListingById(listingId)
      };
    } catch (error) {
      logger.error('Error updating listing:', error);
      throw error;
    }
  }

  /**
   * Cancel an active listing
   */
  async cancelListing(listingId, sellerId) {
    try {
      const listing = await ListingModel.findOne({
        _id: listingId,
        sellerId,
        status: 'active'
      });

      if (!listing) {
        throw new AppError('Listing not found or unauthorized', 404);
      }

      // Cancel blockchain listing
      await this.cancelBlockchainListing(
        new PublicKey(listing.blockchain.listingAddress),
        new PublicKey(sellerId)
      );

      // Update listing status
      listing.status = 'cancelled';
      listing.cancelledAt = new Date();
      await listing.save();

      // Update ticket status
      await TicketModel.findByIdAndUpdate(listing.ticketId, {
        status: 'active',
        $unset: { listingId: 1 }
      });

      // Refund any bids if auction
      if (listing.type === 'auction' && listing.auction.bids.length > 0) {
        await this.refundAllBids(listing);
      }

      // Clear cache
      await this.cacheService.delete(`listing:${listingId}`);
      await this.cacheService.delete(`listings:*`);

      // Send notification
      await this.notificationService.sendNotification({
        userId: sellerId,
        type: 'listing_cancelled',
        title: 'Listing Cancelled',
        message: `Your listing has been cancelled`,
        data: { listingId }
      });

      // Track analytics
      await this.trackListingEvent('listing_cancelled', {
        listingId,
        sellerId,
        reason: 'seller_cancelled'
      });

      logger.info('Listing cancelled successfully', { listingId, sellerId });

      return {
        success: true,
        message: 'Listing cancelled successfully'
      };
    } catch (error) {
      logger.error('Error cancelling listing:', error);
      throw error;
    }
  }

  /**
   * Get filtered listings with pagination
   */
  async getListings(filters = {}, pagination = {}) {
    try {
      const cacheKey = `listings:${JSON.stringify({ filters, pagination })}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached;

      const {
        page = 1,
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = pagination;

      const query = { status: 'active' };

      // Apply filters
      if (filters.eventId) {
        query.eventId = filters.eventId;
      }

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.priceMin || filters.priceMax) {
        query.price = {};
        if (filters.priceMin) query.price.$gte = filters.priceMin;
        if (filters.priceMax) query.price.$lte = filters.priceMax;
      }

      if (filters.ticketType) {
        query['metadata.ticketType'] = filters.ticketType;
      }

      if (filters.section) {
        query['metadata.section'] = filters.section;
      }

      if (filters.searchTerm) {
        query.$or = [
          { 'metadata.eventName': { $regex: filters.searchTerm, $options: 'i' } },
          { description: { $regex: filters.searchTerm, $options: 'i' } }
        ];
      }

      // Execute query
      const [listings, total] = await Promise.all([
        ListingModel.find(query)
          .populate('ticketId')
          .populate('sellerId', 'username walletAddress')
          .populate('eventId', 'name venue startDate endDate images')
          .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
          .limit(limit)
          .skip((page - 1) * limit)
          .lean(),
        ListingModel.countDocuments(query)
      ]);

      // Enhance listings with additional data
      const enhancedListings = await Promise.all(
        listings.map(async (listing) => {
          // Get seller rating
          const sellerStats = await this.getSellerStats(listing.sellerId._id);
          
          return {
            ...listing,
            seller: {
              ...listing.sellerId,
              rating: sellerStats.rating,
              totalSales: sellerStats.totalSales
            },
            timeRemaining: listing.expiresAt ? 
              Math.max(0, new Date(listing.expiresAt) - new Date()) : null,
            isExpired: listing.expiresAt ? 
              new Date(listing.expiresAt) < new Date() : false
          };
        })
      );

      const result = {
        listings: enhancedListings,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasMore: page < Math.ceil(total / limit)
        },
        filters
      };

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, result, 300);

      return result;
    } catch (error) {
      logger.error('Error getting listings:', error);
      throw error;
    }
  }

  /**
   * Get single listing details
   */
  async getListingById(listingId) {
    try {
      const cacheKey = `listing:${listingId}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached;

      const listing = await ListingModel.findById(listingId)
        .populate('ticketId')
        .populate('sellerId', 'username walletAddress profileImage')
        .populate('eventId')
        .lean();

      if (!listing) {
        throw new AppError('Listing not found', 404);
      }

      // Increment view count
      await ListingModel.findByIdAndUpdate(listingId, {
        $inc: { 'analytics.views': 1 }
      });

      // Get seller stats
      const sellerStats = await this.getSellerStats(listing.sellerId._id);

      // Get similar listings
      const similarListings = await this.getSimilarListings(listing);

      // Get price history if available
      const priceHistory = await this.getPriceHistory(listing.ticketId._id);

      const enhancedListing = {
        ...listing,
        seller: {
          ...listing.sellerId,
          rating: sellerStats.rating,
          totalSales: sellerStats.totalSales,
          responseTime: sellerStats.avgResponseTime
        },
        similarListings,
        priceHistory,
        timeRemaining: listing.expiresAt ? 
          Math.max(0, new Date(listing.expiresAt) - new Date()) : null,
        isExpired: listing.expiresAt ? 
          new Date(listing.expiresAt) < new Date() : false
      };

      // Cache for 1 minute
      await this.cacheService.set(cacheKey, enhancedListing, 60);

      return enhancedListing;
    } catch (error) {
      logger.error('Error getting listing by ID:', error);
      throw error;
    }
  }

  /**
   * Comprehensive listing validation
   */
  async validateListing(listingData) {
    const errors = [];

    // Price validation
    if (!listingData.price || listingData.price < this.MIN_LISTING_PRICE) {
      errors.push(`Price must be at least ${this.MIN_LISTING_PRICE} SOL`);
    }

    // Type validation
    const validTypes = ['fixed', 'auction'];
    if (!validTypes.includes(listingData.type)) {
      errors.push('Invalid listing type');
    }

    // Duration validation for auctions
    if (listingData.type === 'auction') {
      if (listingData.duration && listingData.duration > this.MAX_LISTING_DURATION) {
        errors.push('Auction duration exceeds maximum allowed');
      }
    }

    // Ticket validation
    const ticket = await TicketModel.findById(listingData.ticketId);
    if (!ticket) {
      errors.push('Ticket not found');
    } else {
      // Check ticket status
      if (ticket.status !== 'active' && ticket.status !== 'listed') {
        errors.push('Ticket is not available for listing');
      }

      // Check if ticket is transferable
      if (ticket.restrictions?.nonTransferable) {
        errors.push('This ticket is non-transferable');
      }

      // Check event status
      const event = await ticket.populate('eventId');
      if (event.eventId.status === 'cancelled') {
        errors.push('Cannot list tickets for cancelled events');
      }

      // Check if event has already happened
      if (new Date(event.eventId.startDate) < new Date()) {
        errors.push('Cannot list tickets for past events');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      error: errors[0] || null
    };
  }

  /**
   * Check ticket ownership
   */
  async checkOwnership(ticketId, sellerId) {
    try {
      const ticket = await TicketModel.findById(ticketId);
      
      if (!ticket) {
        return { isOwner: false, reason: 'Ticket not found' };
      }

      // Check database ownership
      if (ticket.userId.toString() !== sellerId) {
        return { isOwner: false, reason: 'Not the ticket owner' };
      }

      // Verify blockchain ownership
      const blockchainOwnership = await this.blockchainService.verifyNFTOwnership(
        new PublicKey(ticket.mintAddress),
        new PublicKey(sellerId)
      );

      if (!blockchainOwnership) {
        return { isOwner: false, reason: 'Blockchain ownership verification failed' };
      }

      return { isOwner: true };
    } catch (error) {
      logger.error('Error checking ownership:', error);
      return { isOwner: false, reason: 'Ownership verification error' };
    }
  }

  /**
   * Calculate platform and royalty fees
   */
  async calculateFees(price, ticket) {
    try {
      const platformFee = price * (this.PLATFORM_FEE_PERCENTAGE / 100);
      
      // Get royalty information from ticket/event
      let royaltyFee = 0;
      if (ticket.eventId && ticket.eventId.royaltyPercentage) {
        royaltyFee = price * (ticket.eventId.royaltyPercentage / 100);
      }

      const totalFees = platformFee + royaltyFee;
      const sellerProceeds = price - totalFees;

      return {
        price,
        platformFee: Math.round(platformFee * 100) / 100,
        royaltyFee: Math.round(royaltyFee * 100) / 100,
        totalFees: Math.round(totalFees * 100) / 100,
        sellerProceeds: Math.round(sellerProceeds * 100) / 100,
        breakdown: {
          platformFeePercentage: this.PLATFORM_FEE_PERCENTAGE,
          royaltyFeePercentage: ticket.eventId?.royaltyPercentage || 0
        }
      };
    } catch (error) {
      logger.error('Error calculating fees:', error);
      throw error;
    }
  }

  /**
   * Process expired listings
   */
  async processListingExpiry() {
    try {
      const expiredListings = await ListingModel.find({
        status: 'active',
        expiresAt: { $lt: new Date() }
      });

      logger.info(`Processing ${expiredListings.length} expired listings`);

      for (const listing of expiredListings) {
        try {
          // Handle based on listing type
          if (listing.type === 'auction') {
            await this.processExpiredAuction(listing);
          } else {
            await this.processExpiredFixedListing(listing);
          }
        } catch (error) {
          logger.error(`Error processing expired listing ${listing._id}:`, error);
        }
      }

      return {
        processed: expiredListings.length
      };
    } catch (error) {
      logger.error('Error processing listing expiry:', error);
      throw error;
    }
  }

  /**
   * Get listing analytics
   */
  async getListingAnalytics(listingId) {
    try {
      const listing = await ListingModel.findById(listingId);
      
      if (!listing) {
        throw new AppError('Listing not found', 404);
      }

      // Get view analytics
      const viewAnalytics = await this.getViewAnalytics(listingId);
      
      // Get bid analytics for auctions
      let bidAnalytics = null;
      if (listing.type === 'auction') {
        bidAnalytics = await this.getBidAnalytics(listingId);
      }

      // Get conversion metrics
      const conversionMetrics = await this.getConversionMetrics(listingId);

      // Get competitor analysis
      const competitorAnalysis = await this.getCompetitorAnalysis(listing);

      return {
        listing: {
          id: listing._id,
          type: listing.type,
          price: listing.price,
          status: listing.status,
          createdAt: listing.createdAt,
          expiresAt: listing.expiresAt
        },
        analytics: {
          views: viewAnalytics,
          bids: bidAnalytics,
          conversion: conversionMetrics,
          competitors: competitorAnalysis
        },
        recommendations: await this.generateListingRecommendations(listing, {
          viewAnalytics,
          bidAnalytics,
          conversionMetrics,
          competitorAnalysis
        })
      };
    } catch (error) {
      logger.error('Error getting listing analytics:', error);
      throw error;
    }
  }

  // Helper methods

  async createBlockchainListing(listingData) {
    try {
      const result = await this.blockchainService.createListing(listingData);
      return result;
    } catch (error) {
      logger.error('Error creating blockchain listing:', error);
      throw new AppError('Failed to create blockchain listing', 500);
    }
  }

  async updateBlockchainListing(listingAddress, newPrice, seller) {
    try {
      const result = await this.blockchainService.updateListing(
        listingAddress,
        newPrice,
        seller
      );
      return result;
    } catch (error) {
      logger.error('Error updating blockchain listing:', error);
      throw new AppError('Failed to update blockchain listing', 500);
    }
  }

  async cancelBlockchainListing(listingAddress, seller) {
    try {
      const result = await this.blockchainService.cancelListing(
        listingAddress,
        seller
      );
      return result;
    } catch (error) {
      logger.error('Error cancelling blockchain listing:', error);
      throw new AppError('Failed to cancel blockchain listing', 500);
    }
  }

  async getSellerStats(sellerId) {
    try {
      const stats = await ListingModel.aggregate([
        {
          $match: {
            sellerId: sellerId,
            status: 'sold'
          }
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: 1 },
            totalRevenue: { $sum: '$price' },
            avgPrice: { $avg: '$price' },
            avgResponseTime: { $avg: '$responseTime' }
          }
        }
      ]);

      // Get seller reviews
      const reviews = await this.getSellerReviews(sellerId);
      const rating = reviews.length > 0 ?
        reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

      return {
        totalSales: stats[0]?.totalSales || 0,
        totalRevenue: stats[0]?.totalRevenue || 0,
        avgPrice: stats[0]?.avgPrice || 0,
        avgResponseTime: stats[0]?.avgResponseTime || 0,
        rating,
        reviewCount: reviews.length
      };
    } catch (error) {
      logger.error('Error getting seller stats:', error);
      return {
        totalSales: 0,
        totalRevenue: 0,
        avgPrice: 0,
        avgResponseTime: 0,
        rating: 0,
        reviewCount: 0
      };
    }
  }

  async getSellerReviews(sellerId) {
    // Implement review fetching logic
    return [];
  }

  async getSimilarListings(listing) {
    try {
      const similar = await ListingModel.find({
        _id: { $ne: listing._id },
        eventId: listing.eventId,
        status: 'active',
        type: listing.type,
        price: {
          $gte: listing.price * 0.8,
          $lte: listing.price * 1.2
        }
      })
      .limit(5)
      .populate('sellerId', 'username')
      .lean();

      return similar;
    } catch (error) {
      logger.error('Error getting similar listings:', error);
      return [];
    }
  }

  async getPriceHistory(ticketId) {
    try {
      const history = await ListingModel.find({
        ticketId,
        status: { $in: ['sold', 'cancelled'] }
      })
      .select('price createdAt status')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

      return history;
    } catch (error) {
      logger.error('Error getting price history:', error);
      return [];
    }
  }

  async processExpiredAuction(listing) {
    try {
      if (listing.auction.bids.length > 0) {
        const highestBid = listing.auction.bids[listing.auction.bids.length - 1];
        
        if (highestBid.amount >= listing.auction.reservePrice) {
          // Accept winning bid
          await this.acceptBid(listing._id, highestBid.bidderId);
        } else {
          // Reserve not met, cancel listing
          listing.status = 'expired';
          listing.expiredReason = 'reserve_not_met';
          await listing.save();
          
          // Refund all bids
          await this.refundAllBids(listing);
        }
      } else {
        // No bids, expire listing
        listing.status = 'expired';
        listing.expiredReason = 'no_bids';
        await listing.save();
      }
    } catch (error) {
      logger.error('Error processing expired auction:', error);
      throw error;
    }
  }

  async processExpiredFixedListing(listing) {
    try {
      listing.status = 'expired';
      listing.expiredAt = new Date();
      await listing.save();

      // Update ticket status
      await TicketModel.findByIdAndUpdate(listing.ticketId, {
        status: 'active',
        $unset: { listingId: 1 }
      });

      // Send notification to seller
      await this.notificationService.sendNotification({
        userId: listing.sellerId,
        type: 'listing_expired',
        title: 'Listing Expired',
        message: 'Your listing has expired and has been removed from the marketplace',
        data: { listingId: listing._id }
      });
    } catch (error) {
      logger.error('Error processing expired fixed listing:', error);
      throw error;
    }
  }

  async refundAllBids(listing) {
    // Implement bid refund logic
    logger.info(`Refunding all bids for listing ${listing._id}`);
  }

  async acceptBid(listingId, bidderId) {
    // Implement bid acceptance logic
    logger.info(`Accepting bid from ${bidderId} for listing ${listingId}`);
  }

  async getViewAnalytics(listingId) {
    // Implement view analytics logic
    return {
      total: 0,
      unique: 0,
      byDay: [],
      bySource: {}
    };
  }

  async getBidAnalytics(listingId) {
    // Implement bid analytics logic
    return {
      totalBids: 0,
      uniqueBidders: 0,
      avgBidAmount: 0,
      bidHistory: []
    };
  }

  async getConversionMetrics(listingId) {
    // Implement conversion metrics logic
    return {
      viewToWatchlist: 0,
      viewToBid: 0,
      viewToPurchase: 0
    };
  }

  async getCompetitorAnalysis(listing) {
    // Implement competitor analysis logic
    return {
      avgPrice: 0,
      pricePosition: 'average',
      totalCompetitors: 0
    };
  }

  async generateListingRecommendations(listing, analytics) {
    const recommendations = [];

    // Price recommendations
    if (analytics.competitors.pricePosition === 'high') {
      recommendations.push({
        type: 'price',
        priority: 'high',
        message: 'Your price is above market average. Consider reducing to increase visibility.'
      });
    }

    // View recommendations
    if (analytics.views.total < 10) {
      recommendations.push({
        type: 'visibility',
        priority: 'medium',
        message: 'Low view count. Consider improving your listing title and description.'
      });
    }

    // Auction recommendations
    if (listing.type === 'auction' && analytics.bids?.totalBids === 0) {
      recommendations.push({
        type: 'auction',
        priority: 'high',
        message: 'No bids yet. Consider lowering the starting price to attract bidders.'
      });
    }

    return recommendations;
  }

  async trackListingEvent(eventType, data) {
    try {
      // Implement event tracking
      logger.info(`Tracking listing event: ${eventType}`, data);
    } catch (error) {
      logger.error('Error tracking listing event:', error);
    }
  }
}

module.exports = new ListingService();
