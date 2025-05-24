const mongoose = require('mongoose');
const crypto = require('crypto');
const { Schema } = mongoose;

// Device information schema
const deviceInfoSchema = new Schema({
  userAgent: {
    type: String,
    trim: true
  },
  deviceType: {
    type: String,
    enum: ['mobile', 'tablet', 'desktop', 'smart_tv', 'wearable', 'unknown'],
    default: 'unknown'
  },
  deviceBrand: {
    type: String,
    trim: true
  },
  deviceModel: {
    type: String,
    trim: true
  },
  operatingSystem: {
    type: String,
    trim: true
  },
  osVersion: {
    type: String,
    trim: true
  },
  browser: {
    type: String,
    trim: true
  },
  browserVersion: {
    type: String,
    trim: true
  },
  screenResolution: {
    width: {
      type: Number,
      min: 0
    },
    height: {
      type: Number,
      min: 0
    }
  },
  language: {
    type: String,
    default: 'en'
  }
}, {
  _id: false,
  timestamps: false
});

// Location information schema
const locationSchema = new Schema({
  country: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: [2, 'Country code must be 2 characters']
  },
  countryName: {
    type: String,
    trim: true
  },
  region: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  coordinates: {
    latitude: {
      type: Number,
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90']
    },
    longitude: {
      type: Number,
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180']
    }
  },
  timezone: {
    type: String,
    default: 'UTC'
  }
}, {
  _id: false,
  timestamps: false
});

// Experiment/A-B test schema
const experimentSchema = new Schema({
  experimentId: {
    type: String,
    required: true,
    trim: true
  },
  experimentName: {
    type: String,
    required: true,
    trim: true
  },
  variantId: {
    type: String,
    required: true,
    trim: true
  },
  variantName: {
    type: String,
    trim: true
  },
  isControl: {
    type: Boolean,
    default: false
  }
}, {
  _id: false,
  timestamps: false
});

// Aggregation data schema
const aggregationDataSchema = new Schema({
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  count: {
    type: Number,
    required: true,
    min: 0,
    default: 1
  },
  sum: {
    type: Number,
    default: 0
  },
  min: {
    type: Number
  },
  max: {
    type: Number
  },
  average: {
    type: Number,
    default: 0
  },
  uniqueUsers: {
    type: Number,
    min: 0,
    default: 0
  },
  uniqueSessions: {
    type: Number,
    min: 0,
    default: 0
  }
}, {
  _id: false,
  timestamps: false
});

// Main analytics schema
const analyticsSchema = new Schema({
  // Core metrics
  eventType: {
    type: String,
    required: [true, 'Event type is required'],
    trim: true,
    enum: [
      'page_view', 'click', 'form_submit', 'purchase', 'signup', 'login', 'logout',
      'search', 'play', 'pause', 'skip', 'like', 'share', 'comment', 'follow',
      'ticket_purchase', 'event_view', 'artist_view', 'venue_view', 'nft_mint',
      'nft_transfer', 'wallet_connect', 'transaction', 'error', 'custom'
    ],
    index: true
  },
  
  metricName: {
    type: String,
    required: [true, 'Metric name is required'],
    trim: true,
    maxlength: [100, 'Metric name cannot exceed 100 characters'],
    index: true
  },
  
  value: {
    type: Schema.Types.Mixed,
    required: [true, 'Metric value is required'],
    index: true
  },
  
  dimensions: {
    type: Schema.Types.Mixed,
    default: {},
    validate: {
      validator: function(value) {
        return typeof value === 'object' && !Array.isArray(value);
      },
      message: 'Dimensions must be an object'
    }
  },
  
  // Temporal information
  timestamp: {
    type: Date,
    required: [true, 'Timestamp is required'],
    default: Date.now,
    index: true
  },
  
  aggregationPeriod: {
    type: String,
    enum: ['real_time', 'hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    default: 'real_time',
    index: true
  },
  
  timezone: {
    type: String,
    default: 'UTC',
    validate: {
      validator: function(value) {
        return /^[A-Z][a-z]+\/[A-Z][a-z_]+$/.test(value) || value === 'UTC';
      },
      message: 'Timezone must be in IANA format or UTC'
    }
  },
  
  // Context information
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  
  sessionId: {
    type: String,
    trim: true,
    index: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      },
      message: 'Session ID must be a valid UUID v4'
    }
  },
  
  deviceInfo: deviceInfoSchema,
  
  location: locationSchema,
  
  // Segmentation
  userSegment: {
    type: String,
    enum: ['new', 'active', 'returning', 'vip', 'premium', 'free', 'churned', 'unknown'],
    default: 'unknown',
    index: true
  },
  
  cohort: {
    cohortId: {
      type: String,
      trim: true,
      index: true
    },
    cohortName: {
      type: String,
      trim: true
    },
    cohortDate: {
      type: Date
    },
    cohortType: {
      type: String,
      enum: ['signup', 'first_purchase', 'feature_adoption', 'geographic', 'custom']
    }
  },
  
  experiment: experimentSchema,
  
  // Custom properties and categorization
  customProperties: {
    type: Schema.Types.Mixed,
    default: {},
    validate: {
      validator: function(value) {
        const jsonString = JSON.stringify(value);
        return jsonString.length <= 10000; // 10KB limit
      },
      message: 'Custom properties cannot exceed 10KB'
    }
  },
  
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [50, 'Tag cannot exceed 50 characters']
  }],
  
  category: {
    type: String,
    trim: true,
    enum: [
      'engagement', 'conversion', 'revenue', 'performance', 'user_behavior',
      'content', 'social', 'marketing', 'technical', 'business', 'custom'
    ],
    default: 'engagement',
    index: true
  },
  
  // Aggregation data
  hourly: [aggregationDataSchema],
  daily: [aggregationDataSchema],
  weekly: [aggregationDataSchema],
  monthly: [aggregationDataSchema],
  
  // Real-time processing
  isRealTime: {
    type: Boolean,
    default: true,
    index: true
  },
  
  processingDelay: {
    type: Number, // in milliseconds
    min: 0,
    default: 0
  },
  
  accuracy: {
    type: Number, // percentage 0-100
    min: 0,
    max: 100,
    default: 100
  },
  
  // Data quality
  isValid: {
    type: Boolean,
    default: true,
    index: true
  },
  
  validationErrors: [{
    field: String,
    error: String,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    }
  }],
  
  // Privacy and anonymization
  isAnonymized: {
    type: Boolean,
    default: false,
    index: true
  },
  
  anonymizedAt: {
    type: Date
  },
  
  // Processing metadata
  processedAt: {
    type: Date,
    default: Date.now
  },
  
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  deletedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      if (ret.isAnonymized) {
        delete ret.userId;
        if (ret.location) {
          delete ret.location.coordinates;
        }
      }
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance optimization
analyticsSchema.index({ eventType: 1, timestamp: -1 });
analyticsSchema.index({ metricName: 1, timestamp: -1 });
analyticsSchema.index({ userId: 1, timestamp: -1 });
analyticsSchema.index({ sessionId: 1, timestamp: -1 });
analyticsSchema.index({ userSegment: 1, timestamp: -1 });
analyticsSchema.index({ category: 1, timestamp: -1 });
analyticsSchema.index({ isRealTime: 1, timestamp: -1 });
analyticsSchema.index({ 'location.country': 1, timestamp: -1 });
analyticsSchema.index({ 'deviceInfo.deviceType': 1, timestamp: -1 });
analyticsSchema.index({ tags: 1 });

// Compound indexes for complex queries
analyticsSchema.index({ 
  eventType: 1, 
  userSegment: 1, 
  timestamp: -1 
});

analyticsSchema.index({
  metricName: 1,
  aggregationPeriod: 1,
  timestamp: -1
});

analyticsSchema.index({
  'experiment.experimentId': 1,
  'experiment.variantId': 1,
  timestamp: -1
});

// Virtual fields
analyticsSchema.virtual('age').get(function() {
  return Date.now() - this.timestamp;
});

analyticsSchema.virtual('dayOfWeek').get(function() {
  return this.timestamp.getDay();
});

analyticsSchema.virtual('hourOfDay').get(function() {
  return this.timestamp.getHours();
});

// Populate virtual references
analyticsSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Pre-save hooks
analyticsSchema.pre('save', async function(next) {
  try {
    this.validateAnalyticsData();
    this.enrichData();
    this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase()))];
    
    if (!this.processedAt) {
      this.processedAt = new Date();
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
analyticsSchema.methods.validateAnalyticsData = function() {
  const errors = [];
  
  if (!this.eventType) {
    errors.push({ field: 'eventType', error: 'Event type is required', severity: 'critical' });
  }
  
  if (!this.metricName) {
    errors.push({ field: 'metricName', error: 'Metric name is required', severity: 'critical' });
  }
  
  if (this.value === undefined || this.value === null) {
    errors.push({ field: 'value', error: 'Metric value is required', severity: 'critical' });
  }
  
  if (this.timestamp > new Date()) {
    errors.push({ field: 'timestamp', error: 'Timestamp cannot be in the future', severity: 'high' });
  }
  
  this.validationErrors = errors;
  this.isValid = errors.filter(e => e.severity === 'critical').length === 0;
};

analyticsSchema.methods.enrichData = function() {
  // Enrich device info if user agent is available
  if (this.deviceInfo && this.deviceInfo.userAgent && !this.deviceInfo.deviceType) {
    this.enrichDeviceInfo();
  }
  
  // Set user segment if user ID is available
  if (this.userId && this.userSegment === 'unknown') {
    this.setUserSegment();
  }
  
  // Assign to cohort if applicable
  if (this.userId && !this.cohort.cohortId) {
    this.assignCohort();
  }
};

analyticsSchema.methods.enrichDeviceInfo = function() {
  const userAgent = this.deviceInfo.userAgent.toLowerCase();
  
  if (userAgent.includes('mobile') || userAgent.includes('android') || userAgent.includes('iphone')) {
    this.deviceInfo.deviceType = 'mobile';
  } else if (userAgent.includes('tablet') || userAgent.includes('ipad')) {
    this.deviceInfo.deviceType = 'tablet';
  } else {
    this.deviceInfo.deviceType = 'desktop';
  }
  
  if (userAgent.includes('chrome')) {
    this.deviceInfo.browser = 'Chrome';
  } else if (userAgent.includes('firefox')) {
    this.deviceInfo.browser = 'Firefox';
  } else if (userAgent.includes('safari')) {
    this.deviceInfo.browser = 'Safari';
  } else if (userAgent.includes('edge')) {
    this.deviceInfo.browser = 'Edge';
  }
};

analyticsSchema.methods.setUserSegment = function() {
  // This would typically query user data to determine segment
  this.userSegment = 'active';
};

analyticsSchema.methods.assignCohort = function() {
  const cohortDate = new Date(this.timestamp);
  cohortDate.setDate(1); // First day of month
  
  this.cohort = {
    cohortId: `monthly_${cohortDate.getFullYear()}_${cohortDate.getMonth() + 1}`,
    cohortName: `Monthly Cohort ${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`,
    cohortDate: cohortDate,
    cohortType: 'signup'
  };
};

analyticsSchema.methods.aggregate = function(period = 'daily', startDate = null, endDate = null) {
  const aggregationPeriods = {
    'hourly': 60 * 60 * 1000,
    'daily': 24 * 60 * 60 * 1000,
    'weekly': 7 * 24 * 60 * 60 * 1000,
    'monthly': 30 * 24 * 60 * 60 * 1000
  };
  
  const periodMs = aggregationPeriods[period];
  if (!periodMs) {
    throw new Error(`Invalid aggregation period: ${period}`);
  }
  
  const start = startDate || new Date(this.timestamp.getTime() - periodMs);
  const end = endDate || new Date(this.timestamp.getTime() + periodMs);
  
  return this.constructor.aggregate([
    {
      $match: {
        metricName: this.metricName,
        timestamp: { $gte: start, $lte: end },
        isDeleted: false,
        isValid: true
      }
    },
    {
      $group: {
        _id: {
          period: period,
          date: {
            $dateToString: {
              format: period === 'hourly' ? '%Y-%m-%d %H' : '%Y-%m-%d',
              date: '$timestamp'
            }
          }
        },
        count: { $sum: 1 },
        sum: { $sum: { $toDouble: '$value' } },
        avg: { $avg: { $toDouble: '$value' } },
        min: { $min: { $toDouble: '$value' } },
        max: { $max: { $toDouble: '$value' } },
        uniqueUsers: { $addToSet: '$userId' },
        uniqueSessions: { $addToSet: '$sessionId' }
      }
    },
    {
      $project: {
        period: '$_id.period',
        date: '$_id.date',
        count: 1,
        sum: 1,
        avg: { $round: ['$avg', 2] },
        min: 1,
        max: 1,
        uniqueUsers: { $size: '$uniqueUsers' },
        uniqueSessions: { $size: '$uniqueSessions' }
      }
    },
    {
      $sort: { date: 1 }
    }
  ]);
};

analyticsSchema.methods.segment = function(segmentBy = 'userSegment') {
  const validSegments = ['userSegment', 'deviceInfo.deviceType', 'location.country', 'category'];
  
  if (!validSegments.includes(segmentBy)) {
    throw new Error(`Invalid segment field: ${segmentBy}`);
  }
  
  return this.constructor.aggregate([
    {
      $match: {
        metricName: this.metricName,
        timestamp: {
          $gte: new Date(this.timestamp.getTime() - 30 * 24 * 60 * 60 * 1000),
          $lte: new Date()
        },
        isDeleted: false,
        isValid: true
      }
    },
    {
      $group: {
        _id: `$${segmentBy}`,
        count: { $sum: 1 },
        totalValue: { $sum: { $toDouble: '$value' } },
        avgValue: { $avg: { $toDouble: '$value' } },
        uniqueUsers: { $addToSet: '$userId' }
      }
    },
    {
      $project: {
        segment: '$_id',
        count: 1,
        totalValue: 1,
        avgValue: { $round: ['$avgValue', 2] },
        uniqueUsers: { $size: '$uniqueUsers' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

analyticsSchema.methods.export = function(format = 'json', options = {}) {
  const exportData = {
    id: this._id,
    eventType: this.eventType,
    metricName: this.metricName,
    value: this.value,
    timestamp: this.timestamp,
    dimensions: this.dimensions,
    userId: this.isAnonymized ? null : this.userId,
    sessionId: this.sessionId,
    userSegment: this.userSegment,
    category: this.category,
    tags: this.tags,
    customProperties: this.customProperties
  };
  
  if (!this.isAnonymized) {
    exportData.deviceInfo = this.deviceInfo;
    exportData.location = this.location;
  }
  
  switch (format.toLowerCase()) {
    case 'json':
      return JSON.stringify(exportData, null, options.pretty ? 2 : 0);
    case 'csv':
      return this.convertToCSV(exportData);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
};

analyticsSchema.methods.convertToCSV = function(data) {
  const headers = Object.keys(data);
  const values = headers.map(header => {
    const value = data[header];
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return value;
  });
  
  return headers.join(',') + '\n' + values.join(',');
};

analyticsSchema.methods.anonymize = async function(method = 'hash') {
  if (this.isAnonymized) {
    return this;
  }
  
  switch (method) {
    case 'hash':
      if (this.userId) {
        this.userId = this.hashValue(this.userId.toString());
      }
      break;
      
    case 'removal':
      this.userId = undefined;
      this.location.coordinates = undefined;
      break;
      
    case 'pseudonym':
      if (this.userId) {
        this.userId = `user_${this.hashValue(this.userId.toString()).substr(0, 8)}`;
      }
      break;
      
    default:
      throw new Error(`Unsupported anonymization method: ${method}`);
  }
  
  this.isAnonymized = true;
  this.anonymizedAt = new Date();
  
  await this.save();
  return this;
};

analyticsSchema.methods.hashValue = function(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
};

analyticsSchema.methods.softDelete = async function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  await this.save();
};

// Static methods
analyticsSchema.statics.createEvent = function(eventData) {
  const normalizedData = {
    eventType: eventData.eventType,
    metricName: eventData.metricName,
    value: eventData.value,
    dimensions: eventData.dimensions || {},
    timestamp: eventData.timestamp || new Date(),
    userId: eventData.userId,
    sessionId: eventData.sessionId || this.generateSessionId(),
    deviceInfo: eventData.deviceInfo || {},
    location: eventData.location || {},
    userSegment: eventData.userSegment || 'unknown',
    category: eventData.category || 'engagement',
    customProperties: eventData.customProperties || {},
    tags: eventData.tags || []
  };
  
  return new this(normalizedData);
};

analyticsSchema.statics.generateSessionId = function() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

analyticsSchema.statics.getMetrics = function(filters = {}, options = {}) {
  const query = {
    isDeleted: false,
    isValid: true,
    ...filters
  };
  
  if (options.startDate || options.endDate) {
    query.timestamp = {};
    if (options.startDate) query.timestamp.$gte = options.startDate;
    if (options.endDate) query.timestamp.$lte = options.endDate;
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 1000);
};

analyticsSchema.statics.aggregateMetrics = function(metricName, period = 'daily', filters = {}) {
  const groupBy = {
    'hourly': {
      year: { $year: '$timestamp' },
      month: { $month: '$timestamp' },
      day: { $dayOfMonth: '$timestamp' },
      hour: { $hour: '$timestamp' }
    },
    'daily': {
      year: { $year: '$timestamp' },
      month: { $month: '$timestamp' },
      day: { $dayOfMonth: '$timestamp' }
    },
    'weekly': {
      year: { $year: '$timestamp' },
      week: { $week: '$timestamp' }
    },
    'monthly': {
      year: { $year: '$timestamp' },
      month: { $month: '$timestamp' }
    }
  };
  
  const matchStage = {
    metricName: metricName,
    isDeleted: false,
    isValid: true,
    ...filters
  };
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: groupBy[period],
        count: { $sum: 1 },
        totalValue: { $sum: { $toDouble: '$value' } },
        avgValue: { $avg: { $toDouble: '$value' } },
        minValue: { $min: { $toDouble: '$value' } },
        maxValue: { $max: { $toDouble: '$value' } },
        uniqueUsers: { $addToSet: '$userId' },
        uniqueSessions: { $addToSet: '$sessionId' }
      }
    },
    {
      $project: {
        period: '$_id',
        count: 1,
        totalValue: 1,
        avgValue: { $round: ['$avgValue', 2] },
        minValue: 1,
        maxValue: 1,
        uniqueUsers: { $size: '$uniqueUsers' },
        uniqueSessions: { $size: '$uniqueSessions' }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
  ]);
};

analyticsSchema.statics.getTopMetrics = function(period = '24h', limit = 10, metricType = 'eventType') {
  const timeMap = {
    '1h': 1,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30
  };
  
  const hours = timeMap[period] || 24;
  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate },
        isDeleted: false,
        isValid: true
      }
    },
    {
      $group: {
        _id: `$${metricType}`,
        count: { $sum: 1 },
        totalValue: { $sum: { $toDouble: '$value' } },
        uniqueUsers: { $addToSet: '$userId' }
      }
    },
    {
      $project: {
        metric: '$_id',
        count: 1,
        totalValue: 1,
        uniqueUsers: { $size: '$uniqueUsers' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: limit }
  ]);
};

analyticsSchema.statics.getUserJourney = function(userId, limit = 100) {
  return this.find({
    userId: userId,
    isDeleted: false,
    isValid: true
  })
  .sort({ timestamp: 1 })
  .limit(limit)
  .select('eventType metricName value timestamp deviceInfo location');
};

analyticsSchema.statics.getFunnelAnalysis = function(events, timeframe = '30d') {
  const timeframeDays = parseInt(timeframe.replace('d', ''));
  const startDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        eventType: { $in: events },
        timestamp: { $gte: startDate },
        isDeleted: false,
        isValid: true
      }
    },
    {
      $group: {
        _id: {
          userId: '$userId',
          eventType: '$eventType'
        },
        firstOccurrence: { $min: '$timestamp' }
      }
    },
    {
      $group: {
        _id: '$_id.eventType',
        uniqueUsers: { $addToSet: '$_id.userId' }
      }
    },
    {
      $project: {
        eventType: '$_id',
        userCount: { $size: '$uniqueUsers' }
      }
    },
    {
      $sort: { eventType: 1 }
    }
  ]);
};

// Query helpers
analyticsSchema.query.realTime = function() {
  return this.where({ isRealTime: true, isDeleted: false });
};

analyticsSchema.query.byEventType = function(eventType) {
  return this.where({ eventType: eventType });
};

analyticsSchema.query.byMetric = function(metricName) {
  return this.where({ metricName: metricName });
};

analyticsSchema.query.byUserSegment = function(segment) {
  return this.where({ userSegment: segment });
};

analyticsSchema.query.byCategory = function(category) {
  return this.where({ category: category });
};

analyticsSchema.query.inTimeRange = function(startDate, endDate) {
  return this.where({
    timestamp: {
      $gte: startDate,
      $lte: endDate
    }
  });
};

analyticsSchema.query.valid = function() {
  return this.where({ isValid: true, isDeleted: false });
};

module.exports = mongoose.model('Analytics', analyticsSchema);
