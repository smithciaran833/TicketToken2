const mongoose = require('mongoose');
const { Schema } = mongoose;

// Distribution breakdown schema
const distributionBreakdownSchema = new Schema({
  recipientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Recipient ID is required']
  },
  recipientType: {
    type: String,
    required: [true, 'Recipient type is required'],
    enum: ['artist', 'promoter', 'venue', 'platform', 'collaborator', 'label', 'publisher'],
    index: true
  },
  role: {
    type: String,
    enum: ['primary_artist', 'featured_artist', 'producer', 'songwriter', 'mixer', 'mastering', 'publisher', 'label', 'promoter', 'venue_owner', 'platform'],
    required: true
  },
  percentage: {
    type: Number,
    required: [true, 'Distribution percentage is required'],
    min: [0, 'Percentage cannot be negative'],
    max: [100, 'Percentage cannot exceed 100']
  },
  amount: {
    type: Number,
    required: [true, 'Distribution amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    enum: ['USD', 'SOL', 'ETH', 'USDC', 'USDT'],
    default: 'USD'
  },
  payoutMethod: {
    type: String,
    enum: ['bank_transfer', 'paypal', 'crypto_wallet', 'check', 'hold'],
    default: 'hold'
  },
  payoutStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'held', 'disputed'],
    default: 'pending',
    index: true
  },
  payoutDate: {
    type: Date
  },
  payoutReference: {
    type: String,
    trim: true
  }
}, {
  _id: true,
  timestamps: false
});

// Source transaction details schema
const sourceTransactionSchema = new Schema({
  transactionHash: {
    type: String,
    trim: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^[a-fA-F0-9]{64}$/.test(value) || /^0x[a-fA-F0-9]{64}$/.test(value);
      },
      message: 'Invalid transaction hash format'
    }
  },
  eventId: {
    type: Schema.Types.ObjectId,
    ref: 'Event'
  },
  venueId: {
    type: Schema.Types.ObjectId,
    ref: 'Venue'
  },
  contentId: {
    type: Schema.Types.ObjectId,
    ref: 'Content'
  },
  buyerId: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  sellerId: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  transactionType: {
    type: String,
    enum: ['ticket_sale', 'nft_mint', 'nft_resale', 'streaming', 'merchandise', 'licensing'],
    required: true
  },
  originalAmount: {
    type: Number,
    required: [true, 'Original amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  originalCurrency: {
    type: String,
    required: [true, 'Original currency is required'],
    enum: ['USD', 'SOL', 'ETH', 'USDC', 'USDT']
  }
}, {
  _id: false,
  timestamps: false
});

// Main royalty schema
const royaltySchema = new Schema({
  // Core fields
  transactionId: {
    type: String,
    required: [true, 'Transaction ID is required'],
    trim: true,
    index: true
  },
  
  artistId: {
    type: Schema.Types.ObjectId,
    ref: 'Artist',
    required: [true, 'Artist ID is required'],
    index: true
  },
  
  amount: {
    type: Number,
    required: [true, 'Royalty amount is required'],
    min: [0, 'Amount cannot be negative'],
    index: true
  },
  
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    enum: ['USD', 'SOL', 'ETH', 'USDC', 'USDT'],
    default: 'USD',
    index: true
  },
  
  // Calculation details
  calculation: {
    basePrice: {
      type: Number,
      required: [true, 'Base price is required'],
      min: [0, 'Base price cannot be negative']
    },
    royaltyPercentage: {
      type: Number,
      required: [true, 'Royalty percentage is required'],
      min: [0, 'Royalty percentage cannot be negative'],
      max: [100, 'Royalty percentage cannot exceed 100']
    },
    platformFee: {
      percentage: {
        type: Number,
        required: [true, 'Platform fee percentage is required'],
        min: [0, 'Platform fee cannot be negative'],
        max: [50, 'Platform fee cannot exceed 50%'],
        default: 2.5
      },
      amount: {
        type: Number,
        min: [0, 'Platform fee amount cannot be negative'],
        default: 0
      }
    },
    exchangeRate: {
      type: Number,
      min: [0, 'Exchange rate cannot be negative'],
      default: 1
    },
    calculatedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  // Distribution breakdown
  distribution: distributionBreakdownSchema,
  
  // Legacy shares (for backward compatibility)
  artistShare: {
    type: Number,
    min: [0, 'Artist share cannot be negative'],
    default: 0
  },
  
  promoterShare: {
    type: Number,
    min: [0, 'Promoter share cannot be negative'],
    default: 0
  },
  
  platformShare: {
    type: Number,
    min: [0, 'Platform share cannot be negative'],
    default: 0
  },
  
  // Tracking fields
  distributionDate: {
    type: Date,
    index: true
  },
  
  payoutStatus: {
    type: String,
    required: [true, 'Payout status is required'],
    enum: ['pending', 'processing', 'completed', 'failed', 'disputed', 'held'],
    default: 'pending',
    index: true
  },
  
  payoutMethod: {
    type: String,
    enum: ['bank_transfer', 'paypal', 'crypto_wallet', 'check', 'internal_credit', 'hold'],
    default: 'hold'
  },
  
  // Source information
  sourceType: {
    type: String,
    required: [true, 'Source type is required'],
    enum: ['primary', 'secondary', 'streaming', 'licensing', 'merchandise'],
    index: true
  },
  
  sourceTransaction: sourceTransactionSchema,
  
  // Verification
  isVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  
  verificationMethod: {
    type: String,
    enum: ['automated', 'manual_review', 'blockchain_validation', 'third_party'],
    validate: {
      validator: function(value) {
        if (this.isVerified && !value) {
          return false;
        }
        return true;
      },
      message: 'Verification method is required when royalty is verified'
    }
  },
  
  verificationDate: {
    type: Date,
    validate: {
      validator: function(value) {
        if (this.isVerified && !value) {
          return false;
        }
        return true;
      },
      message: 'Verification date is required when royalty is verified'
    }
  },
  
  verifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Batch processing
  batchId: {
    type: String,
    trim: true,
    index: true
  },
  
  batchDate: {
    type: Date,
    index: true
  },
  
  batchStatus: {
    type: String,
    enum: ['created', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'created',
    index: true
  },
  
  // Additional metadata
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  
  // Administrative fields
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
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
royaltySchema.index({ transactionId: 1, artistId: 1 });
royaltySchema.index({ artistId: 1, createdAt: -1 });
royaltySchema.index({ payoutStatus: 1, distributionDate: 1 });
royaltySchema.index({ batchId: 1, batchStatus: 1 });
royaltySchema.index({ sourceType: 1, amount: -1 });
royaltySchema.index({ isVerified: 1, payoutStatus: 1 });
royaltySchema.index({ currency: 1, createdAt: -1 });

// Compound indexes
royaltySchema.index({ 
  artistId: 1, 
  payoutStatus: 1, 
  sourceType: 1 
});

royaltySchema.index({
  batchDate: 1,
  batchStatus: 1,
  amount: -1
});

// Virtual fields
royaltySchema.virtual('isPaid').get(function() {
  return this.payoutStatus === 'completed';
});

royaltySchema.virtual('netAmount').get(function() {
  const platformFeeAmount = this.calculation.platformFee.amount || 0;
  return this.amount - platformFeeAmount;
});

royaltySchema.virtual('isOverdue').get(function() {
  if (this.isPaid || !this.distributionDate) return false;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return this.distributionDate < thirtyDaysAgo;
});

// Populate virtual references
royaltySchema.virtual('artist', {
  ref: 'Artist',
  localField: 'artistId',
  foreignField: '_id',
  justOne: true
});

royaltySchema.virtual('creator', {
  ref: 'User',
  localField: 'createdBy',
  foreignField: '_id',
  justOne: true
});

// Pre-save hooks
royaltySchema.pre('save', async function(next) {
  try {
    // Calculate platform fee amount
    if (this.isModified('calculation')) {
      this.calculation.platformFee.amount = 
        (this.calculation.basePrice * this.calculation.platformFee.percentage) / 100;
    }
    
    // Process tags
    this.tags = [...new Set(this.tags.map(tag => tag.toLowerCase()))];
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
royaltySchema.methods.calculateDistribution = function(distributionRules = []) {
  const totalAmount = this.netAmount;
  let artistShare = 0;
  let promoterShare = 0;
  let platformShare = this.calculation.platformFee.amount;
  
  // Apply distribution rules
  distributionRules.forEach(rule => {
    const shareAmount = (totalAmount * rule.percentage) / 100;
    
    switch (rule.recipientType) {
      case 'artist':
        artistShare += shareAmount;
        break;
      case 'promoter':
        promoterShare += shareAmount;
        break;
      case 'platform':
        platformShare += shareAmount;
        break;
    }
  });
  
  // Update distribution fields
  this.artistShare = artistShare;
  this.promoterShare = promoterShare;
  this.platformShare = platformShare;
  
  return {
    artistShare,
    promoterShare,
    platformShare,
    totalDistributed: artistShare + promoterShare + platformShare
  };
};

royaltySchema.methods.processPayout = async function(payoutOptions = {}) {
  if (this.payoutStatus !== 'pending') {
    throw new Error(`Cannot process payout with status: ${this.payoutStatus}`);
  }
  
  if (!this.isVerified) {
    throw new Error('Royalty must be verified before payout');
  }
  
  this.payoutStatus = 'processing';
  
  try {
    // Simulate payout processing
    const payoutResult = await this.executePayoutMethod(payoutOptions);
    
    if (payoutResult.success) {
      this.payoutStatus = 'completed';
      this.distributionDate = new Date();
    } else {
      this.payoutStatus = 'failed';
    }
    
    await this.save();
    return payoutResult;
    
  } catch (error) {
    this.payoutStatus = 'failed';
    await this.save();
    throw error;
  }
};

royaltySchema.methods.executePayoutMethod = async function(options = {}) {
  // This would integrate with actual payment processors
  // For now, simulating the process based on payout method
  
  switch (this.payoutMethod) {
    case 'crypto_wallet':
      return this.processCryptoPayout(options);
    case 'bank_transfer':
      return this.processBankPayout(options);
    case 'paypal':
      return this.processPayPalPayout(options);
    case 'hold':
      return this.processHoldPayout(options);
    default:
      throw new Error(`Unsupported payout method: ${this.payoutMethod}`);
  }
};

royaltySchema.methods.processCryptoPayout = async function(options) {
  // Simulate crypto payout
  return {
    success: true,
    payoutReference: `crypto_${Date.now()}`,
    netAmount: this.netAmount * 0.99, // 1% processing fee
    processingFee: this.netAmount * 0.01
  };
};

royaltySchema.methods.processBankPayout = async function(options) {
  // Simulate bank transfer
  const processingFee = Math.max(2.50, this.netAmount * 0.025); // $2.50 or 2.5%
  
  return {
    success: true,
    payoutReference: `bank_${Date.now()}`,
    netAmount: this.netAmount - processingFee,
    processingFee: processingFee
  };
};

royaltySchema.methods.processPayPalPayout = async function(options) {
  // Simulate PayPal payout
  const processingFee = this.netAmount * 0.02; // 2% processing fee
  
  return {
    success: true,
    payoutReference: `pp_${Date.now()}`,
    netAmount: this.netAmount - processingFee,
    processingFee: processingFee
  };
};

royaltySchema.methods.processHoldPayout = async function(options) {
  // Hold the payout (credit to internal account)
  return {
    success: true,
    payoutReference: `hold_${Date.now()}`,
    netAmount: this.netAmount,
    processingFee: 0,
    held: true
  };
};

royaltySchema.methods.verify = async function(verificationMethod = 'automated', verifiedBy = null) {
  // Perform verification checks
  const verificationResult = this.performVerificationChecks();
  
  this.isVerified = verificationResult.passed;
  this.verificationMethod = verificationMethod;
  this.verificationDate = new Date();
  this.verifiedBy = verifiedBy;
  
  await this.save();
  return verificationResult;
};

royaltySchema.methods.performVerificationChecks = function() {
  const checks = {
    passed: true,
    errors: []
  };
  
  // Check 1: Amount calculation
  const expectedAmount = (this.calculation.basePrice * this.calculation.royaltyPercentage) / 100;
  const tolerance = 0.01;
  
  if (Math.abs(this.amount - expectedAmount) > tolerance) {
    checks.passed = false;
    checks.errors.push('Royalty calculation does not match expected amount');
  }
  
  // Check 2: Valid artist
  if (!this.artistId) {
    checks.passed = false;
    checks.errors.push('Artist ID is required');
  }
  
  // Check 3: Valid transaction
  if (!this.transactionId) {
    checks.passed = false;
    checks.errors.push('Transaction ID is required');
  }
  
  // Check 4: Reasonable amount
  if (this.amount > this.calculation.basePrice) {
    checks.passed = false;
    checks.errors.push('Royalty amount cannot exceed base price');
  }
  
  return checks;
};

royaltySchema.methods.addToBatch = async function(batchId, batchDate = null) {
  this.batchId = batchId;
  this.batchDate = batchDate || new Date();
  this.batchStatus = 'created';
  
  await this.save();
  return this;
};

royaltySchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  await this.save();
};

royaltySchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  await this.save();
};

// Static methods
royaltySchema.statics.findByArtist = function(artistId, filters = {}) {
  const query = {
    artistId: artistId,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'username displayName');
};

royaltySchema.statics.findPendingPayouts = function(limit = 100) {
  return this.find({
    payoutStatus: 'pending',
    isVerified: true,
    isDeleted: false
  })
  .sort({ createdAt: 1 })
  .limit(limit)
  .populate('artistId', 'stageName')
  .populate('createdBy', 'username displayName');
};

royaltySchema.statics.findByBatch = function(batchId, filters = {}) {
  const query = {
    batchId: batchId,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ createdAt: -1 });
};

royaltySchema.statics.findOverduePayouts = function(daysOverdue = 30) {
  const overdueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000);
  
  return this.find({
    payoutStatus: { $in: ['pending', 'processing'] },
    distributionDate: { $lt: overdueDate },
    isDeleted: false
  })
  .sort({ distributionDate: 1 })
  .populate('artistId', 'stageName')
  .populate('createdBy', 'username displayName');
};

royaltySchema.statics.getRoyaltyStats = async function(timeframe = '30d', filters = {}) {
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
        totalRoyalties: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        paidRoyalties: {
          $sum: { $cond: [{ $eq: ['$payoutStatus', 'completed'] }, 1, 0] }
        },
        pendingRoyalties: {
          $sum: { $cond: [{ $eq: ['$payoutStatus', 'pending'] }, 1, 0] }
        },
        totalPaidAmount: {
          $sum: { $cond: [{ $eq: ['$payoutStatus', 'completed'] }, '$amount', 0] }
        },
        totalPendingAmount: {
          $sum: { $cond: [{ $eq: ['$payoutStatus', 'pending'] }, '$amount', 0] }
        },
        averageRoyalty: { $avg: '$amount' },
        verifiedRoyalties: {
          $sum: { $cond: [{ $eq: ['$isVerified', true] }, 1, 0] }
        },
        royaltiesBySource: {
          $push: {
            sourceType: '$sourceType',
            amount: '$amount'
          }
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalRoyalties: 0,
    totalAmount: 0,
    paidRoyalties: 0,
    pendingRoyalties: 0,
    totalPaidAmount: 0,
    totalPendingAmount: 0,
    averageRoyalty: 0,
    verifiedRoyalties: 0,
    royaltiesBySource: []
  };
};

royaltySchema.statics.findTopEarners = function(timeframe = '30d', limit = 20) {
  const timeframeDays = parseInt(timeframe.replace('d', ''));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframeDays);
  
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        payoutStatus: 'completed',
        isDeleted: false
      }
    },
    {
      $group: {
        _id: '$artistId',
        totalEarnings: { $sum: '$amount' },
        royaltyCount: { $sum: 1 },
        averageRoyalty: { $avg: '$amount' }
      }
    },
    {
      $sort: { totalEarnings: -1 }
    },
    {
      $limit: limit
    },
    {
      $lookup: {
        from: 'artists',
        localField: '_id',
        foreignField: '_id',
        as: 'artist',
        pipeline: [
          { $project: { stageName: 1, userId: 1 } }
        ]
      }
    },
    {
      $unwind: '$artist'
    }
  ]);
};

royaltySchema.statics.createBatch = async function(royaltyIds, batchOptions = {}) {
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const batchDate = new Date();
  
  const updateResult = await this.updateMany(
    {
      _id: { $in: royaltyIds },
      payoutStatus: 'pending',
      isVerified: true,
      isDeleted: false
    },
    {
      $set: {
        batchId: batchId,
        batchDate: batchDate,
        batchStatus: 'created'
      }
    }
  );
  
  return {
    batchId: batchId,
    batchDate: batchDate,
    royaltiesUpdated: updateResult.modifiedCount,
    totalAmount: await this.aggregate([
      { $match: { batchId: batchId } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0)
  };
};

// Query helpers
royaltySchema.query.pending = function() {
  return this.where({ payoutStatus: 'pending', isDeleted: false });
};

royaltySchema.query.completed = function() {
  return this.where({ payoutStatus: 'completed', isDeleted: false });
};

royaltySchema.query.verified = function() {
  return this.where({ isVerified: true });
};

royaltySchema.query.bySourceType = function(sourceType) {
  return this.where({ sourceType: sourceType });
};

royaltySchema.query.byPayoutMethod = function(method) {
  return this.where({ payoutMethod: method });
};

royaltySchema.query.inBatch = function(batchId) {
  return this.where({ batchId: batchId });
};

royaltySchema.query.overdue = function(days = 30) {
  const overdueDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.where({ 
    distributionDate: { $lt: overdueDate },
    payoutStatus: { $in: ['pending', 'processing'] }
  });
};

module.exports = mongoose.model('Royalty', royaltySchema);
