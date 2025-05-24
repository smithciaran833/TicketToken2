const express = require('express');
const router = express.Router();
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

// Import utilities
const { ResponseFormatter } = require('../utils/responseFormatter');
const { logger, logBusinessEvent } = require('../utils/logger');
const { PAGINATION, EVENT_STATUS, TICKET_TYPES, USER_ROLES, PERMISSIONS } = require('../utils/constants');

// Import middleware
const authMiddleware = require('../middleware/auth');
const permissionMiddleware = require('../middleware/permissions');
const validationMiddleware = require('../middleware/validation');
const cacheMiddleware = require('../middleware/cache');

// Import controllers (assuming these exist)
const eventController = require('../controllers/eventController');
const ticketController = require('../controllers/ticketController');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Event creation validation schema
 */
const createEventSchema = Joi.object({
  title: Joi.string()
    .trim()
    .min(3)
    .max(200)
    .required()
    .messages({
      'string.min': 'Event title must be at least 3 characters long',
      'string.max': 'Event title must not exceed 200 characters',
      'any.required': 'Event title is required'
    }),
  
  description: Joi.string()
    .trim()
    .min(10)
    .max(5000)
    .required()
    .messages({
      'string.min': 'Event description must be at least 10 characters long',
      'string.max': 'Event description must not exceed 5000 characters'
    }),
  
  shortDescription: Joi.string()
    .trim()
    .max(500)
    .optional(),
  
  category: Joi.string()
    .valid('music', 'sports', 'arts', 'technology', 'business', 'education', 'food', 'health', 'other')
    .required(),
  
  venue: Joi.object({
    name: Joi.string().trim().min(2).max(200).required(),
    address: Joi.string().trim().min(5).max(500).required(),
    city: Joi.string().trim().min(2).max(100).required(),
    state: Joi.string().trim().min(2).max(100).optional(),
    country: Joi.string().trim().min(2).max(100).required(),
    zipCode: Joi.string().trim().max(20).optional(),
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional(),
    capacity: Joi.number().integer().min(1).max(1000000).required()
  }).required(),
  
  dateTime: Joi.object({
    start: Joi.date().iso().greater('now').required(),
    end: Joi.date().iso().greater(Joi.ref('start')).required(),
    timezone: Joi.string().default('UTC')
  }).required(),
  
  ticketTypes: Joi.array().items(
    Joi.object({
      name: Joi.string().trim().min(2).max(100).required(),
      type: Joi.string().valid(...Object.values(TICKET_TYPES).map(t => t.value)).required(),
      price: Joi.number().min(0).max(10000).precision(2).required(),
      quantity: Joi.number().integer().min(1).max(100000).required(),
      description: Joi.string().trim().max(1000).optional(),
      salesStart: Joi.date().iso().optional(),
      salesEnd: Joi.date().iso().optional(),
      perks: Joi.array().items(Joi.string().trim().max(200)).optional()
    })
  ).min(1).required(),
  
  images: Joi.array().items(
    Joi.object({
      url: Joi.string().uri().required(),
      alt: Joi.string().trim().max(200).optional(),
      isPrimary: Joi.boolean().default(false)
    })
  ).max(10).optional(),
  
  tags: Joi.array().items(
    Joi.string().trim().min(2).max(50)
  ).max(20).optional(),
  
  settings: Joi.object({
    isPublic: Joi.boolean().default(true),
    requiresApproval: Joi.boolean().default(false),
    allowWaitlist: Joi.boolean().default(true),
    refundPolicy: Joi.string().valid('full', 'partial', 'none').default('partial'),
    transferPolicy: Joi.string().valid('allowed', 'restricted', 'forbidden').default('allowed')
  }).optional()
});

/**
 * Event update validation schema
 */
const updateEventSchema = createEventSchema.fork(
  ['title', 'description', 'category', 'venue', 'dateTime', 'ticketTypes'],
  (schema) => schema.optional()
);

/**
 * Event query parameters validation
 */
const eventQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().valid('title', 'date', 'price', 'popularity', 'created').default('date'),
  order: Joi.string().valid('asc', 'desc').default('asc'),
  search: Joi.string().trim().min(2).max(100).optional(),
  category: Joi.string().valid('music', 'sports', 'arts', 'technology', 'business', 'education', 'food', 'health', 'other').optional(),
  city: Joi.string().trim().min(2).max(100).optional(),
  state: Joi.string().trim().min(2).max(100).optional(),
  country: Joi.string().trim().min(2).max(100).optional(),
  priceMin: Joi.number().min(0).optional(),
  priceMax: Joi.number().min(0).optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
  status: Joi.string().valid(...Object.values(EVENT_STATUS).map(s => s.value)).optional(),
  featured: Joi.boolean().optional(),
  organizer: Joi.string().optional()
});

/**
 * Nearby events validation schema
 */
const nearbyEventsSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().min(1).max(1000).default(50), // km
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

/**
 * Ticket purchase validation schema
 */
const purchaseTicketsSchema = Joi.object({
  tickets: Joi.array().items(
    Joi.object({
      ticketTypeId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).max(10).required(),
      attendeeInfo: Joi.array().items(
        Joi.object({
          firstName: Joi.string().trim().min(1).max(100).required(),
          lastName: Joi.string().trim().min(1).max(100).required(),
          email: Joi.string().email().required(),
          phone: Joi.string().trim().max(20).optional()
        })
      ).optional()
    })
  ).min(1).max(10).required(),
  
  paymentMethod: Joi.object({
    type: Joi.string().valid('card', 'crypto', 'wallet').required(),
    token: Joi.string().required(),
    billingAddress: Joi.object({
      street: Joi.string().trim().max(200).required(),
      city: Joi.string().trim().max(100).required(),
      state: Joi.string().trim().max(100).optional(),
      country: Joi.string().trim().max(100).required(),
      zipCode: Joi.string().trim().max(20).required()
    }).when('type', { is: 'card', then: Joi.required() })
  }).required(),
  
  promoCode: Joi.string().trim().max(50).optional(),
  agreeToTerms: Joi.boolean().valid(true).required()
});

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * General API rate limiting
 */
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
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
 * Ticket purchase rate limiting (more restrictive)
 */
const purchaseRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // limit each IP to 5 purchase attempts per 5 minutes
  message: 'Too many purchase attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + (5 * 60 * 1000)
    });
  }
});

/**
 * Event creation rate limiting
 */
const createEventRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 event creations per hour
  message: 'Too many events created, please try again later',
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

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * GET /events - List events with filters, pagination, and search
 */
router.get('/',
  generalRateLimit,
  validationMiddleware.validateQuery(eventQuerySchema),
  cacheMiddleware(300), // 5 minutes cache
  async (req, res) => {
    try {
      const {
        page,
        limit,
        sort,
        order,
        search,
        category,
        city,
        state,
        country,
        priceMin,
        priceMax,
        dateFrom,
        dateTo,
        status,
        featured,
        organizer
      } = req.query;

      // Build filter object
      const filters = {
        ...(search && { search }),
        ...(category && { category }),
        ...(city && { 'venue.city': city }),
        ...(state && { 'venue.state': state }),
        ...(country && { 'venue.country': country }),
        ...(priceMin && { priceMin }),
        ...(priceMax && { priceMax }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
        ...(status && { status }),
        ...(featured && { featured }),
        ...(organizer && { organizer })
      };

      // Get events from controller
      const result = await eventController.getEvents({
        filters,
        pagination: { page, limit },
        sort: { field: sort, order }
      });

      // Log business event
      logBusinessEvent('events_listed', {
        filters,
        resultCount: result.data.length,
        totalCount: result.total,
        userId: req.user?.id
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatPaginated(
        res,
        result.data,
        page,
        limit,
        result.total,
        'Events retrieved successfully',
        {
          filters,
          sort: { field: sort, order }
        }
      );

    } catch (error) {
      logger.error('Error listing events', {
        error: error.message,
        stack: error.stack,
        query: req.query,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /events/featured - Get featured/trending events
 */
router.get('/featured',
  generalRateLimit,
  cacheMiddleware(600), // 10 minutes cache
  async (req, res) => {
    try {
      const { page = 1, limit = 10 } = req.query;

      const result = await eventController.getFeaturedEvents({
        pagination: { page: parseInt(page), limit: parseInt(limit) }
      });

      return ResponseFormatter.formatPaginated(
        res,
        result.data,
        page,
        limit,
        result.total,
        'Featured events retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting featured events', {
        error: error.message,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /events/categories - Get events grouped by category
 */
router.get('/categories',
  generalRateLimit,
  cacheMiddleware(1800), // 30 minutes cache
  async (req, res) => {
    try {
      const result = await eventController.getEventsByCategory();

      return ResponseFormatter.formatSuccess(
        res,
        result,
        'Events by category retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting events by category', {
        error: error.message,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /events/nearby - Get events near a location
 */
router.get('/nearby',
  generalRateLimit,
  validationMiddleware.validateQuery(nearbyEventsSchema),
  cacheMiddleware(300), // 5 minutes cache
  async (req, res) => {
    try {
      const { latitude, longitude, radius, page, limit } = req.query;

      const result = await eventController.getNearbyEvents({
        location: { latitude, longitude, radius },
        pagination: { page, limit }
      });

      return ResponseFormatter.formatPaginated(
        res,
        result.data,
        page,
        limit,
        result.total,
        'Nearby events retrieved successfully',
        {
          location: { latitude, longitude, radius }
        }
      );

    } catch (error) {
      logger.error('Error getting nearby events', {
        error: error.message,
        query: req.query,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /events/:id - Get single event with full details
 */
router.get('/:id',
  generalRateLimit,
  cacheMiddleware(300), // 5 minutes cache
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const event = await eventController.getEventById(id, { userId });

      if (!event) {
        return ResponseFormatter.formatNotFound(res, 'Event');
      }

      // Log business event
      logBusinessEvent('event_viewed', {
        eventId: id,
        eventTitle: event.title,
        userId
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        event,
        'Event retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting event by ID', {
        error: error.message,
        eventId: req.params.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /events - Create new event (promoter only)
 */
router.post('/',
  createEventRateLimit,
  authMiddleware.requireAuth,
  permissionMiddleware.requirePermission(PERMISSIONS.CREATE_EVENTS),
  validationMiddleware.validateBody(createEventSchema),
  async (req, res) => {
    try {
      const eventData = {
        ...req.body,
        organizer: req.user.id,
        status: EVENT_STATUS.DRAFT.value
      };

      const event = await eventController.createEvent(eventData);

      // Log business event
      logBusinessEvent('event_created', {
        eventId: event.id,
        eventTitle: event.title,
        organizerId: req.user.id,
        category: event.category
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        event,
        'Event created successfully'
      );

    } catch (error) {
      logger.error('Error creating event', {
        error: error.message,
        eventData: req.body,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * PUT /events/:id - Update event (promoter/admin only)
 */
router.put('/:id',
  generalRateLimit,
  authMiddleware.requireAuth,
  permissionMiddleware.requirePermission(PERMISSIONS.MANAGE_OWN_EVENTS),
  validationMiddleware.validateBody(updateEventSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Check if user can edit this event
      const existingEvent = await eventController.getEventById(id);
      
      if (!existingEvent) {
        return ResponseFormatter.formatNotFound(res, 'Event');
      }

      // Only allow organizer or admin to update
      if (existingEvent.organizer.toString() !== userId && 
          !permissionMiddleware.hasPermission(userRole, PERMISSIONS.MANAGE_EVENTS)) {
        return ResponseFormatter.formatForbidden(res, 'You can only edit your own events');
      }

      const updatedEvent = await eventController.updateEvent(id, req.body);

      // Log business event
      logBusinessEvent('event_updated', {
        eventId: id,
        eventTitle: updatedEvent.title,
        organizerId: existingEvent.organizer,
        updatedBy: userId,
        changes: Object.keys(req.body)
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        updatedEvent,
        'Event updated successfully'
      );

    } catch (error) {
      logger.error('Error updating event', {
        error: error.message,
        eventId: req.params.id,
        updateData: req.body,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * DELETE /events/:id - Soft delete event (admin only)
 */
router.delete('/:id',
  generalRateLimit,
  authMiddleware.requireAuth,
  permissionMiddleware.requirePermission(PERMISSIONS.MANAGE_EVENTS),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const event = await eventController.getEventById(id);
      
      if (!event) {
        return ResponseFormatter.formatNotFound(res, 'Event');
      }

      await eventController.deleteEvent(id, userId);

      // Log business event
      logBusinessEvent('event_deleted', {
        eventId: id,
        eventTitle: event.title,
        organizerId: event.organizer,
        deletedBy: userId
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatNoContent(res, 'Event deleted successfully');

    } catch (error) {
      logger.error('Error deleting event', {
        error: error.message,
        eventId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /events/:id/tickets - Get available tickets for an event
 */
router.get('/:id/tickets',
  generalRateLimit,
  cacheMiddleware(60), // 1 minute cache
  async (req, res) => {
    try {
      const { id } = req.params;

      const tickets = await ticketController.getAvailableTickets(id);

      return ResponseFormatter.formatSuccess(
        res,
        tickets,
        'Available tickets retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting available tickets', {
        error: error.message,
        eventId: req.params.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /events/:id/tickets - Purchase tickets for an event
 */
router.post('/:id/tickets',
  purchaseRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(purchaseTicketsSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const purchaseData = {
        ...req.body,
        eventId: id,
        userId
      };

      // Check if event exists and tickets are available
      const event = await eventController.getEventById(id);
      
      if (!event) {
        return ResponseFormatter.formatNotFound(res, 'Event');
      }

      if (event.status !== EVENT_STATUS.ACTIVE.value) {
        return ResponseFormatter.formatError(
          res,
          'Tickets are not available for this event',
          400
        );
      }

      const purchase = await ticketController.purchaseTickets(purchaseData);

      // Log business event
      logBusinessEvent('tickets_purchased', {
        eventId: id,
        eventTitle: event.title,
        userId,
        purchaseId: purchase.id,
        totalAmount: purchase.totalAmount,
        ticketQuantity: purchase.tickets.length
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        purchase,
        'Tickets purchased successfully'
      );

    } catch (error) {
      logger.error('Error purchasing tickets', {
        error: error.message,
        eventId: req.params.id,
        userId: req.user?.id,
        purchaseData: req.body,
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
 * Handle errors in event routes
 */
router.use((error, req, res, next) => {
  logger.error('Events route error', {
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
    return ResponseFormatter.formatError(res, 'Invalid event ID format', 400);
  }

  return ResponseFormatter.formatError(res, error);
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = router;
