// ==========================================
// FILE: backend/controllers/event/eventController.js
// ==========================================

const Event = require('../../models/Event');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { validationResult } = require('express-validator');
const slugify = require('slugify');
const mongoose = require('mongoose');
const redis = require('redis');
const { addDays, isAfter, isBefore, parseISO } = require('date-fns');

// Redis client setup
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

/**
 * @desc    Create a new event
 * @route   POST /api/events
 * @access  Private/Organizer
 * @returns {Object} Created event data
 */
exports.createEvent = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const {
      title,
      description,
      category,
      subcategory,
      startDate,
      endDate,
      venue,
      ticketTypes,
      artists,
      ageRestriction,
      refundPolicy,
      tags,
      images
    } = req.body;

    // Validate dates
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    
    if (!isAfter(start, new Date())) {
      return next(new AppError('Event start date must be in the future', 400));
    }
    
    if (!isAfter(end, start)) {
      return next(new AppError('Event end date must be after start date', 400));
    }

    // Generate unique slug
    let slug = slugify(title, { lower: true, strict: true });
    let slugExists = await Event.findOne({ slug });
    let counter = 1;
    
    while (slugExists) {
      slug = `${slugify(title, { lower: true, strict: true })}-${counter}`;
      slugExists = await Event.findOne({ slug });
      counter++;
    }

    // Validate and process ticket types
    const processedTicketTypes = ticketTypes.map(ticket => {
      if (ticket.price < 0 || ticket.price > 10000) {
        throw new AppError('Ticket price must be between 0 and 10000', 400);
      }
      
      if (ticket.quantity < 1 || ticket.quantity > 100000) {
        throw new AppError('Ticket quantity must be between 1 and 100000', 400);
      }

      // Handle early bird pricing
      if (ticket.earlyBirdPrice) {
        if (ticket.earlyBirdPrice >= ticket.price) {
          throw new AppError('Early bird price must be less than regular price', 400);
        }
        if (!ticket.earlyBirdEndDate || !isBefore(parseISO(ticket.earlyBirdEndDate), start)) {
          throw new AppError('Early bird end date must be before event start', 400);
        }
      }

      return {
        ...ticket,
        available: ticket.quantity,
        sold: 0
      };
    });

    // Calculate total capacity
    const totalCapacity = processedTicketTypes.reduce((sum, type) => sum + type.quantity, 0);

    // Create event
    const event = await Event.create([{
      title,
      slug,
      description,
      category,
      subcategory,
      organizer: req.user.id,
      venue,
      startDate: start,
      endDate: end,
      ticketTypes: processedTicketTypes,
      totalCapacity,
      availableCapacity: totalCapacity,
      artists: artists || [],
      ageRestriction: ageRestriction || 'all',
      refundPolicy: refundPolicy || 'no-refunds',
      tags: tags || [],
      images: images || [],
      status: 'draft',
      metadata: {
        createdBy: req.user.id,
        createdAt: new Date(),
        source: req.headers['x-source'] || 'web',
        ipAddress: req.ip
      }
    }], { session });

    await session.commitTransaction();

    // Log event creation
    logger.info('Event created', {
      eventId: event[0]._id,
      userId: req.user.id,
      title: event[0].title,
      correlationId: req.correlationId
    });

    // Clear relevant caches
    await redisClient.del('events:listing:*');

    res.status(201).json({
      success: true,
      data: event[0],
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Event creation failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Update an event
 * @route   PUT /api/events/:id
 * @access  Private/Organizer
 * @returns {Object} Updated event data
 */
exports.updateEvent = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const event = await Event.findById(req.params.id).session(session);
    
    if (!event) {
      return next(new AppError('Event not found', 404));
    }

    // Check ownership
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to update this event', 403));
    }

    // Store change history
    const changeHistory = {
      modifiedBy: req.user.id,
      modifiedAt: new Date(),
      changes: {},
      version: event.__v + 1
    };

    // Track what fields are being updated
    const allowedUpdates = [
      'title', 'description', 'category', 'subcategory',
      'startDate', 'endDate', 'ticketTypes', 'artists',
      'ageRestriction', 'refundPolicy', 'tags', 'images'
    ];

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined && JSON.stringify(event[field]) !== JSON.stringify(req.body[field])) {
        changeHistory.changes[field] = {
          from: event[field],
          to: req.body[field]
        };
      }
    });

    // Validate date changes
    if (req.body.startDate || req.body.endDate) {
      const newStart = req.body.startDate ? parseISO(req.body.startDate) : event.startDate;
      const newEnd = req.body.endDate ? parseISO(req.body.endDate) : event.endDate;
      
      if (!isAfter(newEnd, newStart)) {
        return next(new AppError('Event end date must be after start date', 400));
      }

      // Don't allow changing dates if event has started
      if (event.status === 'ongoing' || event.status === 'completed') {
        return next(new AppError('Cannot change dates for ongoing or completed events', 400));
      }
    }

    // Update ticket types carefully
    if (req.body.ticketTypes) {
      const updatedTicketTypes = req.body.ticketTypes.map((newType, index) => {
        const existingType = event.ticketTypes.find(t => t.name === newType.name);
        
        if (existingType) {
          // Don't allow reducing quantity below sold amount
          if (newType.quantity < existingType.sold) {
            throw new AppError(`Cannot reduce ${newType.name} quantity below sold amount (${existingType.sold})`, 400);
          }
          
          return {
            ...existingType.toObject(),
            ...newType,
            available: newType.quantity - existingType.sold,
            sold: existingType.sold
          };
        }
        
        // New ticket type
        return {
          ...newType,
          available: newType.quantity,
          sold: 0
        };
      });

      req.body.ticketTypes = updatedTicketTypes;
      req.body.totalCapacity = updatedTicketTypes.reduce((sum, type) => sum + type.quantity, 0);
      req.body.availableCapacity = updatedTicketTypes.reduce((sum, type) => sum + type.available, 0);
    }

    // Apply updates
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        event[key] = req.body[key];
      }
    });

    // Add to history
    event.changeHistory.push(changeHistory);

    // Save with optimistic locking
    await event.save({ session });
    await session.commitTransaction();

    // Clear caches
    await redisClient.del(`event:${event._id}`);
    await redisClient.del('events:listing:*');

    // Trigger notifications if needed
    if (event.status === 'published' && Object.keys(changeHistory.changes).length > 0) {
      // Queue notification job
      logger.info('Event update notification queued', {
        eventId: event._id,
        changes: Object.keys(changeHistory.changes)
      });
    }

    logger.info('Event updated', {
      eventId: event._id,
      userId: req.user.id,
      changes: Object.keys(changeHistory.changes),
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      data: event,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Event update failed', {
      error: error.message,
      eventId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get all events with filtering, sorting, and pagination
 * @route   GET /api/events
 * @access  Public
 * @returns {Object} Events list with pagination
 */
exports.getEvents = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = '-startDate',
      status = 'published',
      category,
      subcategory,
      minPrice,
      maxPrice,
      startAfter,
      startBefore,
      location,
      radius,
      ageRestriction,
      hasAvailableTickets,
      cursor
    } = req.query;

    // Build cache key
    const cacheKey = `events:listing:${JSON.stringify(req.query)}`;
    
    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Build query
    const query = {};

    // Status filter
    if (status !== 'all') {
      query.status = status;
    }

    // Category filters
    if (category) query.category = category;
    if (subcategory) query.subcategory = subcategory;

    // Date filters
    if (startAfter) query.startDate = { $gte: parseISO(startAfter) };
    if (startBefore) query.startDate = { ...query.startDate, $lte: parseISO(startBefore) };

    // Price filter
    if (minPrice || maxPrice) {
      query['ticketTypes.price'] = {};
      if (minPrice) query['ticketTypes.price'].$gte = parseFloat(minPrice);
      if (maxPrice) query['ticketTypes.price'].$lte = parseFloat(maxPrice);
    }

    // Age restriction
    if (ageRestriction) query.ageRestriction = ageRestriction;

    // Available tickets filter
    if (hasAvailableTickets === 'true') {
      query.availableCapacity = { $gt: 0 };
    }

    // Cursor-based pagination
    if (cursor) {
      const decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString());
      query._id = { $lt: decodedCursor.lastId };
    }

    // Execute query with lean for performance
    const events = await Event.find(query)
      .select('-changeHistory')
      .populate('venue', 'name address city coordinates')
      .populate('organizer', 'name email verified')
      .sort(sort)
      .limit(parseInt(limit) + 1)
      .lean();

    // Check if there are more results
    const hasMore = events.length > parseInt(limit);
    if (hasMore) events.pop();

    // Calculate next cursor
    let nextCursor = null;
    if (hasMore && events.length > 0) {
      nextCursor = Buffer.from(JSON.stringify({
        lastId: events[events.length - 1]._id
      })).toString('base64');
    }

    // Track view analytics
    events.forEach(event => {
      // Queue analytics job
      logger.info('Event view tracked', {
        eventId: event._id,
        source: 'listing',
        correlationId: req.correlationId
      });
    });

    const response = {
      success: true,
      data: events,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: await Event.countDocuments(query),
        hasMore,
        cursor: nextCursor
      }
    };

    // Cache for 1 minute
    await redisClient.setEx(cacheKey, 60, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    logger.error('Get events failed', {
      error: error.message,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get single event by ID or slug
 * @route   GET /api/events/:identifier
 * @access  Public
 * @returns {Object} Event details
 */
exports.getEvent = async (req, res, next) => {
  try {
    const { identifier } = req.params;
    
    // Check cache
    const cacheKey = `event:${identifier}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Determine if identifier is ID or slug
    const isObjectId = mongoose.Types.ObjectId.isValid(identifier);
    const query = isObjectId ? { _id: identifier } : { slug: identifier };

    const event = await Event.findOne(query)
      .populate('venue')
      .populate('organizer', 'name email verified avatar')
      .populate('category', 'name slug')
      .lean();

    if (!event) {
      return next(new AppError('Event not found', 404));
    }

    // Check if event is visible
    if (event.status === 'draft' && (!req.user || event.organizer._id.toString() !== req.user.id)) {
      return next(new AppError('Event not found', 404));
    }

    // Increment view count
    await Event.findByIdAndUpdate(event._id, {
      $inc: { 'analytics.views': 1 }
    });

    // Track detailed analytics
    logger.info('Event viewed', {
      eventId: event._id,
      userId: req.user?.id,
      source: req.query.source || 'direct',
      referrer: req.headers.referer,
      correlationId: req.correlationId
    });

    const response = {
      success: true,
      data: event,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    };

    // Cache published events for 5 minutes
    if (event.status === 'published') {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
    }

    res.json(response);

  } catch (error) {
    logger.error('Get event failed', {
      error: error.message,
      identifier: req.params.identifier,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Delete an event
 * @route   DELETE /api/events/:id
 * @access  Private/Organizer
 * @returns {Object} Success message
 */
exports.deleteEvent = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const event = await Event.findById(req.params.id).session(session);
    
    if (!event) {
      return next(new AppError('Event not found', 404));
    }

    // Check ownership
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to delete this event', 403));
    }

    // Don't allow deletion if tickets have been sold
    const totalSold = event.ticketTypes.reduce((sum, type) => sum + type.sold, 0);
    if (totalSold > 0) {
      return next(new AppError('Cannot delete event with sold tickets', 400));
    }

    // Soft delete by changing status
    event.status = 'cancelled';
    event.metadata.deletedBy = req.user.id;
    event.metadata.deletedAt = new Date();
    
    await event.save({ session });
    await session.commitTransaction();

    // Clear caches
    await redisClient.del(`event:${event._id}`);
    await redisClient.del(`event:${event.slug}`);
    await redisClient.del('events:listing:*');

    logger.info('Event deleted', {
      eventId: event._id,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      message: 'Event deleted successfully',
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Event deletion failed', {
      error: error.message,
      eventId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Update event status
 * @route   PATCH /api/events/:id/status
 * @access  Private/Organizer
 * @returns {Object} Updated event
 */
exports.updateEventStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['draft', 'published', 'cancelled', 'postponed', 'completed'];
    
    if (!validStatuses.includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const event = await Event.findById(req.params.id);
    
    if (!event) {
      return next(new AppError('Event not found', 404));
    }

    // Check ownership
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to update this event', 403));
    }

    // Validate status transitions
    const validTransitions = {
      draft: ['published', 'cancelled'],
      published: ['cancelled', 'postponed', 'completed'],
      cancelled: [],
      postponed: ['published', 'cancelled'],
      completed: []
    };

    if (!validTransitions[event.status].includes(status)) {
      return next(new AppError(`Cannot transition from ${event.status} to ${status}`, 400));
    }

    // Update status
    event.status = status;
    event.metadata.lastStatusChange = {
      from: event.status,
      to: status,
      changedBy: req.user.id,
      changedAt: new Date()
    };

    await event.save();

    // Clear caches
    await redisClient.del(`event:${event._id}`);
    await redisClient.del(`event:${event.slug}`);
    await redisClient.del('events:listing:*');

    // Trigger notifications
    if (status === 'published') {
      logger.info('Event published notification queued', {
        eventId: event._id
      });
    }

    logger.info('Event status updated', {
      eventId: event._id,
      oldStatus: event.status,
      newStatus: status,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      data: event,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Event status update failed', {
      error: error.message,
      eventId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get event analytics
 * @route   GET /api/events/:id/analytics
 * @access  Private/Organizer
 * @returns {Object} Event analytics data
 */
exports.getEventAnalytics = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id)
      .select('analytics ticketTypes organizer')
      .lean();
    
    if (!event) {
      return next(new AppError('Event not found', 404));
    }

    // Check ownership
    if (event.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to view analytics', 403));
    }

    // Calculate additional metrics
    const salesMetrics = event.ticketTypes.map(type => ({
      name: type.name,
      sold: type.sold,
      available: type.available,
      revenue: type.sold * type.price,
      conversionRate: event.analytics.views > 0 ? (type.sold / event.analytics.views * 100).toFixed(2) : 0
    }));

    const totalRevenue = salesMetrics.reduce((sum, metric) => sum + metric.revenue, 0);
    const totalSold = salesMetrics.reduce((sum, metric) => sum + metric.sold, 0);

    res.json({
      success: true,
      data: {
        views: event.analytics.views,
        uniqueVisitors: event.analytics.uniqueVisitors,
        conversionRate: event.analytics.conversionRate,
        salesMetrics,
        totalRevenue,
        totalSold,
        sources: event.analytics.sources
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Get event analytics failed', {
      error: error.message,
      eventId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Clone an event
 * @route   POST /api/events/:id/clone
 * @access  Private/Organizer
 * @returns {Object} Cloned event data
 */
exports.cloneEvent = async (req, res, next) => {
  try {
    const originalEvent = await Event.findById(req.params.id).lean();
    
    if (!originalEvent) {
      return next(new AppError('Event not found', 404));
    }

    // Check ownership
    if (originalEvent.organizer.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to clone this event', 403));
    }

    // Remove unique fields and reset others
    delete originalEvent._id;
    delete originalEvent.slug;
    delete originalEvent.createdAt;
    delete originalEvent.updatedAt;
    delete originalEvent.analytics;
    delete originalEvent.changeHistory;

    // Update title and generate new slug
    originalEvent.title = `${originalEvent.title} (Copy)`;
    originalEvent.slug = slugify(originalEvent.title, { lower: true, strict: true });

    // Reset ticket sales
    originalEvent.ticketTypes = originalEvent.ticketTypes.map(type => ({
      ...type,
      sold: 0,
      available: type.quantity
    }));

    // Set to draft status
    originalEvent.status = 'draft';

    // Update dates if in the past
    const now = new Date();
    if (isBefore(originalEvent.startDate, now)) {
      const daysDiff = Math.ceil((originalEvent.endDate - originalEvent.startDate) / (1000 * 60 * 60 * 24));
      originalEvent.startDate = addDays(now, 7); // Start in 1 week
      originalEvent.endDate = addDays(originalEvent.startDate, daysDiff);
    }

    // Create new event
    const clonedEvent = await Event.create({
      ...originalEvent,
      organizer: req.user.id,
      metadata: {
        clonedFrom: req.params.id,
        createdBy: req.user.id,
        createdAt: new Date()
      }
    });

    logger.info('Event cloned', {
      originalEventId: req.params.id,
      clonedEventId: clonedEvent._id,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.status(201).json({
      success: true,
      data: clonedEvent,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Event clone failed', {
      error: error.message,
      eventId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

// Unit test examples
/**
 * Example unit tests:
 * 
 * describe('EventController', () => {
 *   describe('createEvent', () => {
 *     it('should create event with valid data', async () => {
 *       const req = mockRequest({
 *         body: {
 *           title: 'Test Event',
 *           description: 'Test Description',
 *           startDate: '2025-06-01T18:00:00Z',
 *           endDate: '2025-06-01T23:00:00Z',
 *           ticketTypes: [{
 *             name: 'General Admission',
 *             price: 50,
 *             quantity: 100
 *           }]
 *         },
 *         user: { id: 'user123' }
 *       });
 *       
 *       const res = mockResponse();
 *       await eventController.createEvent(req, res, next);
 *       
 *       expect(res.status).toHaveBeenCalledWith(201);
 *       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
 *         success: true,
 *         data: expect.objectContaining({
 *           title: 'Test Event'
 *         })
 *       }));
 *     });
 *     
 *     it('should reject event with past date', async () => {
 *       const req = mockRequest({
 *         body: {
 *           startDate: '2020-01-01T00:00:00Z'
 *         }
 *       });
 *       
 *       await eventController.createEvent(req, res, next);
 *       expect(next).toHaveBeenCalledWith(
 *         expect.objectContaining({
 *           message: 'Event start date must be in the future'
 *         })
 *       );
 *     });
 *   });
 * });
 */

module.exports = exports;
