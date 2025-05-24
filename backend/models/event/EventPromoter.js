const mongoose = require('mongoose');
const { Schema } = mongoose;

// Contact person schema
const contactPersonSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Contact name is required'],
    trim: true,
    maxlength: [100, 'Contact name cannot exceed 100 characters']
  },
  title: {
    type: String,
    trim: true,
    maxlength: [100, 'Contact title cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Contact email is required'],
    trim: true,
    lowercase: true,
    validate: {
      validator: function(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      },
      message: 'Invalid email format'
    }
  },
  phone: {
    type: String,
    required: [true, 'Contact phone is required'],
    trim: true,
    validate: {
      validator: function(value) {
        return /^\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/.test(value);
      },
      message: 'Invalid phone number format'
    }
  },
  mobile: {
    type: String,
    trim: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/.test(value);
      },
      message: 'Invalid mobile number format'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  _id: false,
  timestamps: false
});

// Business verification document schema
const verificationDocumentSchema = new Schema({
  documentType: {
    type: String,
    required: [true, 'Document type is required'],
    enum: ['business_license', 'insurance_certificate', 'bond_certificate', 'tax_certificate', 'permit', 'other']
  },
  documentName: {
    type: String,
    required: [true, 'Document name is required'],
    trim: true,
    maxlength: [200, 'Document name cannot exceed 200 characters']
  },
  documentNumber: {
    type: String,
    trim: true,
    maxlength: [100, 'Document number cannot exceed 100 characters']
  },
  documentUrl: {
    type: String,
    required: [true, 'Document URL is required'],
    validate: {
      validator: function(value) {
        return /^https?:\/\/.+/.test(value);
      },
      message: 'Document URL must be a valid HTTP/HTTPS URL'
    }
  },
  issuedBy: {
    type: String,
    required: [true, 'Issuing authority is required'],
    trim: true,
    maxlength: [200, 'Issuing authority cannot exceed 200 characters']
  },
  issuedDate: {
    type: Date,
    required: [true, 'Issue date is required']
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiration date is required'],
    validate: {
      validator: function(value) {
        return value > this.issuedDate;
      },
      message: 'Expiration date must be after issue date'
    }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  }
}, {
  _id: true,
  timestamps: true
});

// Event reference schema
const eventReferenceSchema = new Schema({
  eventId: {
    type: Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  eventName: {
    type: String,
    required: true,
    trim: true
  },
  eventDate: {
    type: Date,
    required: true
  },
  venueId: {
    type: Schema.Types.ObjectId,
    ref: 'Venue'
  },
  totalRevenue: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAttendance: {
    type: Number,
    default: 0,
    min: 0
  },
  commission: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['planned', 'confirmed', 'live', 'completed', 'cancelled', 'postponed'],
    default: 'planned'
  },
  profitMargin: {
    type: Number,
    default: 0
  },
  expenses: {
    marketing: { type: Number, default: 0, min: 0 },
    venue: { type: Number, default: 0, min: 0 },
    talent: { type: Number, default: 0, min: 0 },
    production: { type: Number, default: 0, min: 0 },
    other: { type: Number, default: 0, min: 0 }
  }
}, {
  _id: false,
  timestamps: false
});

// Partnership schema
const partnershipSchema = new Schema({
  partnerId: {
    type: Schema.Types.ObjectId,
    required: true,
    refPath: 'partnerModel'
  },
  partnerModel: {
    type: String,
    required: true,
    enum: ['Venue', 'Artist', 'User']
  },
  partnershipType: {
    type: String,
    enum: ['venue_preferred', 'artist_exclusive', 'sponsor_partner', 'vendor_partner', 'media_partner'],
    required: true
  },
  contractStart: {
    type: Date,
    required: true
  },
  contractEnd: {
    type: Date,
    validate: {
      validator: function(value) {
        if (value && this.contractStart) {
          return value > this.contractStart;
        }
        return true;
      },
      message: 'Contract end date must be after start date'
    }
  },
  commissionRate: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  exclusivityTerms: {
    type: String,
    trim: true,
    maxlength: [1000, 'Exclusivity terms cannot exceed 1000 characters']
  },
  totalRevenue: {
    type: Number,
    default: 0,
    min: 0
  },
  totalEvents: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  performanceMetrics: {
    averageRevenue: { type: Number, default: 0, min: 0 },
    averageAttendance: { type: Number, default: 0, min: 0 },
    cancellationRate: { type: Number, default: 0, min: 0, max: 100 }
  }
}, {
  _id: true,
  timestamps: true
});

// Review schema
const reviewSchema = new Schema({
  reviewerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reviewerType: {
    type: String,
    enum: ['artist', 'venue', 'attendee', 'vendor', 'partner'],
    required: true
  },
  eventId: {
    type: Schema.Types.ObjectId,
    ref: 'Event'
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },
  title: {
    type: String,
    trim: true,
    maxlength: [200, 'Review title cannot exceed 200 characters']
  },
  content: {
    type: String,
    required: [true, 'Review content is required'],
    trim: true,
    maxlength: [2000, 'Review content cannot exceed 2000 characters']
  },
  categories: {
    communication: { type: Number, min: 1, max: 5 },
    professionalism: { type: Number, min: 1, max: 5 },
    eventExecution: { type: Number, min: 1, max: 5 },
    paymentTimeliness: { type: Number, min: 1, max: 5 }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  response: {
    content: {
      type: String,
      trim: true,
      maxlength: [1000, 'Response cannot exceed 1000 characters']
    },
    respondedAt: {
      type: Date
    }
  },
  isPublic: {
    type: Boolean,
    default: true
  }
}, {
  _id: true,
  timestamps: true
});

// Dispute schema
const disputeSchema = new Schema({
  disputeId: {
    type: String,
    required: true,
    unique: true,
    default: () => `DSP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  },
  reporterId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reporterType: {
    type: String,
    enum: ['artist', 'venue', 'attendee', 'vendor', 'partner'],
    required: true
  },
  eventId: {
    type: Schema.Types.ObjectId,
    ref: 'Event'
  },
  disputeType: {
    type: String,
    enum: ['payment_delay', 'contract_breach', 'event_cancellation', 'poor_execution', 'communication_issue', 'other'],
    required: true
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  title: {
    type: String,
    required: [true, 'Dispute title is required'],
    trim: true,
    maxlength: [200, 'Dispute title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Dispute description is required'],
    trim: true,
    maxlength: [2000, 'Dispute description cannot exceed 2000 characters']
  },
  evidence: [{
    documentUrl: {
      type: String,
      required: true,
      validate: {
        validator: function(value) {
          return /^https?:\/\/.+/.test(value);
        },
        message: 'Evidence URL must be a valid HTTP/HTTPS URL'
      }
    },
    documentType: {
      type: String,
      enum: ['contract', 'email', 'receipt', 'photo', 'video', 'other'],
      required: true
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Evidence description cannot exceed 500 characters']
    }
  }],
  status: {
    type: String,
    enum: ['open', 'investigating', 'mediation', 'resolved', 'closed'],
    default: 'open'
  },
  resolution: {
    outcome: {
      type: String,
      enum: ['dismissed', 'warning_issued', 'compensation_required', 'contract_terminated', 'escalated'],
    },
    details: {
      type: String,
      trim: true,
      maxlength: [1000, 'Resolution details cannot exceed 1000 characters']
    },
    compensationAmount: {
      type: Number,
      min: 0
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: {
      type: Date
    }
  }
}, {
  _id: true,
  timestamps: true
});

// Main promoter schema
const promoterSchema = new Schema({
  // Core user reference
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true,
    index: true
  },
  
  // Company information
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxlength: [200, 'Company name cannot exceed 200 characters'],
    index: true
  },
  
  businessType: {
    type: String,
    required: [true, 'Business type is required'],
    enum: {
      values: ['sole_proprietorship', 'partnership', 'llc', 'corporation', 's_corp', 'non_profit'],
      message: 'Invalid business type'
    }
  },
  
  taxId: {
    type: String,
    required: [true, 'Tax ID is required'],
    trim: true,
    validate: {
      validator: function(value) {
        // Basic EIN validation (XX-XXXXXXX format)
        return /^\d{2}-\d{7}$/.test(value);
      },
      message: 'Tax ID must be in XX-XXXXXXX format'
    },
    unique: true,
    index: true
  },
  
  businessDescription: {
    type: String,
    trim: true,
    maxlength: [1000, 'Business description cannot exceed 1000 characters']
  },
  
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
  
  // Business address
  address: {
    street: {
      type: String,
      required: [true, 'Street address is required'],
      trim: true,
      maxlength: [200, 'Street address cannot exceed 200 characters']
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      maxlength: [100, 'City cannot exceed 100 characters']
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      maxlength: [100, 'State cannot exceed 100 characters']
    },
    zipCode: {
      type: String,
      required: [true, 'ZIP code is required'],
      trim: true,
      validate: {
        validator: function(value) {
          return /^\d{5}(-\d{4})?$/.test(value);
        },
        message: 'Invalid ZIP code format'
      }
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      default: 'United States'
    }
  },
  
  // Contact information
  contacts: {
    primaryContact: {
      type: contactPersonSchema,
      required: [true, 'Primary contact is required']
    },
    billingContact: contactPersonSchema,
    emergencyContact: contactPersonSchema
  },
  
  // Business verification
  verification: {
    isVerified: {
      type: Boolean,
      default: false,
      index: true
    },
    verificationLevel: {
      type: String,
      enum: ['basic', 'standard', 'premium'],
      default: 'basic'
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
        message: 'Verification date is required when promoter is verified'
      }
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    documents: [verificationDocumentSchema],
    businessLicense: {
      isValid: {
        type: Boolean,
        default: false
      },
      licenseNumber: {
        type: String,
        trim: true
      },
      expiresAt: {
        type: Date
      }
    },
    insurance: {
      isActive: {
        type: Boolean,
        default: false
      },
      provider: {
        type: String,
        trim: true
      },
      policyNumber: {
        type: String,
        trim: true
      },
      coverageAmount: {
        type: Number,
        min: 0
      },
      expiresAt: {
        type: Date
      }
    },
    bondStatus: {
      isActive: {
        type: Boolean,
        default: false
      },
      bondAmount: {
        type: Number,
        min: 0
      },
      provider: {
        type: String,
        trim: true
      },
      expiresAt: {
        type: Date
      }
    }
  },
  
  // Financial information
  financial: {
    preferredPaymentMethod: {
      type: String,
      enum: ['ach', 'wire_transfer', 'check', 'crypto', 'paypal'],
      default: 'ach'
    },
    bankingInfo: {
      accountName: {
        type: String,
        trim: true
      },
      routingNumber: {
        type: String,
        trim: true,
        validate: {
          validator: function(value) {
            if (!value) return true;
            return /^\d{9}$/.test(value);
          },
          message: 'Routing number must be 9 digits'
        }
      },
      accountNumber: {
        type: String,
        trim: true
      },
      accountType: {
        type: String,
        enum: ['checking', 'savings', 'business_checking']
      }
    },
    walletAddress: {
      type: String,
      trim: true,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^[A-Za-z0-9]{32,44}$/.test(value) || /^0x[a-fA-F0-9]{40}$/.test(value);
        },
        message: 'Invalid wallet address format'
      }
    },
    payoutSchedule: {
      frequency: {
        type: String,
        enum: ['weekly', 'bi_weekly', 'monthly', 'quarterly'],
        default: 'monthly'
      },
      dayOfWeek: {
        type: Number,
        min: 0,
        max: 6,
        default: 1 // Monday
      },
      minimumAmount: {
        type: Number,
        min: 0,
        default: 100
      },
      nextPayoutDate: {
        type: Date
      }
    },
    creditScore: {
      score: {
        type: Number,
        min: 300,
        max: 850
      },
      lastChecked: {
        type: Date
      }
    },
    taxStatus: {
      type: String,
      enum: ['current', 'delinquent', 'unknown'],
      default: 'unknown'
    }
  },
  
  // Event management
  events: {
    pastEvents: [eventReferenceSchema],
    currentEvents: [eventReferenceSchema],
    plannedEvents: [eventReferenceSchema]
  },
  
  // Partnership management
  partnerships: {
    venues: [partnershipSchema],
    artists: [partnershipSchema],
    sponsors: [partnershipSchema]
  },
  
  // Business analytics
  analytics: {
    totalRevenue: {
      lifetime: {
        type: Number,
        default: 0,
        min: 0
      },
      currentYear: {
        type: Number,
        default: 0,
        min: 0
      },
      currentMonth: {
        type: Number,
        default: 0,
        min: 0
      }
    },
    totalEvents: {
      type: Number,
      default: 0,
      min: 0
    },
    averageAttendance: {
      type: Number,
      default: 0,
      min: 0
    },
    averageTicketPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAttendees: {
      type: Number,
      default: 0,
      min: 0
    },
    roi: {
      overall: {
        type: Number,
        default: 0
      },
      currentYear: {
        type: Number,
        default: 0
      },
      lastEvent: {
        type: Number,
        default: 0
      }
    },
    profitMargins: {
      average: {
        type: Number,
        default: 0
      },
      best: {
        type: Number,
        default: 0
      },
      worst: {
        type: Number,
        default: 0
      }
    },
    marketingEfficiency: {
      costPerAcquisition: {
        type: Number,
        default: 0,
        min: 0
      },
      conversionRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      }
    },
    seasonalTrends: [{
      month: {
        type: Number,
        min: 1,
        max: 12,
        required: true
      },
      averageRevenue: {
        type: Number,
        default: 0,
        min: 0
      },
      eventCount: {
        type: Number,
        default: 0,
        min: 0
      }
    }]
  },
  
  // Reputation management
  reputation: {
    rating: {
      overall: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      communication: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      professionalism: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      eventExecution: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      paymentTimeliness: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      }
    },
    totalReviews: {
      type: Number,
      default: 0,
      min: 0
    },
    reviews: [reviewSchema],
    disputes: [disputeSchema],
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
    }
  },
  
  // Business settings
  settings: {
    autoAcceptBookings: {
      type: Boolean,
      default: false
    },
    requireDepositUpfront: {
      type: Boolean,
      default: true
    },
    defaultDepositPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 25
    },
    cancellationPolicy: {
      type: String,
      enum: ['flexible', 'moderate', 'strict'],
      default: 'moderate'
    },
    marketingBudgetPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 15
    },
    preferredGenres: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    operatingRegions: [{
      city: String,
      state: String,
      radius: { type: Number, min: 0 } // in miles
    }],
    capacityPreferences: {
      minimum: {
        type: Number,
        min: 0,
        default: 100
      },
      maximum: {
        type: Number,
        min: 0
      }
    }
  },
  
  // Promoter status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending_verification'],
    default: 'pending_verification',
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
      // Remove sensitive financial information
      if (ret.financial && ret.financial.bankingInfo) {
        delete ret.financial.bankingInfo.routingNumber;
        delete ret.financial.bankingInfo.accountNumber;
      }
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance optimization
promoterSchema.index({ companyName: 'text', businessDescription: 'text' });
promoterSchema.index({ taxId: 1 }, { unique: true });
promoterSchema.index({ 'address.city': 1, 'address.state': 1 });
promoterSchema.index({ 'verification.isVerified': 1, status: 1 });
promoterSchema.index({ 'analytics.totalRevenue.lifetime': -1 });
promoterSchema.index({ 'analytics.totalEvents': -1 });
promoterSchema.index({ 'reputation.rating.overall': -1 });
promoterSchema.index({ createdAt: -1 });

// Compound indexes
promoterSchema.index({ 
  status: 1, 
  'verification.isVerified': 1, 
  'analytics.totalEvents': -1 
});

// Virtual fields
promoterSchema.virtual('totalActiveEvents').get(function() {
  return this.events.currentEvents.filter(event => 
    ['confirmed', 'live'].includes(event.status)
  ).length;
});

promoterSchema.virtual('totalPartners').get(function() {
  return this.partnerships.venues.length + 
         this.partnerships.artists.length + 
         this.partnerships.sponsors.length;
});

promoterSchema.virtual('averageEventRevenue').get(function() {
  if (this.analytics.totalEvents === 0) return 0;
  return Math.round(this.analytics.totalRevenue.lifetime / this.analytics.totalEvents);
});

promoterSchema.virtual('activeDisputes').get(function() {
  return this.reputation.disputes.filter(dispute => 
    ['open', 'investigating', 'mediation'].includes(dispute.status)
  ).length;
});

// Populate virtual references
promoterSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Pre-save hooks
promoterSchema.pre('save', async function(next) {
  try {
    // Validate promoter before saving
    await this.validatePromoter();
    
    // Update analytics calculations
    this.updateAnalytics();
    
    // Update reputation scores
    this.updateReputationScores();
    
    // Set default billing contact if not provided
    if (!this.contacts.billingContact && this.contacts.primaryContact) {
      this.contacts.billingContact = { ...this.contacts.primaryContact };
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
promoterSchema.methods.validatePromoter = async function() {
  // Validate user exists
  const User = mongoose.model('User');
  const user = await User.findById(this.userId);
  if (!user) {
    throw new Error('Associated user does not exist');
  }
  
  // Validate tax ID uniqueness (excluding current document)
  const existingPromoter = await this.constructor.findOne({
    taxId: this.taxId,
    _id: { $ne: this._id }
  });
  
  if (existingPromoter) {
    throw new Error('Tax ID already exists for another promoter');
  }
  
  return true;
};

promoterSchema.methods.calculateCommission = function(eventRevenue, commissionRate = null) {
  // Use provided rate or default to promoter's standard rate
  const rate = commissionRate || this.settings.defaultDepositPercentage || 10;
  
  const commissionAmount = (eventRevenue * rate) / 100;
  const netRevenue = eventRevenue - commissionAmount;
  
  return {
    grossRevenue: eventRevenue,
    commissionRate: rate,
    commissionAmount: commissionAmount,
    netRevenue: netRevenue,
    calculatedAt: new Date()
  };
};

promoterSchema.methods.generateReport = async function(reportType = 'monthly', startDate = null, endDate = null) {
  if (!endDate) endDate = new Date();
  if (!startDate) {
    startDate = new Date();
    switch (reportType) {
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarterly':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'yearly':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }
  }
  
  // Filter events within date range
  const relevantEvents = [
    ...this.events.pastEvents,
    ...this.events.currentEvents
  ].filter(event => 
    event.eventDate >= startDate && 
    event.eventDate <= endDate &&
    event.status === 'completed'
  );
  
  // Calculate metrics
  const totalRevenue = relevantEvents.reduce((sum, event) => sum + event.totalRevenue, 0);
  const totalAttendance = relevantEvents.reduce((sum, event) => sum + event.totalAttendance, 0);
  const totalExpenses = relevantEvents.reduce((sum, event) => {
    const eventExpenses = Object.values(event.expenses).reduce((expSum, exp) => expSum + exp, 0);
    return sum + eventExpenses;
  }, 0);
  
  const netProfit = totalRevenue - totalExpenses;
  const roi = totalExpenses > 0 ? ((netProfit / totalExpenses) * 100) : 0;
  
  return {
    reportType,
    period: { startDate, endDate },
    summary: {
      totalEvents: relevantEvents.length,
      totalRevenue,
      totalExpenses,
      netProfit,
      roi: Math.round(roi * 100) / 100,
      averageEventRevenue: relevantEvents.length > 0 ? totalRevenue / relevantEvents.length : 0,
      averageAttendance: relevantEvents.length > 0 ? totalAttendance / relevantEvents.length : 0
    },
    events: relevantEvents.map(event => ({
      name: event.eventName,
      date: event.eventDate,
      revenue: event.totalRevenue,
      attendance: event.totalAttendance,
      profitMargin: event.profitMargin,
      status: event.status
    })),
    expenseBreakdown: {
      marketing: relevantEvents.reduce((sum, e) => sum + e.expenses.marketing, 0),
      venue: relevantEvents.reduce((sum, e) => sum + e.expenses.venue, 0),
      talent: relevantEvents.reduce((sum, e) => sum + e.expenses.talent, 0),
      production: relevantEvents.reduce((sum, e) => sum + e.expenses.production, 0),
      other: relevantEvents.reduce((sum, e) => sum + e.expenses.other, 0)
    },
    generatedAt: new Date()
  };
};

promoterSchema.methods.addEvent = async function(eventData, eventType = 'planned') {
  const newEvent = {
    eventId: eventData.eventId || new mongoose.Types.ObjectId(),
    eventName: eventData.eventName,
    eventDate: eventData.eventDate,
    venueId: eventData.venueId,
    totalRevenue: eventData.totalRevenue || 0,
    totalAttendance: eventData.totalAttendance || 0,
    commission: eventData.commission || 0,
    status: eventData.status || 'planned',
    profitMargin: eventData.profitMargin || 0,
    expenses: eventData.expenses || {
      marketing: 0,
      venue: 0,
      talent: 0,
      production: 0,
      other: 0
    }
  };
  
  // Add to appropriate event category
  switch (eventType) {
    case 'past':
      this.events.pastEvents.push(newEvent);
      break;
    case 'current':
      this.events.currentEvents.push(newEvent);
      break;
    case 'planned':
    default:
      this.events.plannedEvents.push(newEvent);
  }
  
  // Update analytics
  if (eventType === 'past' || (eventType === 'current' && newEvent.status === 'completed')) {
    this.analytics.totalEvents += 1;
    this.analytics.totalRevenue.lifetime += newEvent.totalRevenue;
    this.analytics.totalAttendees += newEvent.totalAttendance;
    
    if (this.analytics.totalEvents > 0) {
      this.analytics.averageAttendance = Math.round(
        this.analytics.totalAttendees / this.analytics.totalEvents
      );
    }
  }
  
  await this.save();
  return newEvent;
};

promoterSchema.methods.addPartnership = async function(partnerData) {
  const partnership = {
    partnerId: partnerData.partnerId,
    partnerModel: partnerData.partnerModel,
    partnershipType: partnerData.partnershipType,
    contractStart: partnerData.contractStart || new Date(),
    contractEnd: partnerData.contractEnd,
    commissionRate: partnerData.commissionRate || 0,
    exclusivityTerms: partnerData.exclusivityTerms,
    isActive: true
  };
  
  // Add to appropriate partnership category
  switch (partnerData.partnerModel) {
    case 'Venue':
      this.partnerships.venues.push(partnership);
      break;
    case 'Artist':
      this.partnerships.artists.push(partnership);
      break;
    case 'User': // For sponsors
      this.partnerships.sponsors.push(partnership);
      break;
  }
  
  await this.save();
  return partnership;
};

promoterSchema.methods.addReview = async function(reviewData) {
  const newReview = {
    reviewerId: reviewData.reviewerId,
    reviewerType: reviewData.reviewerType,
    eventId: reviewData.eventId,
    rating: reviewData.rating,
    title: reviewData.title,
    content: reviewData.content,
    categories: reviewData.categories || {},
    isVerified: reviewData.isVerified || false,
    isPublic: reviewData.isPublic !== false
  };
  
  this.reputation.reviews.push(newReview);
  this.reputation.totalReviews += 1;
  
  // Update reputation scores
  this.updateReputationScores();
  
  await this.save();
  return newReview;
};

promoterSchema.methods.addDispute = async function(disputeData) {
  const newDispute = {
    reporterId: disputeData.reporterId,
    reporterType: disputeData.reporterType,
    eventId: disputeData.eventId,
    disputeType: disputeData.disputeType,
    severity: disputeData.severity || 'medium',
    title: disputeData.title,
    description: disputeData.description,
    evidence: disputeData.evidence || [],
    status: 'open'
  };
  
  this.reputation.disputes.push(newDispute);
  await this.save();
  return newDispute;
};

promoterSchema.methods.resolveDispute = async function(disputeId, resolution) {
  const dispute = this.reputation.disputes.id(disputeId);
  if (!dispute) {
    throw new Error('Dispute not found');
  }
  
  dispute.status = 'resolved';
  dispute.resolution = {
    outcome: resolution.outcome,
    details: resolution.details,
    compensationAmount: resolution.compensationAmount,
    resolvedBy: resolution.resolvedBy,
    resolvedAt: new Date()
  };
  
  await this.save();
  return dispute;
};

promoterSchema.methods.updateAnalytics = function() {
  // Update current month and year revenue
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  
  // Calculate current month revenue
  const currentMonthEvents = [
    ...this.events.pastEvents,
    ...this.events.currentEvents
  ].filter(event => {
    const eventDate = new Date(event.eventDate);
    return eventDate.getMonth() === currentMonth && 
           eventDate.getFullYear() === currentYear &&
           event.status === 'completed';
  });
  
  this.analytics.totalRevenue.currentMonth = currentMonthEvents.reduce(
    (sum, event) => sum + event.totalRevenue, 0
  );
  
  // Calculate current year revenue
  const currentYearEvents = [
    ...this.events.pastEvents,
    ...this.events.currentEvents
  ].filter(event => {
    const eventDate = new Date(event.eventDate);
    return eventDate.getFullYear() === currentYear && event.status === 'completed';
  });
  
  this.analytics.totalRevenue.currentYear = currentYearEvents.reduce(
    (sum, event) => sum + event.totalRevenue, 0
  );
  
  // Calculate ROI
  const totalExpenses = [...this.events.pastEvents, ...this.events.currentEvents]
    .reduce((sum, event) => {
      const eventExpenses = Object.values(event.expenses).reduce((expSum, exp) => expSum + exp, 0);
      return sum + eventExpenses;
    }, 0);
  
  if (totalExpenses > 0) {
    const netProfit = this.analytics.totalRevenue.lifetime - totalExpenses;
    this.analytics.roi.overall = Math.round(((netProfit / totalExpenses) * 100) * 100) / 100;
  }
  
  // Update seasonal trends
  this.updateSeasonalTrends();
};

promoterSchema.methods.updateSeasonalTrends = function() {
  const monthlyData = {};
  
  // Initialize all months
  for (let i = 1; i <= 12; i++) {
    monthlyData[i] = { revenue: 0, events: 0 };
  }
  
  // Aggregate data by month
  [...this.events.pastEvents, ...this.events.currentEvents]
    .filter(event => event.status === 'completed')
    .forEach(event => {
      const month = new Date(event.eventDate).getMonth() + 1;
      monthlyData[month].revenue += event.totalRevenue;
      monthlyData[month].events += 1;
    });
  
  // Update seasonal trends
  this.analytics.seasonalTrends = Object.keys(monthlyData).map(month => ({
    month: parseInt(month),
    averageRevenue: monthlyData[month].events > 0 ? 
      Math.round(monthlyData[month].revenue / monthlyData[month].events) : 0,
    eventCount: monthlyData[month].events
  }));
};

promoterSchema.methods.updateReputationScores = function() {
  const reviews = this.reputation.reviews.filter(review => review.isPublic);
  
  if (reviews.length === 0) return;
  
  // Calculate overall rating
  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  this.reputation.rating.overall = Math.round((totalRating / reviews.length) * 10) / 10;
  
  // Calculate category ratings
  const categories = ['communication', 'professionalism', 'eventExecution', 'paymentTimeliness'];
  categories.forEach(category => {
    const categoryReviews = reviews.filter(review => review.categories && review.categories[category]);
    if (categoryReviews.length > 0) {
      const categoryTotal = categoryReviews.reduce((sum, review) => sum + review.categories[category], 0);
      this.reputation.rating[category] = Math.round((categoryTotal / categoryReviews.length) * 10) / 10;
    }
  });
  
  // Update response metrics
  const reviewsWithResponses = reviews.filter(review => review.response && review.response.content);
  this.reputation.responseRate = reviews.length > 0 ? 
    Math.round((reviewsWithResponses.length / reviews.length) * 100) : 0;
};

promoterSchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.status = 'suspended';
  await this.save();
};

promoterSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.status = 'active';
  await this.save();
};

// Static methods
promoterSchema.statics.findVerified = function(filters = {}) {
  const query = {
    'verification.isVerified': true,
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('userId', 'username displayName avatar')
    .sort({ 'reputation.rating.overall': -1, 'analytics.totalEvents': -1 });
};

promoterSchema.statics.findByRegion = function(city, state, radius = 50, filters = {}) {
  const query = {
    $or: [
      { 'address.city': new RegExp(city, 'i') },
      { 'address.state': new RegExp(state, 'i') },
      { 'settings.operatingRegions.city': new RegExp(city, 'i') },
      { 'settings.operatingRegions.state': new RegExp(state, 'i') }
    ],
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('userId', 'username displayName avatar')
    .sort({ 'reputation.rating.overall': -1 });
};

promoterSchema.statics.findTopPerformers = function(criteria = 'revenue', limit = 50, filters = {}) {
  const sortField = {
    revenue: 'analytics.totalRevenue.lifetime',
    events: 'analytics.totalEvents',
    rating: 'reputation.rating.overall',
    roi: 'analytics.roi.overall'
  }[criteria] || 'analytics.totalRevenue.lifetime';
  
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

promoterSchema.statics.searchPromoters = function(searchTerm, filters = {}) {
  const searchQuery = {
    $or: [
      { companyName: { $regex: searchTerm, $options: 'i' } },
      { businessDescription: { $regex: searchTerm, $options: 'i' } },
      { 'settings.preferredGenres': { $regex: searchTerm, $options: 'i' } }
    ],
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .populate('userId', 'username displayName avatar')
    .sort({ 'reputation.rating.overall': -1, 'analytics.totalEvents': -1 });
};

promoterSchema.statics.getPromoterStats = async function(timeframe = '30d', filters = {}) {
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
        totalPromoters: { $sum: 1 },
        verifiedPromoters: {
          $sum: { $cond: [{ $eq: ['$verification.isVerified', true] }, 1, 0] }
        },
        activePromoters: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        totalRevenue: { $sum: '$analytics.totalRevenue.lifetime' },
        totalEvents: { $sum: '$analytics.totalEvents' },
        averageRating: { $avg: '$reputation.rating.overall' },
        totalDisputes: { $sum: { $size: '$reputation.disputes' } },
        averageROI: { $avg: '$analytics.roi.overall' }
      }
    },
    {
      $project: {
        totalPromoters: 1,
        verifiedPromoters: 1,
        activePromoters: 1,
        totalRevenue: 1,
        totalEvents: 1,
        averageRating: { $round: ['$averageRating', 2] },
        totalDisputes: 1,
        averageROI: { $round: ['$averageROI', 2] },
        averageRevenuePerPromoter: { 
          $round: [{ $divide: ['$totalRevenue', '$totalPromoters'] }, 0] 
        },
        averageEventsPerPromoter: { 
          $round: [{ $divide: ['$totalEvents', '$totalPromoters'] }, 1] 
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalPromoters: 0,
    verifiedPromoters: 0,
    activePromoters: 0,
    totalRevenue: 0,
    totalEvents: 0,
    averageRating: 0,
    totalDisputes: 0,
    averageROI: 0,
    averageRevenuePerPromoter: 0,
    averageEventsPerPromoter: 0
  };
};

promoterSchema.statics.findExpiringDocuments = function(daysAhead = 30) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  
  return this.find({
    $or: [
      { 'verification.documents.expiresAt': { $lte: futureDate } },
      { 'verification.businessLicense.expiresAt': { $lte: futureDate } },
      { 'verification.insurance.expiresAt': { $lte: futureDate } },
      { 'verification.bondStatus.expiresAt': { $lte: futureDate } }
    ],
    status: 'active',
    isDeleted: false
  }).populate('userId', 'username displayName email');
};

promoterSchema.statics.findPromotersNeedingPayout = function() {
  const query = {
    'financial.payoutSchedule.nextPayoutDate': { $lte: new Date() },
    'analytics.totalRevenue.currentMonth': { $gt: 0 },
    status: 'active',
    isDeleted: false
  };
  
  return this.find(query)
    .populate('userId', 'username displayName email')
    .sort({ 'analytics.totalRevenue.currentMonth': -1 });
};

// Query helpers
promoterSchema.query.active = function() {
  return this.where({ status: 'active', isDeleted: false });
};

promoterSchema.query.verified = function() {
  return this.where({ 'verification.isVerified': true });
};

promoterSchema.query.byBusinessType = function(type) {
  return this.where({ businessType: type });
};

promoterSchema.query.byRegion = function(city, state) {
  return this.where({
    $or: [
      { 'address.city': new RegExp(city, 'i') },
      { 'address.state': new RegExp(state, 'i') }
    ]
  });
};

promoterSchema.query.topRated = function(minRating = 4.0) {
  return this.where({ 
    'reputation.rating.overall': { $gte: minRating },
    'reputation.totalReviews': { $gte: 5 }
  });
};

promoterSchema.query.withMinRevenue = function(amount) {
  return this.where({ 'analytics.totalRevenue.lifetime': { $gte: amount } });
};

promoterSchema.query.withActiveDisputes = function() {
  return this.where({ 
    'reputation.disputes.status': { $in: ['open', 'investigating', 'mediation'] } 
  });
};

module.exports = mongoose.model('Promoter', promoterSchema);
