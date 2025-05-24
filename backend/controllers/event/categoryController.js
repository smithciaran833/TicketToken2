// ==========================================
// FILE: backend/controllers/event/categoryController.js
// ==========================================

const Event = require('../../models/Event');
const Category = require('../../models/Category');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { validationResult } = require('express-validator');
const slugify = require('slugify');
const redis = require('redis');

// Redis client setup
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

/**
 * @desc    Get all categories with hierarchy
 * @route   GET /api/events/categories
 * @access  Public
 * @returns {Object} Categories list with hierarchy
 */
exports.getCategories = async (req, res, next) => {
  try {
    const { 
      includeCount = 'true',
      onlyActive = 'true',
      parentId = null 
    } = req.query;

    // Build cache key
    const cacheKey = `categories:${JSON.stringify(req.query)}`;
    
    // Check cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Build query
    const query = {};
    if (onlyActive === 'true') {
      query.isActive = true;
    }
    if (parentId) {
      query.parent = parentId;
    } else if (parentId === null) {
      query.parent = null; // Get only root categories
    }

    // Fetch categories
    let categories = await Category.find(query)
      .populate('parent', 'name slug')
      .sort('order name')
      .lean();

    // Include event count if requested
    if (includeCount === 'true') {
      const categoriesWithCount = await Promise.all(
        categories.map(async (category) => {
          // Count events in this category and all subcategories
          const categoryIds = await getAllSubcategoryIds(category._id);
          categoryIds.push(category._id);
          
          const eventCount = await Event.countDocuments({
            category: { $in: categoryIds },
            status: 'published'
          });

          return {
            ...category,
            eventCount
          };
        })
      );
      categories = categoriesWithCount;
    }

    // Build hierarchy if getting root categories
    if (parentId === null) {
      categories = await buildCategoryHierarchy(categories);
    }

    const response = {
      success: true,
      data: categories,
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
    logger.error('Get categories failed', {
      error: error.message,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get single category with subcategories
 * @route   GET /api/events/categories/:identifier
 * @access  Public
 * @returns {Object} Category details with subcategories
 */
exports.getCategory = async (req, res, next) => {
  try {
    const { identifier } = req.params;
    
    // Check cache
    const cacheKey = `category:${identifier}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Find by ID or slug
    const query = identifier.match(/^[0-9a-fA-F]{24}$/) 
      ? { _id: identifier }
      : { slug: identifier };

    const category = await Category.findOne(query)
      .populate('parent', 'name slug')
      .lean();

    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    // Get subcategories
    const subcategories = await Category.find({ parent: category._id })
      .select('name slug description image')
      .sort('order name')
      .lean();

    // Get event count
    const categoryIds = await getAllSubcategoryIds(category._id);
    categoryIds.push(category._id);
    
    const eventCount = await Event.countDocuments({
      category: { $in: categoryIds },
      status: 'published'
    });

    // Get popular events in this category
    const popularEvents = await Event.find({
      category: { $in: categoryIds },
      status: 'published',
      startDate: { $gte: new Date() }
    })
    .select('title slug startDate venue ticketTypes images')
    .populate('venue', 'name city')
    .sort('-analytics.views')
    .limit(5)
    .lean();

    const response = {
      success: true,
      data: {
        ...category,
        subcategories,
        eventCount,
        popularEvents
      },
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
    logger.error('Get category failed', {
      error: error.message,
      identifier: req.params.identifier,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Create a new category
 * @route   POST /api/events/categories
 * @access  Private/Admin
 * @returns {Object} Created category
 */
exports.createCategory = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const {
      name,
      description,
      parent,
      image,
      icon,
      color,
      order,
      seoTitle,
      seoDescription,
      seoKeywords
    } = req.body;

    // Validate parent category if provided
    if (parent) {
      const parentCategory = await Category.findById(parent);
      if (!parentCategory) {
        return next(new AppError('Parent category not found', 404));
      }

      // Prevent deep nesting (max 2 levels)
      if (parentCategory.parent) {
        return next(new AppError('Categories can only be nested up to 2 levels', 400));
      }
    }

    // Generate unique slug
    let slug = slugify(name, { lower: true, strict: true });
    let slugExists = await Category.findOne({ slug });
    let counter = 1;
    
    while (slugExists) {
      slug = `${slugify(name, { lower: true, strict: true })}-${counter}`;
      slugExists = await Category.findOne({ slug });
      counter++;
    }

    // Create category
    const category = await Category.create({
      name,
      slug,
      description,
      parent,
      image,
      icon,
      color: color || '#000000',
      order: order || 0,
      seo: {
        title: seoTitle || name,
        description: seoDescription || description,
        keywords: seoKeywords || []
      },
      isActive: true,
      createdBy: req.user.id
    });

    // Clear cache
    await redisClient.del('categories:*');

    logger.info('Category created', {
      categoryId: category._id,
      name: category.name,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.status(201).json({
      success: true,
      data: category,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Category creation failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Update a category
 * @route   PUT /api/events/categories/:id
 * @access  Private/Admin
 * @returns {Object} Updated category
 */
exports.updateCategory = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const category = await Category.findById(req.params.id);

    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    const allowedUpdates = [
      'name', 'description', 'parent', 'image', 'icon',
      'color', 'order', 'isActive', 'seo'
    ];

    // If changing parent, validate it
    if (req.body.parent !== undefined) {
      if (req.body.parent) {
        const parentCategory = await Category.findById(req.body.parent);
        if (!parentCategory) {
          return next(new AppError('Parent category not found', 404));
        }

        // Prevent deep nesting
        if (parentCategory.parent) {
          return next(new AppError('Categories can only be nested up to 2 levels', 400));
        }

        // Prevent circular reference
        if (req.body.parent === req.params.id) {
          return next(new AppError('Category cannot be its own parent', 400));
        }

        // Check if any child would create deep nesting
        const children = await Category.find({ parent: req.params.id });
        if (children.length > 0) {
          return next(new AppError('Cannot assign parent to category with children', 400));
        }
      }
    }

    // If changing name, update slug
    if (req.body.name && req.body.name !== category.name) {
      req.body.slug = slugify(req.body.name, { lower: true, strict: true });
      
      // Ensure unique slug
      const slugExists = await Category.findOne({
        slug: req.body.slug,
        _id: { $ne: req.params.id }
      });
      
      if (slugExists) {
        let counter = 1;
        while (await Category.findOne({ slug: `${req.body.slug}-${counter}` })) {
          counter++;
        }
        req.body.slug = `${req.body.slug}-${counter}`;
      }
    }

    // Apply updates
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        category[key] = req.body[key];
      }
    });

    category.updatedBy = req.user.id;
    await category.save();

    // Clear cache
    await redisClient.del(`category:${category._id}`);
    await redisClient.del(`category:${category.slug}`);
    await redisClient.del('categories:*');

    logger.info('Category updated', {
      categoryId: category._id,
      updates: Object.keys(req.body),
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      data: category,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Category update failed', {
      error: error.message,
      categoryId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Delete a category
 * @route   DELETE /api/events/categories/:id
 * @access  Private/Admin
 * @returns {Object} Success message
 */
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    // Check if category has events
    const eventCount = await Event.countDocuments({ category: req.params.id });
    if (eventCount > 0) {
      return next(new AppError(`Cannot delete category with ${eventCount} events`, 400));
    }

    // Check if category has subcategories
    const subcategoryCount = await Category.countDocuments({ parent: req.params.id });
    if (subcategoryCount > 0) {
      return next(new AppError(`Cannot delete category with ${subcategoryCount} subcategories`, 400));
    }

    // Soft delete
    category.isActive = false;
    category.deletedBy = req.user.id;
    category.deletedAt = new Date();
    await category.save();

    // Clear cache
    await redisClient.del(`category:${category._id}`);
    await redisClient.del(`category:${category.slug}`);
    await redisClient.del('categories:*');

    logger.info('Category deleted', {
      categoryId: category._id,
      name: category.name,
      userId: req.user.id,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      message: 'Category deleted successfully',
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Category deletion failed', {
      error: error.message,
      categoryId: req.params.id,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get popular categories
 * @route   GET /api/events/categories/popular
 * @access  Public
 * @returns {Object} Popular categories list
 */
exports.getPopularCategories = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    // Check cache
    const cacheKey = `categories:popular:${limit}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Aggregate events by category
    const popularCategories = await Event.aggregate([
      {
        $match: {
          status: 'published',
          startDate: { $gte: new Date() }
        }
      },
      {
        $group: {
          _id: '$category',
          eventCount: { $sum: 1 },
          totalViews: { $sum: '$analytics.views' },
          totalTicketsSold: { $sum: { $sum: '$ticketTypes.sold' } }
        }
      },
      {
        $sort: { eventCount: -1, totalViews: -1 }
      },
      {
        $limit: parseInt(limit)
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
          _id: '$category._id',
          name: '$category.name',
          slug: '$category.slug',
          description: '$category.description',
          image: '$category.image',
          icon: '$category.icon',
          color: '$category.color',
          eventCount: 1,
          totalViews: 1,
          totalTicketsSold: 1
        }
      }
    ]);

    const response = {
      success: true,
      data: popularCategories,
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
    logger.error('Get popular categories failed', {
      error: error.message,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get category suggestions based on user behavior
 * @route   GET /api/events/categories/suggestions
 * @access  Private
 * @returns {Object} Suggested categories
 */
exports.getCategorySuggestions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { limit = 5 } = req.query;

    // Get user's event interaction history
    const userEvents = await Event.find({
      $or: [
        { 'analytics.uniqueVisitors': userId },
        { 'attendees.user': userId }
      ]
    })
    .select('category')
    .limit(50)
    .lean();

    const userCategories = userEvents.map(e => e.category);

    // Find related categories
    const suggestions = await Category.aggregate([
      {
        $match: {
          _id: { $nin: userCategories },
          isActive: true
        }
      },
      {
        $lookup: {
          from: 'events',
          let: { categoryId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$category', '$$categoryId'] },
                    { $in: ['$category', userCategories] }
                  ]
                },
                status: 'published'
              }
            }
          ],
          as: 'relatedEvents'
        }
      },
      {
        $addFields: {
          relevanceScore: { $size: '$relatedEvents' }
        }
      },
      {
        $sort: { relevanceScore: -1, eventCount: -1 }
      },
      {
        $limit: parseInt(limit)
      },
      {
        $project: {
          name: 1,
          slug: 1,
          description: 1,
          image: 1,
          icon: 1,
          relevanceScore: 1
        }
      }
    ]);

    res.json({
      success: true,
      data: suggestions,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Get category suggestions failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

// Helper functions

/**
 * Get all subcategory IDs recursively
 * @param {ObjectId} categoryId 
 * @returns {Array} Array of subcategory IDs
 */
async function getAllSubcategoryIds(categoryId) {
  const subcategories = await Category.find({ parent: categoryId }).select('_id');
  let allIds = subcategories.map(c => c._id);
  
  for (const subcategory of subcategories) {
    const childIds = await getAllSubcategoryIds(subcategory._id);
    allIds = allIds.concat(childIds);
  }
  
  return allIds;
}

/**
 * Build hierarchical category structure
 * @param {Array} categories Flat array of categories
 * @returns {Array} Hierarchical category structure
 */
async function buildCategoryHierarchy(categories) {
  const categoryMap = {};
  const hierarchy = [];

  // Create map for easy lookup
  categories.forEach(cat => {
    categoryMap[cat._id] = { ...cat, children: [] };
  });

  // Get all subcategories
  const allSubcategories = await Category.find({
    parent: { $in: categories.map(c => c._id) },
    isActive: true
  }).lean();

  // Add subcategories to their parents
  allSubcategories.forEach(subcat => {
    if (categoryMap[subcat.parent]) {
      categoryMap[subcat.parent].children.push(subcat);
    }
  });

  // Sort children by order
  Object.values(categoryMap).forEach(cat => {
    cat.children.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  });

  return Object.values(categoryMap);
}

// Category Schema (for reference)
const categorySchema = {
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  image: { type: String },
  icon: { type: String },
  color: { type: String, default: '#000000' },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  seo: {
    title: String,
    description: String,
    keywords: [String]
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: Date
};

// Unit test examples
/**
 * Example unit tests:
 * 
 * describe('CategoryController', () => {
 *   describe('getCategories', () => {
 *     it('should return hierarchical categories', async () => {
 *       const req = mockRequest({ query: { onlyActive: 'true' } });
 *       const res = mockResponse();
 *       
 *       await categoryController.getCategories(req, res, next);
 *       
 *       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
 *         success: true,
 *         data: expect.arrayContaining([
 *           expect.objectContaining({
 *             name: expect.any(String),
 *             children: expect.any(Array)
 *           })
 *         ])
 *       }));
 *     });
 *   });
 *   
 *   describe('createCategory', () => {
 *     it('should prevent deep nesting beyond 2 levels', async () => {
 *       const grandparent = await Category.create({ name: 'Level 1' });
 *       const parent = await Category.create({ name: 'Level 2', parent: grandparent._id });
 *       
 *       const req = mockRequest({
 *         body: { name: 'Level 3', parent: parent._id }
 *       });
 *       
 *       await categoryController.createCategory(req, res, next);
 *       
 *       expect(next).toHaveBeenCalledWith(
 *         expect.objectContaining({
 *           message: 'Categories can only be nested up to 2 levels'
 *         })
 *       );
 *     });
 *   });
 * });
 */

module.exports = exports;
