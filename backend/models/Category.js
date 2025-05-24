const mongoose = require('mongoose');
const { Schema } = mongoose;

// Translation schema for multilingual support
const translationSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Translated name is required'],
    trim: true,
    maxlength: [100, 'Translated name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Translated description cannot exceed 1000 characters']
  },
  metaTitle: {
    type: String,
    trim: true,
    maxlength: [60, 'Meta title cannot exceed 60 characters']
  },
  metaDescription: {
    type: String,
    trim: true,
    maxlength: [160, 'Meta description cannot exceed 160 characters']
  },
  keywords: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [50, 'Keyword cannot exceed 50 characters']
  }]
}, {
  _id: false,
  timestamps: false
});

// Analytics tracking schema
const analyticsSchema = new Schema({
  eventCount: {
    total: {
      type: Number,
      default: 0,
      min: 0
    },
    active: {
      type: Number,
      default: 0,
      min: 0
    },
    completed: {
      type: Number,
      default: 0,
      min: 0
    },
    upcoming: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  popularityScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    index: true
  },
  trendingScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    index: true
  },
  searchCount: {
    type: Number,
    default: 0,
    min: 0
  },
  clickCount: {
    type: Number,
    default: 0,
    min: 0
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  monthlyMetrics: [{
    month: {
      type: Number,
      min: 1,
      max: 12,
      required: true
    },
    year: {
      type: Number,
      required: true
    },
    eventCount: {
      type: Number,
      default: 0,
      min: 0
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0
    },
    attendance: {
      type: Number,
      default: 0,
      min: 0
    },
    searchVolume: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  topVenues: [{
    venueId: {
      type: Schema.Types.ObjectId,
      ref: 'Venue',
      required: true
    },
    eventCount: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  topArtists: [{
    artistId: {
      type: Schema.Types.ObjectId,
      ref: 'Artist',
      required: true
    },
    eventCount: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  averageTicketPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  averageAttendance: {
    type: Number,
    default: 0,
    min: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false,
  timestamps: false
});

// Main category schema
const categorySchema = new Schema({
  // Basic category information
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    maxlength: [100, 'Category name cannot exceed 100 characters'],
    index: true
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  slug: {
    type: String,
    required: [true, 'Category slug is required'],
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: [100, 'Slug cannot exceed 100 characters'],
    validate: {
      validator: function(value) {
        // Slug should only contain letters, numbers, and hyphens
        return /^[a-z0-9-]+$/.test(value);
      },
      message: 'Slug can only contain lowercase letters, numbers, and hyphens'
    },
    index: true
  },
  
  icon: {
    type: String,
    trim: true,
    maxlength: [50, 'Icon name cannot exceed 50 characters'],
    validate: {
      validator: function(value) {
        if (!value) return true;
        // Validate common icon naming patterns
        return /^[a-z0-9-_]+$/i.test(value);
      },
      message: 'Icon name should only contain letters, numbers, hyphens, and underscores'
    }
  },
  
  // Hierarchical structure
  parentCategory: {
    type: Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true,
    validate: {
      validator: async function(value) {
        if (!value) return true;
        
        // Prevent self-reference
        if (value.toString() === this._id?.toString()) {
          return false;
        }
        
        // Check for circular reference
        return await this.constructor.checkCircularReference(value, this._id);
      },
      message: 'Circular reference detected in category hierarchy'
    }
  },
  
  level: {
    type: Number,
    default: 0,
    min: 0,
    max: 5, // Limit hierarchy depth
    index: true
  },
  
  path: {
    type: String,
    index: true,
    default: ''
  },
  
  // Visual and display properties
  color: {
    type: String,
    trim: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        // Validate hex color format
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value);
      },
      message: 'Color must be a valid hex color code'
    },
    default: '#6B7280'
  },
  
  image: {
    url: {
      type: String,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)$/i.test(value);
        },
        message: 'Image URL must be a valid HTTP/HTTPS URL ending in jpg, jpeg, png, gif, webp, or svg'
      }
    },
    alt: {
      type: String,
      trim: true,
      maxlength: [200, 'Image alt text cannot exceed 200 characters']
    },
    caption: {
      type: String,
      trim: true,
      maxlength: [300, 'Image caption cannot exceed 300 characters']
    }
  },
  
  // Category status and ordering
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  sortOrder: {
    type: Number,
    default: 0,
    index: true
  },
  
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  
  isPromoted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Analytics and metrics
  analytics: analyticsSchema,
  
  // SEO optimization
  seo: {
    metaTitle: {
      type: String,
      trim: true,
      maxlength: [60, 'Meta title cannot exceed 60 characters']
    },
    metaDescription: {
      type: String,
      trim: true,
      maxlength: [160, 'Meta description cannot exceed 160 characters']
    },
    keywords: [{
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [50, 'Keyword cannot exceed 50 characters']
    }],
    canonicalUrl: {
      type: String,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^https?:\/\/.+/.test(value);
        },
        message: 'Canonical URL must be a valid HTTP/HTTPS URL'
      }
    },
    noIndex: {
      type: Boolean,
      default: false
    },
    noFollow: {
      type: Boolean,
      default: false
    },
    structuredData: {
      type: Schema.Types.Mixed,
      default: null
    }
  },
  
  // Localization support
  translations: {
    type: Map,
    of: translationSchema,
    default: new Map()
  },
  
  defaultLanguage: {
    type: String,
    default: 'en',
    enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'ru'],
    index: true
  },
  
  // Category rules and restrictions
  rules: {
    minTicketPrice: {
      type: Number,
      min: 0,
      default: 0
    },
    maxTicketPrice: {
      type: Number,
      min: 0
    },
    allowedVenueTypes: [{
      type: String,
      enum: ['concert_hall', 'stadium', 'arena', 'theater', 'club', 'outdoor', 'conference_center', 'hotel', 'restaurant', 'bar', 'gallery', 'other']
    }],
    requiresApproval: {
      type: Boolean,
      default: false
    },
    ageRestriction: {
      type: String,
      enum: ['all_ages', '13+', '16+', '18+', '21+'],
      default: 'all_ages'
    },
    maxCapacity: {
      type: Number,
      min: 1
    },
    minDuration: {
      type: Number, // in minutes
      min: 1
    },
    maxDuration: {
      type: Number, // in minutes
      min: 1
    }
  },
  
  // Category tags and associations
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  
  relatedCategories: [{
    type: Schema.Types.ObjectId,
    ref: 'Category'
  }],
  
  // Admin and management
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },
  
  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  deletedAt: {
    type: Date
  },
  
  deletedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance optimization
categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ parentCategory: 1, sortOrder: 1 });
categorySchema.index({ level: 1, sortOrder: 1 });
categorySchema.index({ isActive: 1, isFeatured: 1 });
categorySchema.index({ 'analytics.popularityScore': -1 });
categorySchema.index({ 'analytics.trendingScore': -1 });
categorySchema.index({ path: 1 });
categorySchema.index({ tags: 1 });
categorySchema.index({ createdAt: -1 });

// Text index for search
categorySchema.index({ 
  name: 'text', 
  description: 'text', 
  tags: 'text',
  'seo.keywords': 'text'
});

// Compound indexes
categorySchema.index({ 
  isActive: 1, 
  level: 1, 
  sortOrder: 1 
});

categorySchema.index({
  parentCategory: 1,
  isActive: 1,
  sortOrder: 1
});

// Virtual fields
categorySchema.virtual('fullPath').get(function() {
  if (this.path) {
    return this.path + '/' + this.slug;
  }
  return this.slug;
});

categorySchema.virtual('breadcrumb').get(function() {
  if (!this.path) return [this.name];
  
  const pathParts = this.path.split('/').filter(Boolean);
  return [...pathParts, this.name];
});

categorySchema.virtual('hasChildren').get(function() {
  return this.subCategories && this.subCategories.length > 0;
});

categorySchema.virtual('totalEventCount').get(function() {
  return this.analytics.eventCount.total || 0;
});

// Populate virtual references
categorySchema.virtual('subCategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentCategory'
});

categorySchema.virtual('events', {
  ref: 'Event',
  localField: '_id',
  foreignField: 'categoryId'
});

// Pre-save hooks
categorySchema.pre('save', async function(next) {
  try {
    // Generate slug if not provided
    if (!this.slug && this.name) {
      this.slug = await this.generateSlug(this.name);
    }
    
    // Update hierarchy path and level
    await this.updateHierarchy();
    
    // Set default SEO fields if not provided
    this.setDefaultSEO();
    
    // Validate hierarchy
    await this.validateHierarchy();
    
    // Process tags
    this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase()))];
    
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-remove hook to handle cascade deletion
categorySchema.pre('remove', async function(next) {
  try {
    // Move child categories to parent or root
    await this.handleChildrenOnDelete();
    
    // Update event categories
    await this.updateEventCategories();
    
    next();
  } catch (error) {
    next(error);
  }
});

// Static methods
categorySchema.statics.checkCircularReference = async function(parentId, childId) {
  if (!parentId || !childId) return true;
  
  let currentCategory = await this.findById(parentId);
  const visited = new Set();
  
  while (currentCategory && currentCategory.parentCategory) {
    if (visited.has(currentCategory._id.toString())) {
      return false; // Circular reference detected
    }
    
    if (currentCategory._id.toString() === childId.toString()) {
      return false; // Would create circular reference
    }
    
    visited.add(currentCategory._id.toString());
    currentCategory = await this.findById(currentCategory.parentCategory);
  }
  
  return true;
};

categorySchema.statics.getRootCategories = function(filters = {}) {
  const query = {
    parentCategory: null,
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('subCategories')
    .sort({ sortOrder: 1, name: 1 });
};

categorySchema.statics.getCategoryTree = async function(language = 'en', maxDepth = 3) {
  const rootCategories = await this.getRootCategories();
  
  const buildTree = async (categories, currentDepth = 0) => {
    if (currentDepth >= maxDepth) return categories;
    
    const categoriesWithChildren = await Promise.all(
      categories.map(async (category) => {
        const categoryObj = category.toObject();
        
        // Add localized content
        if (category.translations.has(language)) {
          const translation = category.translations.get(language);
          categoryObj.localizedName = translation.name;
          categoryObj.localizedDescription = translation.description;
        }
        
        // Get children
        const children = await this.find({
          parentCategory: category._id,
          isActive: true,
          isDeleted: false
        }).sort({ sortOrder: 1, name: 1 });
        
        if (children.length > 0) {
          categoryObj.children = await buildTree(children, currentDepth + 1);
        }
        
        return categoryObj;
      })
    );
    
    return categoriesWithChildren;
  };
  
  return buildTree(rootCategories);
};

categorySchema.statics.searchCategories = function(searchTerm, language = 'en', filters = {}) {
  const searchQuery = {
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { tags: { $regex: searchTerm, $options: 'i' } },
      { 'seo.keywords': { $regex: searchTerm, $options: 'i' } }
    ],
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .sort({ 'analytics.popularityScore': -1, 'analytics.eventCount.total': -1 });
};

categorySchema.statics.getTrendingCategories = function(limit = 10, filters = {}) {
  const query = {
    'analytics.trendingScore': { $gt: 0 },
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ 'analytics.trendingScore': -1 })
    .limit(limit);
};

categorySchema.statics.getPopularCategories = function(limit = 10, filters = {}) {
  const query = {
    'analytics.popularityScore': { $gt: 0 },
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ 'analytics.popularityScore': -1, 'analytics.eventCount.total': -1 })
    .limit(limit);
};

categorySchema.statics.getCategoryStats = async function(timeframe = '30d') {
  const timeframeDays = parseInt(timeframe.replace('d', ''));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframeDays);
  
  const pipeline = [
    {
      $match: {
        isDeleted: false,
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalCategories: { $sum: 1 },
        activeCategories: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
        },
        rootCategories: {
          $sum: { $cond: [{ $eq: ['$parentCategory', null] }, 1, 0] }
        },
        averageEventCount: { $avg: '$analytics.eventCount.total' },
        totalEvents: { $sum: '$analytics.eventCount.total' },
        averagePopularityScore: { $avg: '$analytics.popularityScore' },
        categoriesByLevel: {
          $push: {
            level: '$level',
            count: 1
          }
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalCategories: 0,
    activeCategories: 0,
    rootCategories: 0,
    averageEventCount: 0,
    totalEvents: 0,
    averagePopularityScore: 0,
    categoriesByLevel: []
  };
};

// Instance methods
categorySchema.methods.generateSlug = async function(name) {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim('-');
  
  let slug = baseSlug;
  let counter = 1;
  
  while (await this.constructor.findOne({ slug, _id: { $ne: this._id } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  return slug;
};

categorySchema.methods.updateHierarchy = async function() {
  if (this.parentCategory) {
    const parent = await this.constructor.findById(this.parentCategory);
    if (parent) {
      this.level = parent.level + 1;
      this.path = parent.path ? `${parent.path}/${parent.slug}` : parent.slug;
    }
  } else {
    this.level = 0;
    this.path = '';
  }
};

categorySchema.methods.validateHierarchy = async function() {
  // Check maximum depth
  if (this.level > 5) {
    throw new Error('Category hierarchy cannot exceed 5 levels');
  }
  
  // Validate parent exists and is active
  if (this.parentCategory) {
    const parent = await this.constructor.findById(this.parentCategory);
    if (!parent || !parent.isActive || parent.isDeleted) {
      throw new Error('Parent category must be active and not deleted');
    }
  }
};

categorySchema.methods.setDefaultSEO = function() {
  if (!this.seo.metaTitle) {
    this.seo.metaTitle = this.name;
  }
  
  if (!this.seo.metaDescription && this.description) {
    this.seo.metaDescription = this.description.substring(0, 160);
  }
  
  if (!this.seo.keywords || this.seo.keywords.length === 0) {
    this.seo.keywords = [this.slug, ...this.tags.slice(0, 5)];
  }
};

categorySchema.methods.getEventCount = async function(filters = {}) {
  const Event = mongoose.model('Event');
  
  const query = {
    categoryId: this._id,
    isDeleted: false,
    ...filters
  };
  
  const counts = await Event.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const result = {
    total: 0,
    active: 0,
    completed: 0,
    upcoming: 0,
    cancelled: 0
  };
  
  counts.forEach(item => {
    result.total += item.count;
    if (item._id) {
      result[item._id] = item.count;
    }
  });
  
  return result;
};

categorySchema.methods.getPopularEvents = async function(limit = 10, filters = {}) {
  const Event = mongoose.model('Event');
  
  const query = {
    categoryId: this._id,
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return Event.find(query)
    .populate('venueId', 'name city state')
    .populate('organizerId', 'username displayName')
    .sort({ 'analytics.totalAttendees': -1, 'analytics.revenue': -1 })
    .limit(limit);
};

categorySchema.methods.updateAnalytics = async function() {
  const eventCounts = await this.getEventCount();
  
  // Update event counts
  this.analytics.eventCount = eventCounts;
  
  // Calculate popularity score (based on events, views, clicks)
  const eventWeight = 0.4;
  const viewWeight = 0.3;
  const clickWeight = 0.3;
  
  const normalizedEvents = Math.min(this.analytics.eventCount.total / 100, 1);
  const normalizedViews = Math.min(this.analytics.viewCount / 1000, 1);
  const normalizedClicks = Math.min(this.analytics.clickCount / 500, 1);
  
  this.analytics.popularityScore = Math.round(
    (normalizedEvents * eventWeight + 
     normalizedViews * viewWeight + 
     normalizedClicks * clickWeight) * 100
  );
  
  // Calculate trending score (based on recent activity)
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  
  const recentMetric = this.analytics.monthlyMetrics.find(m => 
    m.year === lastMonth.getFullYear() && m.month === lastMonth.getMonth() + 1
  );
  
  if (recentMetric) {
    const recentEventGrowth = recentMetric.eventCount / Math.max(this.analytics.eventCount.total, 1);
    const recentSearchGrowth = recentMetric.searchVolume / Math.max(this.analytics.searchCount, 1);
    
    this.analytics.trendingScore = Math.min(
      Math.round((recentEventGrowth + recentSearchGrowth) * 50), 
      100
    );
  }
  
  this.analytics.lastUpdated = new Date();
  await this.save();
};

categorySchema.methods.addTranslation = function(language, translation) {
  this.translations.set(language, translation);
  return this.save();
};

categorySchema.methods.getTranslation = function(language) {
  return this.translations.get(language) || {
    name: this.name,
    description: this.description,
    metaTitle: this.seo.metaTitle,
    metaDescription: this.seo.metaDescription,
    keywords: this.seo.keywords
  };
};

categorySchema.methods.incrementView = async function() {
  this.analytics.viewCount += 1;
  await this.save();
};

categorySchema.methods.incrementClick = async function() {
  this.analytics.clickCount += 1;
  await this.save();
};

categorySchema.methods.incrementSearch = async function() {
  this.analytics.searchCount += 1;
  await this.save();
};

categorySchema.methods.handleChildrenOnDelete = async function() {
  // Move children to parent or make them root categories
  await this.constructor.updateMany(
    { parentCategory: this._id },
    { 
      parentCategory: this.parentCategory || null,
      $inc: { level: this.parentCategory ? 0 : -this.level }
    }
  );
};

categorySchema.methods.updateEventCategories = async function() {
  // Update events to use parent category or remove category
  const Event = mongoose.model('Event');
  await Event.updateMany(
    { categoryId: this._id },
    { categoryId: this.parentCategory || null }
  );
};

categorySchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.isActive = false;
  await this.save();
  
  // Handle children and events
  await this.handleChildrenOnDelete();
  await this.updateEventCategories();
};

categorySchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.isActive = true;
  await this.save();
};

// Query helpers
categorySchema.query.active = function() {
  return this.where({ isActive: true, isDeleted: false });
};

categorySchema.query.roots = function() {
  return this.where({ parentCategory: null });
};

categorySchema.query.featured = function() {
  return this.where({ isFeatured: true });
};

categorySchema.query.byLevel = function(level) {
  return this.where({ level: level });
};

categorySchema.query.trending = function() {
  return this.where({ 'analytics.trendingScore': { $gt: 50 } })
    .sort({ 'analytics.trendingScore': -1 });
};

categorySchema.query.popular = function() {
  return this.where({ 'analytics.popularityScore': { $gt: 50 } })
    .sort({ 'analytics.popularityScore': -1 });
};

module.exports = mongoose.model('Category', categorySchema);
