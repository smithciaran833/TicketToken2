const express = require('express');
const router = express.Router();
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

// Import utilities
const { ResponseFormatter } = require('../utils/responseFormatter');
const { logger, logBusinessEvent, logBlockchainTransaction } = require('../utils/logger');
const { PAGINATION, TICKET_STATUS, TICKET_TYPES, USER_ROLES, PERMISSIONS, BLOCKCHAIN_NETWORKS } = require('../utils/constants');
const { isValidWallet, isValidEmail } = require('../utils/helpers');

// Import middleware
const authMiddleware = require('../middleware/auth');
const permissionMiddleware = require('../middleware/permissions');
const validationMiddleware = require('../middleware/validation');
const cacheMiddleware = require('../middleware/cache');

// Import controllers
const ticketController = require('../controllers/ticketController');
const nftController = require('../controllers/nftController');
const blockchainController = require('../controllers/blockchainController');
const eventController = require('../controllers/eventController');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Ticket query parameters validation
 */
const ticketQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().valid('date', 'event', 'status', 'price').default('date'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  status: Joi.string().valid(...Object.values(TICKET_STATUS).map(s => s.value)).optional(),
  eventId: Joi.string().optional(),
  category: Joi.string().optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
  includeUsed: Joi.boolean().default(false),
  includeExpired: Joi.boolean().default(false)
});

/**
 * Ticket transfer validation schema
 */
const transferTicketSchema = Joi.object({
  recipientEmail: Joi.string().email().required(),
  recipientWallet: Joi.string().custom((value, helpers) => {
    if (!isValidWallet(value, 'ethereum')) {
      return helpers.error('any.invalid');
    }
    return value;
  }).optional(),
  message: Joi.string().trim().max(500).optional(),
  transferFee: Joi.number().min(0).max(100).default(0),
  requireAcceptance: Joi.boolean().default(true),
  notifyRecipient: Joi.boolean().default(true)
});

/**
 * Ticket resell validation schema
 */
const resellTicketSchema = Joi.object({
  price: Joi.number().min(0).max(10000).precision(2).required(),
  currency: Joi.string().valid('USD', 'ETH', 'MATIC').default('USD'),
  description: Joi.string().trim().max(1000).optional(),
  listingDuration: Joi.number().integer().min(1).max(90).default(30), // days
  allowBestOffer: Joi.boolean().default(false),
  minimumOffer: Joi.number().min(0).optional(),
  instantSale: Joi.boolean().default(true),
  royaltyPercentage: Joi.number().min(0).max(20).default(5) // percentage to original seller
});

/**
 * Bulk purchase validation schema
 */
const bulkPurchaseSchema = Joi.object({
  purchases: Joi.array().items(
    Joi.object({
      eventId: Joi.string().required(),
      ticketTypeId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).max(50).required(),
      attendeeInfo: Joi.array().items(
        Joi.object({
          firstName: Joi.string().trim().min(1).max(100).required(),
          lastName: Joi.string().trim().min(1).max(100).required(),
          email: Joi.string().email().required(),
          phone: Joi.string().trim().max(20).optional()
        })
      ).optional()
    })
  ).min(1).max(20).required(),
  
  paymentMethod: Joi.object({
    type: Joi.string().valid('card', 'crypto', 'wallet').required(),
    token: Joi.string().required(),
    walletAddress: Joi.string().when('type', {
      is: 'crypto',
      then: Joi.string().custom((value, helpers) => {
        if (!isValidWallet(value, 'ethereum')) {
          return helpers.error('any.invalid');
        }
        return value;
      }).required()
    }),
    network: Joi.string().valid(...Object.keys(BLOCKCHAIN_NETWORKS)).when('type', {
      is: 'crypto',
      then: Joi.required()
    })
  }).required(),
  
  discountCode: Joi.string().trim().max(50).optional(),
  mintAsNFT: Joi.boolean().default(true),
  walletAddress: Joi.string().when('mintAsNFT', {
    is: true,
    then: Joi.string().custom((value, helpers) => {
      if (!isValidWallet(value, 'ethereum')) {
        return helpers.error('any.invalid');
      }
      return value;
    }).required()
  })
});

/**
 * Gift tickets validation schema
 */
const giftTicketsSchema = Joi.object({
  recipients: Joi.array().items(
    Joi.object({
      email: Joi.string().email().required(),
      firstName: Joi.string().trim().min(1).max(100).required(),
      lastName: Joi.string().trim().min(1).max(100).required(),
      walletAddress: Joi.string().custom((value, helpers) => {
        if (!isValidWallet(value, 'ethereum')) {
          return helpers.error('any.invalid');
        }
        return value;
      }).optional(),
      personalMessage: Joi.string().trim().max(500).optional()
    })
  ).min(1).max(10).required(),
  
  eventId: Joi.string().required(),
  ticketTypeId: Joi.string().required(),
  deliveryDate: Joi.date().iso().min('now').optional(),
  giftMessage: Joi.string().trim().max(1000).optional(),
  senderName: Joi.string().trim().min(1).max(100).optional(),
  
  paymentMethod: Joi.object({
    type: Joi.string().valid('card', 'crypto').required(),
    token: Joi.string().required()
  }).required(),
  
  mintAsNFT: Joi.boolean().default(true),
  notifyRecipients: Joi.boolean().default(true)
});

/**
 * Check-in validation schema
 */
const checkinSchema = Joi.object({
  location: Joi.object({
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional()
  }).optional(),
  deviceInfo: Joi.object({
    userAgent: Joi.string().max(500).optional(),
    ip: Joi.string().ip().optional(),
    deviceId: Joi.string().max(100).optional()
  }).optional(),
  verificationCode: Joi.string().length(6).optional(),
  staffMemberId: Joi.string().optional()
});

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * General ticket operations rate limiting
 */
const ticketRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many ticket requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 100,
      remaining: 0,
      resetTime: Date.now() + (15 * 60 * 1000)
    });
  }
});

/**
 * Transfer/resell rate limiting (more restrictive)
 */
const transferRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many transfer/resell attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 10,
      remaining: 0,
      resetTime: Date.now() + (60 * 60 * 1000)
    });
  }
});

/**
 * Bulk purchase rate limiting
 */
const bulkPurchaseRateLimit = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 3,
  message: 'Too many bulk purchase attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 3,
      remaining: 0,
      resetTime: Date.now() + (30 * 60 * 1000)
    });
  }
});

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * GET /tickets - Get user's tickets
 */
router.get('/',
  ticketRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateQuery(ticketQuerySchema),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        page,
        limit,
        sort,
        order,
        status,
        eventId,
        category,
        dateFrom,
        dateTo,
        includeUsed,
        includeExpired
      } = req.query;

      const filters = {
        userId,
        ...(status && { status }),
        ...(eventId && { eventId }),
        ...(category && { category }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
        ...(includeUsed && { includeUsed }),
        ...(includeExpired && { includeExpired })
      };

      const result = await ticketController.getUserTickets({
        filters,
        pagination: { page, limit },
        sort: { field: sort, order }
      });

      return ResponseFormatter.formatPaginated(
        res,
        result.data,
        page,
        limit,
        result.total,
        'Tickets retrieved successfully',
        {
          filters,
          sort: { field: sort, order }
        }
      );

    } catch (error) {
      logger.error('Error getting user tickets', {
        error: error.message,
        userId: req.user?.id,
        query: req.query,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /tickets/:id - Get single ticket details
 */
router.get('/:id',
  ticketRateLimit,
  authMiddleware.requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const ticket = await ticketController.getTicketById(id, userId);

      if (!ticket) {
        return ResponseFormatter.formatNotFound(res, 'Ticket');
      }

      // Check if user owns this ticket or has permission to view
      if (ticket.owner.toString() !== userId && 
          !permissionMiddleware.hasPermission(req.user.role, PERMISSIONS.MANAGE_TICKETS)) {
        return ResponseFormatter.formatForbidden(res, 'Access denied to this ticket');
      }

      // Include NFT and blockchain information
      if (ticket.nftTokenId) {
        ticket.nftInfo = await nftController.getNFTInfo(ticket.nftTokenId);
        ticket.blockchainInfo = await blockchainController.getTokenInfo(
          ticket.nftTokenId,
          ticket.nftContractAddress
        );
      }

      return ResponseFormatter.formatSuccess(
        res,
        ticket,
        'Ticket retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting ticket details', {
        error: error.message,
        ticketId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /tickets/:id/transfer - Transfer ticket to another user
 */
router.post('/:id/transfer',
  transferRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(transferTicketSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const transferData = { ...req.body, transferredBy: userId };

      // Verify ticket ownership
      const ticket = await ticketController.getTicketById(id, userId);
      
      if (!ticket) {
        return ResponseFormatter.formatNotFound(res, 'Ticket');
      }

      if (ticket.owner.toString() !== userId) {
        return ResponseFormatter.formatForbidden(res, 'You can only transfer your own tickets');
      }

      if (ticket.status !== TICKET_STATUS.ACTIVE.value) {
        return ResponseFormatter.formatError(res, 'Only active tickets can be transferred', 400);
      }

      // Check if event allows transfers
      const event = await eventController.getEventById(ticket.eventId);
      if (event.settings.transferPolicy === 'forbidden') {
        return ResponseFormatter.formatError(res, 'Transfers are not allowed for this event', 400);
      }

      const transfer = await ticketController.transferTicket(id, transferData);

      // Handle NFT transfer if applicable
      if (ticket.nftTokenId && req.body.recipientWallet) {
        const nftTransfer = await nftController.transferNFT({
          tokenId: ticket.nftTokenId,
          fromAddress: ticket.nftOwnerAddress,
          toAddress: req.body.recipientWallet,
          contractAddress: ticket.nftContractAddress
        });

        logBlockchainTransaction(
          nftTransfer.txHash,
          'nft_transfer',
          {
            tokenId: ticket.nftTokenId,
            from: ticket.nftOwnerAddress,
            to: req.body.recipientWallet,
            network: ticket.network,
            status: 'pending'
          }
        );
      }

      // Log business event
      logBusinessEvent('ticket_transferred', {
        ticketId: id,
        fromUserId: userId,
        toEmail: req.body.recipientEmail,
        eventId: ticket.eventId,
        transferId: transfer.id
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        transfer,
        'Ticket transfer initiated successfully'
      );

    } catch (error) {
      logger.error('Error transferring ticket', {
        error: error.message,
        ticketId: req.params.id,
        userId: req.user?.id,
        transferData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /tickets/:id/resell - List ticket on marketplace
 */
router.post('/:id/resell',
  transferRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(resellTicketSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const listingData = { ...req.body, sellerId: userId };

      // Verify ticket ownership
      const ticket = await ticketController.getTicketById(id, userId);
      
      if (!ticket) {
        return ResponseFormatter.formatNotFound(res, 'Ticket');
      }

      if (ticket.owner.toString() !== userId) {
        return ResponseFormatter.formatForbidden(res, 'You can only resell your own tickets');
      }

      if (ticket.status !== TICKET_STATUS.ACTIVE.value) {
        return ResponseFormatter.formatError(res, 'Only active tickets can be resold', 400);
      }

      // Check if event allows resales
      const event = await eventController.getEventById(ticket.eventId);
      if (event.settings.transferPolicy === 'forbidden') {
        return ResponseFormatter.formatError(res, 'Resales are not allowed for this event', 400);
      }

      const listing = await ticketController.createMarketplaceListing(id, listingData);

      // Create NFT marketplace listing if applicable
      if (ticket.nftTokenId) {
        const nftListing = await nftController.createMarketplaceListing({
          tokenId: ticket.nftTokenId,
          contractAddress: ticket.nftContractAddress,
          price: req.body.price,
          currency: req.body.currency,
          seller: userId
        });

        listing.nftListingId = nftListing.id;
      }

      // Log business event
      logBusinessEvent('ticket_listed_for_resale', {
        ticketId: id,
        sellerId: userId,
        listingPrice: req.body.price,
        currency: req.body.currency,
        eventId: ticket.eventId,
        listingId: listing.id
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        listing,
        'Ticket listed for resale successfully'
      );

    } catch (error) {
      logger.error('Error listing ticket for resale', {
        error: error.message,
        ticketId: req.params.id,
        userId: req.user?.id,
        listingData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /tickets/:id/verify - Verify ticket authenticity
 */
router.get('/:id/verify',
  ticketRateLimit,
  async (req, res) => {
    try {
      const { id } = req.params;

      const verification = await ticketController.verifyTicketAuthenticity(id);

      // Additional blockchain verification if NFT exists
      if (verification.ticket.nftTokenId) {
        const blockchainVerification = await blockchainController.verifyNFTOwnership({
          tokenId: verification.ticket.nftTokenId,
          contractAddress: verification.ticket.nftContractAddress,
          expectedOwner: verification.ticket.nftOwnerAddress
        });

        verification.blockchainVerified = blockchainVerification.isValid;
        verification.onChainOwner = blockchainVerification.currentOwner;
      }

      return ResponseFormatter.formatSuccess(
        res,
        verification,
        'Ticket verification completed'
      );

    } catch (error) {
      logger.error('Error verifying ticket', {
        error: error.message,
        ticketId: req.params.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /tickets/:id/checkin - Check in at event
 */
router.post('/:id/checkin',
  ticketRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(checkinSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const checkinData = {
        ...req.body,
        checkedInBy: userId,
        checkedInAt: new Date(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      };

      const ticket = await ticketController.getTicketById(id, userId);
      
      if (!ticket) {
        return ResponseFormatter.formatNotFound(res, 'Ticket');
      }

      // Verify ticket can be checked in
      if (ticket.status === TICKET_STATUS.USED.value) {
        return ResponseFormatter.formatError(res, 'Ticket has already been used', 400);
      }

      if (ticket.status !== TICKET_STATUS.ACTIVE.value) {
        return ResponseFormatter.formatError(res, 'Ticket is not valid for check-in', 400);
      }

      // Verify event timing
      const event = await eventController.getEventById(ticket.eventId);
      const now = new Date();
      const eventStart = new Date(event.dateTime.start);
      const checkinWindow = 2 * 60 * 60 * 1000; // 2 hours before event

      if (now < (eventStart.getTime() - checkinWindow)) {
        return ResponseFormatter.formatError(res, 'Check-in is not yet available for this event', 400);
      }

      const checkin = await ticketController.checkinTicket(id, checkinData);

      // Update NFT metadata if applicable
      if (ticket.nftTokenId) {
        await nftController.updateNFTMetadata(ticket.nftTokenId, {
          status: 'checked_in',
          checkedInAt: checkinData.checkedInAt,
          eventId: ticket.eventId
        });
      }

      // Log business event
      logBusinessEvent('ticket_checked_in', {
        ticketId: id,
        userId,
        eventId: ticket.eventId,
        checkinTime: checkinData.checkedInAt,
        location: checkinData.location
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        checkin,
        'Check-in successful'
      );

    } catch (error) {
      logger.error('Error checking in ticket', {
        error: error.message,
        ticketId: req.params.id,
        userId: req.user?.id,
        checkinData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /tickets/:id/content - Get exclusive content access
 */
router.get('/:id/content',
  ticketRateLimit,
  authMiddleware.requireAuth,
  cacheMiddleware(300), // 5 minutes cache
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const ticket = await ticketController.getTicketById(id, userId);
      
      if (!ticket) {
        return ResponseFormatter.formatNotFound(res, 'Ticket');
      }

      if (ticket.owner.toString() !== userId) {
        return ResponseFormatter.formatForbidden(res, 'Access denied to this content');
      }

      const content = await ticketController.getExclusiveContent(id);

      // Log access for analytics
      logBusinessEvent('exclusive_content_accessed', {
        ticketId: id,
        userId,
        eventId: ticket.eventId,
        contentType: content.type
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        content,
        'Exclusive content retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting exclusive content', {
        error: error.message,
        ticketId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /tickets/bulk-purchase - Buy multiple tickets
 */
router.post('/bulk-purchase',
  bulkPurchaseRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(bulkPurchaseSchema),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const purchaseData = { ...req.body, buyerId: userId };

      // Validate all events and ticket types exist
      for (const purchase of req.body.purchases) {
        const event = await eventController.getEventById(purchase.eventId);
        if (!event) {
          return ResponseFormatter.formatError(res, `Event ${purchase.eventId} not found`, 400);
        }
        
        if (event.status !== 'active') {
          return ResponseFormatter.formatError(res, `Event ${event.title} is not available for purchase`, 400);
        }
      }

      const bulkPurchase = await ticketController.bulkPurchaseTickets(purchaseData);

      // Mint NFTs if requested
      if (req.body.mintAsNFT && req.body.walletAddress) {
        const nftMintPromises = bulkPurchase.tickets.map(ticket => 
          nftController.mintTicketNFT({
            ticketId: ticket.id,
            ownerAddress: req.body.walletAddress,
            eventId: ticket.eventId,
            metadata: {
              ticketType: ticket.type,
              eventTitle: ticket.event.title,
              venue: ticket.event.venue.name,
              dateTime: ticket.event.dateTime
            }
          })
        );

        const nftResults = await Promise.allSettled(nftMintPromises);
        bulkPurchase.nftResults = nftResults;
      }

      // Log business event
      logBusinessEvent('bulk_tickets_purchased', {
        userId,
        purchaseId: bulkPurchase.id,
        totalTickets: bulkPurchase.tickets.length,
        totalAmount: bulkPurchase.totalAmount,
        eventIds: req.body.purchases.map(p => p.eventId),
        mintedAsNFT: req.body.mintAsNFT
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        bulkPurchase,
        'Bulk ticket purchase completed successfully'
      );

    } catch (error) {
      logger.error('Error processing bulk purchase', {
        error: error.message,
        userId: req.user?.id,
        purchaseData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /tickets/gift - Gift tickets to others
 */
router.post('/gift',
  transferRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(giftTicketsSchema),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const giftData = { ...req.body, giftedBy: userId };

      // Validate event exists and is available
      const event = await eventController.getEventById(req.body.eventId);
      if (!event) {
        return ResponseFormatter.formatNotFound(res, 'Event');
      }

      if (event.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Event is not available for purchase', 400);
      }

      const giftPurchase = await ticketController.giftTickets(giftData);

      // Mint NFTs for recipients if requested
      if (req.body.mintAsNFT) {
        const nftMintPromises = giftPurchase.tickets.map((ticket, index) => {
          const recipient = req.body.recipients[index];
          if (recipient.walletAddress) {
            return nftController.mintTicketNFT({
              ticketId: ticket.id,
              ownerAddress: recipient.walletAddress,
              eventId: ticket.eventId,
              metadata: {
                ticketType: ticket.type,
                eventTitle: event.title,
                venue: event.venue.name,
                dateTime: event.dateTime,
                giftedBy: req.user.firstName + ' ' + req.user.lastName
              }
            });
          }
          return null;
        }).filter(Boolean);

        if (nftMintPromises.length > 0) {
          const nftResults = await Promise.allSettled(nftMintPromises);
          giftPurchase.nftResults = nftResults;
        }
      }

      // Log business event
      logBusinessEvent('tickets_gifted', {
        gifterId: userId,
        giftId: giftPurchase.id,
        eventId: req.body.eventId,
        recipientCount: req.body.recipients.length,
        totalAmount: giftPurchase.totalAmount,
        mintedAsNFT: req.body.mintAsNFT
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        giftPurchase,
        'Tickets gifted successfully'
      );

    } catch (error) {
      logger.error('Error gifting tickets', {
        error: error.message,
        userId: req.user?.id,
        giftData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * DELETE /tickets/:id/listing - Cancel marketplace listing
 */
router.delete('/:id/listing',
  transferRateLimit,
  authMiddleware.requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const listing = await ticketController.getMarketplaceListing(id);
      
      if (!listing) {
        return ResponseFormatter.formatNotFound(res, 'Listing');
      }

      if (listing.seller.toString() !== userId) {
        return ResponseFormatter.formatForbidden(res, 'You can only cancel your own listings');
      }

      if (listing.status !== 'active') {
        return ResponseFormatter.formatError(res, 'Listing is not active', 400);
      }

      await ticketController.cancelMarketplaceListing(id);

      // Cancel NFT marketplace listing if applicable
      if (listing.nftListingId) {
        await nftController.cancelMarketplaceListing(listing.nftListingId);
      }

      // Log business event
      logBusinessEvent('marketplace_listing_cancelled', {
        listingId: id,
        sellerId: userId,
        ticketId: listing.ticketId,
        eventId: listing.eventId
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
 * Handle errors in ticket routes
 */
router.use((error, req, res, next) => {
  logger.error('Tickets route error', {
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
    return ResponseFormatter.formatError(res, 'Invalid ticket ID format', 400);
  }

  if (error.name === 'BlockchainError') {
    return ResponseFormatter.formatError(res, 'Blockchain operation failed', 503);
  }

  if (error.name === 'NFTError') {
    return ResponseFormatter.formatError(res, 'NFT operation failed', 503);
  }

  return ResponseFormatter.formatError(res, error);
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = router;
