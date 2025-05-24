const mongoose = require('mongoose');
const crypto = require('crypto');
const { Schema } = mongoose;

// Connection history schema
const connectionHistorySchema = new Schema({
  connectedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  disconnectedAt: {
    type: Date
  },
  ipAddress: {
    type: String,
    validate: {
      validator: function(value) {
        if (!value) return true;
        // Basic IP validation (IPv4 and IPv6)
        return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(value) ||
               /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(value);
      },
      message: 'Invalid IP address format'
    }
  },
  userAgent: {
    type: String,
    trim: true
  },
  device: {
    type: String,
    enum: ['mobile', 'desktop', 'tablet', 'unknown'],
    default: 'unknown'
  },
  sessionDuration: {
    type: Number, // in minutes
    min: 0
  },
  location: {
    country: String,
    city: String,
    region: String
  },
  walletApp: {
    type: String,
    enum: ['phantom', 'solflare', 'metamask', 'walletconnect', 'coinbase', 'ledger', 'other'],
    default: 'other'
  },
  version: {
    type: String,
    trim: true
  }
}, {
  _id: true,
  timestamps: false
});

// NFT token schema
const nftTokenSchema = new Schema({
  tokenAddress: {
    type: String,
    required: [true, 'Token address is required'],
    trim: true,
    validate: {
      validator: function(value) {
        // Basic validation for blockchain addresses
        return /^[A-Za-z0-9]{32,44}$/.test(value) || /^0x[a-fA-F0-9]{40}$/.test(value);
      },
      message: 'Invalid token address format'
    }
  },
  tokenId: {
    type: String,
    trim: true
  },
  contractAddress: {
    type: String,
    required: [true, 'Contract address is required'],
    trim: true
  },
  tokenStandard: {
    type: String,
    enum: ['ERC-721', 'ERC-1155', 'SPL-Token', 'Metaplex'],
    required: true
  },
  metadata: {
    name: {
      type: String,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    image: {
      type: String,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^https?:\/\/.+/.test(value) || /^ipfs:\/\/.+/.test(value);
        },
        message: 'Image must be a valid HTTP/HTTPS or IPFS URL'
      }
    },
    attributes: [{
      trait_type: {
        type: String,
        required: true,
        trim: true
      },
      value: {
        type: Schema.Types.Mixed,
        required: true
      },
      display_type: {
        type: String,
        enum: ['number', 'boost_number', 'boost_percentage', 'date']
      }
    }],
    externalUrl: {
      type: String,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^https?:\/\/.+/.test(value);
        },
        message: 'External URL must be a valid HTTP/HTTPS URL'
      }
    }
  },
  collectionInfo: {
    name: {
      type: String,
      trim: true
    },
    symbol: {
      type: String,
      trim: true,
      uppercase: true
    },
    verified: {
      type: Boolean,
      default: false
    },
    floorPrice: {
      type: Number,
      min: 0
    },
    totalSupply: {
      type: Number,
      min: 0
    }
  },
  acquiredAt: {
    type: Date,
    default: Date.now
  },
  lastPriceCheck: {
    type: Date,
    default: Date.now
  },
  estimatedValue: {
    amount: {
      type: Number,
      min: 0,
      default: 0
    },
    currency: {
      type: String,
      enum: ['SOL', 'ETH', 'USD', 'USDC'],
      default: 'SOL'
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  isStaked: {
    type: Boolean,
    default: false
  },
  stakingInfo: {
    stakingPool: {
      type: String,
      trim: true
    },
    stakedAt: {
      type: Date
    },
    rewards: {
      type: Number,
      min: 0,
      default: 0
    }
  }
}, {
  _id: true,
  timestamps: true
});

// Transaction history schema
const transactionSchema = new Schema({
  transactionHash: {
    type: String,
    required: [true, 'Transaction hash is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function(value) {
        // Basic validation for transaction hashes
        return /^[a-fA-F0-9]{64}$/.test(value) || /^0x[a-fA-F0-9]{64}$/.test(value);
      },
      message: 'Invalid transaction hash format'
    }
  },
  blockNumber: {
    type: Number,
    min: 0
  },
  blockHash: {
    type: String,
    trim: true
  },
  timestamp: {
    type: Date,
    required: [true, 'Transaction timestamp is required'],
    default: Date.now
  },
  from: {
    type: String,
    required: [true, 'From address is required'],
    trim: true
  },
  to: {
    type: String,
    required: [true, 'To address is required'],
    trim: true
  },
  amount: {
    type: Number,
    required: [true, 'Transaction amount is required'],
    min: 0
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    enum: ['SOL', 'ETH', 'USDC', 'USDT', 'BTC', 'SPL-Token'],
    default: 'SOL'
  },
  tokenAddress: {
    type: String,
    trim: true // For SPL tokens or ERC-20 tokens
  },
  transactionType: {
    type: String,
    required: [true, 'Transaction type is required'],
    enum: ['send', 'receive', 'swap', 'stake', 'unstake', 'nft_mint', 'nft_transfer', 'contract_interaction'],
    index: true
  },
  status: {
    type: String,
    required: [true, 'Transaction status is required'],
    enum: ['pending', 'confirmed', 'failed', 'dropped'],
    default: 'pending',
    index: true
  },
  gasUsed: {
    type: Number,
    min: 0
  },
  gasPrice: {
    type: Number,
    min: 0
  },
  gasFee: {
    type: Number,
    min: 0
  },
  nonce: {
    type: Number,
    min: 0
  },
  contractAddress: {
    type: String,
    trim: true
  },
  methodName: {
    type: String,
    trim: true
  },
  confirmations: {
    type: Number,
    min: 0,
    default: 0
  },
  errorMessage: {
    type: String,
    trim: true
  },
  metadata: {
    type: Schema.Types.Mixed
  }
}, {
  _id: true,
  timestamps: false
});

// Security check schema
const securityCheckSchema = new Schema({
  checkType: {
    type: String,
    required: true,
    enum: ['signature_verification', 'address_validation', 'transaction_monitoring', 'suspicious_activity', 'compliance_check']
  },
  status: {
    type: String,
    required: true,
    enum: ['passed', 'failed', 'warning', 'manual_review'],
    default: 'passed'
  },
  score: {
    type: Number,
    min: 0,
    max: 100
  },
  details: {
    type: String,
    trim: true
  },
  checkedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  checkedBy: {
    type: String,
    enum: ['system', 'admin', 'third_party'],
    default: 'system'
  },
  recommendations: [{
    type: String,
    trim: true
  }]
}, {
  _id: true,
  timestamps: false
});

// Main wallet schema
const walletSchema = new Schema({
  // Core user reference
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  },
  
  // Wallet identification
  walletAddress: {
    type: String,
    required: [true, 'Wallet address is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function(value) {
        // Support multiple blockchain address formats
        return /^[A-Za-z0-9]{32,44}$/.test(value) || /^0x[a-fA-F0-9]{40}$/.test(value);
      },
      message: 'Invalid wallet address format'
    },
    index: true
  },
  
  walletType: {
    type: String,
    required: [true, 'Wallet type is required'],
    enum: ['solana', 'ethereum', 'bitcoin', 'polygon', 'binance_smart_chain'],
    index: true
  },
  
  publicKey: {
    type: String,
    required: [true, 'Public key is required'],
    trim: true,
    validate: {
      validator: function(value) {
        // Basic validation for public keys
        return /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value) || /^0x[a-fA-F0-9]{128}$/.test(value);
      },
      message: 'Invalid public key format'
    }
  },
  
  // Connection status
  connection: {
    lastConnected: {
      type: Date,
      default: Date.now,
      index: true
    },
    lastDisconnected: {
      type: Date
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    sessionCount: {
      type: Number,
      default: 1,
      min: 0
    },
    totalConnectionTime: {
      type: Number, // in minutes
      default: 0,
      min: 0
    },
    connectionHistory: [connectionHistorySchema]
  },
  
  // Wallet assets
  assets: {
    nftTokens: [nftTokenSchema],
    balances: {
      nativeToken: {
        amount: {
          type: Number,
          default: 0,
          min: 0
        },
        currency: {
          type: String,
          default: function() {
            const currencyMap = {
              'solana': 'SOL',
              'ethereum': 'ETH',
              'bitcoin': 'BTC',
              'polygon': 'MATIC',
              'binance_smart_chain': 'BNB'
            };
            return currencyMap[this.walletType] || 'SOL';
          }
        },
        lastUpdated: {
          type: Date,
          default: Date.now
        }
      },
      tokens: [{
        tokenAddress: {
          type: String,
          required: true,
          trim: true
        },
        symbol: {
          type: String,
          required: true,
          trim: true,
          uppercase: true
        },
        name: {
          type: String,
          trim: true
        },
        amount: {
          type: Number,
          required: true,
          min: 0
        },
        decimals: {
          type: Number,
          required: true,
          min: 0,
          max: 18
        },
        usdValue: {
          type: Number,
          min: 0,
          default: 0
        },
        lastUpdated: {
          type: Date,
          default: Date.now
        }
      }]
    },
    transactionHistory: [transactionSchema]
  },
  
  // Security configuration
  security: {
    encryptedPrivateData: {
      type: String,
      trim: true
    },
    encryptionMethod: {
      type: String,
      enum: ['AES-256-GCM', 'AES-256-CBC', 'RSA-OAEP'],
      default: 'AES-256-GCM'
    },
    lastSecurityCheck: {
      type: Date,
      default: Date.now,
      index: true
    },
    securityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 75
    },
    securityChecks: [securityCheckSchema],
    suspiciousActivity: {
      isDetected: {
        type: Boolean,
        default: false
      },
      lastDetected: {
        type: Date
      },
      riskLevel: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'low'
      },
      alertCount: {
        type: Number,
        default: 0,
        min: 0
      }
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false
    },
    multiSigEnabled: {
      type: Boolean,
      default: false
    },
    whitelistedAddresses: [{
      address: {
        type: String,
        required: true,
        trim: true
      },
      label: {
        type: String,
        trim: true
      },
      addedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  
  // User preferences
  preferences: {
    autoApprove: {
      enabled: {
        type: Boolean,
        default: false
      },
      maxAmount: {
        type: Number,
        min: 0,
        default: 0
      },
      trustedContracts: [{
        contractAddress: {
          type: String,
          required: true,
          trim: true
        },
        name: {
          type: String,
          trim: true
        },
        addedAt: {
          type: Date,
          default: Date.now
        }
      }]
    },
    gasPreference: {
      priority: {
        type: String,
        enum: ['slow', 'standard', 'fast', 'custom'],
        default: 'standard'
      },
      maxGasPrice: {
        type: Number,
        min: 0
      },
      gasLimit: {
        type: Number,
        min: 21000
      }
    },
    slippageTolerance: {
      type: Number,
      min: 0.1,
      max: 50,
      default: 0.5 // 0.5%
    },
    notifications: {
      transactionUpdates: {
        type: Boolean,
        default: true
      },
      priceAlerts: {
        type: Boolean,
        default: false
      },
      securityAlerts: {
        type: Boolean,
        default: true
      },
      nftActivity: {
        type: Boolean,
        default: true
      }
    },
    privacy: {
      hideBalances: {
        type: Boolean,
        default: false
      },
      hideTransactionHistory: {
        type: Boolean,
        default: false
      },
      allowAnalytics: {
        type: Boolean,
        default: true
      }
    }
  },
  
  // Verification status
  verification: {
    isVerified: {
      type: Boolean,
      default: false,
      index: true
    },
    verificationMethod: {
      type: String,
      enum: ['signature', 'transaction', 'message_signing', 'smart_contract'],
      validate: {
        validator: function(value) {
          if (this.verification.isVerified && !value) {
            return false;
          }
          return true;
        },
        message: 'Verification method is required when wallet is verified'
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
        message: 'Verification date is required when wallet is verified'
      }
    },
    verificationMessage: {
      type: String,
      trim: true
    },
    verificationSignature: {
      type: String,
      trim: true
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    trustScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    }
  },
  
  // Analytics and metrics
  analytics: {
    transactionCount: {
      total: {
        type: Number,
        default: 0,
        min: 0
      },
      sent: {
        type: Number,
        default: 0,
        min: 0
      },
      received: {
        type: Number,
        default: 0,
        min: 0
      },
      swaps: {
        type: Number,
        default: 0,
        min: 0
      },
      nftTransactions: {
        type: Number,
        default: 0,
        min: 0
      }
    },
    volume: {
      totalVolume: {
        type: Number,
        default: 0,
        min: 0
      },
      volumeIn: {
        type: Number,
        default: 0,
        min: 0
      },
      volumeOut: {
        type: Number,
        default: 0,
        min: 0
      },
      currency: {
        type: String,
        default: 'USD'
      },
      lastCalculated: {
        type: Date,
        default: Date.now
      }
    },
    gasMetrics: {
      averageGasUsed: {
        type: Number,
        default: 0,
        min: 0
      },
      totalGasSpent: {
        type: Number,
        default: 0,
        min: 0
      },
      averageGasPrice: {
        type: Number,
        default: 0,
        min: 0
      },
      mostExpensiveTransaction: {
        hash: String,
        gasCost: Number
      }
    },
    portfolio: {
      totalValue: {
        type: Number,
        default: 0,
        min: 0
      },
      valueChange24h: {
        type: Number,
        default: 0
      },
      valueChangePercent24h: {
        type: Number,
        default: 0
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    },
    activity: {
      firstTransactionDate: {
        type: Date
      },
      lastTransactionDate: {
        type: Date
      },
      activeDays: {
        type: Number,
        default: 0,
        min: 0
      },
      averageTransactionsPerDay: {
        type: Number,
        default: 0,
        min: 0
      }
    }
  },
  
  // Integration metadata
  integration: {
    connectedApps: [{
      appName: {
        type: String,
        required: true,
        trim: true
      },
      appId: {
        type: String,
        trim: true
      },
      permissions: [{
        type: String,
        enum: ['read_balance', 'read_transactions', 'sign_transactions', 'read_nfts', 'read_tokens']
      }],
      connectedAt: {
        type: Date,
        default: Date.now
      },
      lastUsed: {
        type: Date
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }],
    apiKeys: [{
      keyId: {
        type: String,
        required: true,
        unique: true
      },
      hashedKey: {
        type: String,
        required: true
      },
      permissions: [String],
      createdAt: {
        type: Date,
        default: Date.now
      },
      lastUsed: {
        type: Date
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }]
  },
  
  // Wallet status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'flagged', 'compromised'],
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
      // Remove sensitive data from JSON output
      if (ret.security) {
        delete ret.security.encryptedPrivateData;
        delete ret.security.securityChecks;
      }
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance optimization
walletSchema.index({ walletAddress: 1 }, { unique: true });
walletSchema.index({ userId: 1, walletType: 1 });
walletSchema.index({ 'connection.isActive': 1, status: 1 });
walletSchema.index({ 'verification.isVerified': 1, status: 1 });
walletSchema.index({ 'assets.transactionHistory.transactionHash': 1 });
walletSchema.index({ 'assets.transactionHistory.timestamp': -1 });
walletSchema.index({ 'assets.transactionHistory.transactionType': 1 });
walletSchema.index({ 'analytics.volume.totalVolume': -1 });
walletSchema.index({ 'analytics.transactionCount.total': -1 });
walletSchema.index({ createdAt: -1 });

// Compound indexes
walletSchema.index({ 
  walletType: 1, 
  status: 1, 
  'verification.isVerified': 1 
});

walletSchema.index({
  'connection.isActive': 1,
  'connection.lastConnected': -1
});

// Virtual fields
walletSchema.virtual('totalNFTs').get(function() {
  return this.assets.nftTokens ? this.assets.nftTokens.length : 0;
});

walletSchema.virtual('totalTokenTypes').get(function() {
  return this.assets.balances.tokens ? this.assets.balances.tokens.length : 0;
});

walletSchema.virtual('isOnline').get(function() {
  if (!this.connection.isActive) return false;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.connection.lastConnected > fiveMinutesAgo;
});

walletSchema.virtual('portfolioValue').get(function() {
  return this.analytics.portfolio.totalValue || 0;
});

// Populate virtual references
walletSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Pre-save hooks
walletSchema.pre('save', async function(next) {
  try {
    // Update analytics if transactions changed
    if (this.isModified('assets.transactionHistory')) {
      this.updateAnalytics();
    }
    
    // Update security score
    if (this.isModified('security')) {
      this.calculateSecurityScore();
    }
    
    // Update connection metrics
    if (this.isModified('connection.connectionHistory')) {
      this.updateConnectionMetrics();
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
walletSchema.methods.verifySignature = function(message, signature) {
  // This would integrate with blockchain-specific signature verification
  // For now, returning a basic validation structure
  
  if (!message || !signature) {
    return {
      isValid: false,
      error: 'Message and signature are required'
    };
  }
  
  // Blockchain-specific verification would go here
  // This is a placeholder implementation
  const isValidFormat = this.validateSignatureFormat(signature);
  
  if (!isValidFormat) {
    return {
      isValid: false,
      error: 'Invalid signature format'
    };
  }
  
  // In a real implementation, this would use the appropriate crypto library
  // to verify the signature against the message and public key
  
  return {
    isValid: true,
    message: message,
    signature: signature,
    verifiedAt: new Date()
  };
};

walletSchema.methods.validateSignatureFormat = function(signature) {
  // Basic signature format validation based on wallet type
  const formats = {
    'solana': /^[A-Za-z0-9+/]{86,88}={0,2}$/,
    'ethereum': /^0x[a-fA-F0-9]{130}$/,
    'bitcoin': /^[A-Za-z0-9+/]{86,88}={0,2}$/
  };
  
  const format = formats[this.walletType];
  return format ? format.test(signature) : false;
};

walletSchema.methods.updateBalance = async function(balanceData) {
  // Update native token balance
  if (balanceData.nativeBalance !== undefined) {
    this.assets.balances.nativeToken.amount = balanceData.nativeBalance;
    this.assets.balances.nativeToken.lastUpdated = new Date();
  }
  
  // Update token balances
  if (balanceData.tokens && Array.isArray(balanceData.tokens)) {
    balanceData.tokens.forEach(tokenData => {
      const existingToken = this.assets.balances.tokens.find(
        token => token.tokenAddress === tokenData.tokenAddress
      );
      
      if (existingToken) {
        existingToken.amount = tokenData.amount;
        existingToken.usdValue = tokenData.usdValue || 0;
        existingToken.lastUpdated = new Date();
      } else {
        this.assets.balances.tokens.push({
          tokenAddress: tokenData.tokenAddress,
          symbol: tokenData.symbol,
          name: tokenData.name,
          amount: tokenData.amount,
          decimals: tokenData.decimals,
          usdValue: tokenData.usdValue || 0,
          lastUpdated: new Date()
        });
      }
    });
  }
  
  // Update portfolio value
  this.updatePortfolioValue();
  
  await this.save();
  return this;
};

walletSchema.methods.updatePortfolioValue = function() {
  let totalValue = 0;
  
  // Add native token value
  totalValue += this.assets.balances.nativeToken.amount * (this.getNativeTokenPrice() || 0);
  
  // Add token values
  this.assets.balances.tokens.forEach(token => {
    totalValue += token.usdValue || 0;
  });
  
  // Add NFT values
  this.assets.nftTokens.forEach(nft => {
    if (nft.estimatedValue && nft.estimatedValue.amount) {
      // Convert to USD if needed
      totalValue += nft.estimatedValue.amount * (this.getCurrencyRate(nft.estimatedValue.currency) || 0);
    }
  });
  
  const previousValue = this.analytics.portfolio.totalValue || 0;
  const valueChange = totalValue - previousValue;
  const percentChange = previousValue > 0 ? (valueChange / previousValue) * 100 : 0;
  
  this.analytics.portfolio = {
    totalValue: totalValue,
    valueChange24h: valueChange,
    valueChangePercent24h: percentChange,
    lastUpdated: new Date()
  };
};

walletSchema.methods.getNativeTokenPrice = function() {
  // This would integrate with a price API
  // Placeholder implementation
  const prices = {
    'SOL': 100,
    'ETH': 2000,
    'BTC': 45000,
    'MATIC': 1.5,
    'BNB': 300
  };
  
  return prices[this.assets.balances.nativeToken.currency] || 0;
};

walletSchema.methods.getCurrencyRate = function(currency) {
  // This would integrate with a currency conversion API
  // Placeholder implementation
  const rates = {
    'SOL': 100,
    'ETH': 2000,
    'USD': 1,
    'USDC': 1
  };
  
  return rates[currency] || 1;
};

walletSchema.methods.getTransactions = function(filters = {}) {
  let transactions = this.assets.transactionHistory;
  
  // Apply filters
  if (filters.type) {
    transactions = transactions.filter(tx => tx.transactionType === filters.type);
  }
  
  if (filters.status) {
    transactions = transactions.filter(tx => tx.status === filters.status);
  }
  
  if (filters.startDate) {
    transactions = transactions.filter(tx => tx.timestamp >= filters.startDate);
  }
  
  if (filters.endDate) {
    transactions = transactions.filter(tx => tx.timestamp <= filters.endDate);
  }
  
  if (filters.minAmount) {
    transactions = transactions.filter(tx => tx.amount >= filters.minAmount);
  }
  
  if (filters.maxAmount) {
    transactions = transactions.filter(tx => tx.amount <= filters.maxAmount);
  }
  
  // Sort by timestamp (newest first)
  transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Apply pagination
  if (filters.limit) {
    transactions = transactions.slice(0, filters.limit);
  }
  
  if (filters.offset) {
    transactions = transactions.slice(filters.offset);
  }
  
  return transactions;
};

walletSchema.methods.addTransaction = async function(transactionData) {
  const transaction = {
    transactionHash: transactionData.transactionHash,
    blockNumber: transactionData.blockNumber,
    blockHash: transactionData.blockHash,
    timestamp: transactionData.timestamp || new Date(),
    from: transactionData.from,
    to: transactionData.to,
    amount: transactionData.amount,
    currency: transactionData.currency,
    tokenAddress: transactionData.tokenAddress,
    transactionType: transactionData.transactionType,
    status: transactionData.status || 'pending',
    gasUsed: transactionData.gasUsed,
    gasPrice: transactionData.gasPrice,
    gasFee: transactionData.gasFee,
    nonce: transactionData.nonce,
    contractAddress: transactionData.contractAddress,
    methodName: transactionData.methodName,
    confirmations: transactionData.confirmations || 0,
    metadata: transactionData.metadata
  };
  
  this.assets.transactionHistory.push(transaction);
  this.updateAnalytics();
  
  await this.save();
  return transaction;
};

walletSchema.methods.updateAnalytics = function() {
  const transactions = this.assets.transactionHistory;
  
  // Update transaction counts
  this.analytics.transactionCount.total = transactions.length;
  this.analytics.transactionCount.sent = transactions.filter(tx => 
    tx.from.toLowerCase() === this.walletAddress.toLowerCase()
  ).length;
  this.analytics.transactionCount.received = transactions.filter(tx => 
    tx.to.toLowerCase() === this.walletAddress.toLowerCase()
  ).length;
  this.analytics.transactionCount.swaps = transactions.filter(tx => 
    tx.transactionType === 'swap'
  ).length;
  this.analytics.transactionCount.nftTransactions = transactions.filter(tx => 
    ['nft_mint', 'nft_transfer'].includes(tx.transactionType)
  ).length;
  
  // Update volume metrics
  let totalVolumeIn = 0;
  let totalVolumeOut = 0;
  
  transactions.forEach(tx => {
    if (tx.status === 'confirmed' && tx.currency === 'USD') {
      if (tx.to.toLowerCase() === this.walletAddress.toLowerCase()) {
        totalVolumeIn += tx.amount;
      } else if (tx.from.toLowerCase() === this.walletAddress.toLowerCase()) {
        totalVolumeOut += tx.amount;
      }
    }
  });
  
  this.analytics.volume.volumeIn = totalVolumeIn;
  this.analytics.volume.volumeOut = totalVolumeOut;
  this.analytics.volume.totalVolume = totalVolumeIn + totalVolumeOut;
  this.analytics.volume.lastCalculated = new Date();
  
  // Update gas metrics
  const confirmedTxs = transactions.filter(tx => tx.status === 'confirmed' && tx.gasUsed);
  if (confirmedTxs.length > 0) {
    const totalGasUsed = confirmedTxs.reduce((sum, tx) => sum + (tx.gasUsed || 0), 0);
    const totalGasSpent = confirmedTxs.reduce((sum, tx) => sum + (tx.gasFee || 0), 0);
    const totalGasPrice = confirmedTxs.reduce((sum, tx) => sum + (tx.gasPrice || 0), 0);
    
    this.analytics.gasMetrics.averageGasUsed = Math.round(totalGasUsed / confirmedTxs.length);
    this.analytics.gasMetrics.totalGasSpent = totalGasSpent;
    this.analytics.gasMetrics.averageGasPrice = Math.round(totalGasPrice / confirmedTxs.length);
    
    // Find most expensive transaction
    const mostExpensive = confirmedTxs.reduce((max, tx) => 
      (tx.gasFee || 0) > (max.gasFee || 0) ? tx : max
    );
    this.analytics.gasMetrics.mostExpensiveTransaction = {
      hash: mostExpensive.transactionHash,
      gasCost: mostExpensive.gasFee
    };
  }
  
  // Update activity metrics
  if (transactions.length > 0) {
    const sortedTxs = transactions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    this.analytics.activity.firstTransactionDate = sortedTxs[0].timestamp;
    this.analytics.activity.lastTransactionDate = sortedTxs[sortedTxs.length - 1].timestamp;
    
    // Calculate active days
    const uniqueDays = new Set(
      transactions.map(tx => new Date(tx.timestamp).toDateString())
    );
    this.analytics.activity.activeDays = uniqueDays.size;
    
    // Calculate average transactions per day
    if (this.analytics.activity.activeDays > 0) {
      this.analytics.activity.averageTransactionsPerDay = 
        Math.round((transactions.length / this.analytics.activity.activeDays) * 100) / 100;
    }
  }
};

walletSchema.methods.calculateSecurityScore = function() {
  let score = 50; // Base score
  
  // Verification bonus
  if (this.verification.isVerified) {
    score += 20;
  }
  
  // Two-factor authentication bonus
  if (this.security.twoFactorEnabled) {
    score += 15;
  }
  
  // Multi-sig bonus
  if (this.security.multiSigEnabled) {
    score += 10;
  }
  
  // Whitelisted addresses bonus
  if (this.security.whitelistedAddresses.length > 0) {
    score += 5;
  }
  
  // Recent security checks bonus
  const recentChecks = this.security.securityChecks.filter(check => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return check.checkedAt > sevenDaysAgo && check.status === 'passed';
  });
  
  if (recentChecks.length > 0) {
    score += 10;
  }
  
  // Suspicious activity penalty
  if (this.security.suspiciousActivity.isDetected) {
    score -= 20;
  }
  
  // Ensure score is within bounds
  this.security.securityScore = Math.max(0, Math.min(100, score));
};

walletSchema.methods.updateConnectionMetrics = function() {
  const history = this.connection.connectionHistory;
  
  if (history.length === 0) return;
  
  // Calculate total connection time
  let totalTime = 0;
  history.forEach(session => {
    if (session.disconnectedAt) {
      const duration = (session.disconnectedAt - session.connectedAt) / (1000 * 60); // minutes
      totalTime += duration;
    }
  });
  
  this.connection.totalConnectionTime = Math.round(totalTime);
  this.connection.sessionCount = history.length;
};

walletSchema.methods.addSecurityCheck = function(checkData) {
  const securityCheck = {
    checkType: checkData.checkType,
    status: checkData.status,
    score: checkData.score,
    details: checkData.details,
    checkedAt: checkData.checkedAt || new Date(),
    checkedBy: checkData.checkedBy || 'system',
    recommendations: checkData.recommendations || []
  };
  
  this.security.securityChecks.push(securityCheck);
  
  // Update overall security score
  this.calculateSecurityScore();
  
  // Update last security check
  this.security.lastSecurityCheck = securityCheck.checkedAt;
  
  return securityCheck;
};

walletSchema.methods.addNFT = async function(nftData) {
  const nft = {
    tokenAddress: nftData.tokenAddress,
    tokenId: nftData.tokenId,
    contractAddress: nftData.contractAddress,
    tokenStandard: nftData.tokenStandard,
    metadata: nftData.metadata || {},
    collectionInfo: nftData.collectionInfo || {},
    acquiredAt: nftData.acquiredAt || new Date(),
    estimatedValue: nftData.estimatedValue || { amount: 0, currency: 'SOL' }
  };
  
  this.assets.nftTokens.push(nft);
  await this.save();
  
  return nft;
};

walletSchema.methods.removeNFT = async function(tokenAddress) {
  this.assets.nftTokens = this.assets.nftTokens.filter(
    nft => nft.tokenAddress !== tokenAddress
  );
  await this.save();
};

walletSchema.methods.connectSession = async function(sessionData) {
  const session = {
    connectedAt: new Date(),
    ipAddress: sessionData.ipAddress,
    userAgent: sessionData.userAgent,
    device: sessionData.device || 'unknown',
    location: sessionData.location,
    walletApp: sessionData.walletApp || 'other',
    version: sessionData.version
  };
  
  this.connection.connectionHistory.push(session);
  this.connection.lastConnected = session.connectedAt;
  this.connection.isActive = true;
  
  await this.save();
  return session;
};

walletSchema.methods.disconnectSession = async function(sessionId) {
  if (sessionId) {
    const session = this.connection.connectionHistory.id(sessionId);
    if (session) {
      session.disconnectedAt = new Date();
      session.sessionDuration = (session.disconnectedAt - session.connectedAt) / (1000 * 60); // minutes
    }
  }
  
  this.connection.lastDisconnected = new Date();
  this.connection.isActive = false;
  
  this.updateConnectionMetrics();
  await this.save();
};

walletSchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.status = 'inactive';
  this.connection.isActive = false;
  await this.save();
};

walletSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.status = 'active';
  await this.save();
};

// Static methods
walletSchema.statics.findByWalletAddress = function(walletAddress) {
  return this.findOne({
    walletAddress: walletAddress,
    isDeleted: false
  }).populate('userId', 'username displayName avatar');
};

walletSchema.statics.findByUser = function(userId, walletType = null) {
  const query = {
    userId: userId,
    isDeleted: false
  };
  
  if (walletType) {
    query.walletType = walletType;
  }
  
  return this.find(query).sort({ createdAt: -1 });
};

walletSchema.statics.findActiveWallets = function(walletType = null, limit = 100) {
  const query = {
    'connection.isActive': true,
    status: 'active',
    isDeleted: false
  };
  
  if (walletType) {
    query.walletType = walletType;
  }
  
  return this.find(query)
    .sort({ 'connection.lastConnected': -1 })
    .limit(limit)
    .populate('userId', 'username displayName');
};

walletSchema.statics.findTopByVolume = function(walletType = null, limit = 50) {
  const query = {
    'analytics.volume.totalVolume': { $gt: 0 },
    status: 'active',
    isDeleted: false
  };
  
  if (walletType) {
    query.walletType = walletType;
  }
  
  return this.find(query)
    .sort({ 'analytics.volume.totalVolume': -1 })
    .limit(limit)
    .populate('userId', 'username displayName');
};

walletSchema.statics.findSuspiciousWallets = function(riskLevel = 'medium') {
  const riskLevels = ['medium', 'high', 'critical'];
  const query = {
    'security.suspiciousActivity.isDetected': true,
    'security.suspiciousActivity.riskLevel': { $in: riskLevels.slice(riskLevels.indexOf(riskLevel)) },
    isDeleted: false
  };
  
  return this.find(query)
    .sort({ 'security.suspiciousActivity.lastDetected': -1 })
    .populate('userId', 'username displayName email');
};

walletSchema.statics.getWalletStats = async function(timeframe = '30d', walletType = null) {
  const timeframeDays = parseInt(timeframe.replace('d', ''));
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframeDays);
  
  const matchStage = {
    createdAt: { $gte: startDate },
    isDeleted: false
  };
  
  if (walletType) {
    matchStage.walletType = walletType;
  }
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalWallets: { $sum: 1 },
        activeWallets: {
          $sum: { $cond: [{ $eq: ['$connection.isActive', true] }, 1, 0] }
        },
        verifiedWallets: {
          $sum: { $cond: [{ $eq: ['$verification.isVerified', true] }, 1, 0] }
        },
        totalTransactions: { $sum: '$analytics.transactionCount.total' },
        totalVolume: { $sum: '$analytics.volume.totalVolume' },
        averageSecurityScore: { $avg: '$security.securityScore' },
        walletsByType: {
          $push: {
            type: '$walletType',
            count: 1
          }
        },
        totalNFTs: { $sum: { $size: '$assets.nftTokens' } },
        averagePortfolioValue: { $avg: '$analytics.portfolio.totalValue' }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalWallets: 0,
    activeWallets: 0,
    verifiedWallets: 0,
    totalTransactions: 0,
    totalVolume: 0,
    averageSecurityScore: 0,
    walletsByType: [],
    totalNFTs: 0,
    averagePortfolioValue: 0
  };
};

walletSchema.statics.findWalletsNeedingSecurityCheck = function() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  return this.find({
    'security.lastSecurityCheck': { $lt: sevenDaysAgo },
    status: 'active',
    isDeleted: false
  }).populate('userId', 'username displayName email');
};

walletSchema.statics.findWalletsByNFTCount = function(minCount = 1, limit = 100) {
  return this.aggregate([
    {
      $match: {
        isDeleted: false,
        status: 'active'
      }
    },
    {
      $addFields: {
        nftCount: { $size: '$assets.nftTokens' }
      }
    },
    {
      $match: {
        nftCount: { $gte: minCount }
      }
    },
    {
      $sort: { nftCount: -1 }
    },
    {
      $limit: limit
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $project: { username: 1, displayName: 1, avatar: 1 } }
        ]
      }
    },
    {
      $unwind: '$user'
    }
  ]);
};

// Query helpers
walletSchema.query.active = function() {
  return this.where({ status: 'active', isDeleted: false });
};

walletSchema.query.verified = function() {
  return this.where({ 'verification.isVerified': true });
};

walletSchema.query.connected = function() {
  return this.where({ 'connection.isActive': true });
};

walletSchema.query.byWalletType = function(type) {
  return this.where({ walletType: type });
};

walletSchema.query.withNFTs = function() {
  return this.where({ 'assets.nftTokens.0': { $exists: true } });
};

walletSchema.query.highValue = function(minValue = 1000) {
  return this.where({ 'analytics.portfolio.totalValue': { $gte: minValue } });
};

walletSchema.query.highVolume = function(minVolume = 10000) {
  return this.where({ 'analytics.volume.totalVolume': { $gte: minVolume } });
};

walletSchema.query.suspicious = function() {
  return this.where({ 'security.suspiciousActivity.isDetected': true });
};

walletSchema.query.needsSecurityCheck = function() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return this.where({ 'security.lastSecurityCheck': { $lt: sevenDaysAgo } });
};

module.exports = mongoose.model('Wallet', walletSchema);
