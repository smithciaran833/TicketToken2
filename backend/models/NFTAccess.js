// models/NFTAccess.js - NFT-based access control model

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NFTAccessSchema = new Schema({
  // The NFT identifier (mint address) that grants access
  nftAddress: {
    type: String,
    required: true,
    index: true
  },
  
  // The content or resource this NFT grants access to
  resourceId: {
    type: Schema.Types.ObjectId,
    refPath: 'resourceModel',
    required: true,
    index: true
  },
  
  // Type of resource (ExclusiveContent, Event, etc.)
  resourceModel: {
    type: String,
    required: true,
    enum: ['ExclusiveContent', 'Event', 'Collection']
  },
  
  // Access level granted by this NFT
  accessLevel: {
    type: String,
    enum: ['view', 'download', 'stream', 'edit', 'admin'],
    default: 'view'
  },
  
  // Is this a time-limited access?
  temporaryAccess: {
    type: Boolean,
    default: false
  },
  
  // When access expires (for temporary access)
  expiresAt: {
    type: Date
  },
  
  // Restrictions on access
  restrictions: {
    maxViews: Number,         // Maximum number of views allowed
    maxDownloads: Number,     // Maximum number of downloads allowed
    requiresPresence: Boolean, // Requires user to be at event (geofencing)
    ipRestriction: Boolean,    // Restrict to specific IP ranges
    deviceLimit: Number        // Maximum number of devices
  },
  
  // Who created this access rule
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Status of this access rule
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient querying
NFTAccessSchema.index({ nftAddress: 1, resourceId: 1 }, { unique: true });
NFTAccessSchema.index({ resourceId: 1, resourceModel: 1 });
NFTAccessSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { temporaryAccess: true } });

// Pre-save middleware to update timestamps
NFTAccessSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods
NFTAccessSchema.methods.isExpired = function() {
  if (!this.temporaryAccess) return false;
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Static methods
NFTAccessSchema.statics.findActiveAccessRules = function(nftAddress) {
  return this.find({
    nftAddress,
    isActive: true,
    $or: [
      { temporaryAccess: false },
      { temporaryAccess: true, expiresAt: { $gt: new Date() } }
    ]
  }).populate('resourceId').sort({ createdAt: -1 });
};

NFTAccessSchema.statics.hasAccessToResource = async function(nftAddress, resourceId, resourceModel) {
  const access = await this.findOne({
    nftAddress,
    resourceId,
    resourceModel,
    isActive: true,
    $or: [
      { temporaryAccess: false },
      { temporaryAccess: true, expiresAt: { $gt: new Date() } }
    ]
  });
  
  return !!access;
};

NFTAccessSchema.statics.getRequiredNFTs = async function(resourceId, resourceModel) {
  return this.find({
    resourceId,
    resourceModel,
    isActive: true
  }).select('nftAddress accessLevel restrictions');
};

const NFTAccess = mongoose.model('NFTAccess', NFTAccessSchema);

module.exports = NFTAccess;
