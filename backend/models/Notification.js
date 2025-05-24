const mongoose = require('mongoose');
const { Schema } = mongoose;

// Delivery channel schema
const deliveryChannelSchema = new Schema({
  channel: {
    type: String,
    required: [true, 'Delivery channel is required'],
    enum: ['push', 'email', 'sms', 'in_app', 'webhook', 'slack'],
    index: true
  },
  status: {
    type: String,
    required: [true, 'Delivery status is required'],
    enum: ['pending', 'queued', 'sent', 'delivered', 'failed', 'bounced', 'spam'],
    default: 'pending',
    index: true
  },
  sentAt: {
    type: Date
  },
  deliveredAt: {
    type: Date
  },
  failedAt: {
    type: Date
  },
  errorMessage: {
    type: String,
    trim: true,
    maxlength: [500, 'Error message cannot exceed 500 characters']
  },
  providerId: {
    type: String, // External service ID (FCM, email provider, etc.)
    trim: true
  },
  providerResponse: {
    type: Schema.Types.Mixed
  },
  retryCount: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  nextRetryAt: {
    type: Date
  },
  endpoint: {
    type: String, // Email address, phone number, device token
    trim: true
  }
}, {
  _id: true,
  timestamps: false
});

// Interaction tracking schema
const interactionSchema = new Schema({
  type: {
    type: String,
    required: [true, 'Interaction type is required'],
    enum: ['opened', 'clicked', 'converted', 'dismissed', 'unsubscribed', 'shared']
  },
  timestamp: {
    type: Date,
    required: [true, 'Interaction timestamp is required'],
    default: Date.now
  },
  channel: {
    type: String,
    enum: ['push', 'email', 'sms', 'in_app', 'webhook', 'slack']
  },
  userAgent: {
    type: String,
    trim: true
  },
  ipAddress: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        // Basic IP validation
        return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(value);
      },
      message: 'Invalid IP address format'
    }
  },
  device: {
    type: String,
    enum: ['mobile', 'desktop', 'tablet', 'unknown'],
    default: 'unknown'
  },
  additionalData: {
    type: Schema.Types.Mixed
  }
}, {
  _id: true,
  timestamps: false
});

// Audience segment schema
const audienceSegmentSchema = new Schema({
  segmentId: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  criteria: {
    userTypes: [{
      type: String,
      enum: ['fan', 'artist', 'promoter', 'venue_manager', 'admin']
    }],
    locations: [{
      country: String,
      state: String,
      city: String,
      radius: Number // in miles
    }],
    demographics: {
      minAge: {
        type: Number,
        min: 13,
        max: 100
      },
      maxAge: {
        type: Number,
        min: 13,
        max: 100
      },
      interests: [String],
      languages: [String]
    },
    behavioral: {
      lastActiveWithin: {
        type: Number, // days
        min: 1
      },
      minEvents: {
        type: Number,
        min: 0
      },
      preferredGenres: [String],
      spendingLevel: {
        type: String,
        enum: ['low', 'medium', 'high', 'premium']
      }
    }
  },
  estimatedReach: {
    type: Number,
    min: 0,
    default: 0
  }
}, {
  _id: false,
  timestamps: false
});

// Main notification schema
const notificationSchema = new Schema({
  // Core notification fields
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    validate: {
      validator: function(value) {
        return value || this.isBroadcast;
      },
      message: 'User ID is required for individual notifications'
    }
  },
  
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    trim: true,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  
  type: {
    type: String,
    required: [true, 'Notification type is required'],
    enum: [
      'system', 'marketing', 'event', 'social', 'payment', 'security', 
      'reminder', 'update', 'promotion', 'alert', 'news', 'personalized'
    ],
    index: true
  },
  
  category: {
    type: String,
    enum: [
      'account', 'event_update', 'new_release', 'ticket_sale', 'payment_status',
      'friend_activity', 'recommendation', 'security_alert', 'system_maintenance',
      'promotional_offer', 'artist_news', 'venue_update', 'general'
    ],
    default: 'general',
    index: true
  },
  
  // Delivery configuration
  deliveryChannels: [deliveryChannelSchema],
  
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
    index: true
  },
  
  // Content and metadata
  data: {
    type: Schema.Types.Mixed,
    default: {}
  },
  
  actionUrl: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Action URL must be a valid HTTP/HTTPS URL'
    }
  },
  
  actionLabel: {
    type: String,
    trim: true,
    maxlength: [50, 'Action label cannot exceed 50 characters']
  },
  
  imageUrl: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)$/i.test(value);
      },
      message: 'Image URL must be a valid HTTP/HTTPS URL ending in jpg, jpeg, png, gif, webp, or svg'
    }
  },
  
  // Scheduling and timing
  scheduledFor: {
    type: Date,
    index: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return value >= new Date();
      },
      message: 'Scheduled time must be in the future'
    }
  },
  
  sentAt: {
    type: Date,
    index: true
  },
  
  readAt: {
    type: Date
  },
  
  expiresAt: {
    type: Date,
    index: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        const scheduleTime = this.scheduledFor || new Date();
        return value > scheduleTime;
      },
      message: 'Expiration time must be after scheduled time'
    }
  },
  
  // Targeting and personalization
  isBroadcast: {
    type: Boolean,
    default: false,
    index: true
  },
  
  audienceSegment: audienceSegmentSchema,
  
  personalizedData: {
    type: Schema.Types.Mixed,
    default: {}
  },
  
  localization: {
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'ru']
    },
    timezone: {
      type: String,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^[A-Z][a-z]+\/[A-Z][a-z_]+$/.test(value);
        },
        message: 'Timezone must be in IANA format'
      }
    }
  },
  
  // Status tracking
  status: {
    type: String,
    required: [true, 'Notification status is required'],
    enum: ['pending', 'sent', 'delivered', 'failed', 'expired'],
    default: 'pending',
    index: true
  },
  
  // Interaction tracking
  interactions: [interactionSchema],
  
  // Analytics and metrics
  analytics: {
    totalRecipients: {
      type: Number,
      default: 0,
      min: 0
    },
    deliveryRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    openRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    clickRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    conversionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    revenueGenerated: {
      type: Number,
      default: 0,
      min: 0
    },
    lastCalculated: {
      type: Date,
      default: Date.now
    }
  },
  
  // Campaign and batch information
  campaignId: {
    type: Schema.Types.ObjectId,
    ref: 'Campaign',
    index: true
  },
  
  batchId: {
    type: String,
    index: true,
    trim: true
  },
  
  // Configuration options
  settings: {
    allowDismiss: {
      type: Boolean,
      default: true
    },
    showInHistory: {
      type: Boolean,
      default: true
    },
    requireConfirmation: {
      type: Boolean,
      default: false
    },
    autoExpire: {
      type: Boolean,
      default: true
    },
    trackClicks: {
      type: Boolean,
      default: true
    },
    maxRetries: {
      type: Number,
      min: 0,
      max: 5,
      default: 3
    },
    retryDelay: {
      type: Number, // in minutes
      min: 1,
      max: 1440,
      default: 15
    }
  },
  
  // Admin and management
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },
  
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  
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
notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ type: 1, category: 1, status: 1 });
notificationSchema.index({ scheduledFor: 1, status: 1 });
notificationSchema.index({ expiresAt: 1, status: 1 });
notificationSchema.index({ campaignId: 1, status: 1 });
notificationSchema.index({ batchId: 1 });
notificationSchema.index({ priority: 1, scheduledFor: 1 });
notificationSchema.index({ 'deliveryChannels.channel': 1, 'deliveryChannels.status': 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ tags: 1 });

// Text search index
notificationSchema.index({ 
  title: 'text', 
  message: 'text',
  tags: 'text'
});

// Compound indexes
notificationSchema.index({ 
  status: 1, 
  priority: 1, 
  scheduledFor: 1 
});

notificationSchema.index({
  isBroadcast: 1,
  status: 1,
  scheduledFor: 1
});

// Virtual fields
notificationSchema.virtual('isRead').get(function() {
  return !!this.readAt;
});

notificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && new Date() > this.expiresAt;
});

notificationSchema.virtual('isDelivered').get(function() {
  return this.deliveryChannels.some(channel => channel.status === 'delivered');
});

notificationSchema.virtual('totalInteractions').get(function() {
  return this.interactions.length;
});

// Populate virtual references
notificationSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

notificationSchema.virtual('creator', {
  ref: 'User',
  localField: 'createdBy',
  foreignField: '_id',
  justOne: true
});

// Pre-save hooks
notificationSchema.pre('save', async function(next) {
  try {
    // Set expiration if not provided
    this.setDefaultExpiration();
    
    // Update analytics if interactions changed
    if (this.isModified('interactions')) {
      this.updateAnalytics();
    }
    
    // Process tags
    this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase()))];
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
notificationSchema.methods.setDefaultExpiration = function() {
  if (!this.expiresAt) {
    const expirationDays = {
      'urgent': 1,
      'high': 3,
      'normal': 7,
      'low': 14
    };
    
    const days = expirationDays[this.priority] || 7;
    const scheduleTime = this.scheduledFor || new Date();
    this.expiresAt = new Date(scheduleTime.getTime() + (days * 24 * 60 * 60 * 1000));
  }
};

notificationSchema.methods.markAsRead = async function(readAt = null) {
  if (this.readAt) return this; // Already read
  
  this.readAt = readAt || new Date();
  
  // Add read interaction
  this.interactions.push({
    type: 'opened',
    timestamp: this.readAt
  });
  
  this.updateAnalytics();
  await this.save();
  
  return this;
};

notificationSchema.methods.trackInteraction = async function(interactionData) {
  const interaction = {
    type: interactionData.type,
    timestamp: interactionData.timestamp || new Date(),
    channel: interactionData.channel,
    userAgent: interactionData.userAgent,
    ipAddress: interactionData.ipAddress,
    device: interactionData.device,
    additionalData: interactionData.additionalData
  };
  
  this.interactions.push(interaction);
  
  // Mark as read if it's an open interaction
  if (interactionData.type === 'opened' && !this.readAt) {
    this.readAt = interaction.timestamp;
  }
  
  this.updateAnalytics();
  await this.save();
  
  return interaction;
};

notificationSchema.methods.updateAnalytics = function() {
  const totalInteractions = this.interactions.length;
  if (totalInteractions === 0) return;
  
  // Calculate interaction rates
  const openInteractions = this.interactions.filter(i => i.type === 'opened').length;
  const clickInteractions = this.interactions.filter(i => i.type === 'clicked').length;
  const conversionInteractions = this.interactions.filter(i => i.type === 'converted').length;
  
  // Update rates based on total recipients
  const recipients = this.analytics.totalRecipients || 1;
  
  this.analytics.openRate = Math.round((openInteractions / recipients) * 100 * 100) / 100;
  this.analytics.clickRate = Math.round((clickInteractions / recipients) * 100 * 100) / 100;
  this.analytics.conversionRate = Math.round((conversionInteractions / recipients) * 100 * 100) / 100;
  
  // Calculate delivery rate
  const deliveredChannels = this.deliveryChannels.filter(c => c.status === 'delivered').length;
  const totalChannels = this.deliveryChannels.length || 1;
  this.analytics.deliveryRate = Math.round((deliveredChannels / totalChannels) * 100 * 100) / 100;
  
  this.analytics.lastCalculated = new Date();
};

notificationSchema.methods.schedule = async function(scheduledTime, options = {}) {
  if (scheduledTime <= new Date()) {
    throw new Error('Scheduled time must be in the future');
  }
  
  this.scheduledFor = scheduledTime;
  this.status = 'pending';
  
  // Apply scheduling options
  if (options.expiresAt) {
    this.expiresAt = options.expiresAt;
  }
  
  if (options.priority) {
    this.priority = options.priority;
  }
  
  await this.save();
  return this;
};

notificationSchema.methods.send = async function() {
  if (this.status !== 'pending') {
    throw new Error(`Cannot send notification with status: ${this.status}`);
  }
  
  if (this.isExpired) {
    this.status = 'expired';
    await this.save();
    throw new Error('Cannot send expired notification');
  }
  
  this.status = 'sent';
  this.sentAt = new Date();
  
  // Set delivery channels to sent
  this.deliveryChannels.forEach(channel => {
    if (channel.status === 'pending') {
      channel.status = 'sent';
      channel.sentAt = new Date();
    }
  });
  
  await this.save();
  return this;
};

notificationSchema.methods.updateDeliveryStatus = async function(channelId, status, details = {}) {
  const channel = this.deliveryChannels.id(channelId);
  if (!channel) {
    throw new Error('Delivery channel not found');
  }
  
  channel.status = status;
  
  switch (status) {
    case 'sent':
      channel.sentAt = details.sentAt || new Date();
      break;
    case 'delivered':
      channel.deliveredAt = details.deliveredAt || new Date();
      break;
    case 'failed':
    case 'bounced':
    case 'spam':
      channel.failedAt = details.failedAt || new Date();
      channel.errorMessage = details.errorMessage || '';
      break;
  }
  
  if (details.providerId) channel.providerId = details.providerId;
  if (details.providerResponse) channel.providerResponse = details.providerResponse;
  if (details.endpoint) channel.endpoint = details.endpoint;
  
  // Update overall notification status
  this.updateOverallStatus();
  this.updateAnalytics();
  
  await this.save();
  return channel;
};

notificationSchema.methods.updateOverallStatus = function() {
  const statuses = this.deliveryChannels.map(c => c.status);
  
  if (statuses.every(s => s === 'delivered')) {
    this.status = 'delivered';
  } else if (statuses.every(s => ['failed', 'bounced', 'spam'].includes(s))) {
    this.status = 'failed';
  } else if (statuses.some(s => ['delivered', 'sent'].includes(s))) {
    this.status = 'sent';
  }
};

notificationSchema.methods.addPersonalization = function(personalizedData) {
  this.personalizedData = {
    ...this.personalizedData,
    ...personalizedData
  };
  
  // Apply personalization to content
  this.title = this.applyPersonalization(this.title);
  this.message = this.applyPersonalization(this.message);
  
  return this;
};

notificationSchema.methods.applyPersonalization = function(text) {
  if (!text || !this.personalizedData) return text;
  
  let personalizedText = text;
  
  // Replace placeholders like {{firstName}}, {{eventName}}, etc.
  Object.keys(this.personalizedData).forEach(key => {
    const placeholder = `{{${key}}}`;
    const value = this.personalizedData[key];
    personalizedText = personalizedText.replace(new RegExp(placeholder, 'g'), value);
  });
  
  return personalizedText;
};

notificationSchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  await this.save();
};

notificationSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  await this.save();
};

// Static methods
notificationSchema.statics.findPendingNotifications = function(limit = 100) {
  const now = new Date();
  
  return this.find({
    status: 'pending',
    scheduledFor: { $lte: now },
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: now } }
    ],
    isDeleted: false
  })
  .sort({ priority: -1, scheduledFor: 1 })
  .limit(limit);
};

notificationSchema.statics.findExpiredNotifications = function() {
  const now = new Date();
  
  return this.find({
    expiresAt: { $lte: now },
    status: { $nin: ['expired'] },
    isDeleted: false
  });
};

notificationSchema.statics.findByUser = function(userId, filters = {}) {
  const query = {
    userId: userId,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'username displayName');
};

notificationSchema.statics.findUnreadByUser = function(userId, limit = 50) {
  return this.find({
    userId: userId,
    readAt: { $exists: false },
    status: { $in: ['sent', 'delivered'] },
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ],
    isDeleted: false
  })
  .sort({ priority: -1, createdAt: -1 })
  .limit(limit);
};

notificationSchema.statics.getNotificationStats = async function(timeframe = '30d', filters = {}) {
  const timeframeDays = parseInt(timeframe.replace('d', ''));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframeDays);
  
  const matchStage = {
    createdAt: { $gte: startDate },
    isDeleted: false,
    ...filters
  };
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalNotifications: { $sum: 1 },
        sentNotifications: {
          $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] }
        },
        deliveredNotifications: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
        },
        failedNotifications: {
          $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
        },
        averageOpenRate: { $avg: '$analytics.openRate' },
        averageClickRate: { $avg: '$analytics.clickRate' },
        averageConversionRate: { $avg: '$analytics.conversionRate' },
        totalRevenue: { $sum: '$analytics.revenueGenerated' },
        notificationsByType: {
          $push: {
            type: '$type',
            count: 1
          }
        },
        notificationsByChannel: {
          $push: {
            channels: '$deliveryChannels.channel',
            count: 1
          }
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalNotifications: 0,
    sentNotifications: 0,
    deliveredNotifications: 0,
    failedNotifications: 0,
    averageOpenRate: 0,
    averageClickRate: 0,
    averageConversionRate: 0,
    totalRevenue: 0,
    notificationsByType: [],
    notificationsByChannel: []
  };
};

notificationSchema.statics.searchNotifications = function(searchTerm, filters = {}) {
  const searchQuery = {
    $or: [
      { title: { $regex: searchTerm, $options: 'i' } },
      { message: { $regex: searchTerm, $options: 'i' } },
      { tags: { $regex: searchTerm, $options: 'i' } }
    ],
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'username displayName');
};

notificationSchema.statics.findHighPerformingNotifications = function(minOpenRate = 50, limit = 20) {
  return this.find({
    'analytics.openRate': { $gte: minOpenRate },
    status: { $in: ['sent', 'delivered'] },
    isDeleted: false
  })
  .sort({ 'analytics.openRate': -1, 'analytics.clickRate': -1 })
  .limit(limit)
  .populate('createdBy', 'username displayName');
};

// Query helpers
notificationSchema.query.active = function() {
  return this.where({ isDeleted: false });
};

notificationSchema.query.pending = function() {
  return this.where({ status: 'pending' });
};

notificationSchema.query.sent = function() {
  return this.where({ status: { $in: ['sent', 'delivered'] } });
};

notificationSchema.query.unread = function() {
  return this.where({ readAt: { $exists: false } });
};

notificationSchema.query.byType = function(type) {
  return this.where({ type: type });
};

notificationSchema.query.byCategory = function(category) {
  return this.where({ category: category });
};

notificationSchema.query.byPriority = function(priority) {
  return this.where({ priority: priority });
};

notificationSchema.query.byChannel = function(channel) {
  return this.where({ 'deliveryChannels.channel': channel });
};

notificationSchema.query.scheduled = function() {
  return this.where({ 
    scheduledFor: { $exists: true, $gt: new Date() },
    status: 'pending'
  });
};

notificationSchema.query.expired = function() {
  return this.where({ 
    expiresAt: { $lte: new Date() },
    status: { $nin: ['expired'] }
  });
};

module.exports = mongoose.model('Notification', notificationSchema);
