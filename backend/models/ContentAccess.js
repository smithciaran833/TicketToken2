// models/ContentAccess.js - Tracks user access to exclusive content

const mongoose = require('mongoose');

const ContentAccessSchema = new mongoose.Schema({
  // Which user accessed the content
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Which content was accessed
  content: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExclusiveContent',
    required: true
  },
  
  // Which ticket was used to access the content
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  },
  
  // Access details
  accessedAt: {
    type: Date,
    default: Date.now
  },
  
  // Access type
  accessType: {
    type: String,
    enum: ['view', 'download', 'stream'],
    default: 'view'
  },
  
  // Device information
  deviceInfo: {
    type: String
  },
  
  // IP address (for security auditing)
  ipAddress: {
    type: String
  },
  
  // Status of the access
  status: {
    type: String,
    enum: ['granted', 'denied', 'expired'],
    default: 'granted'
  },
  
  // Optional expiration (for temporary access)
  expiresAt: Date,
  
  // Duration of access (for streaming or time-limited content)
  duration: Number, // In seconds
  
  // Additional metadata
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
});

// Indexes for performance
ContentAccessSchema.index({ user: 1, content: 1 });
ContentAccessSchema.index({ ticket: 1 });
ContentAccessSchema.index({ accessedAt: -1 });
ContentAccessSchema.index({ status: 1 });
ContentAccessSchema.index({ expiresAt: 1 });

// Static methods
ContentAccessSchema.statics.findByUser = function(userId) {
  return this.find({ user: userId })
    .sort({ accessedAt: -1 })
    .populate('content', 'title contentType thumbnailUrl');
};

ContentAccessSchema.statics.findByTicket = function(ticketId) {
  return this.find({ ticket: ticketId })
    .sort({ accessedAt: -1 })
    .populate('content', 'title contentType thumbnailUrl');
};

ContentAccessSchema.statics.findByContent = function(contentId) {
  return this.find({ content: contentId })
    .sort({ accessedAt: -1 })
    .populate('user', 'displayName username');
};

ContentAccessSchema.statics.hasAccess = async function(userId, contentId) {
  const access = await this.findOne({
    user: userId,
    content: contentId,
    status: 'granted',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ]
  });
  return !!access;
};

const ContentAccess = mongoose.model('ContentAccess', ContentAccessSchema);

module.exports = ContentAccess;
