const mongoose = require('mongoose');
const { Schema } = mongoose;

// Social media links schema
const socialMediaSchema = new Schema({
  platform: {
    type: String,
    required: true,
    enum: ['instagram', 'twitter', 'spotify', 'youtube', 'soundcloud', 'tiktok', 'facebook', 'bandcamp', 'apple_music']
  },
  username: {
    type: String,
    required: true,
    trim: true,
    maxlength: [100, 'Username cannot exceed 100 characters']
  },
  url: {
    type: String,
    required: true,
    validate: {
      validator: function(value) {
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Social media URL must be a valid HTTP/HTTPS URL'
    }
  },
  followerCount: {
    type: Number,
    default: 0,
    min: 0
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false,
  timestamps: false
});

// Royalty preferences schema
const royaltyPreferencesSchema = new Schema({
  defaultPercentage: {
    type: Number,
    required: [true, 'Default royalty percentage is required'],
    min: [0, 'Royalty percentage cannot be negative'],
    max: [100, 'Royalty percentage cannot exceed 100'],
    default: 10
  },
  splitType: {
    type: String,
    enum: ['equal', 'custom', 'percentage'],
    default: 'percentage'
  },
  collaboratorSplits: [{
    collaboratorId: {
      type: Schema.Types.ObjectId,
      ref: 'Artist',
      required: true
    },
    percentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    role: {
      type: String,
      enum: ['writer', 'producer', 'performer', 'composer', 'other'],
      default: 'performer'
    }
  }],
  platformRoyalties: {
    streaming: {
      type: Number,
      min: 0,
      max: 100,
      default: 70
    },
    merchandise: {
      type: Number,
      min: 0,
      max: 100,
      default: 85
    },
    tickets: {
      type: Number,
      min: 0,
      max: 100,
      default: 90
    },
    nft: {
      type: Number,
      min: 0,
      max: 100,
      default: 95
    }
  }
}, {
  _id: false,
  timestamps: false
});

// Exclusive content schema
const exclusiveContentSchema = new Schema({
  title: {
    type: String,
    required: [true, 'Content title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  contentType: {
    type: String,
    required: true,
    enum: ['track', 'album', 'video', 'behind_scenes', 'tutorial', 'interview', 'live_session', 'other']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  contentUrl: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Content URL must be a valid HTTP/HTTPS URL'
    }
  },
  thumbnailUrl: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Thumbnail URL must be a valid HTTP/HTTPS URL'
    }
  },
  accessLevel: {
    type: String,
    enum: ['free', 'premium', 'vip', 'exclusive'],
    default: 'free'
  },
  releaseDate: {
    type: Date,
    default: Date.now
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  likeCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  _id: true,
  timestamps: true
});

// Upcoming releases schema
const upcomingReleaseSchema = new Schema({
  title: {
    type: String,
    required: [true, 'Release title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  releaseType: {
    type: String,
    required: true,
    enum: ['single', 'ep', 'album', 'mixtape', 'compilation', 'live_album']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  coverArtUrl: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Cover art URL must be a valid HTTP/HTTPS URL'
    }
  },
  releaseDate: {
    type: Date,
    required: [true, 'Release date is required'],
    validate: {
      validator: function(value) {
        return value >= new Date();
      },
      message: 'Release date must be in the future'
    }
  },
  preOrderDate: {
    type: Date,
    validate: {
      validator: function(value) {
        if (value && this.releaseDate) {
          return value < this.releaseDate;
        }
        return true;
      },
      message: 'Pre-order date must be before release date'
    }
  },
  trackCount: {
    type: Number,
    min: 1,
    default: 1
  },
  collaborators: [{
    artistId: {
      type: Schema.Types.ObjectId,
      ref: 'Artist',
      required: true
    },
    role: {
      type: String,
      enum: ['featured', 'producer', 'writer', 'mixer', 'mastered_by'],
      default: 'featured'
    }
  }],
  genres: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [50, 'Genre cannot exceed 50 characters']
  }],
  isAnnounced: {
    type: Boolean,
    default: false
  },
  announcementDate: {
    type: Date
  }
}, {
  _id: true,
  timestamps: true
});

// Fan message schema
const fanMessageSchema = new Schema({
  fromUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: [true, 'Message content is required'],
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  messageType: {
    type: String,
    enum: ['fan_mail', 'collaboration_request', 'booking_inquiry', 'general'],
    default: 'general'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isReplied: {
    type: Boolean,
    default: false
  },
  reply: {
    message: {
      type: String,
      trim: true,
      maxlength: [1000, 'Reply cannot exceed 1000 characters']
    },
    repliedAt: {
      type: Date
    }
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  }
}, {
  _id: true,
  timestamps: true
});

// Announcement schema
const announcementSchema = new Schema({
  title: {
    type: String,
    required: [true, 'Announcement title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  content: {
    type: String,
    required: [true, 'Announcement content is required'],
    trim: true,
    maxlength: [2000, 'Content cannot exceed 2000 characters']
  },
  announcementType: {
    type: String,
    enum: ['general', 'release', 'tour', 'collaboration', 'merchandise', 'exclusive_content'],
    default: 'general'
  },
  imageUrl: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Image URL must be a valid HTTP/HTTPS URL'
    }
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  publishedAt: {
    type: Date
  },
  scheduledFor: {
    type: Date,
    validate: {
      validator: function(value) {
        if (value && value <= new Date()) {
          return false;
        }
        return true;
      },
      message: 'Scheduled time must be in the future'
    }
  },
  targetAudience: {
    type: String,
    enum: ['all_fans', 'premium_fans', 'vip_fans', 'local_fans'],
    default: 'all_fans'
  },
  engagement: {
    viewCount: {
      type: Number,
      default: 0,
      min: 0
    },
    likeCount: {
      type: Number,
      default: 0,
      min: 0
    },
    shareCount: {
      type: Number,
      default: 0,
      min: 0
    },
    commentCount: {
      type: Number,
      default: 0,
      min: 0
    }
  }
}, {
  _id: true,
  timestamps: true
});

// Collaborator schema
const collaboratorSchema = new Schema({
  artistId: {
    type: Schema.Types.ObjectId,
    ref: 'Artist',
    required: true
  },
  collaborationType: {
    type: String,
    enum: ['featured', 'producer', 'writer', 'remixer', 'band_member', 'recurring'],
    default: 'featured'
  },
  projectsCount: {
    type: Number,
    default: 1,
    min: 1
  },
  totalEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  }
}, {
  _id: false,
  timestamps: true
});

// Main artist schema
const artistSchema = new Schema({
  // Core user reference
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true,
    index: true
  },
  
  // Artist profile information
  stageName: {
    type: String,
    required: [true, 'Stage name is required'],
    trim: true,
    maxlength: [100, 'Stage name cannot exceed 100 characters'],
    index: true
  },
  
  bio: {
    type: String,
    trim: true,
    maxlength: [2000, 'Bio cannot exceed 2000 characters']
  },
  
  genres: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [50, 'Genre cannot exceed 50 characters'],
    index: true
  }],
  
  website: {
    type: String,
    trim: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Website must be a valid HTTP/HTTPS URL'
    }
  },
  
  // Artist verification
  verification: {
    isVerified: {
      type: Boolean,
      default: false,
      index: true
    },
    verificationBadge: {
      type: String,
      enum: ['blue', 'gold', 'platinum', 'diamond'],
      validate: {
        validator: function(value) {
          if (value && !this.verification.isVerified) {
            return false;
          }
          return true;
        },
        message: 'Verification badge can only be set if artist is verified'
      }
    },
    verificationDate: {
      type: Date,
      validate: {
        validator: function(value) {
          if (this.verification.isVerified && !value) {
            return false;
          }
          return true;
        },
        message: 'Verification date is required when artist is verified'
      }
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    verificationDocuments: [{
      documentType: {
        type: String,
        enum: ['identity', 'music_copyright', 'label_contract', 'publisher_agreement', 'other'],
        required: true
      },
      documentUrl: {
        type: String,
        required: true,
        validate: {
          validator: function(value) {
            return /^https?:\/\/.+/.test(value);
          },
          message: 'Document URL must be a valid HTTP/HTTPS URL'
        }
      },
      uploadedAt: {
        type: Date,
        default: Date.now
      },
      isApproved: {
        type: Boolean,
        default: false
      }
    }]
  },
  
  // Social media presence
  socialMedia: [socialMediaSchema],
  
  // Financial information
  financial: {
    walletAddress: {
      type: String,
      trim: true,
      validate: {
        validator: function(value) {
          if (!value) return true;
          // Basic validation for common blockchain wallet formats
          return /^[A-Za-z0-9]{32,44}$/.test(value) || /^0x[a-fA-F0-9]{40}$/.test(value);
        },
        message: 'Invalid wallet address format'
      },
      index: true
    },
    royaltyPreferences: royaltyPreferencesSchema,
    payoutSchedule: {
      frequency: {
        type: String,
        enum: ['weekly', 'monthly', 'quarterly', 'annually'],
        default: 'monthly'
      },
      minimumAmount: {
        type: Number,
        min: [0, 'Minimum payout amount cannot be negative'],
        default: 50
      },
      currency: {
        type: String,
        enum: ['USD', 'SOL', 'ETH', 'USDC'],
        default: 'USD'
      },
      nextPayoutDate: {
        type: Date
      }
    },
    totalEarnings: {
      lifetime: {
        type: Number,
        default: 0,
        min: 0
      },
      currentMonth: {
        type: Number,
        default: 0,
        min: 0
      },
      currentYear: {
        type: Number,
        default: 0,
        min: 0
      }
    },
    pendingPayouts: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Content management
  exclusiveContent: [exclusiveContentSchema],
  upcomingReleases: [upcomingReleaseSchema],
  
  // Analytics and metrics
  analytics: {
    totalFollowers: {
      type: Number,
      default: 0,
      min: 0,
      index: true
    },
    totalStreams: {
      type: Number,
      default: 0,
      min: 0
    },
    totalRevenue: {
      type: Number,
      default: 0,
      min: 0
    },
    monthlyListeners: {
      type: Number,
      default: 0,
      min: 0
    },
    topCountries: [{
      country: {
        type: String,
        required: true
      },
      percentage: {
        type: Number,
        min: 0,
        max: 100,
        required: true
      }
    }],
    topSongs: [{
      songTitle: {
        type: String,
        required: true
      },
      streams: {
        type: Number,
        min: 0,
        required: true
      },
      revenue: {
        type: Number,
        min: 0,
        default: 0
      }
    }],
    engagementRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    fanDemographics: {
      ageGroups: [{
        range: {
          type: String,
          enum: ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'],
          required: true
        },
        percentage: {
          type: Number,
          min: 0,
          max: 100,
          required: true
        }
      }],
      genderSplit: {
        male: {
          type: Number,
          min: 0,
          max: 100,
          default: 0
        },
        female: {
          type: Number,
          min: 0,
          max: 100,
          default: 0
        },
        other: {
          type: Number,
          min: 0,
          max: 100,
          default: 0
        }
      }
    }
  },
  
  // Fan engagement
  fanMessages: [fanMessageSchema],
  announcements: [announcementSchema],
  
  fanEngagement: {
    responseRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    averageResponseTime: {
      type: Number, // in hours
      default: 24,
      min: 0
    },
    totalFanInteractions: {
      type: Number,
      default: 0,
      min: 0
    },
    fanClubMembers: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Collaboration information
  collaborators: [collaboratorSchema],
  
  featuredIn: [{
    artistId: {
      type: Schema.Types.ObjectId,
      ref: 'Artist',
      required: true
    },
    songTitle: {
      type: String,
      required: true,
      trim: true
    },
    role: {
      type: String,
      enum: ['featured', 'producer', 'writer', 'remixer'],
      default: 'featured'
    },
    releaseDate: {
      type: Date,
      required: true
    },
    streams: {
      type: Number,
      default: 0,
      min: 0
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  
  // Artist settings and preferences
  settings: {
    isPublicProfile: {
      type: Boolean,
      default: true
    },
    allowFanMessages: {
      type: Boolean,
      default: true
    },
    allowCollaborationRequests: {
      type: Boolean,
      default: true
    },
    autoReplyEnabled: {
      type: Boolean,
      default: false
    },
    autoReplyMessage: {
      type: String,
      trim: true,
      maxlength: [500, 'Auto-reply message cannot exceed 500 characters']
    },
    notificationPreferences: {
      newFollower: {
        type: Boolean,
        default: true
      },
      newMessage: {
        type: Boolean,
        default: true
      },
      collaborationRequest: {
        type: Boolean,
        default: true
      },
      payoutReady: {
        type: Boolean,
        default: true
      },
      streamingMilestone: {
        type: Boolean,
        default: true
      }
    }
  },
  
  // Artist status
  status: {
    type: String,
    enum: ['active', 'hiatus', 'retired', 'suspended'],
    default: 'active',
    index: true
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
artistSchema.index({ stageName: 'text', bio: 'text' });
artistSchema.index({ genres: 1, 'verification.isVerified': 1 });
artistSchema.index({ 'analytics.totalFollowers': -1 });
artistSchema.index({ 'analytics.totalStreams': -1 });
artistSchema.index({ 'analytics.totalRevenue': -1 });
artistSchema.index({ status: 1, isDeleted: 1 });
artistSchema.index({ createdAt: -1 });

// Compound indexes
artistSchema.index({ 
  'verification.isVerified': 1, 
  status: 1, 
  'analytics.totalFollowers': -1 
});

// Virtual fields
artistSchema.virtual('totalSocialFollowers').get(function() {
  return this.socialMedia.reduce((total, platform) => {
    return total + (platform.followerCount || 0);
  }, 0);
});

artistSchema.virtual('averageEngagement').get(function() {
  const totalInteractions = this.fanEngagement.totalFanInteractions || 0;
  const totalFollowers = this.analytics.totalFollowers || 1;
  return Math.round((totalInteractions / totalFollowers) * 100 * 100) / 100;
});

artistSchema.virtual('unreadMessageCount').get(function() {
  return this.fanMessages.filter(message => !message.isRead).length;
});

artistSchema.virtual('activeCollaborators').get(function() {
  return this.collaborators.filter(collab => collab.isActive);
});

// Populate virtual references
artistSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Pre-save hooks
artistSchema.pre('save', async function(next) {
  try {
    // Validate artist before saving
    await this.validateArtist();
    
    // Update analytics calculations
    this.updateAnalytics();
    
    // Process genres
    this.genres = [...new Set(this.genres.map(genre => genre.toLowerCase()))];
    
    // Update fan engagement metrics
    this.updateFanEngagement();
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
artistSchema.methods.validateArtist = async function() {
  // Validate user exists
  const User = mongoose.model('User');
  const user = await User.findById(this.userId);
  if (!user) {
    throw new Error('Associated user does not exist');
  }
  
  // Validate collaborators exist
  if (this.collaborators.length > 0) {
    const collaboratorIds = this.collaborators.map(c => c.artistId);
    const existingCollaborators = await this.constructor.find({ 
      _id: { $in: collaboratorIds } 
    });
    
    if (existingCollaborators.length !== collaboratorIds.length) {
      throw new Error('One or more collaborators do not exist');
    }
  }
  
  return true;
};

artistSchema.methods.calculateRoyalties = function(grossRevenue, revenueType = 'streaming') {
  const preferences = this.financial.royaltyPreferences;
  const platformPercentage = preferences.platformRoyalties[revenueType] || 70;
  
  // Calculate artist's share
  const artistShare = (grossRevenue * platformPercentage) / 100;
  
  // Calculate collaborator splits if any
  const collaboratorSplits = [];
  let remainingPercentage = 100;
  
  preferences.collaboratorSplits.forEach(split => {
    const splitAmount = (artistShare * split.percentage) / 100;
    collaboratorSplits.push({
      collaboratorId: split.collaboratorId,
      amount: splitAmount,
      percentage: split.percentage,
      role: split.role
    });
    remainingPercentage -= split.percentage;
  });
  
  // Artist gets the remaining percentage
  const artistAmount = (artistShare * remainingPercentage) / 100;
  
  return {
    totalRevenue: grossRevenue,
    artistShare: artistShare,
    artistAmount: artistAmount,
    collaboratorSplits: collaboratorSplits,
    platformFee: grossRevenue - artistShare
  };
};

artistSchema.methods.sendFanMessage = async function(fromUserId, messageContent, messageType = 'general') {
  if (!this.settings.allowFanMessages) {
    throw new Error('This artist is not accepting fan messages');
  }
  
  const newMessage = {
    fromUserId,
    message: messageContent,
    messageType,
    isRead: false,
    isReplied: false,
    priority: messageType === 'booking_inquiry' ? 'high' : 'medium'
  };
  
  this.fanMessages.push(newMessage);
  this.fanEngagement.totalFanInteractions += 1;
  
  // Send auto-reply if enabled
  if (this.settings.autoReplyEnabled && this.settings.autoReplyMessage) {
    newMessage.reply = {
      message: this.settings.autoReplyMessage,
      repliedAt: new Date()
    };
    newMessage.isReplied = true;
  }
  
  await this.save();
  return newMessage;
};

artistSchema.methods.replyToFanMessage = async function(messageId, replyContent) {
  const message = this.fanMessages.id(messageId);
  if (!message) {
    throw new Error('Message not found');
  }
  
  message.reply = {
    message: replyContent,
    repliedAt: new Date()
  };
  message.isReplied = true;
  message.isRead = true;
  
  this.updateFanEngagement();
  await this.save();
  
  return message;
};

artistSchema.methods.createAnnouncement = async function(announcementData) {
  const newAnnouncement = {
    ...announcementData,
    isPublished: announcementData.scheduledFor ? false : true,
    publishedAt: announcementData.scheduledFor ? null : new Date()
  };
  
  this.announcements.push(newAnnouncement);
  await this.save();
  
  return newAnnouncement;
};

artistSchema.methods.addExclusiveContent = async function(contentData) {
  const newContent = {
    ...contentData,
    releaseDate: contentData.releaseDate || new Date(),
    viewCount: 0,
    likeCount: 0
  };
  
  this.exclusiveContent.push(newContent);
  await this.save();
  
  return newContent;
};

artistSchema.methods.addUpcomingRelease = async function(releaseData) {
  const newRelease = {
    ...releaseData,
    isAnnounced: false
  };
  
  this.upcomingReleases.push(newRelease);
  await this.save();
  
  return newRelease;
};

artistSchema.methods.addCollaborator = async function(artistId, collaborationType = 'featured') {
  // Check if collaborator already exists
  const existingCollab = this.collaborators.find(
    c => c.artistId.toString() === artistId.toString() && c.isActive
  );
  
  if (existingCollab) {
    existingCollab.projectsCount += 1;
    await this.save();
    return existingCollab;
  }
  
  const newCollaborator = {
    artistId,
    collaborationType,
    projectsCount: 1,
    totalEarnings: 0,
    isActive: true,
    startDate: new Date()
  };
  
  this.collaborators.push(newCollaborator);
  await this.save();
  
  return newCollaborator;
};

artistSchema.methods.updateAnalytics = function() {
  // Update engagement rate
  const totalInteractions = this.fanEngagement.totalFanInteractions || 0;
  const totalFollowers = this.analytics.totalFollowers || 1;
  this.analytics.engagementRate = Math.round((totalInteractions / totalFollowers) * 100 * 100) / 100;
  
  // Update social media followers
  this.analytics.totalFollowers = this.totalSocialFollowers;
};

artistSchema.methods.updateFanEngagement = function() {
  const totalMessages = this.fanMessages.length;
  const repliedMessages = this.fanMessages.filter(msg => msg.isReplied).length;
  
  if (totalMessages > 0) {
    this.fanEngagement.responseRate = Math.round((repliedMessages / totalMessages) * 100);
  }
  
  // Calculate average response time
  const repliedMessagesWithTime = this.fanMessages.filter(msg => 
    msg.isReplied && msg.reply.repliedAt
  );
  
  if (repliedMessagesWithTime.length > 0) {
    const totalResponseTime = repliedMessagesWithTime.reduce((total, msg) => {
      const responseTime = msg.reply.repliedAt - msg.createdAt;
      return total + (responseTime / (1000 * 60 * 60)); // Convert to hours
    }, 0);
    
    this.fanEngagement.averageResponseTime = Math.round(
      totalResponseTime / repliedMessagesWithTime.length
    );
  }
};

artistSchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.status = 'suspended';
  await this.save();
};

artistSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.status = 'active';
  await this.save();
};

artistSchema.methods.updateSocialMediaStats = async function(platform, followerCount, isVerified = false) {
  const socialMedia = this.socialMedia.find(sm => sm.platform === platform);
  if (socialMedia) {
    socialMedia.followerCount = followerCount;
    socialMedia.isVerified = isVerified;
    socialMedia.lastUpdated = new Date();
  } else {
    throw new Error(`Social media platform ${platform} not found`);
  }
  
  this.updateAnalytics();
  await this.save();
};

// Static methods
artistSchema.statics.findVerified = function(filters = {}) {
  const query = {
    'verification.isVerified': true,
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('userId', 'username displayName avatar')
    .sort({ 'analytics.totalFollowers': -1 });
};

artistSchema.statics.findByGenre = function(genre, options = {}) {
  const query = {
    genres: { $in: [genre.toLowerCase()] },
    status: 'active',
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .populate('userId', 'username displayName avatar')
    .sort({ 'analytics.totalStreams': -1 });
};

artistSchema.statics.findTopArtists = function(criteria = 'followers', limit = 50, filters = {}) {
  const sortField = {
    followers: 'analytics.totalFollowers',
    streams: 'analytics.totalStreams',
    revenue: 'analytics.totalRevenue',
    engagement: 'analytics.engagementRate'
  }[criteria] || 'analytics.totalFollowers';
  
  const query = {
    status: 'active',
    isDeleted: false,
    [sortField]: { $gt: 0 },
    ...filters
  };
  
  return this.find(query)
    .populate('userId', 'username displayName avatar')
    .sort({ [sortField]: -1 })
    .limit(limit);
};

artistSchema.statics.searchArtists = function(searchTerm, filters = {}) {
  const searchQuery = {
    $or: [
      { stageName: { $regex: searchTerm, $options: 'i' } },
      { bio: { $regex: searchTerm, $options: 'i' } },
      { genres: { $regex: searchTerm, $options: 'i' } }
    ],
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .populate('userId', 'username displayName avatar')
    .sort({ 'analytics.totalFollowers': -1, 'verification.isVerified': -1 });
};

artistSchema.statics.findCollaborators = function(artistId, options = {}) {
  return this.find({
    'collaborators.artistId': artistId,
    'collaborators.isActive': true,
    status: 'active',
    isDeleted: false,
    ...options
  }).populate('userId', 'username displayName avatar');
};

artistSchema.statics.getArtistAnalytics = async function(timeframe = '30d', filters = {}) {
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
        totalArtists: { $sum: 1 },
        verifiedArtists: {
          $sum: { $cond: [{ $eq: ['$verification.isVerified', true] }, 1, 0] }
        },
        activeArtists: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        totalFollowers: { $sum: '$analytics.totalFollowers' },
        totalStreams: { $sum: '$analytics.totalStreams' },
        totalRevenue: { $sum: '$analytics.totalRevenue' },
        averageEngagement: { $avg: '$analytics.engagementRate' },
        topGenres: {
          $push: '$genres'
        },
        totalContent: { $sum: { $size: '$exclusiveContent' } },
        totalAnnouncements: { $sum: { $size: '$announcements' } },
        totalFanMessages: { $sum: { $size: '$fanMessages' } }
      }
    },
    {
      $project: {
        totalArtists: 1,
        verifiedArtists: 1,
        activeArtists: 1,
        totalFollowers: 1,
        totalStreams: 1,
        totalRevenue: 1,
        averageEngagement: { $round: ['$averageEngagement', 2] },
        averageFollowersPerArtist: { 
          $round: [{ $divide: ['$totalFollowers', '$totalArtists'] }, 0] 
        },
        averageStreamsPerArtist: { 
          $round: [{ $divide: ['$totalStreams', '$totalArtists'] }, 0] 
        },
        totalContent: 1,
        totalAnnouncements: 1,
        totalFanMessages: 1
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalArtists: 0,
    verifiedArtists: 0,
    activeArtists: 0,
    totalFollowers: 0,
    totalStreams: 0,
    totalRevenue: 0,
    averageEngagement: 0,
    averageFollowersPerArtist: 0,
    averageStreamsPerArtist: 0,
    totalContent: 0,
    totalAnnouncements: 0,
    totalFanMessages: 0
  };
};

artistSchema.statics.getTopGenres = async function(limit = 10) {
  const pipeline = [
    { 
      $match: { 
        status: 'active', 
        isDeleted: false,
        genres: { $exists: true, $ne: [] }
      } 
    },
    { $unwind: '$genres' },
    {
      $group: {
        _id: '$genres',
        artistCount: { $sum: 1 },
        totalStreams: { $sum: '$analytics.totalStreams' },
        totalFollowers: { $sum: '$analytics.totalFollowers' }
      }
    },
    { $sort: { artistCount: -1 } },
    { $limit: limit },
    {
      $project: {
        genre: '$_id',
        artistCount: 1,
        totalStreams: 1,
        totalFollowers: 1,
        averageStreamsPerArtist: { 
          $round: [{ $divide: ['$totalStreams', '$artistCount'] }, 0] 
        }
      }
    }
  ];
  
  return this.aggregate(pipeline);
};

artistSchema.statics.findUpcomingReleases = function(daysAhead = 30, filters = {}) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead);
  
  const query = {
    'upcomingReleases.releaseDate': {
      $gte: new Date(),
      $lte: endDate
    },
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('userId', 'username displayName avatar')
    .sort({ 'upcomingReleases.releaseDate': 1 });
};

artistSchema.statics.findArtistsNeedingPayout = function() {
  const query = {
    'financial.pendingPayouts': { $gt: 0 },
    'financial.payoutSchedule.nextPayoutDate': { $lte: new Date() },
    status: 'active',
    isDeleted: false
  };
  
  return this.find(query)
    .populate('userId', 'username displayName email')
    .sort({ 'financial.pendingPayouts': -1 });
};

artistSchema.statics.calculateTotalRoyalties = async function(artistId, startDate, endDate) {
  // This would typically integrate with external streaming/sales data
  // For now, return a structure that could be populated with real data
  
  const artist = await this.findById(artistId);
  if (!artist) {
    throw new Error('Artist not found');
  }
  
  // Mock calculation - in production this would query transaction/sales data
  const mockRoyalties = {
    streaming: artist.analytics.totalRevenue * 0.7,
    merchandise: artist.analytics.totalRevenue * 0.15,
    tickets: artist.analytics.totalRevenue * 0.1,
    nft: artist.analytics.totalRevenue * 0.05
  };
  
  const totalRoyalties = Object.values(mockRoyalties).reduce((sum, val) => sum + val, 0);
  
  return {
    artistId: artistId,
    period: { startDate, endDate },
    royaltiesBySource: mockRoyalties,
    totalRoyalties: totalRoyalties,
    calculatedAt: new Date()
  };
};

// Query helpers
artistSchema.query.active = function() {
  return this.where({ status: 'active', isDeleted: false });
};

artistSchema.query.verified = function() {
  return this.where({ 'verification.isVerified': true });
};

artistSchema.query.byGenre = function(genre) {
  return this.where({ genres: { $in: [genre.toLowerCase()] } });
};

artistSchema.query.withMinFollowers = function(count) {
  return this.where({ 'analytics.totalFollowers': { $gte: count } });
};

artistSchema.query.withVerificationBadge = function(badge) {
  return this.where({ 'verification.verificationBadge': badge });
};

artistSchema.query.acceptingMessages = function() {
  return this.where({ 'settings.allowFanMessages': true });
};

artistSchema.query.acceptingCollabs = function() {
  return this.where({ 'settings.allowCollaborationRequests': true });
};

artistSchema.query.topPerformers = function() {
  return this.where({
    'analytics.totalStreams': { $gte: 10000 },
    'analytics.engagementRate': { $gte: 5 }
  }).sort({ 'analytics.totalStreams': -1 });
};

module.exports = mongoose.model('Artist', artistSchema);
