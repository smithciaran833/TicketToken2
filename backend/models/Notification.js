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
      // System types
      'system', 'marketing', 'event', 'social', 'payment', 'security', 
      'reminder', 'update', 'promotion', 'alert', 'news', 'personalized',
      // Specific event types
      'ticket_purchase', 'ticket_transfer', 'ticket_sale',
      'event_reminder', 'event_update', 'event_cancelled',
      'payment_received', 'payment_sent', 'payment_failed',
      'marketplace_offer', 'marketplace_bid', 'marketplace_sale',
      'verification_success', 'verification_failed',
      'content_published', 'content_liked', 'content_shared',
      'artist_announcement', 'promoter_message',
      'system_update', 'security_alert', 'account_activity'
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
  
  // For backward compatibility with simpler notifications
  relatedEntity: {
    entityType: {
      type: String,
      enum: ['event', 'ticket', 'user', 'payment', 'content', 'marketplace_listing'],
      index: true
    },
    entityId: {
      type: Schema.Types.ObjectId,
      index: true
    }
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
  
  // Legacy field support
  readStatus: {
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: Date
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
    enum: ['pending', 'sent', 'delivered', 'failed', 'expired', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Legacy delivery status support
  deliveryStatus: {
    email: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String,
      messageId: String
    },
    sms: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String,
      messageId: String
    },
    push: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String,
      tokens: [String]
    }
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
  
  // Legacy support fields
  channels: [{
    type: String,
    enum: ['in_app', 'email', 'sms', 'push']
  }],
  
  retryCount: {
    type: Number,
    default: 0,
    max: 3
  },
  
  metadata: {
    ipAddress: String,
    userAgent: String,
    platform: {
      type: String,
      enum: ['web', 'mobile', 'api']
    }
  },
  
  // Admin and management
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      // Only required for non-system notifications
      return !this.type || this.type !== 'system';
    }
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
notificationSchema.index({ userId: 1, 'readStatus.isRead': 1 });
notificationSchema.index({ 'relatedEntity.entityType': 1, 'relatedEntity.entityId': 1 });

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
  return !!this.readAt || (this.readStatus && this.readStatus.isRead);
});

notificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && new Date() > this.expiresAt;
});

notificationSchema.virtual('isDelivered').get(function() {
  if (this.deliveryChannels && this.deliveryChannels.length > 0) {
    return this.deliveryChannels.some(channel => channel.status === 'delivered');
  }
  // Legacy support
  return this.status === 'delivered';
});

notificationSchema.virtual('totalInteractions').get(function() {
  return this.interactions ? this.interactions.length : 0;
});

// Virtual for time since creation (from first artifact)
notificationSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
});

// Virtual for delivery summary (from first artifact)
notificationSchema.virtual('deliverySummary').get(function() {
  const summary = {
    total: 0,
    delivered: 0,
    failed: 0,
    pending: 0
  };
  
  // Support both new and legacy formats
  if (this.deliveryChannels && this.deliveryChannels.length > 0) {
    summary.total = this.deliveryChannels.length;
    this.deliveryChannels.forEach(channel => {
      if (channel.status === 'delivered') summary.delivered++;
      else if (['failed', 'bounced', 'spam'].includes(channel.status)) summary.failed++;
      else summary.pending++;
    });
  } else if (this.channels) {
    summary.total = this.channels.length;
    this.channels.forEach(channel => {
      if (this.deliveryStatus[channel]?.sent) {
        summary.delivered++;
      } else if (this.deliveryStatus[channel]?.error) {
        summary.failed++;
      } else {
        summary.pending++;
      }
    });
  }
  
  return summary;
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
    // Set default expiration if not provided
    this.setDefaultExpiration();
    
    // Update analytics if interactions changed
    if (this.isModified('interactions')) {
      this.updateAnalytics();
    }
    
    // Process tags
    if (this.tags) {
      this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase()))];
    }
    
    // Sync readStatus with readAt for backward compatibility
    if (this.readAt && !this.readStatus.isRead) {
      this.readStatus.isRead = true;
      this.readStatus.readAt = this.readAt;
    } else if (this.readStatus.isRead && !this.readAt) {
      this.readAt = this.readStatus.readAt || new Date();
    }
    
    // Convert legacy channels to deliveryChannels if needed
    if (this.channels && this.channels.length > 0 && (!this.deliveryChannels || this.deliveryChannels.length === 0)) {
      this.deliveryChannels = this.channels.map(channel => ({
        channel: channel,
        status: 'pending'
      }));
    }
    
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

// Enhanced markAsRead method (combines both versions)
notificationSchema.methods.markAsRead = async function(readAt = null) {
  if (this.readAt || (this.readStatus && this.readStatus.isRead)) return this; // Already read
  
  const readTime = readAt || new Date();
  this.readAt = readTime;
  
  // Update legacy readStatus
  if (!this.readStatus) {
    this.readStatus = {};
  }
  this.readStatus.isRead = true;
  this.readStatus.readAt = readTime;
  
  // Add read interaction
  if (!this.interactions) {
    this.interactions = [];
  }
  this.interactions.push({
    type: 'opened',
    timestamp: readTime
  });
  
  this.updateAnalytics();
  await this.save();
  
  return this;
};

// Instance method to mark as sent (from first artifact)
notificationSchema.methods.markAsSent = async function(channel, messageId) {
  this.status = 'sent';
  
  // Update new format
  if (this.deliveryChannels) {
    const deliveryChannel = this.deliveryChannels.find(ch => ch.channel === channel);
    if (deliveryChannel) {
      deliveryChannel.status = 'sent';
      deliveryChannel.sentAt = new Date();
      if (messageId) {
        deliveryChannel.providerId = messageId;
      }
    }
  }
  
  // Update legacy format
  if (this.deliveryStatus && this.deliveryStatus[channel]) {
    this.deliveryStatus[channel].sent = true;
    this.deliveryStatus[channel].sentAt = new Date();
    if (messageId) {
      this.deliveryStatus[channel].messageId = messageId;
    }
  }
  
  await this.save();
  return this;
};

// Instance method to mark as failed (from first artifact)
notificationSchema.methods.markAsFailed = async function(channel, error) {
  // Update new format
  if (this.deliveryChannels) {
    const deliveryChannel = this.deliveryChannels.find(ch => ch.channel === channel);
    if (deliveryChannel) {
      deliveryChannel.status = 'failed';
      deliveryChannel.failedAt = new Date();
      deliveryChannel.errorMessage = error.message || error;
      deliveryChannel.retryCount++;
    }
  }
  
  // Update legacy format
  if (this.deliveryStatus && this.deliveryStatus[channel]) {
    this.deliveryStatus[channel].sent = false;
    this.deliveryStatus[channel].error = error.message || error;
  }
  
  // Check if all channels failed
  const allFailed = this.deliveryChannels 
    ? this.deliveryChannels.every(ch => ['failed', 'bounced', 'spam'].includes(ch.status))
    : this.channels && this.channels.every(ch => this.deliveryStatus[ch] && this.deliveryStatus[ch].error);
  
  if (allFailed) {
    this.status = 'failed';
  }
  
  this.retryCount++;
  await this.save();
  return this;
};

// Enhanced getFormattedMessage method with template support
notificationSchema.methods.getFormattedMessage = function(channel) {
  const templates = {
    email: {
      ticket_purchase: {
        subject: 'Ticket Purchase Confirmation - {{eventName}}',
        template: process.env.EMAIL_TEMPLATE_TICKET_PURCHASE || 'ticket-purchase-email',
        data: ['eventName', 'ticketCount', 'totalAmount', 'purchaseId']
      },
      event_reminder: {
        subject: 'Event Reminder: {{eventName}} is coming up!',
        template: process.env.EMAIL_TEMPLATE_EVENT_REMINDER || 'event-reminder-email',
        data: ['eventName', 'eventDate', 'venueName', 'ticketCount']
      },
      payment_received: {
        subject: 'Payment Received - ${{amount}}',
        template: process.env.EMAIL_TEMPLATE_PAYMENT_RECEIVED || 'payment-received-email',
        data: ['amount', 'paymentMethod', 'transactionId']
      },
      marketplace_offer: {
        subject: 'New Offer Received for Your Listing',
        template: process.env.EMAIL_TEMPLATE_MARKETPLACE_OFFER || 'marketplace-offer-email',
        data: ['offerAmount', 'eventName', 'offerFrom']
      },
      security_alert: {
        subject: 'Security Alert: New Login Detected',
        template: process.env.EMAIL_TEMPLATE_SECURITY_ALERT || 'security-alert-email',
        data: ['location', 'device', 'ipAddress', 'timestamp']
      }
    },
    sms: {
      ticket_purchase: 'TicketToken: Your {{ticketCount}} ticket(s) for {{eventName}} have been confirmed. Order #{{orderId}}',
      event_reminder: 'TicketToken: {{eventName}} is tomorrow at {{eventTime}}. Don\'t forget your tickets!',
      verification_success: 'TicketToken: Your ticket has been verified. Enjoy {{eventName}}!',
      payment_received: 'TicketToken: Payment of ${{amount}} received. Transaction ID: {{transactionId}}',
      security_alert: 'TicketToken Security Alert: New login from {{location}}. Not you? Contact support immediately.'
    },
    push: {
      ticket_purchase: 'Purchase confirmed for {{eventName}}',
      marketplace_offer: 'New offer received: ${{offerAmount}}',
      security_alert: 'New login detected from {{location}}',
      event_reminder: '{{eventName}} starts in {{timeUntil}}',
      payment_received: 'Payment received: ${{amount}}'
    },
    webhook: {
      // Webhook payloads
      _format: 'json',
      _url: process.env.WEBHOOK_NOTIFICATION_URL
    }
  };
  
  const template = templates[channel]?.[this.type];
  if (!template) return this.message;
  
  if (channel === 'email') {
    return {
      subject: this.replaceVariables(template.subject),
      template: template.template,
      data: this.extractTemplateData(template.data)
    };
  }
  
  if (channel === 'webhook') {
    return {
      url: template._url || process.env.WEBHOOK_NOTIFICATION_URL,
      payload: {
        type: this.type,
        userId: this.userId,
        title: this.title,
        message: this.message,
        data: this.data,
        timestamp: new Date()
      }
    };
  }
  
  return this.replaceVariables(template);
};

// Helper method to replace template variables
notificationSchema.methods.replaceVariables = function(template) {
  let result = template;
  
  // Support both Map and object data
  if (this.data instanceof Map) {
    this.data.forEach((value, key) => {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });
  } else if (typeof this.data === 'object') {
    Object.keys(this.data).forEach(key => {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), this.data[key]);
    });
  }
  
  // Also check personalizedData
  if (this.personalizedData && typeof this.personalizedData === 'object') {
    Object.keys(this.personalizedData).forEach(key => {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), this.personalizedData[key]);
    });
  }
  
  return result;
};

// Helper method to extract template data
notificationSchema.methods.extractTemplateData = function(fields) {
  const data = {};
  
  fields.forEach(field => {
    if (this.data instanceof Map && this.data.has(field)) {
      data[field] = this.data.get(field);
    } else if (this.data && typeof this.data === 'object' && this.data[field]) {
      data[field] = this.data[field];
    } else if (this.personalizedData && this.personalizedData[field]) {
      data[field] = this.personalizedData[field];
    }
  });
  
  return data;
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
  
  if (!this.interactions) {
    this.interactions = [];
  }
  this.interactions.push(interaction);
  
  // Mark as read if it's an open interaction
  if (interactionData.type === 'opened' && !this.readAt) {
    this.readAt = interaction.timestamp;
    if (!this.readStatus) {
      this.readStatus = {};
    }
    this.readStatus.isRead = true;
    this.readStatus.readAt = interaction.timestamp;
  }
  
  this.updateAnalytics();
  await this.save();
  
  return interaction;
};

notificationSchema.methods.updateAnalytics = function() {
  if (!this.interactions || this.interactions.length === 0) return;
  
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
  if (this.deliveryChannels && this.deliveryChannels.length > 0) {
    const deliveredChannels = this.deliveryChannels.filter(c => c.status === 'delivered').length;
    const totalChannels = this.deliveryChannels.length;
    this.analytics.deliveryRate = Math.round((deliveredChannels / totalChannels) * 100 * 100) / 100;
  }
  
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
  if (this.deliveryChannels) {
    this.deliveryChannels.forEach(channel => {
      if (channel.status === 'pending') {
        channel.status = 'sent';
        channel.sentAt = new Date();
      }
    });
  }
  
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
  if (!this.deliveryChannels || this.deliveryChannels.length === 0) return;
  
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

// Enhanced createNotification method (from first artifact)
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this(data);
  
  // Set default channels based on type and user preferences
  if (!notification.channels || notification.channels.length === 0) {
    notification.channels = ['in_app'];
    
    // Add email for important notifications
    if (['ticket_purchase', 'payment_received', 'security_alert'].includes(notification.type)) {
      notification.channels.push('email');
    }
  }
  
  // Convert channels to deliveryChannels format
  if (!notification.deliveryChannels || notification.deliveryChannels.length === 0) {
    notification.deliveryChannels = notification.channels.map(channel => ({
      channel: channel,
      status: 'pending'
    }));
  }
  
  return notification.save();
};

// Static method to mark multiple as read (from first artifact)
notificationSchema.statics.markMultipleAsRead = async function(userId, notificationIds) {
  return this.updateMany(
    {
      _id: { $in: notificationIds },
      userId: userId,
      $or: [
        { readAt: { $exists: false } },
        { 'readStatus.isRead': false }
      ]
    },
    {
      $set: {
        readAt: new Date(),
        'readStatus.isRead': true,
        'readStatus.readAt': new Date()
      }
    }
  );
};

// Static method to get unread count (enhanced)
notificationSchema.statics.getUnreadCount = async function(userId) {
  return this.countDocuments({
    userId,
    $or: [
      { readAt: { $exists: false } },
      { 'readStatus.isRead': false }
    ],
    status: { $in: ['sent', 'delivered'] },
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ],
    isDeleted: false
  });
};

// Enhanced getUserNotifications method (from first artifact)
notificationSchema.statics.getUserNotifications = async function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    type = null,
    unreadOnly = false,
    priority = null,
    category = null
  } = options;
  
  const query = { userId, isDeleted: false };
  
  if (type) query.type = type;
  if (category) query.category = category;
  if (unreadOnly) {
    query.$or = [
      { readAt: { $exists: false } },
      { 'readStatus.isRead': false }
    ];
  }
  if (priority) query.priority = priority;
  
  // Exclude expired notifications
  query.$and = [
    {
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ]
    }
  ];
  
  const skip = (page - 1) * limit;
  
  const [notifications, total] = await Promise.all([
    this.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('relatedEntity.entityId')
      .populate('createdBy', 'username displayName'),
    this.countDocuments(query)
  ]);
  
  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Static method to clean up old notifications (from first artifact)
notificationSchema.statics.cleanupOldNotifications = async function(daysToKeep = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  return this.deleteMany({
    $or: [
      { createdAt: { $lt: cutoffDate } },
      { expiresAt: { $lt: new Date() } }
    ],
    $or: [
      { readAt: { $exists: true } },
      { 'readStatus.isRead': true }
    ],
    isDeleted: false
  });
};

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
    $or: [
      { readAt: { $exists: false } },
      { 'readStatus.isRead': false }
    ],
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
  return this.where({ 
    $or: [
      { readAt: { $exists: false } },
      { 'readStatus.isRead': false }
    ]
  });
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

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
