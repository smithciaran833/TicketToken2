// models/AccessGrant.js - Track granted access sessions

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AccessGrantSchema = new Schema({
  // User granted access
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Resource being accessed
  resource: {
    id: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: 'resource.model'
    },
    model: {
      type: String,
      required: true,
      enum: ['ExclusiveContent', 'Event', 'Collection']
    },
    title: String,
    type: String
  },
  
  // The NFT used to grant access
  nft: {
    address: {
      type: String,
      required: true
    },
    walletAddress: {
      type: String,
      required: true
    }
  },
  
  // Access details
  accessLevel: {
    type: String,
    enum: ['view', 'download', 'stream', 'edit', 'admin'],
    default: 'view'
  },
  
  // Time-based constraints
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  
  // Status of this grant
  status: {
    type: String,
    enum: ['active', 'used', 'expired', 'revoked'],
    default: 'active'
  },
  
  // Usage tracking
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsedAt: {
    type: Date
  },
  
  // Security info
  token: {
    type: String,
    required: true
  },
  ipAddress: String,
  userAgent: String,
  
  // Additional metadata
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  }
});

// Indexes for efficient querying
AccessGrantSchema.index({ 'nft.address': 1 });
AccessGrantSchema.index({ 'resource.id': 1, 'resource.model': 1 });
AccessGrantSchema.index({ expiresAt: 1 });
AccessGrantSchema.index({ token: 1 }, { unique: true });

// Instance methods
AccessGrantSchema.methods.isValid = function() {
  return (
    this.status === 'active' &&
    new Date() < this.expiresAt
  );
};

AccessGrantSchema.methods.use = async function() {
  if (!this.isValid()) {
    return false;
  }
  
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  
  // If max usage reached, mark as used
  const maxUsage = this.metadata?.get('maxUsage');
  if (maxUsage && this.usageCount >= maxUsage) {
    this.status = 'used';
  }
  
  await this.save();
  return true;
};

AccessGrantSchema.methods.revoke = async function(reason = 'Manual revocation') {
  this.status = 'revoked';
  this.metadata = this.metadata || new Map();
  this.metadata.set('revocationReason', reason);
  this.metadata.set('revokedAt', new Date());
  
  await this.save();
  return true;
};

// Static methods
AccessGrantSchema.statics.findActive = function(userId, resourceId, resourceModel) {
  return this.findOne({
    user: userId,
    'resource.id': resourceId,
    'resource.model': resourceModel,
    status: 'active',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

AccessGrantSchema.statics.findByToken = function(token) {
  return this.findOne({ token });
};

AccessGrantSchema.statics.findUserGrants = function(userId) {
  return this.find({
    user: userId,
    status: 'active',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

AccessGrantSchema.statics.cleanupExpired = async function() {
  const result = await this.updateMany(
    {
      status: 'active',
      expiresAt: { $lte: new Date() }
    },
    {
      $set: { status: 'expired' }
    }
  );
  
  return result.modifiedCount;
};

AccessGrantSchema.statics.generateAccessToken = function() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
};

const AccessGrant = mongoose.model('AccessGrant', AccessGrantSchema);

module.exports = AccessGrant;
