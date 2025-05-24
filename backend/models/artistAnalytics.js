const mongoose = require('mongoose');

/**
 * Artist Analytics Schema - Tracks royalty and earnings data for artists
 */
const artistAnalyticsSchema = new mongoose.Schema({
  // Reference to the user (artist) this analytics belongs to
  artistId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Summary statistics
  totalEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  totalSales: {
    type: Number,
    default: 0,
    min: 0
  },
  totalRoyalties: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Primary sales from initial ticket/NFT purchases
  primarySales: {
    count: {
      type: Number,
      default: 0,
      min: 0
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0
    },
    avgPrice: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Secondary sales (resales) on marketplaces
  secondarySales: {
    count: {
      type: Number,
      default: 0,
      min: 0
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0
    },
    royalties: {
      type: Number,
      default: 0,
      min: 0
    },
    avgResalePrice: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Royalty distribution by collection/event
  royaltiesByCollection: [{
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Collection',
      required: true
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    royaltyPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    totalEarned: {
      type: Number,
      default: 0,
      min: 0
    },
    salesCount: {
      type: Number,
      default: 0,
      min: 0
    },
    // Time series data for chart visualization
    timeSeriesData: [{
      date: {
        type: Date,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      salesCount: {
        type: Number,
        required: true,
        min: 0
      }
    }]
  }],
  
  // Royalty distribution by marketplace
  royaltiesByMarketplace: [{
    marketplace: {
      type: String,
      required: true
    },
    totalEarned: {
      type: Number,
      default: 0,
      min: 0
    },
    salesCount: {
      type: Number,
      default: 0,
      min: 0
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Royalty distribution by time period
  royaltiesByPeriod: {
    daily: [{
      date: {
        type: Date,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      salesCount: {
        type: Number,
        required: true,
        min: 0
      }
    }],
    weekly: [{
      weekStart: {
        type: Date,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      salesCount: {
        type: Number,
        required: true,
        min: 0
      }
    }],
    monthly: [{
      month: {
        type: Number,
        required: true,
        min: 1,
        max: 12
      },
      year: {
        type: Number,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      salesCount: {
        type: Number,
        required: true,
        min: 0
      }
    }],
    yearly: [{
      year: {
        type: Number,
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      salesCount: {
        type: Number,
        required: true,
        min: 0
      }
    }]
  },
  
  // Distribution by payment type
  paymentDistribution: {
    crypto: {
      amount: {
        type: Number,
        default: 0,
        min: 0
      },
      percentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      }
    },
    fiat: {
      amount: {
        type: Number,
        default: 0,
        min: 0
      },
      percentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      }
    }
  },
  
  // Payment records for all royalty payments
  paymentRecords: [{
    transactionId: {
      type: String,
      required: true
    },
    date: {
      type: Date,
      required: true,
      default: Date.now
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      required: true
    },
    paymentType: {
      type: String,
      enum: ['crypto', 'fiat'],
      required: true
    },
    tokenId: {
      type: String
    },
    buyerAddress: {
      type: String
    },
    sellerAddress: {
      type: String
    },
    marketplace: {
      type: String
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event'
    },
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Collection'
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'completed'
    },
    saleType: {
      type: String,
      enum: ['primary', 'secondary'],
      required: true
    },
    royaltyPercentage: {
      type: Number,
      min: 0,
      max: 100
    },
    platformFee: {
      type: Number,
      min: 0
    },
    netAmount: {
      type: Number,
      min: 0
    },
    txHash: {
      type: String,
      sparse: true
    }
  }],
  
  // Pending royalty payments
  pendingRoyalties: [{
    saleId: {
      type: String,
      required: true
    },
    date: {
      type: Date,
      required: true,
      default: Date.now
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    tokenId: {
      type: String
    },
    marketplace: {
      type: String
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event'
    },
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Collection'
    },
    estimatedPaymentDate: {
      type: Date
    }
  }],
  
  // Collector data for artist insights
  topCollectors: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    walletAddress: {
      type: String
    },
    purchaseCount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalSpent: {
      type: Number,
      default: 0,
      min: 0
    },
    lastPurchaseDate: {
      type: Date
    }
  }],
  
  // Platform-specific settings and data
  platformData: {
    royaltyEnforcement: {
      type: Boolean,
      default: true
    },
    defaultRoyaltyPercentage: {
      type: Number,
      default: 10,
      min: 0,
      max: 100
    },
    payoutMethod: {
      type: String,
      enum: ['automatic', 'manual'],
      default: 'automatic'
    },
    payoutFrequency: {
      type: String,
      enum: ['instant', 'daily', 'weekly', 'monthly'],
      default: 'weekly'
    },
    preferredWallet: {
      type: String
    },
    taxInformation: {
      taxId: {
        type: String
      },
      reportingEnabled: {
        type: Boolean,
        default: false
      }
    }
  },
  
  // Timestamps for tracking when analytics were last updated
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  lastSyncedWithBlockchain: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better query performance
artistAnalyticsSchema.index({ 'artistId': 1 });
artistAnalyticsSchema.index({ 'royaltiesByCollection.collectionId': 1 });
artistAnalyticsSchema.index({ 'royaltiesByCollection.eventId': 1 });
artistAnalyticsSchema.index({ 'paymentRecords.date': 1 });
artistAnalyticsSchema.index({ 'pendingRoyalties.estimatedPaymentDate': 1 });

// Static method to get analytics by artist ID
artistAnalyticsSchema.statics.getByArtistId = async function(artistId) {
  let analytics = await this.findOne({ artistId });
  
  // If no analytics document exists for this artist, create one
  if (!analytics) {
    analytics = await this.create({ 
      artistId,
      totalEarnings: 0,
      totalSales: 0,
      totalRoyalties: 0
    });
  }
  
  return analytics;
};

// Method to add a new royalty payment
artistAnalyticsSchema.methods.addRoyaltyPayment = async function(paymentData) {
  // Add the payment to payment records
  this.paymentRecords.push(paymentData);
  
  // Update summary statistics
  this.totalEarnings += paymentData.amount;
  this.totalSales += 1;
  
  if (paymentData.saleType === 'secondary') {
    this.totalRoyalties += paymentData.amount;
    this.secondarySales.count += 1;
    this.secondarySales.revenue += paymentData.amount;
    
    // Update the average resale price
    const totalRevenue = this.secondarySales.revenue;
    const totalCount = this.secondarySales.count;
    this.secondarySales.avgResalePrice = totalRevenue / totalCount;
  } else {
    // Primary sale
    this.primarySales.count += 1;
    this.primarySales.revenue += paymentData.amount;
    
    // Update the average price
    const totalRevenue = this.primarySales.revenue;
    const totalCount = this.primarySales.count;
    this.primarySales.avgPrice = totalRevenue / totalCount;
  }
  
  // Update payment distribution
  const totalPayments = this.paymentDistribution.crypto.amount + this.paymentDistribution.fiat.amount + paymentData.amount;
  
  if (paymentData.paymentType === 'crypto') {
    this.paymentDistribution.crypto.amount += paymentData.amount;
  } else {
    this.paymentDistribution.fiat.amount += paymentData.amount;
  }
  
  // Recalculate percentages
  this.paymentDistribution.crypto.percentage = (this.paymentDistribution.crypto.amount / totalPayments) * 100;
  this.paymentDistribution.fiat.percentage = (this.paymentDistribution.fiat.amount / totalPayments) * 100;
  
  // Update marketplace data if available
  if (paymentData.marketplace) {
    let marketplaceEntry = this.royaltiesByMarketplace.find(m => m.marketplace === paymentData.marketplace);
    
    if (!marketplaceEntry) {
      marketplaceEntry = {
        marketplace: paymentData.marketplace,
        totalEarned: 0,
        salesCount: 0,
        lastUpdated: new Date()
      };
      this.royaltiesByMarketplace.push(marketplaceEntry);
    }
    
    marketplaceEntry.totalEarned += paymentData.amount;
    marketplaceEntry.salesCount += 1;
    marketplaceEntry.lastUpdated = new Date();
  }
  
  // Update collection data if available
  if (paymentData.collectionId) {
    let collectionEntry = this.royaltiesByCollection.find(c => 
      c.collectionId.toString() === paymentData.collectionId.toString()
    );
    
    if (!collectionEntry && paymentData.eventId) {
      collectionEntry = {
        collectionId: paymentData.collectionId,
        eventId: paymentData.eventId,
        name: paymentData.collectionName || 'Unknown Collection',
        royaltyPercentage: paymentData.royaltyPercentage || 0,
        totalEarned: 0,
        salesCount: 0,
        timeSeriesData: []
      };
      this.royaltiesByCollection.push(collectionEntry);
    }
    
    if (collectionEntry) {
      collectionEntry.totalEarned += paymentData.amount;
      collectionEntry.salesCount += 1;
      
      // Add to time series data
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let todayEntry = collectionEntry.timeSeriesData.find(entry => 
        entry.date.getTime() === today.getTime()
      );
      
      if (!todayEntry) {
        todayEntry = {
          date: today,
          amount: 0,
          salesCount: 0
        };
        collectionEntry.timeSeriesData.push(todayEntry);
      }
      
      todayEntry.amount += paymentData.amount;
      todayEntry.salesCount += 1;
    }
  }
  
  // Update time period data
  const paymentDate = new Date(paymentData.date);
  
  // Daily data
  const day = new Date(paymentDate);
  day.setHours(0, 0, 0, 0);
  
  let dayEntry = this.royaltiesByPeriod.daily.find(entry => 
    entry.date.getTime() === day.getTime()
  );
  
  if (!dayEntry) {
    dayEntry = {
      date: day,
      amount: 0,
      salesCount: 0
    };
    this.royaltiesByPeriod.daily.push(dayEntry);
  }
  
  dayEntry.amount += paymentData.amount;
  dayEntry.salesCount += 1;
  
  // Weekly data
  const week = new Date(paymentDate);
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - week.getDay()); // Set to start of week (Sunday)
  
  let weekEntry = this.royaltiesByPeriod.weekly.find(entry => 
    entry.weekStart.getTime() === week.getTime()
  );
  
  if (!weekEntry) {
    weekEntry = {
      weekStart: week,
      amount: 0,
      salesCount: 0
    };
    this.royaltiesByPeriod.weekly.push(weekEntry);
  }
  
  weekEntry.amount += paymentData.amount;
  weekEntry.salesCount += 1;
  
  // Monthly data
  const month = paymentDate.getMonth() + 1; // 1-12
  const year = paymentDate.getFullYear();
  
  let monthEntry = this.royaltiesByPeriod.monthly.find(entry => 
    entry.month === month && entry.year === year
  );
  
  if (!monthEntry) {
    monthEntry = {
      month,
      year,
      amount: 0,
      salesCount: 0
    };
    this.royaltiesByPeriod.monthly.push(monthEntry);
  }
  
  monthEntry.amount += paymentData.amount;
  monthEntry.salesCount += 1;
  
  // Yearly data
  let yearEntry = this.royaltiesByPeriod.yearly.find(entry => 
    entry.year === year
  );
  
  if (!yearEntry) {
    yearEntry = {
      year,
      amount: 0,
      salesCount: 0
    };
    this.royaltiesByPeriod.yearly.push(yearEntry);
  }
  
  yearEntry.amount += paymentData.amount;
  yearEntry.salesCount += 1;
  
  // Update collector data if available
  if (paymentData.buyerAddress || paymentData.buyerId) {
    const collectorId = paymentData.buyerId || paymentData.buyerAddress;
    let collectorEntry = this.topCollectors.find(c => 
      (c.userId && c.userId.toString() === collectorId.toString()) || 
      (c.walletAddress && c.walletAddress === collectorId)
    );
    
    if (!collectorEntry) {
      collectorEntry = {
        userId: paymentData.buyerId,
        walletAddress: paymentData.buyerAddress,
        purchaseCount: 0,
        totalSpent: 0
      };
      this.topCollectors.push(collectorEntry);
    }
    
    collectorEntry.purchaseCount += 1;
    collectorEntry.totalSpent += paymentData.amount;
    collectorEntry.lastPurchaseDate = paymentData.date;
  }
  
  // Update last updated timestamp
  this.lastUpdated = new Date();
  
  // Sort top collectors by total spent (descending)
  this.topCollectors.sort((a, b) => b.totalSpent - a.totalSpent);
  
  // Keep only top 50 collectors
  if (this.topCollectors.length > 50) {
    this.topCollectors = this.topCollectors.slice(0, 50);
  }
  
  // Limit time series data to last 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  this.royaltiesByPeriod.daily = this.royaltiesByPeriod.daily.filter(entry => 
    entry.date >= ninetyDaysAgo
  );
  
  // Save the updated analytics
  return this.save();
};

// Method to remove pending royalty payment
artistAnalyticsSchema.methods.removePendingRoyalty = async function(saleId) {
  const pendingIndex = this.pendingRoyalties.findIndex(p => p.saleId === saleId);
  
  if (pendingIndex !== -1) {
    this.pendingRoyalties.splice(pendingIndex, 1);
    await this.save();
    return true;
  }
  
  return false;
};

// Method to get analytics summary
artistAnalyticsSchema.methods.getSummary = function() {
  return {
    totalEarnings: this.totalEarnings,
    totalSales: this.totalSales,
    totalRoyalties: this.totalRoyalties,
    primarySales: this.primarySales,
    secondarySales: this.secondarySales,
    pendingRoyaltiesCount: this.pendingRoyalties.length,
    pendingRoyaltiesAmount: this.pendingRoyalties.reduce((sum, royalty) => sum + royalty.amount, 0),
    topMarketplaces: this.royaltiesByMarketplace.sort((a, b) => b.totalEarned - a.totalEarned).slice(0, 5),
    topCollections: this.royaltiesByCollection.sort((a, b) => b.totalEarned - a.totalEarned).slice(0, 5),
    paymentDistribution: this.paymentDistribution,
    lastUpdated: this.lastUpdated
  };
};

// Create and export the model
const ArtistAnalytics = mongoose.model('ArtistAnalytics', artistAnalyticsSchema);

module.exports = ArtistAnalytics;
