// models/User.js - Comprehensive User model for TicketToken platform

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const Schema = mongoose.Schema;

// Wallet Address Sub-schema
const WalletAddressSchema = new Schema({
  address: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(address) {
        // Solana address validation (base58, 32-44 characters)
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      },
      message: 'Invalid Solana wallet address format'
    }
  },
  walletType: {
    type: String,
    enum: ['phantom', 'solflare', 'sollet', 'slope', 'backpack', 'other'],
    default: 'other'
  },
  publicKey: {
    type: String,
    default: function() {
      return this.address; // In Solana, address is the public key
    }
  },
  isPrimary: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: false
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  label: {
    type: String,
    maxlength: 50,
    trim: true
  },
  lastUsedAt: Date
}, { _id: true });

// Social Connections Sub-schema
const SocialConnectionsSchema = new Schema({
  twitter: {
    type: String,
    trim: true,
    validate: {
      validator: function(handle) {
        if (!handle) return true;
        return /^@?[A-Za-z0-9_]{1,15}$|^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[A-Za-z0-9_]{1,15}\/?$/.test(handle);
      },
      message: 'Invalid Twitter handle or URL'
    }
  },
  instagram: {
    type: String,
    trim: true,
    validate: {
      validator: function(handle) {
        if (!handle) return true;
        return /^@?[A-Za-z0-9_.]{1,30}$|^https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/.test(handle);
      },
      message: 'Invalid Instagram handle or URL'
    }
  },
  discord: {
    type: String,
    trim: true,
    validate: {
      validator: function(handle) {
        if (!handle) return true;
        return /^.{3,32}#[0-9]{4}$|^@?[A-Za-z0-9_.]{2,32}$/.test(handle);
      },
      message: 'Invalid Discord username'
    }
  },
  telegram: {
    type: String,
    trim: true,
    validate: {
      validator: function(handle) {
        if (!handle) return true;
        return /^@?[A-Za-z0-9_]{5,32}$|^https?:\/\/(www\.)?t\.me\/[A-Za-z0-9_]{5,32}\/?$/.test(handle);
      },
      message: 'Invalid Telegram username'
    }
  },
  website: {
    type: String,
    trim: true,
    validate: {
      validator: function(url) {
        if (!url) return true;
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      },
      message: 'Invalid website URL'
    }
  },
  linkedin: {
    type: String,
    trim: true,
    validate: {
      validator: function(url) {
        if (!url) return true;
        return /^https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9\-\.]+\/?$/.test(url);
      },
      message: 'Invalid LinkedIn URL'
    }
  },
  github: {
    type: String,
    trim: true,
    validate: {
      validator: function(handle) {
        if (!handle) return true;
        return /^@?[A-Za-z0-9\-]{1,39}$|^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9\-]{1,39}\/?$/.test(handle);
      },
      message: 'Invalid GitHub username or URL'
    }
  }
}, { _id: false });

// Preferences Sub-schema
const PreferencesSchema = new Schema({
  notifications: {
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
    events: { type: Boolean, default: true },
    tickets: { type: Boolean, default: true },
    content: { type: Boolean, default: true },
    marketplace: { type: Boolean, default: true }
  },
  privacy: {
    showEmail: { type: Boolean, default: false },
    showWallet: { type: Boolean, default: false },
    allowMessaging: { type: Boolean, default: true },
    profileVisibility: {
      type: String,
      enum: ['public', 'private', 'friends'],
      default: 'public'
    },
    showActivity: { type: Boolean, default: true },
    showStats: { type: Boolean, default: true }
  },
  language: {
    type: String,
    enum: ['en', 'es', 'fr', 'de', 'pt', 'jp', 'zh', 'ko'],
    default: 'en'
  },
  currency: {
    type: String,
    enum: ['USD', 'EUR', 'GBP', 'SOL', 'BTC', 'ETH', 'USDC'],
    default: 'USD'
  },
  theme: {
    type: String,
    enum: ['light', 'dark', 'auto'],
    default: 'light'
  },
  timezone: {
    type: String,
    default: 'UTC'
  }
}, { _id: false });

// Analytics/Stats Sub-schema
const StatsSchema = new Schema({
  profileViews: { type: Number, default: 0 },
  ticketsPurchased: { type: Number, default: 0 },
  ticketsSold: { type: Number, default: 0 },
  eventsAttended: { type: Number, default: 0 },
  contentAccessed: { type: Number, default: 0 },
  nftsOwned: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 }
}, { _id: false });

// Verification Sub-schema
const VerificationSchema = new Schema({
  email: {
    verified: { type: Boolean, default: false },
    verificationToken: String,
    verificationExpires: Date,
    verifiedAt: Date
  },
  phone: {
    verified: { type: Boolean, default: false },
    verificationCode: String,
    verificationExpires: Date,
    verifiedAt: Date
  },
  identity: {
    verified: { type: Boolean, default: false },
    kycStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'not_submitted'],
      default: 'not_submitted'
    },
    verifiedAt: Date,
    kycProvider: String,
    kycReferenceId: String
  }
}, { _id: false });

// Main User Schema
const UserSchema = new Schema({
  // Unique identifiers
  userId: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4()
  },
  
  // Basic profile information
  username: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true, // Allows null values while maintaining uniqueness
    minlength: 3,
    maxlength: 20,
    validate: {
      validator: function(username) {
        if (!username) return true; // Allow null/undefined for sparse index
        return /^[a-zA-Z0-9_]{3,20}$/.test(username);
      },
      message: 'Username must be 3-20 characters, alphanumeric and underscore only'
    }
  },
  
  email: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true, // Allows null values while maintaining uniqueness
    validate: {
      validator: function(email) {
        if (!email) return true; // Allow null/undefined for sparse index
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      },
      message: 'Invalid email format'
    }
  },
  
  displayName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50,
    default: function() {
      return `User-${this.userId.substring(0, 8)}`;
    }
  },
  
  bio: {
    type: String,
    trim: true,
    maxlength: 500
  },
  
  profileImage: {
    type: String,
    trim: true,
    validate: {
      validator: function(url) {
        if (!url) return true;
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      },
      message: 'Invalid profile image URL'
    }
  },
  
  // Authentication
  passwordHash: {
    type: String,
    select: false // Don't include in queries by default
  },
  
  authMethod: {
    type: String,
    enum: ['email', 'wallet', 'social'],
    required: true,
    default: 'email'
  },
  
  // Wallet integration
  walletAddresses: [WalletAddressSchema],
  
  // User role and permissions
  role: {
    type: String,
    enum: ['user', 'organizer', 'artist', 'admin', 'moderator'],
    default: 'user'
  },
  
  permissions: [{
    type: String,
    enum: ['create_events', 'manage_content', 'moderate_users', 'view_analytics', 'manage_marketplace']
  }],
  
  // Account status
  isActive: {
    type: Boolean,
    default: true
  },
  
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  
  isBanned: {
    type: Boolean,
    default: false
  },
  
  banReason: String,
  banExpiresAt: Date,
  
  // Social connections
  socialConnections: SocialConnectionsSchema,
  
  // User preferences
  preferences: {
    type: PreferencesSchema,
    default: () => ({})
  },
  
  // Analytics and statistics
  stats: {
    type: StatsSchema,
    default: () => ({})
  },
  
  // Verification information
  verification: {
    type: VerificationSchema,
    default: () => ({})
  },
  
  // Login tracking
  lastLoginAt: Date,
  loginCount: {
    type: Number,
    default: 0
  },
  lastLoginIP: String,
  lastLoginUserAgent: String,
  
  // Password reset
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  // Email verification
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  
  // Account recovery
  recoveryEmail: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(email) {
        if (!email) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      },
      message: 'Invalid recovery email format'
    }
  },
  
  // Metadata for additional information
  metadata: {
    type: Map,
    of: Schema.Types.Mixed,
    default: new Map()
  },
  
  // Location (optional)
  location: {
    country: String,
    city: String,
    timezone: String
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
  
  deletedAt: Date // For soft deletes
}, {
  timestamps: true, // Automatically manage createdAt and updatedAt
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Remove sensitive fields from JSON output
      delete ret.passwordHash;
      delete ret.resetPasswordToken;
      delete ret.emailVerificationToken;
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance optimization
UserSchema.index({ userId: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
UserSchema.index({ 'walletAddresses.address': 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ isActive: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ lastLoginAt: -1 });
UserSchema.index({ displayName: 'text', bio: 'text' }); // Text search index

// Compound indexes
UserSchema.index({ isActive: 1, role: 1 });
UserSchema.index({ isActive: 1, isBanned: 1 });

// Virtual fields
UserSchema.virtual('fullProfile').get(function() {
  return {
    id: this._id,
    userId: this.userId,
    username: this.username,
    email: this.email,
    displayName: this.displayName,
    bio: this.bio,
    profileImage: this.profileImage,
    role: this.role,
    walletAddresses: this.walletAddresses,
    socialConnections: this.socialConnections,
    preferences: this.preferences,
    verification: this.verification,
    isActive: this.isActive,
    isEmailVerified: this.isEmailVerified,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt
  };
});

UserSchema.virtual('primaryWallet').get(function() {
  return this.walletAddresses.find(wallet => wallet.isPrimary) || null;
});

UserSchema.virtual('accountAge').get(function() {
  return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60 * 60 * 24));
});

UserSchema.virtual('isVerified').get(function() {
  return this.verification?.email?.verified || this.verification?.identity?.verified || false;
});

// Pre-save middleware for password hashing
UserSchema.pre('save', async function(next) {
  // Update timestamp
  this.updatedAt = new Date();
  
  // Hash password if it's new or modified
  if (this.isModified('passwordHash') && this.passwordHash) {
    try {
      const salt = await bcrypt.genSalt(12);
      this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    } catch (error) {
      return next(error);
    }
  }
  
  // Ensure only one primary wallet
  if (this.isModified('walletAddresses')) {
    const primaryWallets = this.walletAddresses.filter(wallet => wallet.isPrimary);
    if (primaryWallets.length > 1) {
      // Keep only the first primary wallet
      this.walletAddresses.forEach((wallet, index) => {
        if (index > 0 && wallet.isPrimary) {
          wallet.isPrimary = false;
        }
      });
    } else if (primaryWallets.length === 0 && this.walletAddresses.length > 0) {
      // Set first wallet as primary if none is set
      this.walletAddresses[0].isPrimary = true;
    }
  }
  
  // Set email verification status
  if (this.isModified('email') && this.email) {
    this.isEmailVerified = false;
    this.verification.email.verified = false;
  }
  
  next();
});

// Instance Methods

// Compare password for authentication
UserSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.passwordHash) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.passwordHash);
};

// Generate JWT authentication token
UserSchema.methods.generateAuthToken = function() {
  return jwt.sign(
    { 
      id: this._id,
      userId: this.userId,
      role: this.role 
    },
    process.env.JWT_SECRET,
    { 
      expiresIn: process.env.JWT_EXPIRES_IN || '30d' 
    }
  );
};

// Update login statistics
UserSchema.methods.updateLoginStats = async function(ipAddress, userAgent) {
  this.lastLoginAt = new Date();
  this.loginCount += 1;
  this.lastLoginIP = ipAddress;
  this.lastLoginUserAgent = userAgent;
  return await this.save();
};

// Generate password reset token
UserSchema.methods.generatePasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  
  return resetToken;
};

// Generate email verification token
UserSchema.methods.generateEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
    
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  
  return verificationToken;
};

// Add wallet address
UserSchema.methods.addWalletAddress = function(walletData) {
  const { address, walletType, isPrimary, label } = walletData;
  
  // Check if wallet already exists
  const existingWallet = this.walletAddresses.find(w => w.address === address);
  if (existingWallet) {
    throw new Error('Wallet address already exists');
  }
  
  // If setting as primary, remove primary from others
  if (isPrimary) {
    this.walletAddresses.forEach(wallet => {
      wallet.isPrimary = false;
    });
  }
  
  // Add new wallet
  this.walletAddresses.push({
    address,
    walletType: walletType || 'other',
    isPrimary: isPrimary || this.walletAddresses.length === 0,
    label: label || '',
    verified: false,
    addedAt: new Date()
  });
  
  return this.save();
};

// Remove wallet address
UserSchema.methods.removeWalletAddress = function(address) {
  const walletIndex = this.walletAddresses.findIndex(w => w.address === address);
  
  if (walletIndex === -1) {
    throw new Error('Wallet address not found');
  }
  
  // Check if this is the only wallet for wallet-auth users
  if (this.authMethod === 'wallet' && this.walletAddresses.length === 1) {
    throw new Error('Cannot remove the last wallet from a wallet-authenticated account');
  }
  
  const removedWallet = this.walletAddresses[walletIndex];
  this.walletAddresses.splice(walletIndex, 1);
  
  // If removed wallet was primary, set another as primary
  if (removedWallet.isPrimary && this.walletAddresses.length > 0) {
    this.walletAddresses[0].isPrimary = true;
  }
  
  return this.save();
};

// Set primary wallet
UserSchema.methods.setPrimaryWallet = function(address) {
  const wallet = this.walletAddresses.find(w => w.address === address);
  
  if (!wallet) {
    throw new Error('Wallet address not found');
  }
  
  // Remove primary from all wallets
  this.walletAddresses.forEach(w => {
    w.isPrimary = false;
  });
  
  // Set the specified wallet as primary
  wallet.isPrimary = true;
  
  return this.save();
};

// Update user statistics
UserSchema.methods.updateStats = function(statType, value = 1) {
  if (!this.stats) {
    this.stats = {};
  }
  
  switch(statType) {
    case 'profileView':
      this.stats.profileViews = (this.stats.profileViews || 0) + value;
      break;
    case 'ticketPurchase':
      this.stats.ticketsPurchased = (this.stats.ticketsPurchased || 0) + value;
      break;
    case 'ticketSale':
      this.stats.ticketsSold = (this.stats.ticketsSold || 0) + value;
      break;
    case 'eventAttendance':
      this.stats.eventsAttended = (this.stats.eventsAttended || 0) + value;
      break;
    case 'contentAccess':
      this.stats.contentAccessed = (this.stats.contentAccessed || 0) + value;
      break;
    case 'nftUpdate':
      this.stats.nftsOwned = value;
      break;
    case 'spending':
      this.stats.totalSpent = (this.stats.totalSpent || 0) + value;
      break;
    case 'earning':
      this.stats.totalEarned = (this.stats.totalEarned || 0) + value;
      break;
  }
  
  return this.save();
};

// Soft delete user
UserSchema.methods.softDelete = function() {
  this.deletedAt = new Date();
  this.isActive = false;
  return this.save();
};

// Restore soft deleted user
UserSchema.methods.restore = function() {
  this.deletedAt = undefined;
  this.isActive = true;
  return this.save();
};

// Static Methods

// Find user by wallet address
UserSchema.statics.findByWallet = function(walletAddress) {
  return this.findOne({
    'walletAddresses.address': walletAddress,
    isActive: true,
    deletedAt: { $exists: false }
  });
};

// Find user by email or username
UserSchema.statics.findByEmailOrUsername = function(identifier) {
  const query = {
    $or: [
      { email: identifier.toLowerCase() },
      { username: identifier.toLowerCase() }
    ],
    isActive: true,
    deletedAt: { $exists: false }
  };
  
  return this.findOne(query);
};

// Get user statistics
UserSchema.statics.getUserStats = async function() {
  const pipeline = [
    {
      $match: {
        isActive: true,
        deletedAt: { $exists: false }
      }
    },
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        verifiedUsers: {
          $sum: {
            $cond: [{ $eq: ['$isEmailVerified', true] }, 1, 0]
          }
        },
        walletUsers: {
          $sum: {
            $cond: [{ $gt: [{ $size: '$walletAddresses' }, 0] }, 1, 0]
          }
        },
        activeUsers: {
          $sum: {
            $cond: [
              {
                $gte: [
                  '$lastLoginAt',
                  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                ]
              },
              1,
              0
            ]
          }
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalUsers: 0,
    verifiedUsers: 0,
    walletUsers: 0,
    activeUsers: 0
  };
};

// Search users
UserSchema.statics.searchUsers = function(searchTerm, options = {}) {
  const {
    limit = 20,
    skip = 0,
    role = null,
    isActive = true
  } = options;
  
  const query = {
    $text: { $search: searchTerm },
    isActive,
    deletedAt: { $exists: false }
  };
  
  if (role) {
    query.role = role;
  }
  
  return this.find(query, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .skip(skip)
    .select('-passwordHash');
};

// Create indexes after schema compilation
UserSchema.post('init', function() {
  // Ensure indexes are created
  this.constructor.createIndexes();
});

// Export the model
const User = mongoose.model('User', UserSchema);

module.exports = User;
