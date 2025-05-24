// ==========================================
// FILE: backend/controllers/event/locationController.js
// ==========================================

const Venue = require('../../models/Venue');
const Event = require('../../models/Event');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { validationResult } = require('express-validator');
const NodeGeocoder = require('node-geocoder');
const redis = require('redis');
const slugify = require('slugify');

// Geocoder setup
const geocoder = NodeGeocoder({
  provider: process.env.GEOCODING_PROVIDER || 'openstreetmap',
  apiKey: process.env.GEOCODING_API_KEY,
  formatter: null
});

// Redis client setup
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

/**
 * @desc    Create a new venue
 * @route   POST /api/events/venues
 * @access  Private/Organizer
 * @returns {Object} Created venue data
 */
exports.createVenue = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const {
      name,
      description,
      type,
      address,
      city,
      state,
      country,
      postalCode,
      coordinates,
      spaces,
      amenities,
      accessibility,
      parkingInfo,
      publicTransport,
      images,
      contactInfo
    } = req.body;

    // Generate unique slug
    let slug = slugify(name, { lower: true, strict: true });
    let slugExists = await Venue.findOne({ slug });
    let counter = 1;
    
    while (slugExists) {
      slug = `${slugify(name, { lower: true, strict: true })}-${counter}`;
      slugExists = await Venue.findOne({ slug });
      counter++;
    }

    // Geocode address if coordinates not provided
    let finalCoordinates = coordinates;
    if (!coordinates && address) {
      try {
        const geocodeResults = await geocoder.geocode({
          address: `${address}, ${city}, ${state} ${postalCode}, ${country}`
        });
        
        if (geocodeResults.length > 0) {
          finalCoordinates = {
            type: 'Point',
            coordinates: [geocodeResults[0].longitude, geocodeResults[0].latitude]
          };
        }
      } catch (geocodeError) {
        logger.warn('Geocoding failed', {
          error: geocodeError.message,
          address,
          correlationId: req.correlationId
        });
      }
    }

    // Validate spaces capacity
    let totalCapacity = 0;
    const processedSpaces = spaces?.map(space => {
      if (space.capacity < 1 || space.capacity > 100000) {
        throw new AppError(`Space capacity must be between 1 and 100000`, 400);
      }
      
      totalCapacity += space.capacity;
      
      return {
        ...space,
        configurations: space.configurations || [{
          name: 'Default',
          capacity: space.capacity,
          layout: 'standard'
        }]
      };
    }) || [];

    // Create venue
    const venue = await Venue.create({
      name,
      slug,
      description,
      type: type || 'general',
      address: {
        street: address,
        city,
        state,
        country,
        postalCode,
        coordinates: finalCoordinates
      },
      spaces: processedSpaces,
      totalCapacity,
      amenities: amenities || [],
      accessibility: accessibility || {
        wheelchairAccessible: false,
        features: []
      },
      parking: parkingInfo || {
        available: false,
        type: [],
        capacity: 0,
        fee: 0
      },
      publicTransport: publicTransport || [],
      images: images || [],
      contactInfo: contactInfo || {},
      manager: req.user.id,
      isActive: true,
      metadata: {
        createdBy: req.user.id,
        source: req.headers['x-source'] || 'web'
      }
    });

    // Clear location-based caches
    await redisClient.del('venues:*');

    logger.info('Venue created', {
      venueId: venue._id,
      name: venue.name,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.status(201).json({
      success: true,
      data: venue,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Venue creation failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Update a venue
 * @route   PUT /api/events/venues/:id
 * @access  Private/Venue Manager
 * @returns {Object} Updated venue data
 */
exports.updateVenue = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const venue = await Venue.findById(req.params.id);
    
    if (!venue) {
      return next(new AppError('Venue not found', 404));
    }

    // Check authorization
    if (venue.manager.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to update this venue', 403));
    }

    // Check if venue has upcoming events before major changes
    const upcomingEvents = await Event.countDocuments({
      venue: venue._id,
      startDate: { $gte: new Date() },
      status: { $in: ['published', 'sold-out'] }
    });

    if (upcomingEvents > 0) {
      // Restrict certain updates
      const restrictedFields = ['spaces', 'totalCapacity', 'address'];
      const hasRestrictedUpdate = restrictedFields.some(field => req.body[field]);
      
      if (hasRestrictedUpdate) {
        return next(new AppError(`Cannot modify venue structure with ${upcomingEvents} upcoming events`, 400));
      }
    }

    const allowedUpdates = [
      'name', 'description', 'type', 'amenities', 'accessibility',
      'parking', 'publicTransport', 'images', 'contactInfo', 'isActive'
    ];

    // Handle address update with geocoding
    if (req.body.address) {
      const { street, city, state, country, postalCode } = req.body.address;
      
      if (street && city && country) {
        try {
          const geocodeResults = await geocoder.geocode({
            address: `${street}, ${city}, ${state} ${postalCode}, ${country}`
          });
          
          if (geocodeResults.length > 0) {
            req.body.address.coordinates = {
              type: 'Point',
              coordinates: [geocodeResults[0].longitude, geocodeResults[0].latitude]
            };
          }
        } catch (geocodeError) {
          logger.warn('Geocoding failed during update', {
            error: geocodeError.message,
            venueId: venue._id
          });
        }
      }
    }

    // Apply updates
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        venue[key] = req.body[key];
      }
    });

    venue.metadata.lastModifiedBy = req.user.id;
    venue.metadata.lastModifiedAt = new Date();

    await venue.save();

    // Clear caches
    await redisClient.del(`venue:${venue._id}`);
    await redisClient.del(`venue:${venue.slug}`);
    await redisClient.del('venues:*');

    logger.info('Venue updated', {
      venueId: venue._id,
      updates: Object.keys(req.body),
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      data: venue,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Venue update failed', {
      error: error.message,
      venueId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get all venues with filtering
 * @route   GET /api/events/venues
 * @access  Public
 * @returns {Object} Venues list with pagination
 */
exports.getVenues = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      city,
      state,
      country,
      type,
      minCapacity,
      maxCapacity,
      amenities,
      accessibility,
      search,
      isActive = 'true'
    } = req.query;

    // Build cache key
    const cacheKey = `venues:${JSON.stringify(req.query)}`;
    
    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Build query
    const query = {};
    
    if (isActive !== 'all') {
      query.isActive = isActive === 'true';
    }

    if (city) query['address.city'] = new RegExp(city, 'i');
    if (state) query['address.state'] = new RegExp(state, 'i');
    if (country) query['address.country'] = country;
    if (type) query.type = type;

    if (minCapacity || maxCapacity) {
      query.totalCapacity = {};
      if (minCapacity) query.totalCapacity.$gte = parseInt(minCapacity);
      if (maxCapacity) query.totalCapacity.$lte = parseInt(maxCapacity);
    }

    if (amenities) {
      const amenityList = Array.isArray(amenities) ? amenities : amenities.split(',');
      query.amenities = { $all: amenityList };
    }

    if (accessibility === 'true') {
      query['accessibility.wheelchairAccessible'] = true;
    }

    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { 'address.city': new RegExp(search, 'i') }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [venues, total] = await Promise.all([
      Venue.find(query)
        .select('-metadata')
        .populate('manager', 'name email')
        .sort('-rating.average -totalCapacity')
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Venue.countDocuments(query)
    ]);

    const response = {
      success: true,
      data: venues,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + venues.length < total
      }
    };

    // Cache for 24 hours
    await redisClient.setEx(cacheKey, 86400, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    logger.error('Get venues failed', {
      error: error.message,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get single venue by ID or slug
 * @route   GET /api/events/venues/:identifier
 * @access  Public
 * @returns {Object} Venue details
 */
exports.getVenue = async (req, res, next) => {
  try {
    const { identifier } = req.params;
    
    // Check cache
    const cacheKey = `venue:${identifier}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Determine if identifier is ID or slug
    const query = identifier.match(/^[0-9a-fA-F]{24}$/)
      ? { _id: identifier }
      : { slug: identifier };

    const venue = await Venue.findOne(query)
      .populate('manager', 'name email avatar')
      .lean();

    if (!venue) {
      return next(new AppError('Venue not found', 404));
    }

    // Get upcoming events at this venue
    const upcomingEvents = await Event.find({
      venue: venue._id,
      status: 'published',
      startDate: { $gte: new Date() }
    })
    .select('title slug startDate endDate ticketTypes images')
    .sort('startDate')
    .limit(10)
    .lean();

    // Get venue statistics
    const stats = await Event.aggregate([
      {
        $match: {
          venue: venue._id,
          status: { $in: ['published', 'completed'] }
        }
      },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          totalAttendees: { $sum: { $sum: '$ticketTypes.sold' } },
          avgRating: { $avg: '$rating.average' }
        }
      }
    ]);

    const response = {
      success: true,
      data: {
        ...venue,
        upcomingEvents,
        statistics: stats[0] || {
          totalEvents: 0,
          totalAttendees: 0,
          avgRating: 0
        }
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    };

    // Cache for 24 hours
    await redisClient.setEx(cacheKey, 86400, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    logger.error('Get venue failed', {
      error: error.message,
      identifier: req.params.identifier,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Search venues by location radius
 * @route   GET /api/events/venues/search/nearby
 * @access  Public
 * @returns {Object} Nearby venues
 */
exports.searchNearbyVenues = async (req, res, next) => {
  try {
    const {
      latitude,
      longitude,
      radius = 10, // km
      limit = 20,
      type,
      minCapacity
    } = req.query;

    if (!latitude || !longitude) {
      return next(new AppError('Latitude and longitude are required', 400));
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const maxDistance = parseFloat(radius) * 1000; // Convert km to meters

    // Build query
    const query = {
      'address.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat]
          },
          $maxDistance: maxDistance
        }
      },
      isActive: true
    };

    if (type) query.type = type;
    if (minCapacity) query.totalCapacity = { $gte: parseInt(minCapacity) };

    const venues = await Venue.find(query)
      .select('name slug type address totalCapacity images rating')
      .limit(parseInt(limit))
      .lean();

    // Calculate distances
    const venuesWithDistance = venues.map(venue => {
      const distance = calculateDistance(
        lat,
        lng,
        venue.address.coordinates.coordinates[1],
        venue.address.coordinates.coordinates[0]
      );
      
      return {
        ...venue,
        distance: Math.round(distance * 100) / 100 // Round to 2 decimals
      };
    });

    res.json({
      success: true,
      data: venuesWithDistance,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId,
        searchCenter: { latitude: lat, longitude: lng },
        searchRadius: radius
      }
    });

  } catch (error) {
    logger.error('Search nearby venues failed', {
      error: error.message,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get venue availability
 * @route   GET /api/events/venues/:id/availability
 * @access  Public
 * @returns {Object} Venue availability calendar
 */
exports.getVenueAvailability = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return next(new AppError('Start date and end date are required', 400));
    }

    const venue = await Venue.findById(req.params.id);
    
    if (!venue) {
      return next(new AppError('Venue not found', 404));
    }

    // Get events in date range
    const events = await Event.find({
      venue: venue._id,
      status: { $nin: ['cancelled', 'draft'] },
      $or: [
        {
          startDate: { $gte: new Date(startDate), $lte: new Date(endDate) }
        },
        {
          endDate: { $gte: new Date(startDate), $lte: new Date(endDate) }
        },
        {
          startDate: { $lte: new Date(startDate) },
          endDate: { $gte: new Date(endDate) }
        }
      ]
    })
    .select('title startDate endDate spaces')
    .lean();

    // Build availability calendar
    const availability = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const dateStr = date.toISOString().split('T')[0];
      
      // Check if date has events
      const dateEvents = events.filter(event => {
        const eventStart = new Date(event.startDate);
        const eventEnd = new Date(event.endDate);
        return date >= eventStart && date <= eventEnd;
      });

      availability[dateStr] = {
        available: dateEvents.length === 0,
        events: dateEvents.map(e => ({
          id: e._id,
          title: e.title,
          spaces: e.spaces || []
        })),
        availableSpaces: venue.spaces.filter(space => {
          // Check if space is not booked
          const bookedSpaces = dateEvents.flatMap(e => e.spaces || []);
          return !bookedSpaces.some(bs => bs.toString() === space._id.toString());
        })
      };
    }

    res.json({
      success: true,
      data: {
        venue: {
          id: venue._id,
          name: venue.name,
          spaces: venue.spaces
        },
        availability
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Get venue availability failed', {
      error: error.message,
      venueId: req.params.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Delete a venue
 * @route   DELETE /api/events/venues/:id
 * @access  Private/Venue Manager
 * @returns {Object} Success message
 */
exports.deleteVenue = async (req, res, next) => {
  try {
    const venue = await Venue.findById(req.params.id);
    
    if (!venue) {
      return next(new AppError('Venue not found', 404));
    }

    // Check authorization
    if (venue.manager.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to delete this venue', 403));
    }

    // Check for upcoming events
    const upcomingEvents = await Event.countDocuments({
      venue: venue._id,
      startDate: { $gte: new Date() },
      status: { $nin: ['cancelled'] }
    });

    if (upcomingEvents > 0) {
      return next(new AppError(`Cannot delete venue with ${upcomingEvents} upcoming events`, 400));
    }

    // Soft delete
    venue.isActive = false;
    venue.metadata.deletedBy = req.user.id;
    venue.metadata.deletedAt = new Date();
    await venue.save();

    // Clear caches
    await redisClient.del(`venue:${venue._id}`);
    await redisClient.del(`venue:${venue.slug}`);
    await redisClient.del('venues:*');

    logger.info('Venue deleted', {
      venueId: venue._id,
      name: venue.name,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      message: 'Venue deleted successfully',
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Venue deletion failed', {
      error: error.message,
      venueId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Rate a venue
 * @route   POST /api/events/venues/:id/rate
 * @access  Private
 * @returns {Object} Updated venue rating
 */
exports.rateVenue = async (req, res, next) => {
  try {
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return next(new AppError('Rating must be between 1 and 5', 400));
    }

    const venue = await Venue.findById(req.params.id);
    
    if (!venue) {
      return next(new AppError('Venue not found', 404));
    }

    // Check if user attended an event at this venue
    const attendedEvent = await Event.findOne({
      venue: venue._id,
      'attendees.user': req.user.id,
      status: 'completed'
    });

    if (!attendedEvent) {
      return next(new AppError('You must attend an event at this venue to rate it', 403));
    }

    // Update or create rating
    const existingRatingIndex = venue.rating.ratings.findIndex(
      r => r.user.toString() === req.user.id
    );

    if (existingRatingIndex > -1) {
      // Update existing rating
      venue.rating.ratings[existingRatingIndex] = {
        user: req.user.id,
        rating,
        comment,
        date: new Date()
      };
    } else {
      // Add new rating
      venue.rating.ratings.push({
        user: req.user.id,
        rating,
        comment,
        date: new Date()
      });
    }

    // Recalculate average
    const totalRatings = venue.rating.ratings.reduce((sum, r) => sum + r.rating, 0);
    venue.rating.average = totalRatings / venue.rating.ratings.length;
    venue.rating.count = venue.rating.ratings.length;

    await venue.save();

    // Clear cache
    await redisClient.del(`venue:${venue._id}`);
    await redisClient.del(`venue:${venue.slug}`);

    logger.info('Venue rated', {
      venueId: venue._id,
      rating,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      data: {
        average: venue.rating.average,
        count: venue.rating.count,
        userRating: rating
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Venue rating failed', {
      error: error.message,
      venueId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

// Helper functions

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {Number} lat1 
 * @param {Number} lon1 
 * @param {Number} lat2 
 * @param {Number} lon2 
 * @returns {Number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

// Unit test examples
/**
 * Example unit tests:
 * 
 * describe('LocationController', () => {
 *   describe('createVenue', () => {
 *     it('should geocode address when coordinates not provided', async () => {
 *       const req = mockRequest({
 *         body: {
 *           name: 'Test Venue',
 *           address: '123 Main St',
 *           city: 'New York',
 *           state: 'NY',
 *           country: 'USA',
 *           postalCode: '10001'
 *         },
 *         user: { id: 'user123' }
 *       });
 *       
 *       const res = mockResponse();
 *       await locationController.createVenue(req, res, next);
 *       
 *       expect(res.status).toHaveBeenCalledWith(201);
 *       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
 *         data: expect.objectContaining({
 *           address: expect.objectContaining({
 *             coordinates: expect.objectContaining({
 *               type: 'Point',
 *               coordinates: expect.arrayContaining([
 *                 expect.any(Number),
 *                 expect.any(Number)
 *               ])
 *             })
 *           })
 *         })
 *       }));
 *     });
 *   });
 *   
 *   describe('searchNearbyVenues', () => {
 *     it('should return venues within specified radius', async () => {
 *       const req = mockRequest({
 *         query: {
 *           latitude: '40.7128',
 *           longitude: '-74.0060',
 *           radius: '5'
 *         }
 *       });
 *       
 *       const res = mockResponse();
 *       await locationController.searchNearbyVenues(req, res, next);
 *       
 *       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
 *         data: expect.arrayContaining([
 *           expect.objectContaining({
 *             distance: expect.any(Number)
 *           })
 *         ])
 *       }));
 *     });
 *   });
 * });
 */

module.exports = exports;
