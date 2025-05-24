// models/ExclusiveContent.js - Updated with NFT access integration

const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const NFTAccess = require('./NFTAccess');

const ExclusiveContentSchema = new mongoose.Schema({
  // Content identifier
  contentId: {
    type: String,
    required: true,
    unique: true
  },
  
  // Basic content information
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  
  // Content type and details
  contentType: {
    type: String,
    enum: ['image', 'video', 'audio', 'document', 'livestream', 'interactive'],
    required: true
  },
  
  // Content ownership and relationships
  artist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  
  // Content storage information
  contentUrl: {
    type: String,
    required: true
  },
  thumbnailUrl: {
    type: String
  },
  duration: {
    type: Number // Duration in seconds for audio/video
  },
  size: {
    type: Number // Size in bytes
  },
  
  // NFT access control
  accessControl: {
    type: {
      type: String,
      enum: ['public', 'ticket-based', 'nft-based', 'hybrid'],
      default: 'nft-based'
    },
    requiredNFTs: [{
      type: Schema.Types.ObjectId,
      ref: 'NFTAccess'
    }],
    ticketTypes: [String],
    defaultAccessLevel: {
      type: String,
      enum: ['view', 'download', 'stream', 'edit', 'admin'],
      default: 'view'
    }
  },
  
  // Available time window (optional)
  availableFrom: {
    type: Date,
    default: Date.now
  },
  availableUntil: {
    type: Date
  },
  
  // Metadata for specific content types
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  },
  
  // Content status
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  
  // Tracking information
  views: {
    type: Number,
    default: 0
  },
  likes: {
    type: Number,
    default: 0
  },
  downloads: {
    type: Number,
    default: 0
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  publishedAt: Date
});

// Indexes for performance
ExclusiveContentSchema.index({ contentId: 1 });
ExclusiveContentSchema.index({ artist: 1, status: 1 });
ExclusiveContentSchema.index({ event: 1, status: 1 });
ExclusiveContentSchema.index({ contentType: 1 });
ExclusiveContentSchema.index({ 'accessControl.type': 1 });
ExclusiveContentSchema.index({ createdAt: -1 });

// Pre-save middleware
ExclusiveContentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Post-save middleware to update NFT access rules
ExclusiveContentSchema.post('save', async function() {
  if (this.accessControl.type === 'nft-based' || this.accessControl.type === 'hybrid') {
    try {
      // Check for required NFTs in the access list
      const nftAccessRules = await NFTAccess.find({
        resourceId: this._id,
        resourceModel: 'ExclusiveContent',
        isActive: true
      });
      
      // Update references to NFT access rules
      this.accessControl.requiredNFTs = nftAccessRules.map(rule => rule._id);
      
      // Save without triggering hooks to avoid infinite loop
      await this.constructor.findByIdAndUpdate(
        this._id,
        { 'accessControl.requiredNFTs': this.accessControl.requiredNFTs }
      );
    } catch (error) {
      console.error('Error updating NFT access references:', error);
    }
  }
});

// Virtual for secure content URL with token (for authorized access)
ExclusiveContentSchema.virtual('secureContentUrl').get(function() {
  // In production, you would generate a signed URL or token here
  return `${this.contentUrl}?contentId=${this.contentId}`;
});

// Instance methods
ExclusiveContentSchema.methods.incrementViews = async function() {
  this.views += 1;
  return this.save();
};

ExclusiveContentSchema.methods.incrementDownloads = async function() {
  this.downloads += 1;
  return this.save();
};

// Check if content is available based on time window
ExclusiveContentSchema.methods.isAvailable = function() {
  const now = new Date();
  
  if (this.availableFrom && now < this.availableFrom) {
    return false;
  }
  
  if (this.availableUntil && now > this.availableUntil) {
    return false;
  }
  
  return this.status === 'published';
};

// Check if content is accessible with a specific ticket
ExclusiveContentSchema.methods.isAccessibleWithTicket = function(ticket) {
  // If accessControl type is 'public', always allow
  if (this.accessControl.type === 'public') {
    return true;
  }
  
  // If not 'ticket-based' or 'hybrid', don't allow ticket access
  if (this.accessControl.type !== 'ticket-based' && this.accessControl.type !== 'hybrid') {
    return false;
  }
  
  // Check if the ticket event matches this content's event
  if (ticket.event.toString() !== this.event.toString()) {
    return false;
  }
  
  // If no specific ticket types are required, any ticket for this event is valid
  if (!this.accessControl.ticketTypes || this.accessControl.ticketTypes.length === 0) {
    return true;
  }
  
  // Check if the ticket type matches any of the required types
  return this.accessControl.ticketTypes.includes(ticket.ticketType);
};

// Check if NFT based access is possible
ExclusiveContentSchema.methods.requiresNFT = function() {
  return this.accessControl.type === 'nft-based' || this.accessControl.type === 'hybrid';
};

// Statics
ExclusiveContentSchema.statics.findByEvent = function(eventId) {
  return this.find({
    event: eventId,
    status: 'published',
    $or: [
      { availableUntil: { $exists: false } },
      { availableUntil: { $gt: new Date() } }
    ]
  }).sort({ createdAt: -1 });
};

ExclusiveContentSchema.statics.findByArtist = function(artistId) {
  return this.find({
    artist: artistId,
    status: 'published'
  }).sort({ createdAt: -1 });
};

// Helper method to find content based on NFT ownership
ExclusiveContentSchema.statics.findByNFTAddress = async function(nftAddress) {
  // Find access rules for this NFT
  const accessRules = await NFTAccess.find({
    nftAddress,
    resourceModel: 'ExclusiveContent',
    isActive: true
  });
  
  // Extract resource IDs
  const resourceIds = accessRules.map(rule => rule.resourceId);
  
  // Find published content with these IDs
  return this.find({
    _id: { $in: resourceIds },
    status: 'published'
  }).sort({ createdAt: -1 });
};

const ExclusiveContent = mongoose.model('ExclusiveContent', ExclusiveContentSchema);

module.exports = ExclusiveContent;
