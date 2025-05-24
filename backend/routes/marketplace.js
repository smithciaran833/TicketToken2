const express = require('express');
const router = express.Router();
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

// Import utilities
const { ResponseFormatter } = require('../utils/responseFormatter');
const { logger, logBusinessEvent, logBlockchainTransaction } = require('../utils/logger');
const { PAGINATION, USER_ROLES, PERMISSIONS, BLOCKCHAIN_NETWORKS } = require('../utils/constants');
const { isValidWallet, calculatePercentage, formatCurrency } = require('../utils/helpers');

// Import middleware
const authMiddleware = require('../middleware/auth');
const permissionMiddleware = require('../middleware/permissions');
const validationMiddleware = require('../middleware/validation');
const cacheMiddleware = require('../middleware/cache');
const nftGateMiddleware = require('../middleware/nftGate');

// Import controllers
const marketplaceController = require('../controllers/marketplaceController');
const nftController = require('../controllers/nftController');
const ticketController = require('../controllers/ticketController');
const blockchainController = require('../controllers/blockchainController');
const royaltyController = require('../controllers/royaltyController');
const analyticsController = require('../controllers/analyticsController');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Marketplace query parameters validation
 */
const marketplaceQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().valid('price', 'date', 'popularity', 'ending_soon', 'newest').default('date'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  type: Joi.string().valid('fixed_price', 'auction', 'bundle').optional(),
  category: Joi.string().optional(),
  eventId: Joi.string().optional(),
  artist: Joi.string().optional(),
  seller: Joi.string().optional(),
  priceMin: Joi.number().min(0).optional(),
  priceMax: Joi.number().min(0).optional(),
  currency: Joi.string().valid('USD', 'ETH', 'MATIC').optional(),
  status: Joi.string().valid('active', 'sold', 'cancelled', 'expired').default('active'),
  search: Joi.string().trim().min(2).max(100).optional(),
  tags: Joi.array().items(Joi.string().trim().max(50)).max(10).optional(),
  hasOffers: Joi.boolean().optional(),
  endingSoon: Joi.boolean().optional(), // Items ending within 24 hours
  verified: Joi.boolean().optional(), // Verified sellers only
  network: Joi.string().valid(...Object.keys(BLOCKCHAIN_NETWORKS)).optional()
});

/**
 * Create listing validation schema
 */
const createListingSchema = Joi.object({
  itemType: Joi.string()
    .valid('ticket', 'nft', 'bundle')
    .required(),
  
  itemId: Joi.string()
    .required()
    .messages({
      'any.required': 'Item ID is required'
    }),
  
  listingType: Joi.string()
    .valid('fixed_price', 'auction', 'accept_offers')
    .required(),
  
  price: Joi.number()
    .min(0)
    .precision(8)
    .when('listingType', {
      is: Joi.valid('fixed_price', 'auction'),
      then: Joi.required()
    }),
  
  reservePrice: Joi.number()
    .min(0)
    .precision(8)
    .when('listingType', {
      is: 'auction',
      then: Joi.optional()
    }),
  
  currency: Joi.string()
    .valid('USD', 'ETH', 'MATIC', 'BTC')
    .default('USD'),
  
  duration: Joi.number()
    .integer()
    .min(1)
    .max(365)
    .default(30)
    .messages({
      'number.min': 'Listing duration must be at least 1 day',
      'number.max': 'Listing duration cannot exceed 365 days'
    }),
  
  auctionDuration: Joi.number()
    .integer()
    .min(1)
    .max(30)
    .when('listingType', {
      is: 'auction',
      then: Joi.required()
    })
    .messages({
      'number.min': 'Auction duration must be at least 1 day',
      'number.max': 'Auction duration cannot exceed 30 days'
    }),
  
  description: Joi.string()
    .trim()
    .max(2000)
    .optional(),
  
  tags: Joi.array()
    .items(Joi.string().trim().min(2).max(50))
    .max(20)
    .optional(),
  
  royalties: Joi.object({
    enabled: Joi.boolean().default(true),
    percentage: Joi.number().min(0).max(20).default(5),
    recipients: Joi.array().items(
      Joi.object({
        address: Joi.string().custom((value, helpers) => {
          if (!isValidWallet(value, 'ethereum')) {
            return helpers.error('any.invalid');
          }
          return value;
        }).required(),
        percentage: Joi.number().min(1).max(100).required()
      })
    ).optional()
  }).optional(),
  
  settings: Joi.object({
    allowOffers: Joi.boolean().default(true),
    autoAcceptPrice: Joi.number().min(0).optional(),
    makePrivate: Joi.boolean().default(false),
    bundleDiscount: Joi.number().min(0).max(50).when('itemType', {
      is: 'bundle',
      then: Joi.optional()
    }),
    transferable: Joi.boolean().default(true),
    allowBundling: Joi.boolean().default(true)
  }).optional(),
  
  network: Joi.string()
    .valid(...Object.keys(BLOCKCHAIN_NETWORKS))
    .default('ethereum'),
  
  contractAddress: Joi.string()
    .custom((value, helpers) => {
      if (!isValidWallet(value, 'ethereum')) {
        return helpers.error('any.invalid');
      }
      return value;
    })
    .when('itemType', {
      is: 'nft',
      then: Joi.required()
    })
});

/**
 * Update listing validation schema
 */
const updateListingSchema = Joi.object({
  price: Joi.number().min(0).precision(8).optional(),
  reservePrice: Joi.number().min(0).precision(8).optional(),
  duration: Joi.number().integer().min(1).max(365).optional(),
  description: Joi.string().trim().max(2000).optional(),
  tags: Joi.array().items(Joi.string().trim().min(2).max(50)).max(20).optional(),
  settings: Joi.object({
    allowOffers: Joi.boolean().optional(),
    autoAcceptPrice: Joi.number().min(0).optional(),
    makePrivate: Joi.boolean().optional()
  }).optional()
});

/**
 * Bid placement validation schema
 */
const placeBidSchema = Joi.object({
  amount: Joi.number()
    .min(0)
    .precision(8)
    .required()
    .messages({
      'number.min': 'Bid amount must be greater than 0',
      'any.required': 'Bid amount is required'
    }),
  
  currency: Joi.string()
    .valid('USD', 'ETH', 'MATIC', 'BTC')
    .required(),
  
  expiresIn: Joi.number()
    .integer()
    .min(1)
    .max(30)
    .default(7)
    .messages({
      'number.min': 'Bid expiration must be at least 1 day',
      'number.max': 'Bid expiration cannot exceed 30 days'
    }),
  
  message: Joi.string()
    .trim()
    .max(500)
    .optional(),
  
  walletAddress: Joi.string()
    .custom((value, helpers) => {
      if (!isValidWallet(value, 'ethereum')) {
        return helpers.error('any.invalid');
      }
      return value;
    })
    .required(),
  
  signature: Joi.string()
    .required()
    .messages({
      'any.required': 'Wallet signature is required for bid verification'
    })
});

/**
 * Buy now validation schema
 */
const buyNowSchema = Joi.object({
  paymentMethod: Joi.object({
    type: Joi.string().valid('card', 'crypto', 'wallet').required(),
    token: Joi.string().when('type', { is: 'card', then: Joi.required() }),
    walletAddress: Joi.string().when('type', {
      is: Joi.valid('crypto', 'wallet'),
      then: Joi.string().custom((value, helpers) => {
        if (!isValidWallet(value, 'ethereum')) {
          return helpers.error('any.invalid');
        }
        return value;
      }).required()
    }),
    signature: Joi.string().when('type', {
      is: Joi.valid('crypto', 'wallet'),
      then: Joi.required()
    })
  }).required(),
  
  buyerAddress: Joi.string()
    .custom((value, helpers) => {
      if (!isValidWallet(value, 'ethereum')) {
        return helpers.error('any.invalid');
      }
      return value;
    })
    .required(),
  
  agreedPrice: Joi.number()
    .min(0)
    .precision(8)
    .required(),
  
  currency: Joi.string()
    .valid('USD', 'ETH', 'MATIC', 'BTC')
    .required()
});

/**
 * Accept offer validation schema
 */
const acceptOfferSchema = Joi.object({
  bidId: Joi.string().required(),
  signature: Joi.string().required(),
  terms: Joi.object({
    transferRoyalties: Joi.boolean().default(true),
    immediateTransfer: Joi.boolean().default(true)
  }).optional()
});

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * General marketplace rate limiting
 */
const marketplaceRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150,
  message: 'Too many marketplace requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 150,
      remaining: 0,
      resetTime: Date.now() + (15 * 60 * 1000)
    });
  }
});

/**
 * Trading operations rate limiting (more restrictive)
 */
const tradingRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many trading attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 20,
      remaining: 0,
      resetTime: Date.now() + (60 * 60 * 1000)
    });
  }
});

/**
 * Bidding rate limiting
 */
const biddingRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  message: 'Too many bidding attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 30,
      remaining: 0,
      resetTime: Date.now() + (10 * 60 * 1000)
    });
  }
});

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * GET /marketplace - List marketplace items with filters
 */
router.get('/',
  marketplaceRateLimit,
  validationMiddleware.validateQuery(marketplaceQuerySchema),
  cacheMiddleware(120), // 2 minutes cache
  async (req, res) => {
    try {
      const userId = req.user?.id;
      const {
        page,
        limit,
        sort,
        order,
        type,
        category,
        eventId,
        artist,
        seller,
        priceMin,
        priceMax,
        currency,
        status,
        search,
        tags,
        hasOffers,
        endingSoon,
        verified,
        network
      } = req.query;

      const filters = {
        ...(type && { type }),
        ...(category && { category }),
        ...(eventId && { eventId }),
        ...(artist && { artist }),
        ...(seller && { seller }),
        ...(priceMin && { priceMin }),
        ...(priceMax && { priceMax }),
        ...(currency && { currency }),
        ...(status && { status }),
        ...(search && { search }),
        ...(tags && { tags }),
        ...(hasOffers !== undefined && { hasOffers }),
        ...(endingSoon !== undefined && { endingSoon }),
        ...(verified !== undefined && { verified }),
        ...(network && { network })
      };

      const result = await marketplaceController.getListings({
        filters,
        pagination: { page, limit },
        sort: { field: sort, order },
        userId // For personalization
      });

      return ResponseFormatter.formatPaginated(
        res,
        result.data,
        page,
        limit,
        result.total,
        'Marketplace listings retrieved successfully',
        {
          filters,
          sort: { field: sort, order },
          marketplaceStats: result.stats
        }
      );

    } catch (error) {
      logger.error('Error listing marketplace items', {
        error: error.message,
        query: req.query,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /marketplace/trending - Get trending listings
 */
router.get('/trending',
  marketplaceRateLimit,
  cacheMiddleware(600), // 10 minutes cache
  async (req, res) => {
    try {
      const { limit = 20, timeframe = '24h' } = req.query;

      const trending = await marketplaceController.getTrendingListings({
        limit: parseInt(limit),
        timeframe
      });

      return ResponseFormatter.formatSuccess(
        res,
        trending,
        'Trending listings retrieved successfully',
        {
          timeframe,
          trendingFactors: ['views', 'bids', 'price_changes', 'social_activity']
        }
      );

    } catch (error) {
      logger.error('Error getting trending listings', {
        error: error.message,
        query: req.query,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /marketplace/:id - Get single listing details
 */
router.get('/:id',
  marketplaceRateLimit,
  cacheMiddleware(60), // 1 minute cache
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const listing = await marketplaceController.getListingById(id, userId);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      // Include additional data for detailed view
      const enrichedListing = await marketplaceController.enrichListingData(listing, {
        includeBidHistory: true,
        includeViewHistory: true,
        includeSimilarItems: true,
        includeOwnershipHistory: true
      });

      // Log view for analytics
      if (userId && userId !== listing.seller.toString()) {
        await analyticsController.trackListingView(id, userId, {
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          referer: req.get('Referer')
        });
      }

      return ResponseFormatter.formatSuccess(
        res,
        enrichedListing,
        'Listing details retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting listing details', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /marketplace - Create new listing
 */
router.post('/',
  tradingRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(createListingSchema),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const listingData = { ...req.body, seller: userId };

      // Verify ownership of the item being listed
      const ownership = await marketplaceController.verifyItemOwnership(
        req.body.itemType,
        req.body.itemId,
        userId
      );

      if (!ownership.isOwner) {
        return ResponseFormatter.formatForbidden(res, 'You do not own this item');
      }

      // Check if item is already listed
      const existingListing = await marketplaceController.getActiveListingByItem(
        req.body.itemType,
        req.body.itemId
      );

      if (existingListing) {
        return ResponseFormatter.formatConflict(res, 'Item is already listed on marketplace');
      }

      const listing = await marketplaceController.createListing(listingData);

      // Set up blockchain listing if NFT
      if (req.body.itemType === 'nft') {
        const nftListing = await nftController.createMarketplaceListing({
          tokenId: req.body.itemId,
          contractAddress: req.body.contractAddress,
          price: req.body.price,
          currency: req.body.currency,
          listingType: req.body.listingType,
          duration: req.body.duration
        });

        listing.blockchainListingId = nftListing.id;
      }

      // Log business event
      logBusinessEvent('marketplace_listing_created', {
        listingId: listing.id,
        sellerId: userId,
        itemType: req.body.itemType,
        itemId: req.body.itemId,
        listingType: req.body.listingType,
        price: req.body.price,
        currency: req.body.currency
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        listing,
        'Listing created successfully'
      );

    } catch (error) {
      logger.error('Error creating listing', {
        error: error.message,
        userId: req.user?.id,
        listingData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * PUT /marketplace/:id - Update listing (seller only)
 */
router.put('/:id',
  tradingRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(updateListingSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const listing = await marketplaceController.getListingById(id);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      if (listing.seller.toString() !== userId) {
        return ResponseFormatter.formatForbidden(res, 'You can only update your own listings');
      }

      if (listing.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Only active listings can be updated', 400);
      }

      // Check if there are active bids that would be affected
      if (req.body.price && listing.listingType === 'auction') {
        const activeBids = await marketplaceController.getActiveBids(id);
        if (activeBids.length > 0 && req.body.price < Math.max(...activeBids.map(b => b.amount))) {
          return ResponseFormatter.formatError(res, 'Cannot lower price below highest bid', 400);
        }
      }

      const updatedListing = await marketplaceController.updateListing(id, req.body);

      // Update blockchain listing if applicable
      if (listing.blockchainListingId) {
        await nftController.updateMarketplaceListing(listing.blockchainListingId, {
          price: req.body.price,
          duration: req.body.duration
        });
      }

      // Log business event
      logBusinessEvent('marketplace_listing_updated', {
        listingId: id,
        sellerId: userId,
        changes: Object.keys(req.body)
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        updatedListing,
        'Listing updated successfully'
      );

    } catch (error) {
      logger.error('Error updating listing', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        updateData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * DELETE /marketplace/:id - Cancel listing (seller only)
 */
router.delete('/:id',
  tradingRateLimit,
  authMiddleware.requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const listing = await marketplaceController.getListingById(id);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      if (listing.seller.toString() !== userId) {
        return ResponseFormatter.formatForbidden(res, 'You can only cancel your own listings');
      }

      if (listing.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Only active listings can be cancelled', 400);
      }

      // Check for active bids
      const activeBids = await marketplaceController.getActiveBids(id);
      if (activeBids.length > 0) {
        // Notify bidders about cancellation
        await marketplaceController.notifyBiddersOfCancellation(id, activeBids);
      }

      await marketplaceController.cancelListing(id, userId);

      // Cancel blockchain listing if applicable
      if (listing.blockchainListingId) {
        await nftController.cancelMarketplaceListing(listing.blockchainListingId);
      }

      // Log business event
      logBusinessEvent('marketplace_listing_cancelled', {
        listingId: id,
        sellerId: userId,
        activeBidsCount: activeBids.length
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatNoContent(res, 'Listing cancelled successfully');

    } catch (error) {
      logger.error('Error cancelling listing', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /marketplace/:id/bid - Place bid on auction
 */
router.post('/:id/bid',
  biddingRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(placeBidSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const bidData = { ...req.body, bidder: userId };

      const listing = await marketplaceController.getListingById(id);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      if (listing.seller.toString() === userId) {
        return ResponseFormatter.formatForbidden(res, 'You cannot bid on your own listing');
      }

      if (listing.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Listing is not active', 400);
      }

      if (!['auction', 'accept_offers'].includes(listing.listingType)) {
        return ResponseFormatter.formatError(res, 'This listing does not accept bids', 400);
      }

      // Validate bid amount
      const currentHighestBid = await marketplaceController.getHighestBid(id);
      const minimumBid = currentHighestBid 
        ? currentHighestBid.amount * 1.05 // 5% increment
        : listing.reservePrice || listing.price * 0.5; // 50% of listing price if no reserve

      if (req.body.amount < minimumBid) {
        return ResponseFormatter.formatError(
          res,
          `Bid must be at least ${formatCurrency(minimumBid, { currency: listing.currency })}`,
          400
        );
      }

      // Verify wallet signature
      const signatureValid = await blockchainController.verifyBidSignature({
        bidAmount: req.body.amount,
        currency: req.body.currency,
        listingId: id,
        bidderAddress: req.body.walletAddress,
        signature: req.body.signature
      });

      if (!signatureValid) {
        return ResponseFormatter.formatError(res, 'Invalid wallet signature', 400);
      }

      const bid = await marketplaceController.placeBid(id, bidData);

      // Check if bid meets auto-accept criteria
      if (listing.settings.autoAcceptPrice && req.body.amount >= listing.settings.autoAcceptPrice) {
        await marketplaceController.autoAcceptBid(id, bid.id);
        
        // Log auto-acceptance
        logBusinessEvent('bid_auto_accepted', {
          listingId: id,
          bidId: bid.id,
          bidAmount: req.body.amount,
          bidderId: userId,
          sellerId: listing.seller
        }, { correlationId: req.correlationId });
      }

      // Log business event
      logBusinessEvent('bid_placed', {
        listingId: id,
        bidId: bid.id,
        bidAmount: req.body.amount,
        currency: req.body.currency,
        bidderId: userId,
        sellerId: listing.seller
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        bid,
        'Bid placed successfully'
      );

    } catch (error) {
      logger.error('Error placing bid', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        bidData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /marketplace/:id/bids - Get bid history
 */
router.get('/:id/bids',
  marketplaceRateLimit,
  cacheMiddleware(30), // 30 seconds cache
  async (req, res) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20, includePrivate = false } = req.query;
      const userId = req.user?.id;

      const listing = await marketplaceController.getListingById(id);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      // Only seller can see private bids and bidder details
      const showPrivateDetails = userId && 
        (listing.seller.toString() === userId || 
         permissionMiddleware.hasPermission(req.user?.role, PERMISSIONS.MANAGE_EVENTS));

      const bids = await marketplaceController.getBidHistory(id, {
        pagination: { page: parseInt(page), limit: parseInt(limit) },
        includePrivate: showPrivateDetails && includePrivate,
        userId
      });

      return ResponseFormatter.formatPaginated(
        res,
        bids.data,
        page,
        limit,
        bids.total,
        'Bid history retrieved successfully',
        {
          highestBid: bids.highestBid,
          totalBidders: bids.totalBidders,
          averageBid: bids.averageBid
        }
      );

    } catch (error) {
      logger.error('Error getting bid history', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /marketplace/:id/buy - Buy now (fixed price)
 */
router.post('/:id/buy',
  tradingRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(buyNowSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const purchaseData = { ...req.body, buyer: userId };

      const listing = await marketplaceController.getListingById(id);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      if (listing.seller.toString() === userId) {
        return ResponseFormatter.formatForbidden(res, 'You cannot buy your own listing');
      }

      if (listing.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Listing is not active', 400);
      }

      if (listing.listingType !== 'fixed_price') {
        return ResponseFormatter.formatError(res, 'This is not a fixed price listing', 400);
      }

      // Verify agreed price matches listing price
      if (req.body.agreedPrice !== listing.price) {
        return ResponseFormatter.formatError(res, 'Price mismatch with current listing price', 400);
      }

      // Process payment and transfer
      const purchase = await marketplaceController.processPurchase(id, purchaseData);

      // Calculate and distribute royalties
      const royaltyDistribution = await royaltyController.calculateRoyalties({
        salePrice: purchase.finalPrice,
        currency: purchase.currency,
        itemType: listing.itemType,
        itemId: listing.itemId,
        seller: listing.seller,
        buyer: userId,
        royaltySettings: listing.royalties
      });

      await royaltyController.distributeRoyalties(royaltyDistribution);

      // Handle NFT transfer if applicable
      if (listing.itemType === 'nft') {
        const nftTransfer = await nftController.transferNFT({
          tokenId: listing.itemId,
          fromAddress: listing.sellerWallet,
          toAddress: req.body.buyerAddress,
          contractAddress: listing.contractAddress,
          salePrice: purchase.finalPrice
        });

        logBlockchainTransaction(
          nftTransfer.txHash,
          'nft_sale',
          {
            tokenId: listing.itemId,
            from: listing.sellerWallet,
            to: req.body.buyerAddress,
            price: purchase.finalPrice,
            currency: purchase.currency,
            network: listing.network,
            status: 'pending'
          }
        );
      }

      // Log business event
      logBusinessEvent('marketplace_item_sold', {
        listingId: id,
        purchaseId: purchase.id,
        sellerId: listing.seller,
        buyerId: userId,
        salePrice: purchase.finalPrice,
        currency: purchase.currency,
        itemType: listing.itemType,
        royaltiesDistributed: royaltyDistribution.totalRoyalties
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        {
          purchase,
          royaltyDistribution,
          transferDetails: listing.itemType === 'nft' ? nftTransfer : null
        },
        'Purchase completed successfully'
      );

    } catch (error) {
      logger.error('Error processing purchase', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        purchaseData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /marketplace/:id/accept - Accept offer (seller only)
 */
router.post('/:id/accept',
  tradingRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(acceptOfferSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const listing = await marketplaceController.getListingById(id);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      if (listing.seller.toString() !== userId) {
        return ResponseFormatter.formatForbidden(res, 'You can only accept offers on your own listings');
      }

      if (listing.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Listing is not active', 400);
      }

      // Get the specific bid/offer
      const bid = await marketplaceController.getBidById(req.body.bidId);

      if (!bid) {
        return ResponseFormatter.formatNotFound(res, 'Bid not found');
      }

      if (bid.listingId.toString() !== id) {
        return ResponseFormatter.formatError(res, 'Bid does not belong to this listing', 400);
      }

      if (bid.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Bid is no longer active', 400);
      }

      // Verify seller signature
      const signatureValid = await blockchainController.verifyAcceptanceSignature({
        bidId: req.body.bidId,
        listingId: id,
        sellerAddress: listing.sellerWallet,
        signature: req.body.signature
      });

      if (!signatureValid) {
        return ResponseFormatter.formatError(res, 'Invalid seller signature', 400);
      }

      // Process the acceptance and sale
      const acceptance = await marketplaceController.acceptOffer(id, req.body.bidId, {
        terms: req.body.terms,
        acceptedBy: userId
      });

      // Calculate and distribute royalties
      const royaltyDistribution = await royaltyController.calculateRoyalties({
        salePrice: bid.amount,
        currency: bid.currency,
        itemType: listing.itemType,
        itemId: listing.itemId,
        seller: listing.seller,
        buyer: bid.bidder,
        royaltySettings: listing.royalties
      });

      await royaltyController.distributeRoyalties(royaltyDistribution);

      // Handle item transfer
      if (listing.itemType === 'nft') {
        const nftTransfer = await nftController.transferNFT({
          tokenId: listing.itemId,
          fromAddress: listing.sellerWallet,
          toAddress: bid.bidderWallet,
          contractAddress: listing.contractAddress,
          salePrice: bid.amount
        });

        logBlockchainTransaction(
          nftTransfer.txHash,
          'nft_sale_offer_accepted',
          {
            tokenId: listing.itemId,
            from: listing.sellerWallet,
            to: bid.bidderWallet,
            price: bid.amount,
            currency: bid.currency,
            network: listing.network,
            status: 'pending'
          }
        );
      }

      // Log business event
      logBusinessEvent('marketplace_offer_accepted', {
        listingId: id,
        bidId: req.body.bidId,
        acceptanceId: acceptance.id,
        sellerId: userId,
        buyerId: bid.bidder,
        salePrice: bid.amount,
        currency: bid.currency,
        itemType: listing.itemType,
        royaltiesDistributed: royaltyDistribution.totalRoyalties
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        {
          acceptance,
          saleDetails: {
            finalPrice: bid.amount,
            currency: bid.currency,
            buyer: bid.bidder,
            seller: userId
          },
          royaltyDistribution,
          transferDetails: listing.itemType === 'nft' ? nftTransfer : null
        },
        'Offer accepted successfully'
      );

    } catch (error) {
      logger.error('Error accepting offer', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        acceptanceData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

// =============================================================================
// ADDITIONAL MARKETPLACE ENDPOINTS
// =============================================================================

/**
 * GET /marketplace/stats - Get marketplace statistics
 */
router.get('/stats',
  marketplaceRateLimit,
  cacheMiddleware(1800), // 30 minutes cache
  async (req, res) => {
    try {
      const { timeframe = '24h' } = req.query;

      const stats = await marketplaceController.getMarketplaceStats({ timeframe });

      return ResponseFormatter.formatSuccess(
        res,
        stats,
        'Marketplace statistics retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting marketplace stats', {
        error: error.message,
        query: req.query,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /marketplace/user/:userId/listings - Get user's listings
 */
router.get('/user/:userId/listings',
  marketplaceRateLimit,
  cacheMiddleware(180), // 3 minutes cache
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 20, status = 'active' } = req.query;
      const requestingUserId = req.user?.id;

      // Privacy check - only show private listings to the owner
      const showPrivate = requestingUserId === userId;

      const listings = await marketplaceController.getUserListings(userId, {
        pagination: { page: parseInt(page), limit: parseInt(limit) },
        status,
        showPrivate
      });

      return ResponseFormatter.formatPaginated(
        res,
        listings.data,
        page,
        limit,
        listings.total,
        'User listings retrieved successfully',
        {
          userId,
          userStats: listings.userStats
        }
      );

    } catch (error) {
      logger.error('Error getting user listings', {
        error: error.message,
        userId: req.params.userId,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /marketplace/user/:userId/bids - Get user's bid history
 */
router.get('/user/:userId/bids',
  marketplaceRateLimit,
  authMiddleware.requireAuth,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user.id;
      const { page = 1, limit = 20, status = 'all' } = req.query;

      // Users can only view their own bid history
      if (userId !== requestingUserId && 
          !permissionMiddleware.hasPermission(req.user.role, PERMISSIONS.MANAGE_EVENTS)) {
        return ResponseFormatter.formatForbidden(res, 'You can only view your own bid history');
      }

      const bids = await marketplaceController.getUserBids(userId, {
        pagination: { page: parseInt(page), limit: parseInt(limit) },
        status
      });

      return ResponseFormatter.formatPaginated(
        res,
        bids.data,
        page,
        limit,
        bids.total,
        'User bid history retrieved successfully',
        {
          userId,
          bidStats: bids.bidStats
        }
      );

    } catch (error) {
      logger.error('Error getting user bids', {
        error: error.message,
        userId: req.params.userId,
        requestingUserId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /marketplace/:id/favorite - Add/remove from favorites
 */
router.post('/:id/favorite',
  marketplaceRateLimit,
  authMiddleware.requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const listing = await marketplaceController.getListingById(id);

      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      const favorite = await marketplaceController.toggleFavorite(id, userId);

      // Log business event
      logBusinessEvent(favorite.added ? 'listing_favorited' : 'listing_unfavorited', {
        listingId: id,
        userId,
        sellerId: listing.seller
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        favorite,
        favorite.added ? 'Added to favorites' : 'Removed from favorites'
      );

    } catch (error) {
      logger.error('Error toggling favorite', {
        error: error.message,
        listingId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /marketplace/categories - Get marketplace categories with counts
 */
router.get('/categories',
  marketplaceRateLimit,
  cacheMiddleware(3600), // 1 hour cache
  async (req, res) => {
    try {
      const categories = await marketplaceController.getCategories();

      return ResponseFormatter.formatSuccess(
        res,
        categories,
        'Marketplace categories retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting marketplace categories', {
        error: error.message,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================

/**
 * Handle 404 errors for unmatched routes
 */
router.use('*', (req, res) => {
  ResponseFormatter.formatNotFound(res, 'Route');
});

/**
 * Handle errors in marketplace routes
 */
router.use((error, req, res, next) => {
  logger.error('Marketplace route error', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    correlationId: req.correlationId
  });

  if (error.name === 'ValidationError') {
    return ResponseFormatter.formatValidationError(res, error);
  }

  if (error.name === 'CastError') {
    return ResponseFormatter.formatError(res, 'Invalid marketplace item ID format', 400);
  }

  if (error.name === 'PaymentError') {
    return ResponseFormatter.formatError(res, 'Payment processing failed', 402);
  }

  if (error.name === 'BlockchainError') {
    return ResponseFormatter.formatError(res, 'Blockchain operation failed', 503);
  }

  if (error.name === 'InsufficientFundsError') {
    return ResponseFormatter.formatError(res, 'Insufficient funds for this transaction', 402);
  }

  if (error.name === 'ListingExpiredError') {
    return ResponseFormatter.formatError(res, 'Listing has expired', 410);
  }

  if (error.name === 'RoyaltyCalculationError') {
    return ResponseFormatter.formatError(res, 'Error calculating royalties', 500);
  }

  return ResponseFormatter.formatError(res, error);
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = router;
        itemType: listing.itemType,
