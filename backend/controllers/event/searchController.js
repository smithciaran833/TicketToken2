// ==========================================
// FILE: backend/controllers/event/searchController.js
// ==========================================

const Event = require('../../models/Event');
const Venue = require('../../models/Venue');
const Category = require('../../models/Category');
const SearchHistory = require('../../models/SearchHistory');
const SavedSearch = require('../../models/SavedSearch');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const redis = require('redis');
const { Client } = require('@elastic/elasticsearch');

// Redis client setup
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

// Elasticsearch client setup (optional - fallback to MongoDB if not available)
let esClient = null;
if (process.env.ELASTICSEARCH_URL) {
  esClient = new Client({
    node: process.env.ELASTICSEARCH_URL,
    auth: {
      username: process.env.ELASTICSEARCH_USERNAME,
      password: process.env.ELASTICSEARCH_PASSWORD
    }
  });
}

/**
 * @desc    Advanced event search with multiple filters
 * @route   GET /api/events/search
 * @access  Public
 * @returns {Object} Search results with facets
 */
exports.searchEvents = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const {
      q,
      categories,
      subcategories,
      dateFrom,
      dateTo,
      priceMin,
      priceMax,
      location,
      radius = 50,
      lat,
      lng,
      hasAvailableTickets,
      ageRestriction,
      accessibility,
      artists,
      tags,
      sortBy = 'relevance',
      page = 1,
      limit = 20,
      includeFilters = 'true'
    } = req.query;

    // Build cache key
    const cacheKey = `search:${JSON.stringify(req.query)}`;
    
    // Check cache for non-personalized searches
    if (!req.user) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }

    // Use Elasticsearch if available, otherwise MongoDB
    let searchResults;
    if (esClient) {
      searchResults = await searchWithElasticsearch(req.query);
    } else {
      searchResults = await searchWithMongoDB(req.query);
    }

    // Track search for analytics
    if (req.user) {
      trackSearch(req.user.id, req.query);
    }

    // Add search suggestions if no results
    if (searchResults.results.length === 0) {
      searchResults.suggestions = await generateSearchSuggestions(req.query);
    }

    // Get facets/filters if requested
    if (includeFilters === 'true') {
      searchResults.filters = await getSearchFilters(searchResults.query);
    }

    const response = {
      success: true,
      data: searchResults.results,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId,
        query: q,
        totalResults: searchResults.total
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: searchResults.total,
        hasMore: searchResults.hasMore
      }
    };

    if (searchResults.filters) {
      response.filters = searchResults.filters;
    }

    if (searchResults.suggestions) {
      response.suggestions = searchResults.suggestions;
    }

    // Cache public searches for 5 minutes
    if (!req.user) {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
    }

    res.json(response);

  } catch (error) {
    logger.error('Event search failed', {
      error: error.message,
      query: req.query,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get search suggestions/autocomplete
 * @route   GET /api/events/search/suggestions
 * @access  Public
 * @returns {Object} Search suggestions
 */
exports.getSearchSuggestions = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: [],
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.0',
          requestId: req.correlationId
        }
      });
    }

    const cacheKey = `suggestions:${q.toLowerCase()}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const suggestions = [];

    // Search events
    const eventSuggestions = await Event.find({
      $or: [
        { title: new RegExp(q, 'i') },
        { 'artists.name': new RegExp(q, 'i') }
      ],
      status: 'published',
      startDate: { $gte: new Date() }
    })
    .select('title slug')
    .limit(Math.ceil(limit / 3))
    .lean();

    suggestions.push(...eventSuggestions.map(e => ({
      type: 'event',
      text: e.title,
      slug: e.slug
    })));

    // Search venues
    const venueSuggestions = await Venue.find({
      name: new RegExp(q, 'i'),
      isActive: true
    })
    .select('name slug')
    .limit(Math.ceil(limit / 3))
    .lean();

    suggestions.push(...venueSuggestions.map(v => ({
      type: 'venue',
      text: v.name,
      slug: v.slug
    })));

    // Search categories
    const categorySuggestions = await Category.find({
      name: new RegExp(q, 'i'),
      isActive: true
    })
    .select('name slug')
    .limit(Math.ceil(limit / 3))
    .lean();

    suggestions.push(...categorySuggestions.map(c => ({
      type: 'category',
      text: c.name,
      slug: c.slug
    })));

    // Get popular search terms
    const popularSearches = await SearchHistory.aggregate([
      {
        $match: {
          query: new RegExp(q, 'i'),
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: '$query',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);

    suggestions.push(...popularSearches.map(s => ({
      type: 'search',
      text: s._id,
      count: s.count
    })));

    const response = {
      success: true,
      data: suggestions.slice(0, limit),
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    };

    // Cache for 1 hour
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    logger.error('Get search suggestions failed', {
      error: error.message,
      query: req.query.q,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get trending searches
 * @route   GET /api/events/search/trending
 * @access  Public
 * @returns {Object} Trending search terms
 */
exports.getTrendingSearches = async (req, res, next) => {
  try {
    const { limit = 10, timeframe = '24h' } = req.query;

    const cacheKey = `trending:${timeframe}:${limit}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Calculate time range
    const timeRanges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };

    const since = new Date(Date.now() - (timeRanges[timeframe] || timeRanges['24h']));

    // Get trending searches
    const trending = await SearchHistory.aggregate([
      {
        $match: {
          createdAt: { $gte: since }
        }
      },
      {
        $group: {
          _id: '$query',
          count: { $sum: 1 },
          recentCount: {
            $sum: {
              $cond: [
                { $gte: ['$createdAt', new Date(Date.now() - timeRanges['1h'])] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          query: '$_id',
          count: 1,
          trendScore: {
            $multiply: [
              '$count',
              { $add: [1, { $multiply: ['$recentCount', 0.5] }] }
            ]
          }
        }
      },
      {
        $sort: { trendScore: -1 }
      },
      {
        $limit: parseInt(limit)
      }
    ]);

    const response = {
      success: true,
      data: trending,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId,
        timeframe
      }
    };

    // Cache for 15 minutes
    await redisClient.setEx(cacheKey, 900, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    logger.error('Get trending searches failed', {
      error: error.message,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Save a search for alerts
 * @route   POST /api/events/search/save
 * @access  Private
 * @returns {Object} Saved search data
 */
exports.saveSearch = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const {
      name,
      query,
      filters,
      alertFrequency = 'daily'
    } = req.body;

    // Check for existing saved search
    const existingSearch = await SavedSearch.findOne({
      user: req.user.id,
      name
    });

    if (existingSearch) {
      return next(new AppError('A saved search with this name already exists', 400));
    }

    // Validate alert frequency
    const validFrequencies = ['instant', 'daily', 'weekly', 'never'];
    if (!validFrequencies.includes(alertFrequency)) {
      return next(new AppError('Invalid alert frequency', 400));
    }

    // Create saved search
    const savedSearch = await SavedSearch.create({
      user: req.user.id,
      name,
      query,
      filters: filters || {},
      alertFrequency,
      lastAlertSent: alertFrequency === 'never' ? new Date() : null,
      isActive: true
    });

    logger.info('Search saved', {
      savedSearchId: savedSearch._id,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.status(201).json({
      success: true,
      data: savedSearch,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Save search failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get user's saved searches
 * @route   GET /api/events/search/saved
 * @access  Private
 * @returns {Object} List of saved searches
 */
exports.getSavedSearches = async (req, res, next) => {
  try {
    const savedSearches = await SavedSearch.find({
      user: req.user.id,
      isActive: true
    })
    .sort('-createdAt')
    .lean();

    // Get match counts for each search
    const searchesWithCounts = await Promise.all(
      savedSearches.map(async (search) => {
        const count = await Event.countDocuments({
          ...buildSearchQuery(search.query, search.filters),
          status: 'published',
          startDate: { $gte: new Date() }
        });

        return {
          ...search,
          currentMatches: count
        };
      })
    );

    res.json({
      success: true,
      data: searchesWithCounts,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Get saved searches failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Delete a saved search
 * @route   DELETE /api/events/search/saved/:id
 * @access  Private
 * @returns {Object} Success message
 */
exports.deleteSavedSearch = async (req, res, next) => {
  try {
    const savedSearch = await SavedSearch.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!savedSearch) {
      return next(new AppError('Saved search not found', 404));
    }

    savedSearch.isActive = false;
    await savedSearch.save();

    logger.info('Saved search deleted', {
      savedSearchId: savedSearch._id,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      message: 'Saved search deleted successfully',
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Delete saved search failed', {
      error: error.message,
      savedSearchId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get search history for user
 * @route   GET /api/events/search/history
 * @access  Private
 * @returns {Object} Search history
 */
exports.getSearchHistory = async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;

    const history = await SearchHistory.find({
      user: req.user.id
    })
    .sort('-createdAt')
    .limit(parseInt(limit))
    .lean();

    // Group by unique queries
    const uniqueHistory = [];
    const seen = new Set();

    for (const item of history) {
      const key = JSON.stringify({ query: item.query, filters: item.filters });
      if (!seen.has(key)) {
        seen.add(key);
        uniqueHistory.push(item);
      }
    }

    res.json({
      success: true,
      data: uniqueHistory,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Get search history failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Clear search history
 * @route   DELETE /api/events/search/history
 * @access  Private
 * @returns {Object} Success message
 */
exports.clearSearchHistory = async (req, res, next) => {
  try {
    await SearchHistory.deleteMany({ user: req.user.id });

    logger.info('Search history cleared', {
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      message: 'Search history cleared successfully',
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Clear search history failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

// Helper functions

/**
 * Search using MongoDB (fallback when Elasticsearch not available)
 */
async function searchWithMongoDB(params) {
  const {
    q,
    categories,
    subcategories,
    dateFrom,
    dateTo,
    priceMin,
    priceMax,
    location,
    radius,
    lat,
    lng,
    hasAvailableTickets,
    ageRestriction,
    accessibility,
    artists,
    tags,
    sortBy,
    page = 1,
    limit = 20
  } = params;

  const query = buildSearchQuery(q, params);
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build sort
  let sort = {};
  switch (sortBy) {
    case 'date':
      sort = { startDate: 1 };
      break;
    case 'price_low':
      sort = { 'ticketTypes.price': 1 };
      break;
    case 'price_high':
      sort = { 'ticketTypes.price': -1 };
      break;
    case 'popularity':
      sort = { 'analytics.views': -1 };
      break;
    default:
      // Relevance - sort by text score if text search
      if (q) {
        sort = { score: { $meta: 'textScore' } };
      } else {
        sort = { startDate: 1 };
      }
  }

  const [results, total] = await Promise.all([
    Event.find(query)
      .select('title slug description startDate endDate venue category ticketTypes images analytics')
      .populate('venue', 'name city address')
      .populate('category', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit) + 1)
      .lean(),
    Event.countDocuments(query)
  ]);

  const hasMore = results.length > parseInt(limit);
  if (hasMore) results.pop();

  return {
    results,
    total,
    hasMore,
    query
  };
}

/**
 * Search using Elasticsearch
 */
async function searchWithElasticsearch(params) {
  const {
    q,
    categories,
    dateFrom,
    dateTo,
    priceMin,
    priceMax,
    page = 1,
    limit = 20
  } = params;

  const from = (parseInt(page) - 1) * parseInt(limit);

  const body = {
    from,
    size: parseInt(limit),
    query: {
      bool: {
        must: [],
        filter: []
      }
    }
  };

  // Text search
  if (q) {
    body.query.bool.must.push({
      multi_match: {
        query: q,
        fields: ['title^3', 'description', 'artists.name^2', 'tags'],
        type: 'best_fields'
      }
    });
  }

  // Filters
  body.query.bool.filter.push({ term: { status: 'published' } });

  if (categories) {
    const categoryList = Array.isArray(categories) ? categories : [categories];
    body.query.bool.filter.push({
      terms: { 'category.id': categoryList }
    });
  }

  if (dateFrom || dateTo) {
    const dateRange = { range: { startDate: {} } };
    if (dateFrom) dateRange.range.startDate.gte = dateFrom;
    if (dateTo) dateRange.range.startDate.lte = dateTo;
    body.query.bool.filter.push(dateRange);
  }

  if (priceMin || priceMax) {
    const priceRange = { range: { 'ticketTypes.price': {} } };
    if (priceMin) priceRange.range['ticketTypes.price'].gte = parseFloat(priceMin);
    if (priceMax) priceRange.range['ticketTypes.price'].lte = parseFloat(priceMax);
    body.query.bool.filter.push(priceRange);
  }

  try {
    const response = await esClient.search({
      index: 'events',
      body
    });

    return {
      results: response.hits.hits.map(hit => hit._source),
      total: response.hits.total.value,
      hasMore: from + response.hits.hits.length < response.hits.total.value
    };
  } catch (error) {
    logger.error('Elasticsearch query failed', { error: error.message });
    // Fallback to MongoDB
    return searchWithMongoDB(params);
  }
}

/**
 * Build MongoDB search query
 */
function buildSearchQuery(q, filters = {}) {
  const query = { status: 'published' };

  // Text search
  if (q) {
    query.$text = { $search: q };
  }

  // Categories
  if (filters.categories) {
    const categoryList = Array.isArray(filters.categories) 
      ? filters.categories 
      : filters.categories.split(',');
    query.category = { $in: categoryList };
  }

  // Date range
  if (filters.dateFrom || filters.dateTo) {
    query.startDate = {};
    if (filters.dateFrom) query.startDate.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) query.startDate.$lte = new Date(filters.dateTo);
  } else {
    // Default to future events
    query.startDate = { $gte: new Date() };
  }

  // Price range
  if (filters.priceMin || filters.priceMax) {
    query['ticketTypes.price'] = {};
    if (filters.priceMin) query['ticketTypes.price'].$gte = parseFloat(filters.priceMin);
    if (filters.priceMax) query['ticketTypes.price'].$lte = parseFloat(filters.priceMax);
  }

  // Location search
  if (filters.lat && filters.lng && filters.radius) {
    const maxDistance = parseFloat(filters.radius) * 1000; // Convert km to meters
    query['venue.address.coordinates'] = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(filters.lng), parseFloat(filters.lat)]
        },
        $maxDistance: maxDistance
      }
    };
  }

  // Available tickets
  if (filters.hasAvailableTickets === 'true') {
    query.availableCapacity = { $gt: 0 };
  }

  // Age restriction
  if (filters.ageRestriction) {
    query.ageRestriction = filters.ageRestriction;
  }

  // Accessibility
  if (filters.accessibility === 'true') {
    query['venue.accessibility.wheelchairAccessible'] = true;
  }

  // Artists
  if (filters.artists) {
    const artistList = Array.isArray(filters.artists) 
      ? filters.artists 
      : filters.artists.split(',');
    query['artists.name'] = { $in: artistList };
  }

  // Tags
  if (filters.tags) {
    const tagList = Array.isArray(filters.tags) 
      ? filters.tags 
      : filters.tags.split(',');
    query.tags = { $in: tagList };
  }

  return query;
}

/**
 * Get search filters/facets
 */
async function getSearchFilters(baseQuery) {
  const filters = await Event.aggregate([
    { $match: baseQuery },
    {
      $facet: {
        categories: [
          {
            $group: {
              _id: '$category',
              count: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'categories',
              localField: '_id',
              foreignField: '_id',
              as: 'category'
            }
          },
          {
            $unwind: '$category'
          },
          {
            $project: {
              id: '$_id',
              name: '$category.name',
              slug: '$category.slug',
              count: 1
            }
          },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ],
        priceRanges: [
          {
            $unwind: '$ticketTypes'
          },
          {
            $group: {
              _id: null,
              min: { $min: '$ticketTypes.price' },
              max: { $max: '$ticketTypes.price' }
            }
          }
        ],
        venues: [
          {
            $group: {
              _id: '$venue',
              count: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'venues',
              localField: '_id',
              foreignField: '_id',
              as: 'venue'
            }
          },
          {
            $unwind: '$venue'
          },
          {
            $project: {
              id: '$_id',
              name: '$venue.name',
              city: '$venue.address.city',
              count: 1
            }
          },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ],
        dateRanges: [
          {
            $group: {
              _id: null,
              earliest: { $min: '$startDate' },
              latest: { $max: '$startDate' }
            }
          }
        ]
      }
    }
  ]);

  return filters[0];
}

/**
 * Generate search suggestions for empty results
 */
async function generateSearchSuggestions(query) {
  const suggestions = [];

  // Suggest removing filters
  if (query.categories || query.priceMin || query.priceMax) {
    suggestions.push({
      type: 'remove_filters',
      text: 'Try removing some filters to see more results'
    });
  }

  // Suggest alternative dates
  if (query.dateFrom || query.dateTo) {
    suggestions.push({
      type: 'expand_dates',
      text: 'Try searching for a wider date range'
    });
  }

  // Suggest popular events in the area
  if (query.lat && query.lng) {
    const popularNearby = await Event.findOne({
      status: 'published',
      startDate: { $gte: new Date() }
    })
    .sort('-analytics.views')
    .select('title slug')
    .lean();

    if (popularNearby) {
      suggestions.push({
        type: 'popular_nearby',
        text: `Check out "${popularNearby.title}"`,
        slug: popularNearby.slug
      });
    }
  }

  return suggestions;
}

/**
 * Track search for analytics
 */
async function trackSearch(userId, searchParams) {
  try {
    await SearchHistory.create({
      user: userId,
      query: searchParams.q || '',
      filters: {
        categories: searchParams.categories,
        priceRange: {
          min: searchParams.priceMin,
          max: searchParams.priceMax
        },
        dateRange: {
          from: searchParams.dateFrom,
          to: searchParams.dateTo
        },
        location: searchParams.location
      },
      resultsCount: searchParams.resultsCount || 0
    });
  } catch (error) {
    logger.error('Failed to track search', { error: error.message });
  }
}

// Search History Schema (for reference)
const searchHistorySchema = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  query: String,
  filters: {
    categories: [String],
    priceRange: {
      min: Number,
      max: Number
    },
    dateRange: {
      from: Date,
      to: Date
    },
    location: String
  },
  resultsCount: Number,
  createdAt: { type: Date, default: Date.now }
};

// Saved Search Schema (for reference)
const savedSearchSchema = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  query: String,
  filters: Object,
  alertFrequency: { type: String, enum: ['instant', 'daily', 'weekly', 'never'] },
  lastAlertSent: Date,
  isActive: { type: Boolean, default: true }
};

// Unit test examples
/**
 * Example unit tests:
 * 
 * describe('SearchController', () => {
 *   describe('searchEvents', () => {
 *     it('should return filtered results', async () => {
 *       const req = mockRequest({
 *         query: {
 *           q: 'music',
 *           categories: 'concerts',
 *           priceMax: '100'
 *         }
 *       });
 *       
 *       await searchController.searchEvents(req, res, next);
 *       
 *       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
 *         data: expect.arrayContaining([
 *           expect.objectContaining({
 *             category: expect.objectContaining({ slug: 'concerts' })
 *           })
 *         ])
 *       }));
 *     });
 *     
 *     it('should provide suggestions for empty results', async () => {
 *       const req = mockRequest({
 *         query: {
 *           q: 'nonexistent',
 *           priceMin: '1000'
 *         }
 *       });
 *       
 *       await searchController.searchEvents(req, res, next);
 *       
 *       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
 *         suggestions: expect.arrayContaining([
 *           expect.objectContaining({
 *             type: 'remove_filters'
 *           })
 *         ])
 *       }));
 *     });
 *   });
 * });
 */

module.exports = exports;
