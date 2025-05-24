const mongoose = require('mongoose');
const { Schema } = mongoose;

// Content schema for token-gated content system
const contentSchema = new Schema({
  // Basic content information
  title: {
    type: String,
    required: [true, 'Content title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
    index: true
  },
  
  description: {
    type: String,
    required: [true, 'Content description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  
  contentType: {
    type: String,
    required: [true, 'Content type is required'],
    enum: {
      values: ['video', 'audio', 'image', 'document'],
      message: 'Content type must be video, audio, image, or document'
    },
    index: true
  },
  
  // Access control and token gating
  requiredTicketIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  }],
  
  accessLevel: {
    type: String,
    required: [true, 'Access level is required'],
    enum: {
      values: ['basic', 'premium', 'vip'],
      message: 'Access level must be basic, premium, or vip'
    },
    default: 'basic',
    index: true
  },
  
  // Content metadata
  metadata: {
    duration: {
      type: Number, // Duration in seconds
      min: [0, 'Duration cannot be negative'],
      validate: {
        validator: function(value) {
          // Duration is required for video and audio content
          if (['video', 'audio'].includes(this.contentType)) {
            return value != null && value > 0;
          }
          return true;
        },
        message: 'Duration is required for video and audio content'
      }
    },
    
    fileSize: {
      type: Number, // File size in bytes
      required: [true, 'File size is required'],
      min: [1, 'File size must be greater than 0']
    },
    
    format: {
      type: String,
      required: [true, 'File format is required'],
      uppercase: true,
      validate: {
        validator: function(value) {
          const validFormats = {
            video: ['MP4', 'AVI', 'MOV', 'WMV', 'FLV', 'WEBM'],
            audio: ['MP3', 'WAV', 'FLAC', 'AAC', 'OGG', 'M4A'],
            image: ['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'SVG'],
            document: ['PDF', 'DOC', 'DOCX', 'TXT', 'RTF', 'ODT']
          };
          return validFormats[this.contentType]?.includes(value);
        },
        message: 'Invalid format for the specified content type'
      }
    },
    
    quality: {
      type: String,
      enum: {
        values: ['low', 'medium', 'high', 'ultra'],
        message: 'Quality must be low, medium, high, or ultra'
      },
      default: 'medium'
    },
    
    // Additional metadata fields
    resolution: {
      width: { type: Number, min: 1 },
      height: { type: Number, min: 1 }
    },
    
    bitrate: { type: Number, min: 1 }, // For audio/video content
    
    thumbnailUrl: {
      type: String,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^https?:\/\/.+/.test(value);
        },
        message: 'Thumbnail URL must be a valid HTTP/HTTPS URL'
      }
    }
  },
  
  // File storage information
  fileUrl: {
    type: String,
    required: [true, 'File URL is required'],
    validate: {
      validator: function(value) {
        return /^https?:\/\/.+/.test(value);
      },
      message: 'File URL must be a valid HTTP/HTTPS URL'
    }
  },
  
  // Artist and royalty information
  artistId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Artist ID is required'],
    index: true
  },
  
  royaltyPercentage: {
    type: Number,
    required: [true, 'Royalty percentage is required'],
    min: [0, 'Royalty percentage cannot be negative'],
    max: [100, 'Royalty percentage cannot exceed 100'],
    default: 0
  },
  
  isExclusive: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Content status and visibility
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  isPublished: {
    type: Boolean,
    default: false,
    index: true
  },
  
  isLive: {
    type: Boolean,
    default: false,
    index: true,
    validate: {
      validator: function(value) {
        // Only video content can be live
        if (value && this.contentType !== 'video') {
          return false;
        }
        return true;
      },
      message: 'Only video content can be live'
    }
  },
  
  // Publishing schedule
  publishedAt: {
    type: Date,
    validate: {
      validator: function(value) {
        if (this.isPublished && !value) {
          return false;
        }
        return true;
      },
      message: 'Published date is required when content is published'
    }
  },
  
  scheduledPublishAt: {
    type: Date,
    validate: {
      validator: function(value) {
        if (value && value <= new Date()) {
          return false;
        }
        return true;
      },
      message: 'Scheduled publish date must be in the future'
    }
  },
  
  // Analytics and engagement metrics
  analytics: {
    viewCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    downloadCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    shareCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    uniqueViewers: [{
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      viewedAt: { type: Date, default: Date.now },
      duration: { type: Number, min: 0 } // Time spent viewing
    }],
    
    lastViewedAt: {
      type: Date
    },
    
    engagementRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  
  // Content categories and tags
  categories: [{
    type: String,
    trim: true,
    maxlength: [50, 'Category name cannot exceed 50 characters']
  }],
  
  tags: [{
    type: String,
    trim: true,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  
  // Content series/collection information
  seriesId: {
    type: Schema.Types.ObjectId,
    ref: 'ContentSeries'
  },
  
  episodeNumber: {
    type: Number,
    min: 1,
    validate: {
      validator: function(value) {
        // Episode number is required if part of a series
        if (this.seriesId && !value) {
          return false;
        }
        return true;
      },
      message: 'Episode number is required when content is part of a series'
    }
  },
  
  // Soft delete functionality
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  deletedAt: {
    type: Date,
    validate: {
      validator: function(value) {
        if (this.isDeleted && !value) {
          return false;
        }
        return true;
      },
      message: 'Deleted date is required when content is marked as deleted'
    }
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
contentSchema.index({ artistId: 1, contentType: 1 });
contentSchema.index({ requiredTicketIds: 1, accessLevel: 1 });
contentSchema.index({ isActive: 1, isPublished: 1, isDeleted: 1 });
contentSchema.index({ createdAt: -1 });
contentSchema.index({ 'analytics.viewCount': -1 });
contentSchema.index({ categories: 1 });
contentSchema.index({ tags: 1 });
contentSchema.index({ seriesId: 1, episodeNumber: 1 });

// Compound indexes
contentSchema.index({ 
  contentType: 1, 
  accessLevel: 1, 
  isActive: 1, 
  isPublished: 1 
});

// Virtual fields
contentSchema.virtual('formattedDuration').get(function() {
  if (!this.metadata.duration) return null;
  
  const hours = Math.floor(this.metadata.duration / 3600);
  const minutes = Math.floor((this.metadata.duration % 3600) / 60);
  const seconds = this.metadata.duration % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

contentSchema.virtual('formattedFileSize').get(function() {
  const bytes = this.metadata.fileSize;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

contentSchema.virtual('artist', {
  ref: 'User',
  localField: 'artistId',
  foreignField: '_id',
  justOne: true
});

contentSchema.virtual('requiredTickets', {
  ref: 'Ticket',
  localField: 'requiredTicketIds',
  foreignField: '_id'
});

// Pre-save hooks for validation and data processing
contentSchema.pre('save', async function(next) {
  try {
    // Validate content before saving
    await this.validateContent();
    
    // Set published date if publishing for the first time
    if (this.isPublished && !this.publishedAt) {
      this.publishedAt = new Date();
    }
    
    // Clear published date if unpublishing
    if (!this.isPublished && this.publishedAt) {
      this.publishedAt = undefined;
    }
    
    // Update engagement rate
    this.updateEngagementRate();
    
    // Process categories and tags
    this.categories = [...new Set(this.categories.map(cat => cat.toLowerCase()))];
    this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase()))];
    
    next();
  } catch (error) {
    next(error);
  }
});

contentSchema.pre('findOneAndUpdate', async function(next) {
  try {
    const update = this.getUpdate();
    
    // Handle soft delete
    if (update.isDeleted && !update.deletedAt) {
      update.deletedAt = new Date();
    }
    
    // Handle publishing
    if (update.isPublished === true && !update.publishedAt) {
      update.publishedAt = new Date();
    } else if (update.isPublished === false) {
      update.publishedAt = undefined;
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
contentSchema.methods.validateContent = async function() {
  // Validate required tickets exist
  if (this.requiredTicketIds && this.requiredTicketIds.length > 0) {
    const Ticket = mongoose.model('Ticket');
    const tickets = await Ticket.find({ _id: { $in: this.requiredTicketIds } });
    
    if (tickets.length !== this.requiredTicketIds.length) {
      throw new Error('One or more required tickets do not exist');
    }
  }
  
  // Validate artist exists
  const User = mongoose.model('User');
  const artist = await User.findById(this.artistId);
  if (!artist) {
    throw new Error('Artist does not exist');
  }
  
  return true;
};

contentSchema.methods.incrementView = async function(userId = null, duration = 0) {
  this.analytics.viewCount += 1;
  this.analytics.lastViewedAt = new Date();
  
  if (userId) {
    // Check if user has already viewed this content
    const existingView = this.analytics.uniqueViewers.find(
      viewer => viewer.userId.toString() === userId.toString()
    );
    
    if (!existingView) {
      this.analytics.uniqueViewers.push({
        userId,
        viewedAt: new Date(),
        duration
      });
    } else {
      // Update existing view
      existingView.viewedAt = new Date();
      existingView.duration = Math.max(existingView.duration, duration);
    }
  }
  
  this.updateEngagementRate();
  await this.save();
};

contentSchema.methods.incrementDownload = async function() {
  this.analytics.downloadCount += 1;
  this.updateEngagementRate();
  await this.save();
};

contentSchema.methods.incrementShare = async function() {
  this.analytics.shareCount += 1;
  this.updateEngagementRate();
  await this.save();
};

contentSchema.methods.updateEngagementRate = function() {
  const totalEngagements = this.analytics.downloadCount + this.analytics.shareCount;
  const views = this.analytics.viewCount || 1; // Avoid division by zero
  this.analytics.engagementRate = Math.round((totalEngagements / views) * 100 * 100) / 100;
};

contentSchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.isActive = false;
  this.isPublished = false;
  await this.save();
};

contentSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.isActive = true;
  await this.save();
};

// Static methods
contentSchema.statics.findByTicketId = function(ticketId, options = {}) {
  const query = {
    requiredTicketIds: ticketId,
    isActive: true,
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .populate('artistId', 'username displayName avatar')
    .populate('requiredTicketIds', 'name type accessLevel')
    .sort({ createdAt: -1 });
};

contentSchema.statics.findByArtist = function(artistId, options = {}) {
  const query = {
    artistId,
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .populate('requiredTicketIds', 'name type accessLevel')
    .sort({ createdAt: -1 });
};

contentSchema.statics.findPublished = function(filters = {}) {
  const query = {
    isActive: true,
    isPublished: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('artistId', 'username displayName avatar')
    .populate('requiredTicketIds', 'name type accessLevel')
    .sort({ publishedAt: -1 });
};

contentSchema.statics.findByAccessLevel = function(accessLevel, options = {}) {
  const query = {
    accessLevel,
    isActive: true,
    isPublished: true,
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .populate('artistId', 'username displayName avatar')
    .populate('requiredTicketIds', 'name type accessLevel')
    .sort({ createdAt: -1 });
};

contentSchema.statics.findByContentType = function(contentType, options = {}) {
  const query = {
    contentType,
    isActive: true,
    isPublished: true,
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .populate('artistId', 'username displayName avatar')
    .populate('requiredTicketIds', 'name type accessLevel')
    .sort({ createdAt: -1 });
};

contentSchema.statics.getAnalyticsSummary = async function(artistId = null) {
  const matchStage = {
    isDeleted: false
  };
  
  if (artistId) {
    matchStage.artistId = new mongoose.Types.ObjectId(artistId);
  }
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalContent: { $sum: 1 },
        totalViews: { $sum: '$analytics.viewCount' },
        totalDownloads: { $sum: '$analytics.downloadCount' },
        totalShares: { $sum: '$analytics.shareCount' },
        avgEngagementRate: { $avg: '$analytics.engagementRate' },
        contentByType: {
          $push: {
            type: '$contentType',
            count: 1
          }
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalContent: 0,
    totalViews: 0,
    totalDownloads: 0,
    totalShares: 0,
    avgEngagementRate: 0,
    contentByType: []
  };
};

contentSchema.statics.searchContent = function(searchTerm, filters = {}) {
  const searchQuery = {
    $or: [
      { title: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { categories: { $regex: searchTerm, $options: 'i' } },
      { tags: { $regex: searchTerm, $options: 'i' } }
    ],
    isActive: true,
    isPublished: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .populate('artistId', 'username displayName avatar')
    .populate('requiredTicketIds', 'name type accessLevel')
    .sort({ 'analytics.viewCount': -1, createdAt: -1 });
};

// Query helpers
contentSchema.query.active = function() {
  return this.where({ isActive: true, isDeleted: false });
};

contentSchema.query.published = function() {
  return this.where({ isPublished: true });
};

contentSchema.query.byAccessLevel = function(level) {
  return this.where({ accessLevel: level });
};

contentSchema.query.byContentType = function(type) {
  return this.where({ contentType: type });
};

module.exports = mongoose.model('Content', contentSchema);
