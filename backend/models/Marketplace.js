const mongoose = require('mongoose');
const { Schema } = mongoose;

// Bidder schema for auction listings
const bidderSchema = new Schema({
  bidderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bidAmount: {
    type: Number,
    required: true,
    min: [0, 'Bid amount cannot be negative']
  },
  bidTime: {
    type: Date,
    default: Date.now
  },
  isWinning: {
    type: Boolean,
    default: false
  },
  transactionId: {
    type: String,
    sparse: true
  },
  blockchainTxId: {
    type: String,
    sparse: true
  }
}, {
  _id: true,
  timestamps: false
});

// Offer schema for offer-based listings
const offerSchema = new Schema({
  offerId: {
    type: Schema.Types.ObjectId,
    default: () => new mongoose.Types.ObjectId()
  },
  offererId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  offerAmount: {
    type: Number,
    required: true,
    min: [0, 'Offer amount cannot be negative']
  },
  offerTime: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    validate: {
      validator: function(value) {
        return value > new Date();
      },
      message: 'Offer expiration must be in the future'
    }
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'expired'],
    default: 'pending'
  },
  message: {
    type: String,
    maxlength: [500, 'Offer message cannot exceed 500 characters'],
    trim: true
  }
}, {
  _id: false,
  timestamps: false
});

// Main marketplace listing schema
const marketplaceSchema = new Schema({
  // Core listing information
  ticketId: {
    type: Schema.Types.ObjectId,
    ref: 'Ticket',
    required: [true, 'Ticket ID is required'],
    index: true
  },
  
  sellerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Seller ID is required'],
    index: true
  },
  
  // Pricing and currency
  price: {
    type: Number,
    required: function() {
      return this.listingType === 'fixedPrice';
    },
    min: [0, 'Price cannot be negative'],
    validate: {
      validator: function(value) {
        // Price is required for fixed price listings
        if (this.listingType === 'fixedPrice' && (!value || value <= 0)) {
          return false;
        }
        return true;
      },
      message: 'Price is required for fixed price listings'
    }
  },
  
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    enum: {
      values: ['SOL', 'USD', 'USDC', 'ETH'],
      message: 'Currency must be SOL, USD, USDC, or ETH'
    },
    default: 'SOL',
    index: true
  },
  
  // Listing type and configuration
  listingType: {
    type: String,
    required: [true, 'Listing type is required'],
    enum: {
      values: ['auction', 'fixedPrice', 'offerBased'],
      message: 'Listing type must be auction, fixedPrice, or offerBased'
    },
    index: true
  },
  
  // Auction-specific fields
  auction: {
    startPrice: {
      type: Number,
      required: function() {
        return this.listingType === 'auction';
      },
      min: [0, 'Start price cannot be negative'],
      validate: {
        validator: function(value) {
          if (this.listingType === 'auction' && (!value || value <= 0)) {
            return false;
          }
          return true;
        },
        message: 'Start price is required for auction listings'
      }
    },
    
    reservePrice: {
      type: Number,
      min: [0, 'Reserve price cannot be negative'],
      validate: {
        validator: function(value) {
          if (value && this.auction.startPrice && value < this.auction.startPrice) {
            return false;
          }
          return true;
        },
        message: 'Reserve price must be greater than or equal to start price'
      }
    },
    
    currentBid: {
      type: Number,
      default: 0,
      min: [0, 'Current bid cannot be negative']
    },
    
    minimumBidIncrement: {
      type: Number,
      default: 0.1,
      min: [0.01, 'Minimum bid increment must be at least 0.01']
    },
    
    startTime: {
      type: Date,
      default: Date.now
    },
    
    endTime: {
      type: Date,
      required: function() {
        return this.listingType === 'auction';
      },
      validate: {
        validator: function(value) {
          if (this.listingType === 'auction') {
            if (!value) return false;
            const now = new Date();
            const minDuration = 1 * 60 * 60 * 1000; // 1 hour minimum
            const maxDuration = 30 * 24 * 60 * 60 * 1000; // 30 days maximum
            
            if (value <= now) return false;
            if (value - now < minDuration) return false;
            if (value - now > maxDuration) return false;
          }
          return true;
        },
        message: 'Auction must run for at least 1 hour and maximum 30 days'
      }
    },
    
    bidders: [bidderSchema],
    
    autoExtend: {
      type: Boolean,
      default: true
    },
    
    extensionTime: {
      type: Number, // Minutes to extend when bid placed near end
      default: 10,
      min: [1, 'Extension time must be at least 1 minute'],
      max: [60, 'Extension time cannot exceed 60 minutes']
    }
  },
  
  // Offer-based listing fields
  offers: [offerSchema],
  
  minimumOffer: {
    type: Number,
    min: [0, 'Minimum offer cannot be negative'],
    validate: {
      validator: function(value) {
        if (this.listingType === 'offerBased' && value && value <= 0) {
          return false;
        }
        return true;
      },
      message: 'Minimum offer must be greater than 0 for offer-based listings'
    }
  },
  
  // Listing status
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: {
      values: ['active', 'sold', 'cancelled', 'expired', 'pending'],
      message: 'Status must be active, sold, cancelled, expired, or pending'
    },
    default: 'active',
    index: true
  },
  
  // Financial details
  royalty: {
    artistRoyalty: {
      percentage: {
        type: Number,
        required: [true, 'Artist royalty percentage is required'],
        min: [0, 'Artist royalty cannot be negative'],
        max: [50, 'Artist royalty cannot exceed 50%'],
        default: 5
      },
      recipient: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Artist royalty recipient is required']
      }
    },
    
    platformFee: {
      percentage: {
        type: Number,
        required: [true, 'Platform fee percentage is required'],
        min: [0, 'Platform fee cannot be negative'],
        max: [10, 'Platform fee cannot exceed 10%'],
        default: 2.5
      }
    }
  },
  
  // Listing metadata
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  images: [{
    url: {
      type: String,
      required: true,
      validate: {
        validator: function(value) {
          return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(value);
        },
        message: 'Image URL must be a valid HTTP/HTTPS URL ending in jpg, jpeg, png, gif, or webp'
      }
    },
    caption: {
      type: String,
      maxlength: [200, 'Image caption cannot exceed 200 characters']
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  
  // Transaction tracking
  transaction: {
    transactionId: {
      type: String,
      sparse: true,
      index: true
    },
    
    blockchainTxId: {
      type: String,
      sparse: true,
      index: true,
      validate: {
        validator: function(value) {
          if (!value) return true;
          // Basic validation for common blockchain transaction ID formats
          return /^[a-fA-F0-9]{64}$/.test(value) || /^0x[a-fA-F0-9]{64}$/.test(value);
        },
        message: 'Invalid blockchain transaction ID format'
      }
    },
    
    buyerId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    
    finalPrice: {
      type: Number,
      min: [0, 'Final price cannot be negative']
    },
    
    completedAt: {
      type: Date
    },
    
    fees: {
      artistRoyaltyAmount: {
        type: Number,
        min: [0, 'Artist royalty amount cannot be negative']
      },
      platformFeeAmount: {
        type: Number,
        min: [0, 'Platform fee amount cannot be negative']
      },
      totalFees: {
        type: Number,
        min: [0, 'Total fees cannot be negative']
      }
    }
  },
  
  // Listing activity and metrics
  analytics: {
    viewCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    favoriteCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    offerCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    bidCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    lastActivity: {
      type: Date,
      default: Date.now
    }
  },
  
  // Listing configuration
  configuration: {
    allowOffers: {
      type: Boolean,
      default: function() {
        return this.listingType !== 'auction';
      }
    },
    
    autoAcceptOffers: {
      type: Boolean,
      default: false
    },
    
    autoAcceptThreshold: {
      type: Number,
      min: [0, 'Auto-accept threshold cannot be negative']
    },
    
    isPrivate: {
      type: Boolean,
      default: false
    },
    
    allowedBuyers: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }]
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
marketplaceSchema.index({ ticketId: 1, status: 1 });
marketplaceSchema.index({ sellerId: 1, status: 1 });
marketplaceSchema.index({ listingType: 1, status: 1 });
marketplaceSchema.index({ currency: 1, price: 1 });
marketplaceSchema.index({ 'auction.endTime': 1, status: 1 });
marketplaceSchema.index({ createdAt: -1 });
marketplaceSchema.index({ 'analytics.viewCount': -1 });
marketplaceSchema.index({ tags: 1 });
marketplaceSchema.index({ 'transaction.transactionId': 1 });
marketplaceSchema.index({ 'transaction.blockchainTxId': 1 });

// Compound indexes
marketplaceSchema.index({ 
  status: 1, 
  listingType: 1, 
  currency: 1,
  isDeleted: 1 
});

// Virtual fields
marketplaceSchema.virtual('timeRemaining').get(function() {
  if (this.listingType === 'auction' && this.auction.endTime) {
    const now = new Date();
    const remaining = this.auction.endTime - now;
    return Math.max(0, remaining);
  }
  return null;
});

marketplaceSchema.virtual('isExpired').get(function() {
  if (this.listingType === 'auction' && this.auction.endTime) {
    return new Date() > this.auction.endTime;
  }
  return false;
});

marketplaceSchema.virtual('highestBid').get(function() {
  if (this.listingType === 'auction' && this.auction.bidders.length > 0) {
    return this.auction.bidders.reduce((highest, bidder) => {
      return bidder.bidAmount > highest ? bidder.bidAmount : highest;
    }, 0);
  }
  return null;
});

marketplaceSchema.virtual('totalFeePercentage').get(function() {
  return this.royalty.artistRoyalty.percentage + this.royalty.platformFee.percentage;
});

// Populate virtual references
marketplaceSchema.virtual('seller', {
  ref: 'User',
  localField: 'sellerId',
  foreignField: '_id',
  justOne: true
});

marketplaceSchema.virtual('ticket', {
  ref: 'Ticket',
  localField: 'ticketId',
  foreignField: '_id',
  justOne: true
});

// Pre-save hooks
marketplaceSchema.pre('save', async function(next) {
  try {
    // Validate listing before saving
    await this.validateListing();
    
    // Update analytics
    this.updateAnalytics();
    
    // Handle auction status updates
    if (this.listingType === 'auction') {
      this.updateAuctionStatus();
    }
    
    // Process tags
    this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase()))];
    
    // Ensure only one primary image
    if (this.images.length > 0) {
      let primaryCount = this.images.filter(img => img.isPrimary).length;
      if (primaryCount === 0) {
        this.images[0].isPrimary = true;
      } else if (primaryCount > 1) {
        this.images.forEach((img, index) => {
          img.isPrimary = index === 0;
        });
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
marketplaceSchema.methods.validateListing = async function() {
  // Validate ticket exists and seller owns it
  const Ticket = mongoose.model('Ticket');
  const ticket = await Ticket.findById(this.ticketId);
  
  if (!ticket) {
    throw new Error('Ticket does not exist');
  }
  
  if (ticket.currentOwnerId.toString() !== this.sellerId.toString()) {
    throw new Error('Seller does not own this ticket');
  }
  
  // Check if ticket is already listed
  const existingListing = await this.constructor.findOne({
    ticketId: this.ticketId,
    status: 'active',
    _id: { $ne: this._id }
  });
  
  if (existingListing) {
    throw new Error('Ticket is already listed in the marketplace');
  }
  
  return true;
};

marketplaceSchema.methods.placeBid = async function(bidderId, bidAmount, transactionData = {}) {
  if (this.listingType !== 'auction') {
    throw new Error('Can only place bids on auction listings');
  }
  
  if (this.status !== 'active') {
    throw new Error('Cannot bid on inactive listing');
  }
  
  if (this.isExpired) {
    throw new Error('Auction has expired');
  }
  
  if (bidderId.toString() === this.sellerId.toString()) {
    throw new Error('Seller cannot bid on their own listing');
  }
  
  // Validate bid amount
  const minimumBid = Math.max(
    this.auction.currentBid + this.auction.minimumBidIncrement,
    this.auction.startPrice
  );
  
  if (bidAmount < minimumBid) {
    throw new Error(`Bid must be at least ${minimumBid} ${this.currency}`);
  }
  
  // Mark previous winning bidder as not winning
  this.auction.bidders.forEach(bidder => {
    bidder.isWinning = false;
  });
  
  // Add new bid
  const newBid = {
    bidderId,
    bidAmount,
    bidTime: new Date(),
    isWinning: true,
    transactionId: transactionData.transactionId,
    blockchainTxId: transactionData.blockchainTxId
  };
  
  this.auction.bidders.push(newBid);
  this.auction.currentBid = bidAmount;
  this.analytics.bidCount += 1;
  this.analytics.lastActivity = new Date();
  
  // Auto-extend auction if bid placed near end
  if (this.auction.autoExtend) {
    const timeRemaining = this.auction.endTime - new Date();
    const extensionThreshold = this.auction.extensionTime * 60 * 1000; // Convert to milliseconds
    
    if (timeRemaining < extensionThreshold) {
      const extensionMs = this.auction.extensionTime * 60 * 1000;
      this.auction.endTime = new Date(this.auction.endTime.getTime() + extensionMs);
    }
  }
  
  await this.save();
  return newBid;
};

marketplaceSchema.methods.makeOffer = async function(offererId, offerAmount, expiresAt, message = '') {
  if (!this.configuration.allowOffers) {
    throw new Error('Offers are not allowed on this listing');
  }
  
  if (this.status !== 'active') {
    throw new Error('Cannot make offer on inactive listing');
  }
  
  if (offererId.toString() === this.sellerId.toString()) {
    throw new Error('Seller cannot make offer on their own listing');
  }
  
  // Validate offer amount
  if (this.minimumOffer && offerAmount < this.minimumOffer) {
    throw new Error(`Offer must be at least ${this.minimumOffer} ${this.currency}`);
  }
  
  // Check for duplicate offers from same user
  const existingOffer = this.offers.find(offer => 
    offer.offererId.toString() === offererId.toString() && 
    offer.status === 'pending'
  );
  
  if (existingOffer) {
    throw new Error('You already have a pending offer on this listing');
  }
  
  const newOffer = {
    offererId,
    offerAmount,
    expiresAt,
    message,
    offerTime: new Date(),
    status: 'pending'
  };
  
  this.offers.push(newOffer);
  this.analytics.offerCount += 1;
  this.analytics.lastActivity = new Date();
  
  // Auto-accept if enabled and threshold met
  if (this.configuration.autoAcceptOffers && 
      this.configuration.autoAcceptThreshold && 
      offerAmount >= this.configuration.autoAcceptThreshold) {
    await this.acceptOffer(newOffer.offerId);
  }
  
  await this.save();
  return newOffer;
};

marketplaceSchema.methods.acceptOffer = async function(offerId) {
  const offer = this.offers.id(offerId);
  if (!offer) {
    throw new Error('Offer not found');
  }
  
  if (offer.status !== 'pending') {
    throw new Error('Offer is no longer pending');
  }
  
  if (new Date() > offer.expiresAt) {
    offer.status = 'expired';
    throw new Error('Offer has expired');
  }
  
  // Accept the offer
  offer.status = 'accepted';
  
  // Reject all other pending offers
  this.offers.forEach(otherOffer => {
    if (otherOffer.offerId.toString() !== offerId.toString() && 
        otherOffer.status === 'pending') {
      otherOffer.status = 'rejected';
    }
  });
  
  // Complete the sale
  await this.completeSale(offer.offererId, offer.offerAmount);
  
  return offer;
};

marketplaceSchema.methods.completeSale = async function(buyerId, finalPrice, transactionData = {}) {
  if (this.status === 'sold') {
    throw new Error('Listing is already sold');
  }
  
  // Calculate fees
  const artistRoyaltyAmount = (finalPrice * this.royalty.artistRoyalty.percentage) / 100;
  const platformFeeAmount = (finalPrice * this.royalty.platformFee.percentage) / 100;
  const totalFees = artistRoyaltyAmount + platformFeeAmount;
  const sellerAmount = finalPrice - totalFees;
  
  // Update transaction details
  this.transaction = {
    ...this.transaction,
    ...transactionData,
    buyerId,
    finalPrice,
    completedAt: new Date(),
    fees: {
      artistRoyaltyAmount,
      platformFeeAmount,
      totalFees
    }
  };
  
  this.status = 'sold';
  this.analytics.lastActivity = new Date();
  
  await this.save();
  
  // Transfer ticket ownership (this would typically trigger blockchain transaction)
  const Ticket = mongoose.model('Ticket');
  await Ticket.findByIdAndUpdate(this.ticketId, {
    currentOwnerId: buyerId,
    transferHistory: {
      $push: {
        fromUserId: this.sellerId,
        toUserId: buyerId,
        transferDate: new Date(),
        transferType: 'marketplace_sale',
        price: finalPrice,
        currency: this.currency,
        marketplaceListingId: this._id
      }
    }
  });
  
  return {
    sellerAmount,
    artistRoyaltyAmount,
    platformFeeAmount,
    totalFees
  };
};

marketplaceSchema.methods.cancel = async function(reason = '') {
  if (this.status === 'sold') {
    throw new Error('Cannot cancel sold listing');
  }
  
  if (this.status === 'cancelled') {
    throw new Error('Listing is already cancelled');
  }
  
  // For auctions with bids, special handling may be required
  if (this.listingType === 'auction' && this.auction.bidders.length > 0) {
    // In production, you might want to require a valid reason or admin approval
    // for cancelling auctions with bids
  }
  
  this.status = 'cancelled';
  this.analytics.lastActivity = new Date();
  
  // Reject all pending offers
  this.offers.forEach(offer => {
    if (offer.status === 'pending') {
      offer.status = 'rejected';
    }
  });
  
  await this.save();
};

marketplaceSchema.methods.updateAnalytics = function() {
  // Update offer and bid counts
  this.analytics.offerCount = this.offers.length;
  this.analytics.bidCount = this.auction?.bidders?.length || 0;
};

marketplaceSchema.methods.updateAuctionStatus = function() {
  if (this.listingType === 'auction' && this.status === 'active') {
    if (this.isExpired) {
      this.status = 'expired';
      
      // If there are bids and reserve price is met, complete the sale
      if (this.auction.bidders.length > 0) {
        const winningBid = this.auction.bidders.find(bid => bid.isWinning);
        if (winningBid && 
            (!this.auction.reservePrice || winningBid.bidAmount >= this.auction.reservePrice)) {
          // Auto-complete sale for expired auction with valid winning bid
          // This would typically be handled by a background job
        }
      }
    }
  }
};

marketplaceSchema.methods.incrementView = async function() {
  this.analytics.viewCount += 1;
  this.analytics.lastActivity = new Date();
  await this.save();
};

// Static methods
marketplaceSchema.statics.findActiveListings = function(filters = {}) {
  const query = {
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('sellerId', 'username displayName avatar')
    .populate('ticketId', 'name type accessLevel')
    .sort({ createdAt: -1 });
};

marketplaceSchema.statics.findByTicket = function(ticketId, options = {}) {
  const query = {
    ticketId,
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .populate('sellerId', 'username displayName avatar')
    .sort({ createdAt: -1 });
};

marketplaceSchema.statics.findBySeller = function(sellerId, options = {}) {
  const query = {
    sellerId,
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .populate('ticketId', 'name type accessLevel')
    .sort({ createdAt: -1 });
};

marketplaceSchema.statics.findExpiredAuctions = function() {
  return this.find({
    listingType: 'auction',
    status: 'active',
    'auction.endTime': { $lt: new Date() },
    isDeleted: false
  });
};

marketplaceSchema.statics.searchListings = function(searchTerm, filters = {}) {
  const searchQuery = {
    $or: [
      { description: { $regex: searchTerm, $options: 'i' } },
      { tags: { $regex: searchTerm, $options: 'i' } }
    ],
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .populate('sellerId', 'username displayName avatar')
    .populate('ticketId', 'name type accessLevel')
    .sort({ 'analytics.viewCount': -1, createdAt: -1 });
};

marketplaceSchema.statics.getMarketplaceStats = async function(timeframe = '30d') {
  const timeframeDays = parseInt(timeframe.replace('d', ''));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframeDays);
  
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: startDate },
        isDeleted: false
      }
    },
    {
      $group: {
        _id: null,
        totalListings: { $sum: 1 },
        activeListings: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        soldListings: {
          $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
        },
        totalVolume: {
          $sum: { $cond: [{ $eq: ['$status', 'sold'] }, '$transaction.finalPrice', 0] }
        },
        averagePrice: {
          $avg: { $cond: [{ $eq: ['$status', 'sold'] }, '$transaction.finalPrice', null] }
        },
        totalViews: { $sum: '$analytics.viewCount' },
        totalOffers: { $sum: '$analytics.offerCount' },
        totalBids: { $sum: '$analytics.bidCount' }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalListings: 0,
    activeListings: 0,
    soldListings: 0,
    totalVolume: 0,
    averagePrice: 0,
    totalViews: 0,
    totalOffers: 0,
    totalBids: 0
  };
};

// Query helpers
marketplaceSchema.query.active = function() {
  return this.where({ status: 'active', isDeleted: false });
};

marketplaceSchema.query.byListingType = function(type) {
  return this.where({ listingType: type });
};

marketplaceSchema.query.byCurrency = function(currency) {
  return this.where({ currency: currency });
};

marketplaceSchema.query.inPriceRange = function(min, max) {
  const query = {};
  if (min !== undefined) query.$gte = min;
  if (max !== undefined) query.$lte = max;
  return this.where({ price: query });
};

module.exports = mongoose.model('Marketplace', marketplaceSchema);
