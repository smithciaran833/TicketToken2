// backend/controllers/eventController.js

const Event = require('../models/Event');
const { sendSuccess, sendError, sendNotFound } = require('../utils/responseHelper');

/**
 * @desc    Create a new event
 * @route   POST /api/events
 * @access  Private (Organizers and Admins)
 */
const createEvent = async (req, res) => {
  try {
    const { 
      title, 
      description, 
      startDate, 
      endDate, 
      location, 
      ticketTypes, 
      category, 
      tags,
      bannerImage,
      isPublic
    } = req.body;
    
    // Basic validation
    if (!title || !description || !startDate || !endDate || !location) {
      return sendError(res, 'Missing required fields', {
        title: !title ? 'Title is required' : undefined,
        description: !description ? 'Description is required' : undefined,
        startDate: !startDate ? 'Start date is required' : undefined,
        endDate: !endDate ? 'End date is required' : undefined,
        location: !location ? 'Location is required' : undefined
      });
    }
    
    // Validate dates
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    const now = new Date();
    
    if (startDateObj < now) {
      return sendError(res, 'Invalid start date', {
        startDate: 'Start date cannot be in the past'
      });
    }
    
    if (endDateObj <= startDateObj) {
      return sendError(res, 'Invalid end date', {
        endDate: 'End date must be after start date'
      });
    }
    
    // Generate eventId
    const { v4: uuidv4 } = require('uuid');
    const eventId = uuidv4();
    
    // Create the event
    const event = await Event.create({
      eventId,
      title,
      description,
      startDate: startDateObj,
      endDate: endDateObj,
      location: {
        ...location,
        coordinates: location.coordinates || [0, 0] // Default coordinates if not provided
      },
      organizer: req.user._id,
      ticketTypes: ticketTypes || [],
      category,
      tags: tags || [],
      bannerImage,
      status: isPublic ? 'published' : 'draft',
      createdAt: new Date()
    });
    
    return sendSuccess(res, { event }, 'Event created successfully', 201);
    
  } catch (error) {
    console.error('Create event error:', error);
    return sendError(res, 'Error creating event', { server: error.message }, 500);
  }
};

/**
 * @desc    Get all events with filtering and search
 * @route   GET /api/events
 * @access  Public
 */
const getEvents = async (req, res) => {
  try {
    // Extract query parameters
    const { 
      q, 
      category, 
      tags, 
      location, 
      radius, 
      startAfter, 
      startBefore, 
      organizerId,
      page = 1, 
      limit = 10,
      sort = 'startDate',
      order = 'asc'
    } = req.query;
    
    // Build the filter query
    const filter = { status: 'published' };
    
    // Text search
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }
    
    // Category filter
    if (category) {
      filter.category = category;
    }
    
    // Tags filter (comma-separated)
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      filter.tags = { $in: tagArray };
    }
    
    // Organizer filter
    if (organizerId) {
      filter.organizer = organizerId;
    }
    
    // Date filters
    if (startAfter) {
      filter.startDate = { ...filter.startDate, $gte: new Date(startAfter) };
    }
    
    if (startBefore) {
      filter.startDate = { ...filter.startDate, $lte: new Date(startBefore) };
    }
    
    // Location-based search (if coordinates and radius provided)
    if (location && radius) {
      try {
        const [longitude, latitude] = location.split(',').map(coord => parseFloat(coord));
        const radiusInMeters = parseFloat(radius) * 1000; // Convert km to meters
        
        filter.location = {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [longitude, latitude]
            },
            $maxDistance: radiusInMeters
          }
        };
      } catch (err) {
        console.warn('Invalid location or radius parameters');
      }
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Sorting
    const sortOptions = {};
    sortOptions[sort] = order === 'desc' ? -1 : 1;
    
    // Execute query
    const events = await Event.find(filter)
      .populate('organizer', 'displayName username')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const total = await Event.countDocuments(filter);
    
    return sendSuccess(res, { 
      events, 
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      } 
    });
    
  } catch (error) {
    console.error('Get events error:', error);
    return sendError(res, 'Error retrieving events', { server: error.message }, 500);
  }
};

/**
 * @desc    Get nearby events
 * @route   GET /api/events/nearby
 * @access  Public
 */
const getNearbyEvents = async (req, res) => {
  try {
    const { latitude, longitude, radius = 10, limit = 10 } = req.query;
    
    if (!latitude || !longitude) {
      return sendError(res, 'Location coordinates required', {
        location: 'Latitude and longitude are required'
      });
    }
    
    const radiusInMeters = parseFloat(radius) * 1000; // Convert km to meters
    
    const events = await Event.find({
      status: 'published',
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: radiusInMeters
        }
      }
    })
    .populate('organizer', 'displayName username')
    .limit(parseInt(limit));
    
    return sendSuccess(res, { events });
    
  } catch (error) {
    console.error('Get nearby events error:', error);
    return sendError(res, 'Error retrieving nearby events', { server: error.message }, 500);
  }
};

/**
 * @desc    Get event by ID
 * @route   GET /api/events/:id
 * @access  Public
 */
const getEventById = async (req, res) => {
  try {
    const event = await Event.findOne({ eventId: req.params.id })
      .populate('organizer', 'displayName username profileImage');
    
    if (!event) {
      return sendNotFound(res, 'Event');
    }
    
    // If it's a draft, only allow organizer or admin to see it
    if (event.status === 'draft') {
      if (!req.user || (event.organizer._id.toString() !== req.user._id.toString() && req.user.role !== 'admin')) {
        return sendNotFound(res, 'Event'); // Pretend it doesn't exist for security
      }
    }
    
    return sendSuccess(res, { event });
    
  } catch (error) {
    console.error('Get event error:', error);
    return sendError(res, 'Error retrieving event', { server: error.message }, 500);
  }
};

/**
 * @desc    Update event
 * @route   PUT /api/events/:id
 * @access  Private (Event Organizer and Admins)
 */
const updateEvent = async (req, res) => {
  try {
    const event = await Event.findOne({ eventId: req.params.id });
    
    if (!event) {
      return sendNotFound(res, 'Event');
    }
    
    // Check if user is authorized to update this event
    if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return sendError(res, 'Not authorized', { auth: 'You can only update your own events' }, 403);
    }
    
    // Update fields
    const updateData = { ...req.body };
    
    // Don't allow changing the organizer
    delete updateData.organizer;
    
    // Process dates
    if (updateData.startDate) {
      updateData.startDate = new Date(updateData.startDate);
    }
    
    if (updateData.endDate) {
      updateData.endDate = new Date(updateData.endDate);
    }
    
    // Validate dates
    if (updateData.startDate && updateData.endDate && 
        updateData.startDate > updateData.endDate) {
      return sendError(res, 'Invalid dates', {
        dates: 'End date must be after start date'
      });
    }
    
    const updatedEvent = await Event.findOneAndUpdate(
      { eventId: req.params.id },
      { $set: updateData },
      { new: true }
    ).populate('organizer', 'displayName username');
    
    return sendSuccess(res, { event: updatedEvent }, 'Event updated successfully');
    
  } catch (error) {
    console.error('Update event error:', error);
    return sendError(res, 'Error updating event', { server: error.message }, 500);
  }
};

/**
 * @desc    Delete event
 * @route   DELETE /api/events/:id
 * @access  Private (Event Organizer and Admins)
 */
const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findOne({ eventId: req.params.id });
    
    if (!event) {
      return sendNotFound(res, 'Event');
    }
    
    // Check if user is authorized to delete this event
    if (event.organizer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return sendError(res, 'Not authorized', { auth: 'You can only delete your own events' }, 403);
    }
    
    await Event.deleteOne({ eventId: req.params.id });
    
    return sendSuccess(res, { deleted: true }, 'Event deleted successfully');
    
  } catch (error) {
    console.error('Delete event error:', error);
    return sendError(res, 'Error deleting event', { server: error.message }, 500);
  }
};

/**
 * @desc    Get events by organizer
 * @route   GET /api/events/organizer/:id
 * @access  Public
 */
const getEventsByOrganizer = async (req, res) => {
  try {
    const organizerId = req.params.id;
    
    // If logged in user is viewing their own events, show drafts too
    const includesDrafts = req.user && req.user._id.toString() === organizerId;
    
    const filter = { 
      organizer: organizerId,
      ...(includesDrafts ? {} : { status: 'published' })
    };
    
    const events = await Event.find(filter)
      .sort({ startDate: 1 });
    
    return sendSuccess(res, { events });
    
  } catch (error) {
    console.error('Get organizer events error:', error);
    return sendError(res, 'Error retrieving organizer events', { server: error.message }, 500);
  }
};

/**
 * @desc    Get categories
 * @route   GET /api/events/categories
 * @access  Public
 */
const getCategories = async (req, res) => {
  try {
    // Get all distinct categories from published events
    const categories = await Event.distinct('category', { status: 'published' });
    
    return sendSuccess(res, { categories });
    
  } catch (error) {
    console.error('Get categories error:', error);
    return sendError(res, 'Error retrieving categories', { server: error.message }, 500);
  }
};

/**
 * @desc    Get popular tags
 * @route   GET /api/events/tags
 * @access  Public
 */
const getTags = async (req, res) => {
  try {
    // Get all tags from published events
    const tags = await Event.aggregate([
      { $match: { status: 'published' } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);
    
    return sendSuccess(res, { 
      tags: tags.map(tag => ({
        name: tag._id,
        count: tag.count
      }))
    });
    
  } catch (error) {
    console.error('Get tags error:', error);
    return sendError(res, 'Error retrieving tags', { server: error.message }, 500);
  }
};

/**
 * @desc    Promoter dashboard stats
 * @route   GET /api/events/promoter/stats
 * @access  Private (Promoters)
 */
const getPromoterStats = async (req, res) => {
  try {
    const stats = {
      totalEvents: await Event.countDocuments({ organizer: req.user._id }),
      publishedEvents: await Event.countDocuments({ 
        organizer: req.user._id,
        status: 'published'
      }),
      draftEvents: await Event.countDocuments({ 
        organizer: req.user._id,
        status: 'draft'
      }),
      upcomingEvents: await Event.countDocuments({
        organizer: req.user._id,
        status: 'published',
        startDate: { $gt: new Date() }
      })
    };
    
    // Get recent events
    const recentEvents = await Event.find({ organizer: req.user._id })
      .sort({ createdAt: -1 })
      .limit(5);
    
    return sendSuccess(res, { 
      stats,
      recentEvents
    });
    
  } catch (error) {
    console.error('Get promoter stats error:', error);
    return sendError(res, 'Error retrieving promoter stats', { server: error.message }, 500);
  }
};

module.exports = {
  createEvent,
  getEvents,
  getNearbyEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  getEventsByOrganizer,
  getCategories,
  getTags,
  getPromoterStats
};
