const mongoose = require('mongoose');
const { Schema } = mongoose;

// Section schema for venue capacity management
const sectionSchema = new Schema({
  sectionId: {
    type: String,
    required: [true, 'Section ID is required'],
    uppercase: true,
    trim: true
  },
  name: {
    type: String,
    required: [true, 'Section name is required'],
    trim: true,
    maxlength: [100, 'Section name cannot exceed 100 characters']
  },
  type: {
    type: String,
    required: [true, 'Section type is required'],
    enum: {
      values: ['general', 'vip', 'premium', 'standing', 'seated', 'box', 'suite'],
      message: 'Section type must be general, vip, premium, standing, seated, box, or suite'
    }
  },
  capacity: {
    type: Number,
    required: [true, 'Section capacity is required'],
    min: [1, 'Section capacity must be at least 1']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Section description cannot exceed 500 characters']
  },
  priceMultiplier: {
    type: Number,
    default: 1.0,
    min: [0.1, 'Price multiplier must be at least 0.1'],
    max: [10, 'Price multiplier cannot exceed 10']
  },
  amenities: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  isAccessible: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  _id: true,
  timestamps: false
});

// Document schema for venue verification
const documentSchema = new Schema({
  documentType: {
    type: String,
    required: [true, 'Document type is required'],
    enum: {
      values: ['business_license', 'fire_certificate', 'insurance', 'capacity_certificate', 'health_permit', 'other'],
      message: 'Invalid document type'
    }
  },
  documentName: {
    type: String,
    required: [true, 'Document name is required'],
    trim: true,
    maxlength: [200, 'Document name cannot exceed 200 characters']
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
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    validate: {
      validator: function(value) {
        if (value && value <= new Date()) {
          return false;
        }
        return true;
      },
      message: 'Document expiration date must be in the future'
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
  }
}, {
  _id: true,
  timestamps: false
});

// Operating hours schema
const operatingHoursSchema = new Schema({
  day: {
    type: String,
    required: true,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  },
  isOpen: {
    type: Boolean,
    default: true
  },
  openTime: {
    type: String,
    validate: {
      validator: function(value) {
        if (!this.isOpen) return true;
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
      },
      message: 'Open time must be in HH:MM format'
    }
  },
  closeTime: {
    type: String,
    validate: {
      validator: function(value) {
        if (!this.isOpen) return true;
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
      },
      message: 'Close time must be in HH:MM format'
    }
  }
}, {
  _id: false,
  timestamps: false
});

// Main venue schema
const venueSchema = new Schema({
  // Basic venue information
  name: {
    type: String,
    required: [true, 'Venue name is required'],
    trim: true,
    maxlength: [200, 'Venue name cannot exceed 200 characters'],
    index: true
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  
  venueType: {
    type: String,
    required: [true, 'Venue type is required'],
    enum: {
      values: ['concert_hall', 'stadium', 'arena', 'theater', 'club', 'outdoor', 'conference_center', 'hotel', 'restaurant', 'bar', 'gallery', 'other'],
      message: 'Invalid venue type'
    },
    index: true
  },
  
  // Address and location information
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
      maxlength: [100, 'City cannot exceed 100 characters'],
      index: true
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      maxlength: [100, 'State cannot exceed 100 characters'],
      index: true
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      maxlength: [100, 'Country cannot exceed 100 characters'],
      default: 'United States',
      index: true
    },
    zipCode: {
      type: String,
      required: [true, 'ZIP code is required'],
      trim: true,
      validate: {
        validator: function(value) {
          // US ZIP code validation (5 digits or 5+4 format)
          return /^\d{5}(-\d{4})?$/.test(value);
        },
        message: 'Invalid ZIP code format'
      }
    }
  },
  
  // Geographic coordinates for mapping
  coordinates: {
    latitude: {
      type: Number,
      required: [true, 'Latitude is required'],
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90'],
      index: '2dsphere'
    },
    longitude: {
      type: Number,
      required: [true, 'Longitude is required'],
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180'],
      index: '2dsphere'
    }
  },
  
  // Capacity management
  capacity: {
    totalCapacity: {
      type: Number,
      required: [true, 'Total capacity is required'],
      min: [1, 'Total capacity must be at least 1'],
      index: true
    },
    sections: [sectionSchema],
    standingCapacity: {
      type: Number,
      default: 0,
      min: [0, 'Standing capacity cannot be negative']
    },
    seatedCapacity: {
      type: Number,
      default: 0,
      min: [0, 'Seated capacity cannot be negative']
    }
  },
  
  // Contact information
  contact: {
    phone: {
      type: String,
      trim: true,
      validate: {
        validator: function(value) {
          if (!value) return true;
          // US phone number validation
          return /^\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/.test(value);
        },
        message: 'Invalid phone number format'
      }
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        },
        message: 'Invalid email format'
      }
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
    socialMedia: {
      facebook: {
        type: String,
        trim: true,
        validate: {
          validator: function(value) {
            if (!value) return true;
            return /^https?:\/\/(www\.)?facebook\.com\/.+/.test(value);
          },
          message: 'Invalid Facebook URL'
        }
      },
      instagram: {
        type: String,
        trim: true,
        validate: {
          validator: function(value) {
            if (!value) return true;
            return /^https?:\/\/(www\.)?instagram\.com\/.+/.test(value);
          },
          message: 'Invalid Instagram URL'
        }
      },
      twitter: {
        type: String,
        trim: true,
        validate: {
          validator: function(value) {
            if (!value) return true;
            return /^https?:\/\/(www\.)?twitter\.com\/.+/.test(value);
          },
          message: 'Invalid Twitter URL'
        }
      },
      youtube: {
        type: String,
        trim: true,
        validate: {
          validator: function(value) {
            if (!value) return true;
            return /^https?:\/\/(www\.)?youtube\.com\/.+/.test(value);
          },
          message: 'Invalid YouTube URL'
        }
      }
    }
  },
  
  // Venue amenities and features
  amenities: {
    parking: {
      hasParking: {
        type: Boolean,
        default: false
      },
      parkingSpaces: {
        type: Number,
        min: [0, 'Parking spaces cannot be negative'],
        default: 0
      },
      parkingFee: {
        type: Number,
        min: [0, 'Parking fee cannot be negative'],
        default: 0
      },
      valetService: {
        type: Boolean,
        default: false
      }
    },
    
    accessibility: {
      wheelchairAccessible: {
        type: Boolean,
        default: true
      },
      assistiveListening: {
        type: Boolean,
        default: false
      },
      accessibleParking: {
        type: Boolean,
        default: false
      },
      accessibleRestrooms: {
        type: Boolean,
        default: false
      },
      signLanguageServices: {
        type: Boolean,
        default: false
      }
    },
    
    foodOptions: [{
      type: {
        type: String,
        enum: ['restaurant', 'bar', 'concession', 'catering', 'food_truck', 'vending'],
        required: true
      },
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, 'Food option name cannot exceed 100 characters']
      },
      description: {
        type: String,
        trim: true,
        maxlength: [300, 'Food option description cannot exceed 300 characters']
      },
      priceRange: {
        type: String,
        enum: ['$', '$$', '$$$', '$$$$'],
        default: '$$'
      },
      isAlcoholServed: {
        type: Boolean,
        default: false
      }
    }],
    
    technical: {
      hasStage: {
        type: Boolean,
        default: false
      },
      soundSystem: {
        type: Boolean,
        default: false
      },
      lightingSystem: {
        type: Boolean,
        default: false
      },
      projectionSystem: {
        type: Boolean,
        default: false
      },
      wifi: {
        type: Boolean,
        default: true
      },
      airConditioning: {
        type: Boolean,
        default: true
      },
      heating: {
        type: Boolean,
        default: true
      }
    },
    
    other: [{
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [50, 'Amenity name cannot exceed 50 characters']
    }]
  },
  
  // Venue verification and compliance
  verification: {
    isVerified: {
      type: Boolean,
      default: false,
      index: true
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
        message: 'Verification date is required when venue is verified'
      }
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    documents: [documentSchema],
    nextInspectionDate: {
      type: Date
    },
    certifications: [{
      name: {
        type: String,
        required: true,
        trim: true
      },
      issuedBy: {
        type: String,
        required: true,
        trim: true
      },
      issuedDate: {
        type: Date,
        required: true
      },
      expiresDate: {
        type: Date
      },
      certificateUrl: {
        type: String,
        validate: {
          validator: function(value) {
            if (!value) return true;
            return /^https?:\/\/.+/.test(value);
          },
          message: 'Certificate URL must be a valid HTTP/HTTPS URL'
        }
      }
    }]
  },
  
  // Operating information
  operatingHours: [operatingHoursSchema],
  
  timezone: {
    type: String,
    required: [true, 'Timezone is required'],
    default: 'America/New_York'
  },
  
  // Management and ownership
  managerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Manager ID is required'],
    index: true
  },
  
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  
  staff: [{
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      required: true,
      enum: ['manager', 'coordinator', 'security', 'technician', 'janitor', 'other']
    },
    startDate: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  
  // Analytics and performance metrics
  analytics: {
    totalEvents: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAttendance: {
      type: Number,
      default: 0,
      min: 0
    },
    averageAttendance: {
      type: Number,
      default: 0,
      min: 0
    },
    totalRevenue: {
      type: Number,
      default: 0,
      min: 0
    },
    averageRevenue: {
      type: Number,
      default: 0,
      min: 0
    },
    utilizationRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    popularEventTypes: [{
      eventType: String,
      count: { type: Number, min: 0 }
    }],
    lastEventDate: {
      type: Date
    },
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      totalReviews: {
        type: Number,
        default: 0,
        min: 0
      }
    }
  },
  
  // Venue images and media
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
    imageType: {
      type: String,
      enum: ['exterior', 'interior', 'stage', 'seating', 'amenity', 'other'],
      default: 'other'
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  
  // Venue status and availability
  status: {
    type: String,
    required: [true, 'Venue status is required'],
    enum: {
      values: ['active', 'inactive', 'under_construction', 'closed_temporarily', 'closed_permanently'],
      message: 'Invalid venue status'
    },
    default: 'active',
    index: true
  },
  
  isAvailableForBooking: {
    type: Boolean,
    default: true,
    index: true
  },
  
  // Pricing information
  pricing: {
    baseDayRate: {
      type: Number,
      min: [0, 'Base day rate cannot be negative'],
      default: 0
    },
    baseHourlyRate: {
      type: Number,
      min: [0, 'Base hourly rate cannot be negative'],
      default: 0
    },
    cleaningFee: {
      type: Number,
      min: [0, 'Cleaning fee cannot be negative'],
      default: 0
    },
    securityDeposit: {
      type: Number,
      min: [0, 'Security deposit cannot be negative'],
      default: 0
    },
    cancellationPolicy: {
      type: String,
      enum: ['flexible', 'moderate', 'strict'],
      default: 'moderate'
    }
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
venueSchema.index({ 'coordinates.latitude': 1, 'coordinates.longitude': 1 });
venueSchema.index({ 'address.city': 1, 'address.state': 1 });
venueSchema.index({ venueType: 1, status: 1 });
venueSchema.index({ 'capacity.totalCapacity': 1 });
venueSchema.index({ 'verification.isVerified': 1 });
venueSchema.index({ isAvailableForBooking: 1, status: 1 });
venueSchema.index({ managerId: 1, status: 1 });
venueSchema.index({ 'analytics.rating.average': -1 });
venueSchema.index({ createdAt: -1 });

// Compound indexes
venueSchema.index({ 
  'address.city': 1, 
  'address.state': 1, 
  venueType: 1, 
  status: 1 
});

venueSchema.index({
  'coordinates.latitude': 1,
  'coordinates.longitude': 1,
  'capacity.totalCapacity': 1,
  status: 1
});

// GeoSpatial index for location-based queries
venueSchema.index({ 
  coordinates: '2dsphere' 
});

// Virtual fields
venueSchema.virtual('fullAddress').get(function() {
  return `${this.address.street}, ${this.address.city}, ${this.address.state} ${this.address.zipCode}, ${this.address.country}`;
});

venueSchema.virtual('totalSectionCapacity').get(function() {
  return this.capacity.sections.reduce((total, section) => {
    return total + (section.isActive ? section.capacity : 0);
  }, 0);
});

venueSchema.virtual('averageUtilization').get(function() {
  if (this.analytics.totalEvents === 0) return 0;
  return Math.round((this.analytics.averageAttendance / this.capacity.totalCapacity) * 100);
});

// Populate virtual references
venueSchema.virtual('manager', {
  ref: 'User',
  localField: 'managerId',
  foreignField: '_id',
  justOne: true
});

venueSchema.virtual('owner', {
  ref: 'User',
  localField: 'ownerId',
  foreignField: '_id',
  justOne: true
});

venueSchema.virtual('events', {
  ref: 'Event',
  localField: '_id',
  foreignField: 'venueId'
});

// Pre-save hooks
venueSchema.pre('save', async function(next) {
  try {
    // Validate venue before saving
    await this.validateVenue();
    
    // Update analytics
    this.updateAnalytics();
    
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
    
    // Validate capacity consistency
    this.validateCapacityConsistency();
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
venueSchema.methods.validateVenue = async function() {
  // Validate manager exists
  const User = mongoose.model('User');
  const manager = await User.findById(this.managerId);
  if (!manager) {
    throw new Error('Manager does not exist');
  }
  
  // Validate owner if specified
  if (this.ownerId) {
    const owner = await User.findById(this.ownerId);
    if (!owner) {
      throw new Error('Owner does not exist');
    }
  }
  
  return true;
};

venueSchema.methods.validateCapacityConsistency = function() {
  // Check if total capacity matches sum of sections
  const sectionsTotal = this.totalSectionCapacity;
  const standingAndSeated = this.capacity.standingCapacity + this.capacity.seatedCapacity;
  
  if (sectionsTotal > 0 && Math.abs(sectionsTotal - this.capacity.totalCapacity) > 10) {
    throw new Error('Total capacity should approximately match sum of section capacities');
  }
  
  if (standingAndSeated > 0 && Math.abs(standingAndSeated - this.capacity.totalCapacity) > 10) {
    throw new Error('Total capacity should approximately match standing + seated capacity');
  }
};

venueSchema.methods.calculateDistance = function(latitude, longitude) {
  const earthRadiusKm = 6371;
  
  const dLat = this.degreesToRadians(latitude - this.coordinates.latitude);
  const dLng = this.degreesToRadians(longitude - this.coordinates.longitude);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(this.degreesToRadians(this.coordinates.latitude)) * 
    Math.cos(this.degreesToRadians(latitude)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = earthRadiusKm * c;
  
  return {
    kilometers: Math.round(distanceKm * 100) / 100,
    miles: Math.round(distanceKm * 0.621371 * 100) / 100
  };
};

venueSchema.methods.degreesToRadians = function(degrees) {
  return degrees * (Math.PI / 180);
};

venueSchema.methods.checkAvailability = async function(startDate, endDate, excludeEventId = null) {
  const Event = mongoose.model('Event');
  
  const query = {
    venueId: this._id,
    status: { $in: ['active', 'confirmed', 'live'] },
    $or: [
      {
        startDate: { $lte: endDate },
        endDate: { $gte: startDate }
      }
    ]
  };
  
  if (excludeEventId) {
    query._id = { $ne: excludeEventId };
  }
  
  const conflictingEvents = await Event.find(query);
  
  return {
    isAvailable: conflictingEvents.length === 0,
    conflictingEvents: conflictingEvents.map(event => ({
      id: event._id,
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate
    }))
  };
};

venueSchema.methods.addEvent = async function(eventData) {
  // Check availability
  const availability = await this.checkAvailability(
    eventData.startDate, 
    eventData.endDate
  );
  
  if (!availability.isAvailable) {
    throw new Error('Venue is not available for the specified dates');
  }
  
  // Update analytics
  this.analytics.totalEvents += 1;
  this.analytics.lastEventDate = eventData.startDate;
  
  if (eventData.expectedAttendance) {
    const newTotalAttendance = this.analytics.totalAttendance + eventData.expectedAttendance;
    this.analytics.averageAttendance = Math.round(newTotalAttendance / this.analytics.totalEvents);
  }
  
  // Update popular event types
  if (eventData.eventType) {
    const existingType = this.analytics.popularEventTypes.find(
      type => type.eventType === eventData.eventType
    );
    
    if (existingType) {
      existingType.count += 1;
    } else {
      this.analytics.popularEventTypes.push({
        eventType: eventData.eventType,
        count: 1
      });
    }
  }
  
  await this.save();
};

venueSchema.methods.updateAnalytics = function() {
  // Calculate utilization rate
  if (this.analytics.totalEvents > 0) {
    this.analytics.utilizationRate = Math.round(
      (this.analytics.averageAttendance / this.capacity.totalCapacity) * 100
    );
  }
  
  // Calculate average revenue if total events > 0
  if (this.analytics.totalEvents > 0 && this.analytics.totalRevenue > 0) {
    this.analytics.averageRevenue = Math.round(
      this.analytics.totalRevenue / this.analytics.totalEvents
    );
  }
  
  // Sort popular event types by count
  this.analytics.popularEventTypes.sort((a, b) => b.count - a.count);
};

venueSchema.methods.addRating = async function(rating, reviewCount = 1) {
  const currentTotal = this.analytics.rating.average * this.analytics.rating.totalReviews;
  const newTotal = currentTotal + rating;
  const newReviewCount = this.analytics.rating.totalReviews + reviewCount;
  
  this.analytics.rating.average = Math.round((newTotal / newReviewCount) * 10) / 10;
  this.analytics.rating.totalReviews = newReviewCount;
  
  await this.save();
};

venueSchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.status = 'inactive';
  this.isAvailableForBooking = false;
  await this.save();
};

venueSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.status = 'active';
  this.isAvailableForBooking = true;
  await this.save();
};

// Static methods
venueSchema.statics.findNearby = function(latitude, longitude, maxDistanceKm = 50, filters = {}) {
  const query = {
    coordinates: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistanceKm * 1000 // Convert km to meters
      }
    },
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('managerId', 'username displayName avatar')
    .sort({ 'analytics.rating.average': -1 });
};

venueSchema.statics.findByCapacity = function(minCapacity, maxCapacity = null, filters = {}) {
  const capacityQuery = { $gte: minCapacity };
  if (maxCapacity) {
    capacityQuery.$lte = maxCapacity;
  }
  
  const query = {
    'capacity.totalCapacity': capacityQuery,
    status: 'active',
    isAvailableForBooking: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('managerId', 'username displayName avatar')
    .sort({ 'capacity.totalCapacity': 1 });
};

venueSchema.statics.findByManager = function(managerId, options = {}) {
  const query = {
    managerId,
    isDeleted: false,
    ...options
  };
  
  return this.find(query)
    .sort({ createdAt: -1 });
};

venueSchema.statics.findVerified = function(filters = {}) {
  const query = {
    'verification.isVerified': true,
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('managerId', 'username displayName avatar')
    .sort({ 'analytics.rating.average': -1, createdAt: -1 });
};

venueSchema.statics.findAvailable = function(startDate, endDate, filters = {}) {
  // This would typically require a more complex aggregation pipeline
  // to check against actual event bookings
  const query = {
    status: 'active',
    isAvailableForBooking: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('managerId', 'username displayName avatar')
    .sort({ 'analytics.rating.average': -1 });
};

venueSchema.statics.searchVenues = function(searchTerm, filters = {}) {
  const searchQuery = {
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { 'address.city': { $regex: searchTerm, $options: 'i' } },
      { 'address.state': { $regex: searchTerm, $options: 'i' } },
      { venueType: { $regex: searchTerm, $options: 'i' } },
      { 'amenities.other': { $regex: searchTerm, $options: 'i' } }
    ],
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .populate('managerId', 'username displayName avatar')
    .sort({ 'analytics.rating.average': -1, 'analytics.totalEvents': -1 });
};

venueSchema.statics.getVenueStats = async function(timeframe = '30d', filters = {}) {
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
        totalVenues: { $sum: 1 },
        verifiedVenues: {
          $sum: { $cond: [{ $eq: ['$verification.isVerified', true] }, 1, 0] }
        },
        activeVenues: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        totalCapacity: { $sum: '$capacity.totalCapacity' },
        averageCapacity: { $avg: '$capacity.totalCapacity' },
        totalEvents: { $sum: '$analytics.totalEvents' },
        totalAttendance: { $sum: '$analytics.totalAttendance' },
        averageRating: { $avg: '$analytics.rating.average' },
        venuesByType: {
          $push: {
            type: '$venueType',
            count: 1
          }
        },
        venuesByState: {
          $push: {
            state: '$address.state',
            count: 1
          }
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalVenues: 0,
    verifiedVenues: 0,
    activeVenues: 0,
    totalCapacity: 0,
    averageCapacity: 0,
    totalEvents: 0,
    totalAttendance: 0,
    averageRating: 0,
    venuesByType: [],
    venuesByState: []
  };
};

venueSchema.statics.findTopRated = function(limit = 10, filters = {}) {
  const query = {
    'analytics.rating.totalReviews': { $gte: 5 }, // At least 5 reviews
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('managerId', 'username displayName avatar')
    .sort({ 
      'analytics.rating.average': -1, 
      'analytics.rating.totalReviews': -1 
    })
    .limit(limit);
};

venueSchema.statics.findMostPopular = function(limit = 10, filters = {}) {
  const query = {
    'analytics.totalEvents': { $gte: 1 },
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .populate('managerId', 'username displayName avatar')
    .sort({ 
      'analytics.totalEvents': -1, 
      'analytics.totalAttendance': -1 
    })
    .limit(limit);
};

venueSchema.statics.findByAmenities = function(requiredAmenities = [], filters = {}) {
  const query = {
    status: 'active',
    isDeleted: false,
    ...filters
  };
  
  // Build amenity queries
  requiredAmenities.forEach(amenity => {
    switch (amenity) {
      case 'parking':
        query['amenities.parking.hasParking'] = true;
        break;
      case 'wheelchair_accessible':
        query['amenities.accessibility.wheelchairAccessible'] = true;
        break;
      case 'wifi':
        query['amenities.technical.wifi'] = true;
        break;
      case 'sound_system':
        query['amenities.technical.soundSystem'] = true;
        break;
      case 'stage':
        query['amenities.technical.hasStage'] = true;
        break;
      case 'air_conditioning':
        query['amenities.technical.airConditioning'] = true;
        break;
      default:
        query['amenities.other'] = { $in: [amenity.toLowerCase()] };
    }
  });
  
  return this.find(query)
    .populate('managerId', 'username displayName avatar')
    .sort({ 'analytics.rating.average': -1 });
};

venueSchema.statics.getCapacityDistribution = async function() {
  const pipeline = [
    { 
      $match: { 
        status: 'active', 
        isDeleted: false 
      } 
    },
    {
      $bucket: {
        groupBy: '$capacity.totalCapacity',
        boundaries: [0, 100, 500, 1000, 5000, 10000, 50000, Infinity],
        default: 'Unknown',
        output: {
          count: { $sum: 1 },
          venues: { $push: { name: '$name', capacity: '$capacity.totalCapacity' } }
        }
      }
    }
  ];
  
  return this.aggregate(pipeline);
};

venueSchema.statics.findExpiredDocuments = function() {
  const now = new Date();
  
  return this.find({
    'verification.documents.expiresAt': { $lt: now },
    'verification.documents.isVerified': true,
    status: 'active',
    isDeleted: false
  }).populate('managerId', 'username displayName email');
};

// Query helpers
venueSchema.query.active = function() {
  return this.where({ status: 'active', isDeleted: false });
};

venueSchema.query.verified = function() {
  return this.where({ 'verification.isVerified': true });
};

venueSchema.query.available = function() {
  return this.where({ isAvailableForBooking: true });
};

venueSchema.query.byVenueType = function(type) {
  return this.where({ venueType: type });
};

venueSchema.query.byCity = function(city) {
  return this.where({ 'address.city': new RegExp(city, 'i') });
};

venueSchema.query.byState = function(state) {
  return this.where({ 'address.state': new RegExp(state, 'i') });
};

venueSchema.query.withCapacity = function(min, max) {
  const query = { 'capacity.totalCapacity': { $gte: min } };
  if (max) query['capacity.totalCapacity'].$lte = max;
  return this.where(query);
};

venueSchema.query.topRated = function(minRating = 4.0) {
  return this.where({ 
    'analytics.rating.average': { $gte: minRating },
    'analytics.rating.totalReviews': { $gte: 5 }
  });
};

module.exports = mongoose.model('Venue', venueSchema);
