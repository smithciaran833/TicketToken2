const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;

// Import models
const Event = require('../models/Event');
const Venue = require('../models/Venue');
const Artist = require('../models/Artist');
const User = require('../models/User');
const Ticket = require('../models/Ticket');

// Import utilities
const { logger, logBusinessEvent } = require('../utils/logger');
const { EVENT_STATUS, TICKET_TYPES, ERROR_CODES } = require('../utils/constants');
const { formatDate, addDays, slugify, sanitizeInput } = require('../utils/helpers');

// Import other services
const venueService = require('./venueService');
const artistService = require('./artistService');
const ticketService = require('./ticketService');
const analyticsService = require('./analyticsService');
const notificationService = require('./notificationService');
const searchService = require('./searchService');

/**
 * Event Service
 * Handles all event-related business logic
 */
class EventService {
  
  // =============================================================================
  // EVENT CREATION AND MANAGEMENT
  // =============================================================================

  /**
   * Create a new event
   * @param {Object} eventData - Event data
   * @param {string} promoterId - Promoter/organizer user ID
   * @returns {Promise<Object>} Created event
   */
  async createEvent(eventData, promoterId) {
    try {
      // Validate event data
      const validation = await this.validateEventData(eventData);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Check promoter exists and has permissions
      const promoter = await User.findById(promoterId);
      if (!promoter) {
        throw new Error('Promoter not found');
      }

      // Create or get venue
      let venue;
      if (eventData.venue.id) {
        venue = await venueService.getVenueById(eventData.venue.id);
      } else {
        venue = await venueService.createVenue(eventData.venue, promoterId);
      }

      // Handle artists
      const artistIds = [];
      if (eventData.artists && eventData.artists.length > 0) {
        for (const artistData of eventData.artists) {
          let artist;
          if (artistData.id) {
            artist = await artistService.getArtistById(artistData.id);
          } else {
            artist = await artistService.createArtist(artistData, promoterId);
          }
          artistIds.push(artist._id);
        }
      }

      // Generate unique slug
      const baseSlug = slugify(eventData.title);
      const slug = await this.generateUniqueSlug(baseSlug);

      // Prepare event document
      const eventDoc = {
        title: sanitizeInput(eventData.title),
        slug,
        description: sanitizeInput(eventData.description),
        shortDescription: eventData.shortDescription ? sanitizeInput(eventData.shortDescription) : null,
        category: eventData.category,
        
        // Venue and location
        venue: venue._id,
        location: {
          type: 'Point',
          coordinates: [venue.longitude, venue.latitude],
          address: venue.address,
          city: venue.city,
          state: venue.state,
          country: venue.country,
          zipCode: venue.zipCode
        },
        
        // Date and time
        dateTime: {
          start: new Date(eventData.dateTime.start),
          end: new Date(eventData.dateTime.end),
          timezone: eventData.dateTime.timezone || 'UTC',
          doors: eventData.dateTime.doors ? new Date(eventData.dateTime.doors) : null
        },
        
        // People
        organizer: promoterId,
        artists: artistIds,
        
        // Ticket types
        ticketTypes: this.processTicketTypes(eventData.ticketTypes),
        
        // Media and content
        images: eventData.images || [],
        videos: eventData.videos || [],
        
        // SEO and discovery
        tags: eventData.tags || [],
        seoTitle: eventData.seoTitle || eventData.title,
        seoDescription: eventData.seoDescription || eventData.shortDescription,
        
        // Settings and policies
        settings: {
          isPublic: eventData.settings?.isPublic !== false,
          requiresApproval: eventData.settings?.requiresApproval || false,
          allowWaitlist: eventData.settings?.allowWaitlist !== false,
          maxTicketsPerUser: eventData.settings?.maxTicketsPerUser || 10,
          salesStartDate: eventData.settings?.salesStartDate ? new Date(eventData.settings.salesStartDate) : new Date(),
          salesEndDate: eventData.settings?.salesEndDate ? new Date(eventData.settings.salesEndDate) : new Date(eventData.dateTime.start),
          refundPolicy: eventData.settings?.refundPolicy || 'partial',
          transferPolicy: eventData.settings?.transferPolicy || 'allowed',
          ageRestriction: eventData.settings?.ageRestriction || null,
          dressCode: eventData.settings?.dressCode || null
        },
        
        // Status and metadata
        status: eventData.settings?.requiresApproval ? EVENT_STATUS.PENDING_APPROVAL.value : EVENT_STATUS.DRAFT.value,
        featured: false,
        verified: false,
        capacity: venue.capacity,
        ticketsSold: 0,
        revenue: 0,
        viewCount: 0,
        
        // Timestamps
        createdAt: new Date(),
        updatedAt: new Date(),
        publishedAt: null
      };

      // Create the event
      const event = new Event(eventDoc);
      await event.save();

      // Populate references for response
      await event.populate([
        { path: 'venue', select: 'name address city state country capacity' },
        { path: 'organizer', select: 'firstName lastName email profileImage' },
        { path: 'artists', select: 'name genre profileImage bio' }
      ]);

      // Index for search
      await searchService.indexEvent(event);

      // Log business event
      logBusinessEvent('event_created', {
        eventId: event._id,
        title: event.title,
        organizerId: promoterId,
        venueId: venue._id,
        artistIds,
        category: event.category,
        capacity: event.capacity
      });

      logger.info('Event created successfully', {
        eventId: event._id,
        title: event.title,
        organizerId: promoterId
      });

      return event;

    } catch (error) {
      logger.error('Error creating event', {
        error: error.message,
        stack: error.stack,
        eventData,
        promoterId
      });
      throw error;
    }
  }

  /**
   * Update an existing event
   * @param {string} eventId - Event ID
   * @param {Object} updates - Updates to apply
   * @param {string} userId - User making the update
   * @returns {Promise<Object>} Updated event
   */
  async updateEvent(eventId, updates, userId) {
    try {
      const event = await Event.findById(eventId);
      if (!event) {
        throw new Error('Event not found');
      }

      // Check permissions
      const canUpdate = await this.checkUpdatePermissions(event, userId);
      if (!canUpdate.allowed) {
        throw new Error(canUpdate.reason);
      }

      // Validate updates
      if (Object.keys(updates).length > 0) {
        const validation = await this.validateEventData(updates, true);
        if (!validation.isValid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }
      }

      // Handle special updates
      const processedUpdates = await this.processEventUpdates(event, updates, userId);

      // Apply updates
      Object.assign(event, processedUpdates);
      event.updatedAt = new Date();

      // Save changes
      await event.save();

      // Populate references
      await event.populate([
        { path: 'venue', select: 'name address city state country capacity' },
        { path: 'organizer', select: 'firstName lastName email profileImage' },
        { path: 'artists', select: 'name genre profileImage bio' }
      ]);

      // Update search index
      await searchService.updateEventIndex(event);

      // Notify subscribers of significant changes
      if (this.isSignificantUpdate(updates)) {
        await notificationService.notifyEventUpdate(event, updates);
      }

      // Log business event
      logBusinessEvent('event_updated', {
        eventId: event._id,
        updatedBy: userId,
        changes: Object.keys(processedUpdates),
        significant: this.isSignificantUpdate(updates)
      });

      logger.info('Event updated successfully', {
        eventId: event._id,
        updatedBy: userId,
        changes: Object.keys(processedUpdates)
      });

      return event;

    } catch (error) {
      logger.error('Error updating event', {
        error: error.message,
        stack: error.stack,
        eventId,
        updates,
        userId
      });
      throw error;
    }
  }

  /**
   * Get events with filtering and pagination
   * @param {Object} filters - Search filters
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Events and metadata
   */
  async getEvents(filters = {}, pagination = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sort = 'dateTime.start',
        order = 'asc'
      } = pagination;

      // Build query
      const query = this.buildEventQuery(filters);

      // Build sort options
      const sortOptions = this.buildSortOptions(sort, order);

      // Execute query with pagination
      const skip = (page - 1) * limit;
      
      const [events, total] = await Promise.all([
        Event.find(query)
          .populate('venue', 'name address city state country capacity')
          .populate('organizer', 'firstName lastName email profileImage')
          .populate('artists', 'name genre profileImage')
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .lean(),
        Event.countDocuments(query)
      ]);

      // Add computed fields
      const enrichedEvents = await Promise.all(
        events.map(event => this.enrichEventData(event, filters.userId))
      );

      return {
        data: enrichedEvents,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      };

    } catch (error) {
      logger.error('Error getting events', {
        error: error.message,
        stack: error.stack,
        filters,
        pagination
      });
      throw error;
    }
  }

  /**
   * Get a single event by ID
   * @param {string} eventId - Event ID
   * @param {string} userId - Optional user ID for personalization
   * @returns {Promise<Object>} Event details
   */
  async getEventById(eventId, userId = null) {
    try {
      if (!ObjectId.isValid(eventId)) {
        throw new Error('Invalid event ID format');
      }

      const event = await Event.findById(eventId)
        .populate({
          path: 'venue',
          select: 'name address city state country zipCode capacity amenities contact'
        })
        .populate({
          path: 'organizer',
          select: 'firstName lastName email profileImage bio company verified'
        })
        .populate({
          path: 'artists',
          select: 'name genre profileImage bio socialLinks verified'
        })
        .lean();

      if (!event) {
        return null;
      }

      // Check visibility
      if (!event.settings.isPublic && (!userId || event.organizer._id.toString() !== userId)) {
        return null;
      }

      // Enrich with additional data
      const enrichedEvent = await this.enrichEventData(event, userId);

      // Add ticket availability
      enrichedEvent.ticketAvailability = await this.getTicketAvailability(eventId);

      // Add related events
      enrichedEvent.relatedEvents = await this.getRelatedEvents(event, 5);

      // Increment view count (async, don't wait)
      this.incrementViewCount(eventId, userId).catch(err => 
        logger.warn('Failed to increment view count', { eventId, error: err.message })
      );

      return enrichedEvent;

    } catch (error) {
      logger.error('Error getting event by ID', {
        error: error.message,
        stack: error.stack,
        eventId,
        userId
      });
      throw error;
    }
  }

  /**
   * Soft delete an event
   * @param {string} eventId - Event ID
   * @param {string} userId - User performing deletion
   * @returns {Promise<boolean>} Success status
   */
  async deleteEvent(eventId, userId) {
    try {
      const event = await Event.findById(eventId);
      if (!event) {
        throw new Error('Event not found');
      }

      // Check permissions
      const canDelete = await this.checkDeletePermissions(event, userId);
      if (!canDelete.allowed) {
        throw new Error(canDelete.reason);
      }

      // Check if event has sold tickets
      const ticketsSold = await Ticket.countDocuments({ 
        eventId: eventId,
        status: { $in: ['active', 'used'] }
      });

      if (ticketsSold > 0) {
        // Soft delete - mark as cancelled
        event.status = EVENT_STATUS.CANCELLED.value;
        event.deletedAt = new Date();
        event.deletedBy = userId;
        await event.save();

        // Notify ticket holders
        await notificationService.notifyEventCancellation(event);
      } else {
        // Hard delete if no tickets sold
        await Event.findByIdAndDelete(eventId);
      }

      // Remove from search index
      await searchService.removeEventFromIndex(eventId);

      // Log business event
      logBusinessEvent('event_deleted', {
        eventId: event._id,
        title: event.title,
        deletedBy: userId,
        ticketsSold,
        deletionType: ticketsSold > 0 ? 'soft' : 'hard'
      });

      logger.info('Event deleted successfully', {
        eventId: event._id,
        deletedBy: userId,
        ticketsSold
      });

      return true;

    } catch (error) {
      logger.error('Error deleting event', {
        error: error.message,
        stack: error.stack,
        eventId,
        userId
      });
      throw error;
    }
  }

  // =============================================================================
  // SEARCH AND FILTERING
  // =============================================================================

  /**
   * Search events with full-text search
   * @param {string} query - Search query
   * @param {Object} filters - Additional filters
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Search results
   */
  async searchEvents(query, filters = {}, pagination = {}) {
    try {
      // Use search service for full-text search
      const searchResults = await searchService.searchEvents(query, {
        ...filters,
        ...pagination
      });

      // Get full event data
      const eventIds = searchResults.hits.map(hit => hit._id);
      const events = await Event.find({ _id: { $in: eventIds } })
        .populate('venue', 'name address city state country')
        .populate('organizer', 'firstName lastName profileImage')
        .populate('artists', 'name genre profileImage')
        .lean();

      // Maintain search order and add scores
      const orderedEvents = eventIds.map(id => {
        const event = events.find(e => e._id.toString() === id);
        const hit = searchResults.hits.find(h => h._id === id);
        return {
          ...event,
          _score: hit._score,
          _highlights: hit.highlight
        };
      }).filter(Boolean);

      return {
        data: orderedEvents,
        total: searchResults.total,
        page: pagination.page || 1,
        limit: pagination.limit || 20,
        query,
        suggestions: searchResults.suggestions || []
      };

    } catch (error) {
      logger.error('Error searching events', {
        error: error.message,
        stack: error.stack,
        query,
        filters,
        pagination
      });
      throw error;
    }
  }

  /**
   * Get events by category
   * @param {string} category - Event category
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Category events
   */
  async getEventsByCategory(category, pagination = {}) {
    try {
      const filters = { 
        category,
        status: EVENT_STATUS.ACTIVE.value,
        'settings.isPublic': true
      };

      return await this.getEvents(filters, pagination);

    } catch (error) {
      logger.error('Error getting events by category', {
        error: error.message,
        stack: error.stack,
        category,
        pagination
      });
      throw error;
    }
  }

  /**
   * Get nearby events based on coordinates
   * @param {Object} coordinates - { latitude, longitude }
   * @param {number} radius - Search radius in kilometers
   * @param {Object} pagination - Pagination options
   * @returns {Promise<Object>} Nearby events
   */
  async getNearbyEvents(coordinates, radius = 50, pagination = {}) {
    try {
      const { latitude, longitude } = coordinates;
      const { page = 1, limit = 20 } = pagination;

      // Build geospatial query
      const query = {
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [longitude, latitude]
            },
            $maxDistance: radius * 1000 // Convert km to meters
          }
        },
        status: EVENT_STATUS.ACTIVE.value,
        'settings.isPublic': true,
        'dateTime.start': { $gte: new Date() }
      };

      const skip = (page - 1) * limit;

      const [events, total] = await Promise.all([
        Event.find(query)
          .populate('venue', 'name address city state country')
          .populate('organizer', 'firstName lastName profileImage')
          .populate('artists', 'name genre profileImage')
          .sort({ 'dateTime.start': 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Event.countDocuments(query)
      ]);

      // Calculate distances and enrich data
      const enrichedEvents = await Promise.all(
        events.map(async (event) => {
          const distance = this.calculateDistance(
            latitude, longitude,
            event.location.coordinates[1], event.location.coordinates[0]
          );
          
          const enriched = await this.enrichEventData(event);
          return {
            ...enriched,
            distance: Math.round(distance * 10) / 10 // Round to 1 decimal
          };
        })
      );

      return {
        data: enrichedEvents,
        total,
        page,
        limit,
        searchCenter: { latitude, longitude },
        radius
      };

    } catch (error) {
      logger.error('Error getting nearby events', {
        error: error.message,
        stack: error.stack,
        coordinates,
        radius,
        pagination
      });
      throw error;
    }
  }

  // =============================================================================
  // ANALYTICS AND METRICS
  // =============================================================================

  /**
   * Get event analytics
   * @param {string} eventId - Event ID
   * @param {string} timeframe - Analytics timeframe
   * @returns {Promise<Object>} Event analytics
   */
  async getEventAnalytics(eventId, timeframe = '30d') {
    try {
      const event = await Event.findById(eventId);
      if (!event) {
        throw new Error('Event not found');
      }

      // Get analytics from analytics service
      const analytics = await analyticsService.getEventAnalytics(eventId, {
        timeframe,
        includeComparisons: true
      });

      // Add event-specific metrics
      const eventMetrics = await this.calculateEventMetrics(event);

      return {
        ...analytics,
        eventMetrics,
        generatedAt: new Date(),
        timeframe
      };

    } catch (error) {
      logger.error('Error getting event analytics', {
        error: error.message,
        stack: error.stack,
        eventId,
        timeframe
      });
      throw error;
    }
  }

  // =============================================================================
  // VALIDATION AND UTILITIES
  // =============================================================================

  /**
   * Validate event data
   * @param {Object} eventData - Event data to validate
   * @param {boolean} isUpdate - Whether this is an update operation
   * @returns {Promise<Object>} Validation result
   */
  async validateEventData(eventData, isUpdate = false) {
    const errors = [];

    try {
      // Title validation
      if (!isUpdate || eventData.title !== undefined) {
        if (!eventData.title || eventData.title.trim().length < 3) {
          errors.push('Event title must be at least 3 characters');
        }
        if (eventData.title && eventData.title.length > 200) {
          errors.push('Event title must not exceed 200 characters');
        }
      }

      // Description validation
      if (!isUpdate || eventData.description !== undefined) {
        if (!eventData.description || eventData.description.trim().length < 10) {
          errors.push('Event description must be at least 10 characters');
        }
        if (eventData.description && eventData.description.length > 5000) {
          errors.push('Event description must not exceed 5000 characters');
        }
      }

      // Category validation
      if (!isUpdate || eventData.category !== undefined) {
        const validCategories = ['music', 'sports', 'arts', 'technology', 'business', 'education', 'food', 'health', 'other'];
        if (!eventData.category || !validCategories.includes(eventData.category)) {
          errors.push('Valid category is required');
        }
      }

      // Date validation
      if (!isUpdate || eventData.dateTime !== undefined) {
        const now = new Date();
        const startDate = new Date(eventData.dateTime?.start);
        const endDate = new Date(eventData.dateTime?.end);

        if (!eventData.dateTime?.start || isNaN(startDate.getTime())) {
          errors.push('Valid start date is required');
        } else if (startDate <= now) {
          errors.push('Event start date must be in the future');
        }

        if (!eventData.dateTime?.end || isNaN(endDate.getTime())) {
          errors.push('Valid end date is required');
        } else if (endDate <= startDate) {
          errors.push('Event end date must be after start date');
        }

        // Check if event is too far in the future (2 years max)
        const maxFutureDate = addDays(now, 730);
        if (startDate > maxFutureDate) {
          errors.push('Event cannot be scheduled more than 2 years in advance');
        }
      }

      // Venue validation
      if (!isUpdate || eventData.venue !== undefined) {
        if (!eventData.venue) {
          errors.push('Venue information is required');
        } else {
          if (!eventData.venue.name || eventData.venue.name.trim().length < 2) {
            errors.push('Venue name is required');
          }
          if (!eventData.venue.address || eventData.venue.address.trim().length < 5) {
            errors.push('Venue address is required');
          }
          if (!eventData.venue.city || eventData.venue.city.trim().length < 2) {
            errors.push('Venue city is required');
          }
          if (!eventData.venue.country || eventData.venue.country.trim().length < 2) {
            errors.push('Venue country is required');
          }
          if (!eventData.venue.capacity || eventData.venue.capacity < 1) {
            errors.push('Venue capacity must be at least 1');
          }
        }
      }

      // Ticket types validation
      if (!isUpdate || eventData.ticketTypes !== undefined) {
        if (!eventData.ticketTypes || !Array.isArray(eventData.ticketTypes) || eventData.ticketTypes.length === 0) {
          errors.push('At least one ticket type is required');
        } else {
          for (const [index, ticketType] of eventData.ticketTypes.entries()) {
            if (!ticketType.name || ticketType.name.trim().length < 2) {
              errors.push(`Ticket type ${index + 1}: Name is required`);
            }
            if (ticketType.price === undefined || ticketType.price < 0) {
              errors.push(`Ticket type ${index + 1}: Valid price is required`);
            }
            if (!ticketType.quantity || ticketType.quantity < 1) {
              errors.push(`Ticket type ${index + 1}: Quantity must be at least 1`);
            }
            if (!ticketType.type || !Object.values(TICKET_TYPES).map(t => t.value).includes(ticketType.type)) {
              errors.push(`Ticket type ${index + 1}: Valid ticket type is required`);
            }
          }
        }
      }

      // Tags validation
      if (eventData.tags && Array.isArray(eventData.tags)) {
        if (eventData.tags.length > 20) {
          errors.push('Maximum 20 tags allowed');
        }
        for (const tag of eventData.tags) {
          if (typeof tag !== 'string' || tag.trim().length < 2 || tag.length > 50) {
            errors.push('Tags must be strings between 2-50 characters');
            break;
          }
        }
      }

      // Images validation
      if (eventData.images && Array.isArray(eventData.images)) {
        if (eventData.images.length > 10) {
          errors.push('Maximum 10 images allowed');
        }
        for (const image of eventData.images) {
          if (!image.url || typeof image.url !== 'string') {
            errors.push('Image URL is required');
            break;
          }
        }
      }

      return {
        isValid: errors.length === 0,
        errors
      };

    } catch (error) {
      logger.error('Error validating event data', {
        error: error.message,
        stack: error.stack,
        eventData
      });
      
      return {
        isValid: false,
        errors: ['Validation error occurred']
      };
    }
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  /**
   * Generate unique slug for event
   * @param {string} baseSlug - Base slug
   * @returns {Promise<string>} Unique slug
   */
  async generateUniqueSlug(baseSlug) {
    let slug = baseSlug;
    let counter = 1;

    while (await Event.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  /**
   * Process ticket types data
   * @param {Array} ticketTypes - Raw ticket types
   * @returns {Array} Processed ticket types
   */
  processTicketTypes(ticketTypes) {
    return ticketTypes.map(ticketType => ({
      ...ticketType,
      id: new ObjectId(),
      soldCount: 0,
      revenue: 0,
      createdAt: new Date()
    }));
  }

  /**
   * Check update permissions
   * @param {Object} event - Event document
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Permission result
   */
  async checkUpdatePermissions(event, userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        return { allowed: false, reason: 'User not found' };
      }

      // Event organizer can always update
      if (event.organizer.toString() === userId) {
        return { allowed: true };
      }

      // Admin users can update any event
      if (user.role === 'admin' || user.role === 'super_admin') {
        return { allowed: true };
      }

      return { allowed: false, reason: 'Insufficient permissions' };

    } catch (error) {
      logger.error('Error checking update permissions', { error: error.message, eventId: event._id, userId });
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Check delete permissions
   * @param {Object} event - Event document
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Permission result
   */
  async checkDeletePermissions(event, userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        return { allowed: false, reason: 'User not found' };
      }

      // Only admin can delete events
      if (user.role === 'admin' || user.role === 'super_admin') {
        return { allowed: true };
      }

      return { allowed: false, reason: 'Only administrators can delete events' };

    } catch (error) {
      logger.error('Error checking delete permissions', { error: error.message, eventId: event._id, userId });
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Process event updates
   * @param {Object} event - Current event
   * @param {Object} updates - Updates to process
   * @param {string} userId - User making updates
   * @returns {Promise<Object>} Processed updates
   */
  async processEventUpdates(event, updates, userId) {
    const processedUpdates = { ...updates };

    // Handle venue updates
    if (updates.venue) {
      if (updates.venue.id) {
        const venue = await venueService.getVenueById(updates.venue.id);
        processedUpdates.venue = venue._id;
      } else {
        const venue = await venueService.createVenue(updates.venue, userId);
        processedUpdates.venue = venue._id;
      }
    }

    // Handle artist updates
    if (updates.artists) {
      const artistIds = [];
      for (const artistData of updates.artists) {
        let artist;
        if (artistData.id) {
          artist = await artistService.getArtistById(artistData.id);
        } else {
          artist = await artistService.createArtist(artistData, userId);
        }
        artistIds.push(artist._id);
      }
      processedUpdates.artists = artistIds;
    }

    // Handle status changes
    if (updates.status === EVENT_STATUS.ACTIVE.value && event.status !== EVENT_STATUS.ACTIVE.value) {
      processedUpdates.publishedAt = new Date();
    }

  // Sanitize text fields
    if (updates.title) {
      processedUpdates.title = sanitizeInput(updates.title);
    }
    if (updates.description) {
      processedUpdates.description = sanitizeInput(updates.description);
    }

    return processedUpdates;
  }

  /**
   * Check if update is significant (requires notifications)
   * @param {Object} updates - Updates being made
   * @returns {boolean} Is significant
   */
  isSignificantUpdate(updates) {
    const significantFields = ['dateTime', 'venue', 'status', 'ticketTypes'];
    return significantFields.some(field => updates[field] !== undefined);
  }

  /**
   * Build MongoDB query from filters
   * @param {Object} filters - Search filters
   * @returns {Object} MongoDB query
   */
  buildEventQuery(filters) {
    const query = {};

    // Basic filters
    if (filters.status) {
      query.status = filters.status;
    } else {
      query.status = { $ne: 'deleted' };
    }

    if (filters.category) {
      query.category = filters.category;
    }

    if (filters.organizer) {
      query.organizer = ObjectId.isValid(filters.organizer) ? filters.organizer : null;
    }

    if (filters.featured !== undefined) {
      query.featured = filters.featured;
    }

    // Date filters
    if (filters.dateFrom || filters.dateTo) {
      query['dateTime.start'] = {};
      if (filters.dateFrom) {
        query['dateTime.start'].$gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        query['dateTime.start'].$lte = new Date(filters.dateTo);
      }
    }

    // Location filters
    if (filters.city) {
      query['location.city'] = new RegExp(filters.city, 'i');
    }
    if (filters.state) {
      query['location.state'] = new RegExp(filters.state, 'i');
    }
    if (filters.country) {
      query['location.country'] = new RegExp(filters.country, 'i');
    }

    // Price filters
    if (filters.priceMin || filters.priceMax) {
      query['ticketTypes'] = {
        $elemMatch: {}
      };
      if (filters.priceMin) {
        query['ticketTypes'].$elemMatch.price = { $gte: filters.priceMin };
      }
      if (filters.priceMax) {
        if (query['ticketTypes'].$elemMatch.price) {
          query['ticketTypes'].$elemMatch.price.$lte = filters.priceMax;
        } else {
          query['ticketTypes'].$elemMatch.price = { $lte: filters.priceMax };
        }
      }
    }

    // Text search
    if (filters.search) {
      query.$text = { $search: filters.search };
    }

    // Tags filter
    if (filters.tags && Array.isArray(filters.tags)) {
      query.tags = { $in: filters.tags };
    }

    // Visibility filter
    if (!filters.includePrivate) {
      query['settings.isPublic'] = true;
    }

    return query;
  }

  /**
   * Build sort options
   * @param {string} sort - Sort field
   * @param {string} order - Sort order
   * @returns {Object} Sort options
   */
  buildSortOptions(sort, order) {
    const sortOptions = {};
    const direction = order === 'desc' ? -1 : 1;

    switch (sort) {
      case 'date':
        sortOptions['dateTime.start'] = direction;
        break;
      case 'title':
        sortOptions.title = direction;
        break;
      case 'price':
        sortOptions['ticketTypes.0.price'] = direction;
        break;
      case 'popularity':
        sortOptions.viewCount = direction;
        sortOptions.ticketsSold = direction;
        break;
      case 'created':
        sortOptions.createdAt = direction;
        break;
      default:
        sortOptions['dateTime.start'] = 1; // Default to upcoming events first
    }

    return sortOptions;
  }

  /**
   * Enrich event data with computed fields
   * @param {Object} event - Event document
   * @param {string} userId - Optional user ID
   * @returns {Promise<Object>} Enriched event
   */
  async enrichEventData(event, userId = null) {
    const enriched = { ...event };

    // Calculate availability
    enriched.availability = this.calculateAvailability(event);

    // Calculate price range
    enriched.priceRange = this.calculatePriceRange(event.ticketTypes);

    // Add status indicators
    enriched.statusInfo = this.getStatusInfo(event);

    // Add user-specific data if authenticated
    if (userId) {
      enriched.userInteractions = await this.getUserInteractions(event._id, userId);
    }

    // Add formatted dates
    enriched.formattedDates = {
      start: formatDate(event.dateTime.start, 'MM/DD/YYYY HH:mm'),
      end: formatDate(event.dateTime.end, 'MM/DD/YYYY HH:mm'),
      relative: this.getRelativeDate(event.dateTime.start)
    };

    return enriched;
  }

  /**
   * Calculate event availability
   * @param {Object} event - Event document
   * @returns {Object} Availability info
   */
  calculateAvailability(event) {
    const totalCapacity = event.capacity;
    const soldCount = event.ticketsSold || 0;
    const available = totalCapacity - soldCount;
    const percentage = totalCapacity > 0 ? (available / totalCapacity) * 100 : 0;

    return {
      total: totalCapacity,
      sold: soldCount,
      available,
      percentage: Math.round(percentage),
      status: this.getAvailabilityStatus(percentage)
    };
  }

  /**
   * Get availability status
   * @param {number} percentage - Available percentage
   * @returns {string} Status
   */
  getAvailabilityStatus(percentage) {
    if (percentage === 0) return 'sold_out';
    if (percentage <= 10) return 'limited';
    if (percentage <= 25) return 'selling_fast';
    return 'available';
  }

  /**
   * Calculate price range from ticket types
   * @param {Array} ticketTypes - Ticket types
   * @returns {Object} Price range
   */
  calculatePriceRange(ticketTypes) {
    if (!ticketTypes || ticketTypes.length === 0) {
      return { min: 0, max: 0, currency: 'USD' };
    }

    const prices = ticketTypes.map(t => t.price).filter(p => p >= 0);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    return {
      min,
      max,
      currency: 'USD', // TODO: Support multiple currencies
      hasRange: min !== max,
      formatted: {
        min: `$${min.toFixed(2)}`,
        max: `$${max.toFixed(2)}`,
        range: min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)} - $${max.toFixed(2)}`
      }
    };
  }

  /**
   * Get status information
   * @param {Object} event - Event document
   * @returns {Object} Status info
   */
  getStatusInfo(event) {
    const now = new Date();
    const startDate = new Date(event.dateTime.start);
    const endDate = new Date(event.dateTime.end);

    let status = event.status;
    let message = '';

    if (status === EVENT_STATUS.ACTIVE.value) {
      if (now > endDate) {
        status = 'completed';
        message = 'Event has ended';
      } else if (now >= startDate) {
        status = 'ongoing';
        message = 'Event is happening now';
      } else {
        const salesEndDate = new Date(event.settings.salesEndDate);
        if (now > salesEndDate) {
          status = 'sales_ended';
          message = 'Ticket sales have ended';
        } else {
          message = 'Tickets available';
        }
      }
    }

    return {
      status,
      message,
      canPurchase: this.canPurchaseTickets(event, now),
      timeUntilStart: startDate > now ? startDate - now : 0,
      timeUntilEnd: endDate > now ? endDate - now : 0
    };
  }

  /**
   * Check if tickets can be purchased
   * @param {Object} event - Event document
   * @param {Date} now - Current date
   * @returns {boolean} Can purchase
   */
  canPurchaseTickets(event, now = new Date()) {
    if (event.status !== EVENT_STATUS.ACTIVE.value) return false;
    
    const startDate = new Date(event.dateTime.start);
    const salesStartDate = new Date(event.settings.salesStartDate);
    const salesEndDate = new Date(event.settings.salesEndDate);
    
    return now >= salesStartDate && 
           now <= salesEndDate && 
           now < startDate && 
           event.ticketsSold < event.capacity;
  }

  /**
   * Get user interactions with event
   * @param {string} eventId - Event ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User interactions
   */
  async getUserInteractions(eventId, userId) {
    try {
      const [tickets, favorites, views] = await Promise.all([
        Ticket.countDocuments({ eventId, userId, status: { $ne: 'cancelled' } }),
        // Assuming a favorites collection exists
        // Favorite.findOne({ eventId, userId }),
        null, // Placeholder for favorites
        // Assuming view tracking exists
        null // Placeholder for views
      ]);

      return {
        hasTickets: tickets > 0,
        ticketCount: tickets,
        isFavorite: !!favorites,
        hasViewed: !!views
      };
    } catch (error) {
      logger.warn('Error getting user interactions', { eventId, userId, error: error.message });
      return {
        hasTickets: false,
        ticketCount: 0,
        isFavorite: false,
        hasViewed: false
      };
    }
  }

  /**
   * Get relative date string
   * @param {Date} date - Date to format
   * @returns {string} Relative date
   */
  getRelativeDate(date) {
    const now = new Date();
    const eventDate = new Date(date);
    const diffMs = eventDate - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return 'Past event';
    } else if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Tomorrow';
    } else if (diffDays <= 7) {
      return `In ${diffDays} days`;
    } else if (diffDays <= 30) {
      const weeks = Math.ceil(diffDays / 7);
      return `In ${weeks} week${weeks > 1 ? 's' : ''}`;
    } else {
      const months = Math.ceil(diffDays / 30);
      return `In ${months} month${months > 1 ? 's' : ''}`;
    }
  }

  /**
   * Get ticket availability for event
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Ticket availability
   */
  async getTicketAvailability(eventId) {
    try {
      const event = await Event.findById(eventId).select('ticketTypes capacity ticketsSold');
      if (!event) return null;

      const availability = event.ticketTypes.map(ticketType => ({
        id: ticketType.id,
        name: ticketType.name,
        type: ticketType.type,
        price: ticketType.price,
        total: ticketType.quantity,
        sold: ticketType.soldCount || 0,
        available: ticketType.quantity - (ticketType.soldCount || 0),
        percentage: ((ticketType.quantity - (ticketType.soldCount || 0)) / ticketType.quantity) * 100
      }));

      return {
        overall: this.calculateAvailability(event),
        byType: availability
      };
    } catch (error) {
      logger.error('Error getting ticket availability', { eventId, error: error.message });
      return null;
    }
  }

  /**
   * Get related events
   * @param {Object} event - Current event
   * @param {number} limit - Number of related events
   * @returns {Promise<Array>} Related events
   */
  async getRelatedEvents(event, limit = 5) {
    try {
      const query = {
        _id: { $ne: event._id },
        status: EVENT_STATUS.ACTIVE.value,
        'settings.isPublic': true,
        $or: [
          { category: event.category },
          { artists: { $in: event.artists || [] } },
          { 'location.city': event.location.city },
          { tags: { $in: event.tags || [] } }
        ]
      };

      const relatedEvents = await Event.find(query)
        .populate('venue', 'name city')
        .populate('organizer', 'firstName lastName')
        .sort({ 'dateTime.start': 1 })
        .limit(limit)
        .lean();

      return relatedEvents.map(e => this.enrichEventData(e));
    } catch (error) {
      logger.warn('Error getting related events', { eventId: event._id, error: error.message });
      return [];
    }
  }

  /**
   * Increment view count for event
   * @param {string} eventId - Event ID
   * @param {string} userId - Optional user ID
   * @returns {Promise<void>}
   */
  async incrementViewCount(eventId, userId = null) {
    try {
      await Event.findByIdAndUpdate(eventId, { $inc: { viewCount: 1 } });
      
      // Track individual view if user is logged in
      if (userId) {
        // Could implement view tracking per user here
        logBusinessEvent('event_viewed', {
          eventId,
          userId,
          timestamp: new Date()
        });
      }
    } catch (error) {
      logger.warn('Error incrementing view count', { eventId, error: error.message });
    }
  }

  /**
   * Calculate distance between two coordinates
   * @param {number} lat1 - First latitude
   * @param {number} lon1 - First longitude
   * @param {number} lat2 - Second latitude
   * @param {number} lon2 - Second longitude
   * @returns {number} Distance in kilometers
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Calculate event-specific metrics
   * @param {Object} event - Event document
   * @returns {Promise<Object>} Event metrics
   */
  async calculateEventMetrics(event) {
    try {
      const totalTickets = event.ticketTypes.reduce((sum, type) => sum + type.quantity, 0);
      const soldTickets = event.ticketsSold || 0;
      const revenue = event.revenue || 0;
      const averageTicketPrice = soldTickets > 0 ? revenue / soldTickets : 0;
      
      const salesRate = totalTickets > 0 ? (soldTickets / totalTickets) * 100 : 0;
      const daysUntilEvent = Math.ceil((new Date(event.dateTime.start) - new Date()) / (1000 * 60 * 60 * 24));
      
      return {
        tickets: {
          total: totalTickets,
          sold: soldTickets,
          available: totalTickets - soldTickets,
          salesRate: Math.round(salesRate * 100) / 100
        },
        revenue: {
          total: revenue,
          average: Math.round(averageTicketPrice * 100) / 100,
          projected: totalTickets * averageTicketPrice
        },
        engagement: {
          views: event.viewCount || 0,
          viewsPerDay: daysUntilEvent > 0 ? Math.round((event.viewCount || 0) / Math.max(1, daysUntilEvent)) : 0
        },
        timing: {
          daysUntilEvent: Math.max(0, daysUntilEvent),
          salesPeriod: Math.ceil((new Date(event.settings.salesEndDate) - new Date(event.settings.salesStartDate)) / (1000 * 60 * 60 * 24))
        }
      };
    } catch (error) {
      logger.error('Error calculating event metrics', { eventId: event._id, error: error.message });
      return {};
    }
  }
}

// Export singleton instance
module.exports = new EventService();
