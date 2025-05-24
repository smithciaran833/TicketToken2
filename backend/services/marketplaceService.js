// services/marketplaceService.js - Marketplace operations service

const Listing = require('../models/Listing');
const Ticket = require('../models/Ticket');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Event = require('../models/Event');
const { v4: uuidv4 } = require('uuid');
const nftVerificationService = require('./nftVerificationService');
const artistRoyaltyService = require('./artistRoyaltyService');

class MarketplaceService {
  /**
   * Create a new listing for a ticket
   * @param {Object} listingData - Listing information
   * @param {String} userId - ID of the seller
   * @returns {Promise<Object>} Created listing
   */
  static async createListing(listingData, userId) {
    try {
      const { ticketId, price } = listingData;
      
      if (!ticketId || !price) {
        throw new Error('Ticket ID and price are required');
      }
      
      // Convert price to number if string
      const numericPrice = typeof price === 'string' ? parseFloat(price) : price;
      
      if (isNaN(numericPrice) || numericPrice <= 0) {
        throw new Error('Price must be a positive number');
      }
      
      // Find the ticket
      const ticket = await Ticket.findOne({ ticketId }).populate('event');
      
      if (!ticket) {
        throw new Error('Ticket not found');
      }
      
      // Verify ownership
      if (ticket.owner.toString() !== userId) {
        throw new Error('You can only list tickets you own');
      }
      
      // Check if ticket is active
      if (ticket.status !== 'active') {
        throw new Error(`Cannot list a ticket with status: ${ticket.status}`);
      }
      
      // Check if ticket is already listed
      const existingListing = await Listing.findOne({ 
        ticket: ticket._id,
        status: 'active'
      });
      
      if (existingListing) {
        throw new Error('This ticket is already listed for sale');
      }
      
      // Verify NFT ownership on blockchain
      const verificationResult = await this.verifyTicketOwnership(ticket, userId);
      
      if (!verificationResult.verified) {
        throw new Error(`Blockchain verification failed: ${verificationResult.reason}`);
      }
      
      // Create listing
      const listingId = uuidv4();
      const listing = await Listing.create({
        listingId,
        seller: userId,
        ticket: ticket._id,
        event: ticket.event._id,
        price: numericPrice,
        status: 'active',
        createdAt: new Date(),
        expiresAt: listingData.expiresAt || null
      });
      
      // Create blockchain listing (placeholder - would integrate with blockchain service)
      const blockchainResult = await this.createBlockchainListing(listing, ticket);
      
      // Update with blockchain info if needed
      if (blockchainResult.success) {
        // Update with blockchain information
      }
      
      return {
        success: true,
        listing,
        blockchainResult
      };
    } catch (error) {
      console.error('Create listing error:', error);
      throw error;
    }
  }
  
/**
   * Purchase a listed ticket
   * @param {String} listingId - ID of the listing to purchase
   * @param {String} buyerId - ID of the buyer
   * @param {String} paymentMethod - Method of payment
   * @returns {Promise<Object>} Purchase results
   */
  static async purchaseListing(listingId, buyerId, paymentMethod = 'wallet') {
    try {
      // Find the listing
      const listing = await Listing.findOne({ listingId, status: 'active' })
        .populate('ticket')
        .populate('seller')
        .populate({
          path: 'event',
          populate: {
            path: 'organizer',
            select: 'displayName username _id'
          }
        });
      
      if (!listing) {
        throw new Error('Listing not found or no longer active');
      }
      
      // Validate the buyer is not the seller
      if (listing.seller._id.toString() === buyerId) {
        throw new Error('You cannot purchase your own listing');
      }
      
      // Find the buyer
      const buyer = await User.findById(buyerId);
      if (!buyer) {
        throw new Error('Buyer not found');
      }
      
      // Process payment (placeholder - would integrate with payment service)
      const paymentResult = await this.processPayment(buyerId, listing.price, paymentMethod);
      
      if (!paymentResult.success) {
        throw new Error(`Payment failed: ${paymentResult.message}`);
      }
      
      // Create transaction record
      const transactionId = uuidv4();
      const transaction = await Transaction.create({
        transactionId,
        type: 'secondary_sale',
        buyer: buyerId,
        seller: listing.seller._id,
        tickets: [{
          ticket: listing.ticket._id,
          price: listing.price
        }],
        totalAmount: listing.price,
        paymentMethod,
        status: 'pending',
        createdAt: new Date()
      });
      
      // Update ticket ownership
      const ticket = listing.ticket;
      
      // Add to transfer history
      ticket.transferHistory.push({
        fromUser: listing.seller._id,
        toUser: buyerId,
        date: new Date(),
        price: listing.price
      });
      
      // Update ownership
      ticket.owner = buyerId;
      await ticket.save();
      
      // Update listing status
      listing.status = 'sold';
      await listing.save();
      
      // Complete transaction
      transaction.status = 'completed';
      transaction.completedAt = new Date();
      await transaction.save();
      
      // Execute blockchain transfer (placeholder - would integrate with blockchain service)
      const transferResult = await this.transferNFTOnBlockchain(listing, buyer);
      
      // Calculate and distribute royalties
      const royaltyResult = await this.calculateAndDistributeRoyalties(
        listing, 
        transaction
      );
      
      return {
        success: true,
        transaction,
        ticket,
        transferResult,
        royaltyResult
      };
    } catch (error) {
      console.error('Purchase listing error:', error);
      throw error;
    }
  }
  
  /**
   * Cancel a listing
   * @param {String} listingId - ID of the listing to cancel
   * @param {String} userId - ID of the user cancelling the listing
   * @returns {Promise<Object>} Cancellation results
   */
  static async cancelListing(listingId, userId) {
    try {
      // Find the listing
      const listing = await Listing.findOne({ listingId, status: 'active' });
      
      if (!listing) {
        throw new Error('Listing not found or no longer active');
      }
      
      // Verify ownership
      if (listing.seller.toString() !== userId) {
        throw new Error('You can only cancel your own listings');
      }
      
      // Update listing status
      listing.status = 'cancelled';
      await listing.save();
      
      // Cancel blockchain listing (placeholder - would integrate with blockchain service)
      const blockchainResult = await this.cancelBlockchainListing(listing);
      
      return {
        success: true,
        listing,
        blockchainResult
      };
    } catch (error) {
      console.error('Cancel listing error:', error);
      throw error;
    }
  }
  
  /**
   * Get active listings
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} Active listings
   */
  static async getActiveListings(filters = {}) {
    try {
      // Build query
      const query = { status: 'active' };
      
      // Apply filters
      if (filters.eventId) {
        const event = await Event.findOne({ eventId: filters.eventId });
        if (event) {
          query.event = event._id;
        }
      }
      
      if (filters.minPrice) {
        query.price = { $gte: parseFloat(filters.minPrice) };
      }
      
      if (filters.maxPrice) {
        query.price = { ...query.price, $lte: parseFloat(filters.maxPrice) };
      }
      
      if (filters.sellerId) {
        query.seller = filters.sellerId;
      }
      
      // Apply sorting
      const sortField = filters.sortField || 'createdAt';
      const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
      const sort = { [sortField]: sortOrder };
      
      // Apply pagination
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 20;
      const skip = (page - 1) * limit;
      
      // Execute query
      const listings = await Listing.find(query)
        .populate('ticket')
        .populate('seller', 'displayName username')
        .populate('event', 'title startDate endDate')
        .sort(sort)
        .skip(skip)
        .limit(limit);
      
      // Get total count
      const total = await Listing.countDocuments(query);
      
      return {
        listings,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Get active listings error:', error);
      throw error;
    }
  }
  
  /**
   * Get listings by seller
   * @param {String} sellerId - ID of the seller
   * @returns {Promise<Array>} Seller's listings
   */
  static async getListingsBySeller(sellerId) {
    try {
      const listings = await Listing.find({ seller: sellerId })
        .populate('ticket')
        .populate('event', 'title startDate endDate')
        .sort({ createdAt: -1 });
      
      return listings;
    } catch (error) {
      console.error('Get listings by seller error:', error);
      throw error;
    }
  }
  
  /**
   * Get listing details
   * @param {String} listingId - ID of the listing
   * @returns {Promise<Object>} Listing details
   */
  static async getListingDetails(listingId) {
    try {
      const listing = await Listing.findOne({ listingId })
        .populate('ticket')
        .populate('seller', 'displayName username')
        .populate({
          path: 'event',
          populate: {
            path: 'organizer',
            select: 'displayName username _id'
          }
        });
      
      if (!listing) {
        throw new Error('Listing not found');
      }
      
      return listing;
    } catch (error) {
      console.error('Get listing details error:', error);
      throw error;
    }
  }
  
  /**
   * Get marketplace statistics
   * @param {String} eventId - Optional event ID to filter stats
   * @returns {Promise<Object>} Marketplace statistics
   */
  static async getMarketplaceStats(eventId) {
    try {
      // Build base query
      let eventQuery = {};
      
      if (eventId) {
        const event = await Event.findOne({ eventId });
        if (event) {
          eventQuery = { event: event._id };
        }
      }
      
      // Get active listings count
      const activeListings = await Listing.countDocuments({
        ...eventQuery,
        status: 'active'
      });
      
      // Get sold listings
      const soldListings = await Listing.countDocuments({
        ...eventQuery,
        status: 'sold'
      });
      
      // Get average price
      const priceAggregation = await Listing.aggregate([
        { $match: { ...eventQuery, status: 'sold' } },
        { $group: {
            _id: null,
            averagePrice: { $avg: '$price' },
            minPrice: { $min: '$price' },
            maxPrice: { $max: '$price' },
            totalVolume: { $sum: '$price' }
          }
        }
      ]);
      
      const priceStats = priceAggregation.length > 0 ? priceAggregation[0] : {
        averagePrice: 0,
        minPrice: 0,
        maxPrice: 0,
        totalVolume: 0
      };
      
      // Get recent sales
      const recentSales = await Listing.find({
        ...eventQuery,
        status: 'sold'
      })
        .populate('ticket')
        .populate('seller', 'displayName username')
        .populate('event', 'title')
        .sort({ updatedAt: -1 })
        .limit(5);
      
      return {
        activeListings,
        soldListings,
        priceStats,
        recentSales,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Get marketplace stats error:', error);
      throw error;
    }
  }
  
  // Helper Methods
  
  /**
   * Process payment for marketplace purchase
   * @private
   */
  static async processPayment(buyerId, amount, paymentMethod) {
    // Placeholder implementation
    console.log(`Processing payment for buyer ${buyerId}: ${amount} via ${paymentMethod}`);
    
    // For demo purposes - in production, this would integrate with a payment processor
    return {
      success: true,
      transactionId: `payment-${uuidv4()}`,
      amount,
      timestamp: new Date()
    };
  }
  
  /**
   * Create listing on blockchain
   * @private
   */
  static async createBlockchainListing(listing, ticket) {
    // Placeholder implementation - would integrate with blockchain service
    console.log(`Creating blockchain listing for ticket ${ticket.ticketId}`);
    
    // For demo purposes
    return {
      success: true,
      listingId: `blockchain-listing-${uuidv4()}`,
      timestamp: new Date()
    };
  }
  
  /**
   * Cancel listing on blockchain
   * @private
   */
  static async cancelBlockchainListing(listing) {
    // Placeholder implementation - would integrate with blockchain service
    console.log(`Cancelling blockchain listing ${listing.listingId}`);
    
    // For demo purposes
    return {
      success: true,
      timestamp: new Date()
    };
  }
  
  /**
   * Transfer NFT ownership on blockchain after purchase
   * @private
   */
  static async transferNFTOnBlockchain(listing, buyer) {
    // Placeholder implementation - would integrate with blockchain service
    console.log(`Transferring NFT for ticket ${listing.ticket.ticketId} to buyer ${buyer._id}`);
    
    // For demo purposes
    return {
      success: true,
      transactionId: `blockchain-tx-${uuidv4()}`,
      timestamp: new Date()
    };
  }
  
  /**
   * Calculate and distribute royalties for secondary sales
   * @private
   */
  static async calculateAndDistributeRoyalties(listing, transaction) {
    try {
      // Get event and organizer
      const event = listing.event;
      const organizer = event.organizer;
      
      // Calculate royalty percentages (placeholder - would be configurable)
      const royaltyPercent = 5; // 5% royalty for creators
      const platformFeePercent = 2.5; // 2.5% platform fee
      
      // Calculate amounts
      const saleAmount = listing.price;
      const royaltyAmount = (saleAmount * royaltyPercent) / 100;
      const platformFee = (saleAmount * platformFeePercent) / 100;
      const sellerAmount = saleAmount - royaltyAmount - platformFee;
      
      // Record royalty payment
      if (organizer) {
        await artistRoyaltyService.recordRoyaltyPayment({
          artistId: organizer._id,
          transactionId: transaction.transactionId,
          date: new Date(),
          amount: royaltyAmount,
          currency: 'USD', // Or appropriate currency
          paymentType: 'fiat', // Or 'crypto' if applicable
          tokenId: listing.ticket.ticketId,
          buyerAddress: transaction.buyer,
          sellerAddress: transaction.seller,
          marketplace: 'TicketToken Marketplace',
          eventId: event._id,
          status: 'completed',
          saleType: 'secondary',
          royaltyPercentage: royaltyPercent
        });
      }
      
      return {
        success: true,
        royaltyAmount,
        platformFee,
        sellerAmount,
        royaltyPercent,
        platformFeePercent
      };
    } catch (error) {
      console.error('Royalty calculation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Verify ticket ownership on blockchain
   * @private
   */
  static async verifyTicketOwnership(ticket, userId) {
    // This would integrate with your blockchain service in production
    // For now, this is a placeholder implementation
    
    try {
      // Verify NFT ownership if NFT data is available
      if (ticket.nftData && ticket.nftData.mintAddress) {
        // Get user wallet addresses
        const user = await User.findById(userId);
        
        if (!user || !user.walletAddresses || user.walletAddresses.length === 0) {
          return {
            verified: false,
            reason: 'User has no connected wallet addresses'
          };
        }
        
        const walletAddresses = user.walletAddresses.map(w => w.address);
        
        // In production, this would verify on blockchain using nftVerificationService
        console.log(`Verifying NFT ownership for ticket ${ticket.ticketId} with wallet addresses ${walletAddresses.join(', ')}`);
        
        // For demo purposes
        return {
          verified: true,
          timestamp: new Date()
        };
      }
      
      // If no NFT data, fall back to database ownership check
      return {
        verified: ticket.owner.toString() === userId,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Ticket ownership verification error:', error);
      return {
        verified: false,
        reason: error.message
      };
    }
  }
}

module.exports = MarketplaceService;
