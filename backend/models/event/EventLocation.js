const mongoose = require('mongoose');
const { Schema } = mongoose;

// Demographics schema
const demographicsSchema = new Schema({
  population: {
    total: {
      type: Number,
      min: 0,
      default: 0
    },
    density: {
      type: Number, // people per square mile/km
      min: 0,
      default: 0
    },
    metropolitan: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  income: {
    median: {
      type: Number,
      min: 0,
      default: 0
    },
    average: {
      type: Number,
      min: 0,
      default: 0
    },
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'BRL', 'MXN']
    }
  },
  ageGroups: [{
    range: {
      type: String,
      enum: ['0-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
      required: true
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100,
      required: true
    }
  }],
  education: {
    highSchool: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    bachelors: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    graduate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  },
  employment: {
    unemploymentRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    majorIndustries: [{
      type: String,
      trim: true,
      lowercase: true
    }]
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false,
  timestamps: false
});

// Event analytics schema
const eventAnalyticsSchema = new Schema({
  totalEvents: {
    allTime: {
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
  popularGenres: [{
    genre: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    eventCount: {
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
    popularityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  }],
  seasonality: [{
    season: {
      type: String,
      enum: ['spring', 'summer', 'fall', 'winter'],
      required: true
    },
    eventCount: {
      type: Number,
      default: 0,
      min: 0
    },
    averageAttendance: {
      type: Number,
      default: 0,
      min: 0
    },
    topGenres: [{
      type: String,
      trim: true,
      lowercase: true
    }]
  }],
  monthlyTrends: [{
    month: {
      type: Number,
      min: 1,
      max: 12,
      required: true
    },
    eventCount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAttendance: {
      type: Number,
      default: 0,
      min: 0
    },
    totalRevenue: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  venueTypes: [{
    type: {
      type: String,
      enum: ['concert_hall', 'stadium', 'arena', 'theater', 'club', 'outdoor', 'conference_center', 'hotel', 'restaurant', 'bar', 'gallery', 'other'],
      required: true
    },
    count: {
      type: Number,
      default: 0,
      min: 0
    },
    totalCapacity: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  averageEventSize: {
    type: Number,
    default: 0,
    min: 0
  },
  totalRevenue: {
    type: Number,
    default: 0,
    min: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false,
  timestamps: false
});

// Transportation schema
const transportationSchema = new Schema({
  nearestAirport: {
    code: {
      type: String,
      uppercase: true,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return /^[A-Z]{3,4}$/.test(value);
        },
        message: 'Airport code must be 3-4 uppercase letters'
      }
    },
    name: {
      type: String,
      trim: true
    },
    distance: {
      type: Number, // in miles/km
      min: 0
    },
    driveTime: {
      type: Number, // in minutes
      min: 0
    }
  },
  publicTransport: [{
    type: {
      type: String,
      enum: ['subway', 'bus', 'train', 'tram', 'ferry', 'light_rail'],
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    coverage: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'limited', 'none'],
      default: 'fair'
    },
    frequency: {
      type: String,
      enum: ['very_frequent', 'frequent', 'moderate', 'infrequent', 'limited'],
      default: 'moderate'
    }
  }],
  parking: {
    availability: {
      type: String,
      enum: ['abundant', 'adequate', 'limited', 'scarce', 'very_scarce'],
      default: 'adequate'
    },
    averageCost: {
      type: Number,
      min: 0,
      default: 0
    },
    costUnit: {
      type: String,
      enum: ['hour', 'day', 'event'],
      default: 'hour'
    },
    parkingGarages: {
      type: Number,
      min: 0,
      default: 0
    },
    streetParking: {
      type: Boolean,
      default: true
    }
  },
  walkability: {
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    description: {
      type: String,
      enum: ['car_dependent', 'somewhat_walkable', 'very_walkable', 'walkers_paradise'],
      default: 'somewhat_walkable'
    }
  },
  bikeability: {
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    bikeShares: {
      type: Boolean,
      default: false
    },
    bikeLanes: {
      type: String,
      enum: ['none', 'limited', 'good', 'excellent'],
      default: 'limited'
    }
  }
}, {
  _id: false,
  timestamps: false
});

// Weather schema
const weatherSchema = new Schema({
  averageTemp: {
    annual: {
      type: Number, // in Fahrenheit or Celsius
      default: 0
    },
    summer: {
      type: Number,
      default: 0
    },
    winter: {
      type: Number,
      default: 0
    },
    unit: {
      type: String,
      enum: ['fahrenheit', 'celsius'],
      default: 'fahrenheit'
    }
  },
  precipitation: {
    annualRainfall: {
      type: Number, // in inches or mm
      default: 0,
      min: 0
    },
    annualSnowfall: {
      type: Number, // in inches or cm
      default: 0,
      min: 0
    },
    unit: {
      type: String,
      enum: ['inches', 'millimeters', 'centimeters'],
      default: 'inches'
    }
  },
  seasonalPatterns: [{
    season: {
      type: String,
      enum: ['spring', 'summer', 'fall', 'winter'],
      required: true
    },
    averageTemp: {
      type: Number,
      required: true
    },
    precipitation: {
      type: Number,
      required: true,
      min: 0
    },
    humidity: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    conditions: [{
      type: String,
      enum: ['sunny', 'cloudy', 'rainy', 'snowy', 'windy', 'humid', 'dry']
    }]
  }],
  extremes: {
    highestTemp: {
      type: Number
    },
    lowestTemp: {
      type: Number
    },
    recordRainfall: {
      type: Number,
      min: 0
    },
    recordSnowfall: {
      type: Number,
      min: 0
    }
  },
  climateZone: {
    type: String,
    enum: ['tropical', 'dry', 'temperate', 'continental', 'polar'],
    default: 'temperate'
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false,
  timestamps: false
});

// Main location schema
const locationSchema = new Schema({
  // Address information
  address: {
    street: {
      type: String,
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
      required: [true, 'State/Province is required'],
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
    postalCode: {
      type: String,
      trim: true,
      validate: {
        validator: function(value) {
          if (!value) return true;
          // Support various postal code formats
          return /^[A-Z0-9\s-]{3,10}$/i.test(value);
        },
        message: 'Invalid postal code format'
      },
      index: true
    },
    region: {
      type: String,
      trim: true,
      maxlength: [100, 'Region cannot exceed 100 characters']
    }
  },
  
  // Geographic coordinates
  coordinates: {
    latitude: {
      type: Number,
      required: [true, 'Latitude is required'],
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90']
    },
    longitude: {
      type: Number,
      required: [true, 'Longitude is required'],
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180']
    },
    geohash: {
      type: String,
      index: true
    },
    accuracy: {
      type: Number, // in meters
      min: 0,
      default: 10
    },
    source: {
      type: String,
      enum: ['gps', 'geocoded', 'manual', 'approximate'],
      default: 'geocoded'
    }
  },
  
  // Timezone information
  timezone: {
    timezone: {
      type: String,
      required: [true, 'Timezone is required'],
      validate: {
        validator: function(value) {
          // Basic timezone validation (IANA format)
          return /^[A-Z][a-z]+\/[A-Z][a-z_]+$/.test(value);
        },
        message: 'Timezone must be in IANA format (e.g., America/New_York)'
      },
      default: 'America/New_York'
    },
    utcOffset: {
      type: Number, // in hours
      required: [true, 'UTC offset is required'],
      min: [-12, 'UTC offset must be between -12 and +14'],
      max: [14, 'UTC offset must be between -12 and +14']
    },
    dstObserved: {
      type: Boolean,
      default: true
    },
    dstOffset: {
      type: Number, // additional hours during DST
      default: 1,
      min: 0,
      max: 2
    }
  },
  
  // Location type and classification
  locationType: {
    type: String,
    required: [true, 'Location type is required'],
    enum: ['city', 'suburb', 'rural', 'metropolitan', 'district', 'neighborhood', 'landmark'],
    default: 'city',
    index: true
  },
  
  locationSize: {
    type: String,
    enum: ['small', 'medium', 'large', 'major'],
    default: 'medium',
    index: true
  },
  
  // Area measurements
  area: {
    landArea: {
      type: Number, // in square miles or square kilometers
      min: 0
    },
    waterArea: {
      type: Number,
      min: 0
    },
    unit: {
      type: String,
      enum: ['square_miles', 'square_kilometers'],
      default: 'square_miles'
    }
  },
  
  // Demographics data
  demographics: demographicsSchema,
  
  // Event analytics
  eventData: eventAnalyticsSchema,
  
  // Transportation information
  transportation: transportationSchema,
  
  // Weather data
  weather: weatherSchema,
  
  // Economy and market data
  economy: {
    marketSize: {
      type: String,
      enum: ['micro', 'small', 'medium', 'large', 'major'],
      default: 'medium'
    },
    costOfLiving: {
      index: {
        type: Number, // compared to national average (100 = average)
        min: 0,
        default: 100
      },
      housing: {
        type: Number,
        min: 0,
        default: 100
      },
      transportation: {
        type: Number,
        min: 0,
        default: 100
      },
      entertainment: {
        type: Number,
        min: 0,
        default: 100
      }
    },
    businessClimate: {
      type: String,
      enum: ['poor', 'fair', 'good', 'excellent'],
      default: 'fair'
    },
    tourismLevel: {
      type: String,
      enum: ['none', 'low', 'moderate', 'high', 'major_destination'],
      default: 'moderate'
    }
  },
  
  // Location features and points of interest
  features: {
    universities: {
      type: Number,
      min: 0,
      default: 0
    },
    hospitals: {
      type: Number,
      min: 0,
      default: 0
    },
    shoppingCenters: {
      type: Number,
      min: 0,
      default: 0
    },
    restaurants: {
      type: Number,
      min: 0,
      default: 0
    },
    hotels: {
      type: Number,
      min: 0,
      default: 0
    },
    landmarks: [{
      name: {
        type: String,
        required: true,
        trim: true
      },
      type: {
        type: String,
        enum: ['historical', 'cultural', 'natural', 'entertainment', 'religious', 'commercial'],
        required: true
      },
      significance: {
        type: String,
        enum: ['local', 'regional', 'national', 'international'],
        default: 'local'
      }
    }]
  },
  
  // Data quality and verification
  dataQuality: {
    completeness: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    accuracy: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    lastVerified: {
      type: Date
    },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    dataSources: [{
      source: {
        type: String,
        required: true,
        trim: true
      },
      reliability: {
        type: String,
        enum: ['low', 'medium', 'high', 'verified'],
        default: 'medium'
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    }]
  },
  
  // Location status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  isVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Admin fields
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },
  
  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
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

// Geospatial indexes
locationSchema.index({ 
  'coordinates.latitude': 1, 
  'coordinates.longitude': 1 
});

locationSchema.index({ 
  'coordinates': '2dsphere' 
});

// Text search index
locationSchema.index({ 
  'address.city': 'text',
  'address.state': 'text',
  'address.country': 'text',
  'address.region': 'text'
});

// Compound indexes
locationSchema.index({ 
  'address.country': 1, 
  'address.state': 1, 
  'address.city': 1 
});

locationSchema.index({
  locationType: 1,
  locationSize: 1,
  isActive: 1
});

locationSchema.index({
  'coordinates.geohash': 1,
  isActive: 1
});

locationSchema.index({
  'demographics.population.total': -1,
  isActive: 1
});

locationSchema.index({
  'eventData.totalEvents.allTime': -1,
  isActive: 1
});

// Virtual fields
locationSchema.virtual('fullAddress').get(function() {
  const parts = [];
  if (this.address.street) parts.push(this.address.street);
  parts.push(this.address.city);
  parts.push(this.address.state);
  if (this.address.postalCode) parts.push(this.address.postalCode);
  parts.push(this.address.country);
  return parts.join(', ');
});

locationSchema.virtual('displayName').get(function() {
  if (this.address.region && this.address.region !== this.address.city) {
    return `${this.address.city}, ${this.address.region}, ${this.address.state}`;
  }
  return `${this.address.city}, ${this.address.state}`;
});

locationSchema.virtual('eventDensity').get(function() {
  if (this.area.landArea > 0 && this.eventData.totalEvents.allTime > 0) {
    return Math.round((this.eventData.totalEvents.allTime / this.area.landArea) * 100) / 100;
  }
  return 0;
});

locationSchema.virtual('populationDensity').get(function() {
  if (this.area.landArea > 0 && this.demographics.population.total > 0) {
    return Math.round((this.demographics.population.total / this.area.landArea) * 100) / 100;
  }
  return this.demographics.population.density || 0;
});

// Pre-save hooks
locationSchema.pre('save', async function(next) {
  try {
    // Generate geohash if coordinates are provided
    if (this.coordinates.latitude && this.coordinates.longitude) {
      this.coordinates.geohash = this.generateGeohash(
        this.coordinates.latitude, 
        this.coordinates.longitude
      );
    }
    
    // Calculate data quality metrics
    this.calculateDataQuality();
    
    // Update location classification
    this.updateLocationClassification();
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
locationSchema.methods.generateGeohash = function(latitude, longitude, precision = 8) {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  
  let lat = [latitude, latitude];
  let lon = [longitude, longitude];
  let geohash = '';
  let even = true;
  let ch = 0;
  let bit = 0;
  
  lat[0] = -90.0;
  lat[1] = 90.0;
  lon[0] = -180.0;
  lon[1] = 180.0;
  
  while (geohash.length < precision) {
    let mid;
    
    if (even) {
      mid = (lon[0] + lon[1]) / 2;
      if (longitude >= mid) {
        ch |= (1 << (4 - bit));
        lon[0] = mid;
      } else {
        lon[1] = mid;
      }
    } else {
      mid = (lat[0] + lat[1]) / 2;
      if (latitude >= mid) {
        ch |= (1 << (4 - bit));
        lat[0] = mid;
      } else {
        lat[1] = mid;
      }
    }
    
    even = !even;
    
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  
  return geohash;
};

locationSchema.methods.calculateDistance = function(otherLocation) {
  const R = 3959; // Earth's radius in miles
  
  const lat1 = this.coordinates.latitude;
  const lon1 = this.coordinates.longitude;
  const lat2 = otherLocation.coordinates ? 
    otherLocation.coordinates.latitude : otherLocation.latitude;
  const lon2 = otherLocation.coordinates ? 
    otherLocation.coordinates.longitude : otherLocation.longitude;
  
  const dLat = this.toRadians(lat2 - lat1);
  const dLon = this.toRadians(lon2 - lon1);
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distanceMiles = R * c;
  
  return {
    miles: Math.round(distanceMiles * 100) / 100,
    kilometers: Math.round(distanceMiles * 1.60934 * 100) / 100
  };
};

locationSchema.methods.toRadians = function(degrees) {
  return degrees * (Math.PI / 180);
};

locationSchema.methods.findNearbyEvents = async function(radiusMiles = 25, filters = {}) {
  const Event = mongoose.model('Event');
  
  const query = {
    'venue.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [this.coordinates.longitude, this.coordinates.latitude]
        },
        $maxDistance: radiusMiles * 1609.34 // Convert miles to meters
      }
    },
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return Event.find(query)
    .populate('venueId', 'name address capacity')
    .populate('organizerId', 'username displayName')
    .sort({ startDate: 1 })
    .limit(50);
};

locationSchema.methods.calculateDataQuality = function() {
  let completenessScore = 0;
  let totalFields = 0;
  
  // Check essential fields
  const essentialFields = [
    'address.city',
    'address.state', 
    'address.country',
    'coordinates.latitude',
    'coordinates.longitude',
    'timezone.timezone'
  ];
  
  essentialFields.forEach(field => {
    totalFields++;
    if (this.get(field)) completenessScore++;
  });
  
  // Check optional but valuable fields
  const optionalFields = [
    'address.postalCode',
    'demographics.population.total',
    'transportation.nearestAirport.code',
    'weather.averageTemp.annual'
  ];
  
  optionalFields.forEach(field => {
    totalFields++;
    if (this.get(field)) completenessScore++;
  });
  
  this.dataQuality.completeness = Math.round((completenessScore / totalFields) * 100);
  
  // Simple accuracy score based on verification
  this.dataQuality.accuracy = this.isVerified ? 95 : 70;
};

locationSchema.methods.updateLocationClassification = function() {
  const population = this.demographics.population.total;
  
  if (population > 1000000) {
    this.locationSize = 'major';
  } else if (population > 250000) {
    this.locationSize = 'large';
  } else if (population > 50000) {
    this.locationSize = 'medium';
  } else {
    this.locationSize = 'small';
  }
  
  // Update location type based on population density
  const density = this.populationDensity;
  if (density > 10000) {
    this.locationType = 'metropolitan';
  } else if (density > 3000) {
    this.locationType = 'city';
  } else if (density > 1000) {
    this.locationType = 'suburb';
  } else {
    this.locationType = 'rural';
  }
};

locationSchema.methods.updateEventAnalytics = async function() {
  const Event = mongoose.model('Event');
  const Venue = mongoose.model('Venue');
  
  // Find all venues in this location (within 25 miles)
  const nearbyVenues = await Venue.find({
    'coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [this.coordinates.longitude, this.coordinates.latitude]
        },
        $maxDistance: 40234 // 25 miles in meters
      }
    },
    isActive: true,
    isDeleted: false
  });
  
  const venueIds = nearbyVenues.map(venue => venue._id);
  
  // Aggregate event data
  const eventStats = await Event.aggregate([
    {
      $match: {
        venueId: { $in: venueIds },
        isDeleted: false
      }
    },
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        totalRevenue: { $sum: '$analytics.revenue' },
        totalAttendance: { $sum: '$analytics.totalAttendees' },
        avgEventSize: { $avg: '$analytics.totalAttendees' },
        genreStats: { $push: '$category' }
      }
    }
  ]);
  
  if (eventStats.length > 0) {
    const stats = eventStats[0];
    this.eventData.totalEvents.allTime = stats.totalEvents;
    this.eventData.totalRevenue = stats.totalRevenue;
    this.eventData.averageEventSize = Math.round(stats.avgEventSize || 0);
  }
  
  await this.save();
};

locationSchema.methods.addLandmark = function(landmarkData) {
  this.features.landmarks.push({
    name: landmarkData.name,
    type: landmarkData.type,
    significance: landmarkData.significance || 'local'
  });
  return this.save();
};

locationSchema.methods.updateWeatherData = function(weatherData) {
  this.weather = {
    ...this.weather.toObject(),
    ...weatherData,
    lastUpdated: new Date()
  };
  return this.save();
};

locationSchema.methods.updateDemographics = function(demographicData) {
  this.demographics = {
    ...this.demographics.toObject(),
    ...demographicData,
    lastUpdated: new Date()
  };
  this.updateLocationClassification();
  return this.save();
};

locationSchema.methods.softDelete = async function(deletedBy = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.isActive = false;
  await this.save();
};

locationSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.isActive = true;
  await this.save();
};

// Static methods
locationSchema.statics.findNearby = function(latitude, longitude, radiusMiles = 25, filters = {}) {
  const query = {
    'coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: radiusMiles * 1609.34 // Convert miles to meters
      }
    },
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ 'demographics.population.total': -1 });
};

locationSchema.statics.findByRegion = function(country, state = null, filters = {}) {
  const query = {
    'address.country': new RegExp(country, 'i'),
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  if (state) {
    query['address.state'] = new RegExp(state, 'i');
  }
  
  return this.find(query)
    .sort({ 'demographics.population.total': -1 });
};

locationSchema.statics.findByPopulation = function(minPopulation, maxPopulation = null, filters = {}) {
  const populationQuery = { $gte: minPopulation };
  if (maxPopulation) {
    populationQuery.$lte = maxPopulation;
  }
  
  const query = {
    'demographics.population.total': populationQuery,
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ 'demographics.population.total': -1 });
};

locationSchema.statics.findTopEventLocations = function(limit = 20, filters = {}) {
  const query = {
    'eventData.totalEvents.allTime': { $gt: 0 },
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ 
      'eventData.totalEvents.allTime': -1, 
      'demographics.population.total': -1 
    })
    .limit(limit);
};

locationSchema.statics.searchLocations = function(searchTerm, filters = {}) {
  const searchQuery = {
    $or: [
      { 'address.city': { $regex: searchTerm, $options: 'i' } },
      { 'address.state': { $regex: searchTerm, $options: 'i' } },
      { 'address.country': { $regex: searchTerm, $options: 'i' } },
      { 'address.region': { $regex: searchTerm, $options: 'i' } },
      { 'features.landmarks.name': { $regex: searchTerm, $options: 'i' } }
    ],
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(searchQuery)
    .sort({ 'demographics.population.total': -1, 'eventData.totalEvents.allTime': -1 });
};

locationSchema.statics.findByClimate = function(climateZone, filters = {}) {
  const query = {
    'weather.climateZone': climateZone,
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ 'demographics.population.total': -1 });
};

locationSchema.statics.findByTimezone = function(timezone, filters = {}) {
  const query = {
    'timezone.timezone': timezone,
    isActive: true,
    isDeleted: false,
    ...filters
  };
  
  return this.find(query)
    .sort({ 'demographics.population.total': -1 });
};

locationSchema.statics.getLocationStats = async function(timeframe = '30d', filters = {}) {
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
        totalLocations: { $sum: 1 },
        activeLocations: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
        },
        verifiedLocations: {
          $sum: { $cond: [{ $eq: ['$isVerified', true] }, 1, 0] }
        },
        totalPopulation: { $sum: '$demographics.population.total' },
        totalEvents: { $sum: '$eventData.totalEvents.allTime' },
        averagePopulation: { $avg: '$demographics.population.total' },
        locationsByType: {
          $push: {
            type: '$locationType',
            count: 1
          }
        },
        locationsBySize: {
          $push: {
            size: '$locationSize',
            count: 1
          }
        },
        climateDistribution: {
          $push: {
            climate: '$weather.climateZone',
            count: 1
          }
        }
      }
    }
  ];
  
  const result = await this.aggregate(pipeline);
  return result[0] || {
    totalLocations: 0,
    activeLocations: 0,
    verifiedLocations: 0,
    totalPopulation: 0,
    totalEvents: 0,
    averagePopulation: 0,
    locationsByType: [],
    locationsBySize: [],
    climateDistribution: []
  };
};

locationSchema.statics.findEventHotspots = async function(minEvents = 10, radiusMiles = 50) {
  const pipeline = [
    {
      $match: {
        'eventData.totalEvents.allTime': { $gte: minEvents },
        isActive: true,
        isDeleted: false
      }
    },
    {
      $group: {
        _id: {
          $substr: ['$coordinates.geohash', 0, 4] // Group by geohash prefix
        },
        locations: { $push: '$ROOT' },
        totalEvents: { $sum: '$eventData.totalEvents.allTime' },
        totalPopulation: { $sum: '$demographics.population.total' },
        avgLatitude: { $avg: '$coordinates.latitude' },
        avgLongitude: { $avg: '$coordinates.longitude' },
        locationCount: { $sum: 1 }
      }
    },
    {
      $match: {
        locationCount: { $gte: 2 }, // At least 2 locations in cluster
        totalEvents: { $gte: minEvents * 2 }
      }
    },
    {
      $sort: { totalEvents: -1 }
    },
    {
      $limit: 20
    }
  ];
  
  return this.aggregate(pipeline);
};

locationSchema.statics.findLocationsByEventGenre = function(genre, limit = 20) {
  const query = {
    'eventData.popularGenres.genre': genre.toLowerCase(),
    isActive: true,
    isDeleted: false
  };
  
  return this.find(query)
    .sort({ 'eventData.popularGenres.$.eventCount': -1 })
    .limit(limit);
};

locationSchema.statics.findLocationsByWeather = function(weatherFilters, locationFilters = {}) {
  const query = {
    isActive: true,
    isDeleted: false,
    ...locationFilters
  };
  
  // Add weather-specific filters
  if (weatherFilters.minTemp) {
    query['weather.averageTemp.annual'] = { $gte: weatherFilters.minTemp };
  }
  if (weatherFilters.maxTemp) {
    query['weather.averageTemp.annual'] = { 
      ...query['weather.averageTemp.annual'],
      $lte: weatherFilters.maxTemp 
    };
  }
  if (weatherFilters.maxRainfall) {
    query['weather.precipitation.annualRainfall'] = { $lte: weatherFilters.maxRainfall };
  }
  if (weatherFilters.climateZone) {
    query['weather.climateZone'] = weatherFilters.climateZone;
  }
  
  return this.find(query)
    .sort({ 'demographics.population.total': -1 });
};

locationSchema.statics.findBestEventLocations = function(criteria = {}, limit = 20) {
  const query = {
    isActive: true,
    isDeleted: false
  };
  
  // Build query based on criteria
  if (criteria.minPopulation) {
    query['demographics.population.total'] = { $gte: criteria.minPopulation };
  }
  if (criteria.minIncome) {
    query['demographics.income.median'] = { $gte: criteria.minIncome };
  }
  if (criteria.transportationScore) {
    query['transportation.walkability.score'] = { $gte: criteria.transportationScore };
  }
  if (criteria.climateZone) {
    query['weather.climateZone'] = criteria.climateZone;
  }
  if (criteria.maxCostOfLiving) {
    query['economy.costOfLiving.index'] = { $lte: criteria.maxCostOfLiving };
  }
  
  // Sort by multiple factors
  const sortCriteria = {};
  if (criteria.prioritize === 'population') {
    sortCriteria['demographics.population.total'] = -1;
  } else if (criteria.prioritize === 'events') {
    sortCriteria['eventData.totalEvents.allTime'] = -1;
  } else if (criteria.prioritize === 'income') {
    sortCriteria['demographics.income.median'] = -1;
  } else {
    // Default: balanced scoring
    sortCriteria['eventData.totalEvents.allTime'] = -1;
    sortCriteria['demographics.population.total'] = -1;
  }
  
  return this.find(query)
    .sort(sortCriteria)
    .limit(limit);
};

locationSchema.statics.calculateOptimalEventTiming = async function(locationId, eventType = null) {
  const location = await this.findById(locationId);
  if (!location) {
    throw new Error('Location not found');
  }
  
  const recommendations = {
    bestMonths: [],
    worstMonths: [],
    seasonalInsights: {},
    weatherConsiderations: []
  };
  
  // Analyze seasonal event data
  location.eventData.seasonality.forEach(season => {
    recommendations.seasonalInsights[season.season] = {
      eventCount: season.eventCount,
      averageAttendance: season.averageAttendance,
      topGenres: season.topGenres
    };
  });
  
  // Analyze monthly trends
  const monthlyData = location.eventData.monthlyTrends.sort((a, b) => b.eventCount - a.eventCount);
  recommendations.bestMonths = monthlyData.slice(0, 3).map(m => ({
    month: m.month,
    eventCount: m.eventCount,
    totalRevenue: m.totalRevenue
  }));
  
  recommendations.worstMonths = monthlyData.slice(-3).map(m => ({
    month: m.month,
    eventCount: m.eventCount,
    totalRevenue: m.totalRevenue
  }));
  
  // Weather considerations
  location.weather.seasonalPatterns.forEach(pattern => {
    if (pattern.conditions.includes('rainy') && pattern.precipitation > 5) {
      recommendations.weatherConsiderations.push({
        season: pattern.season,
        concern: 'high_rainfall',
        impact: 'Consider indoor venues or weather contingencies'
      });
    }
    if (pattern.averageTemp < 32) {
      recommendations.weatherConsiderations.push({
        season: pattern.season,
        concern: 'cold_weather',
        impact: 'Outdoor events may have reduced attendance'
      });
    }
    if (pattern.averageTemp > 90) {
      recommendations.weatherConsiderations.push({
        season: pattern.season,
        concern: 'hot_weather',
        impact: 'Ensure adequate cooling and hydration'
      });
    }
  });
  
  return recommendations;
};

// Query helpers
locationSchema.query.active = function() {
  return this.where({ isActive: true, isDeleted: false });
};

locationSchema.query.verified = function() {
  return this.where({ isVerified: true });
};

locationSchema.query.byCountry = function(country) {
  return this.where({ 'address.country': new RegExp(country, 'i') });
};

locationSchema.query.byState = function(state) {
  return this.where({ 'address.state': new RegExp(state, 'i') });
};

locationSchema.query.byLocationType = function(type) {
  return this.where({ locationType: type });
};

locationSchema.query.byLocationSize = function(size) {
  return this.where({ locationSize: size });
};

locationSchema.query.withMinPopulation = function(population) {
  return this.where({ 'demographics.population.total': { $gte: population } });
};

locationSchema.query.withEvents = function() {
  return this.where({ 'eventData.totalEvents.allTime': { $gt: 0 } });
};

locationSchema.query.inTimezone = function(timezone) {
  return this.where({ 'timezone.timezone': timezone });
};

locationSchema.query.withClimate = function(climateZone) {
  return this.where({ 'weather.climateZone': climateZone });
};

locationSchema.query.nearAirport = function() {
  return this.where({ 'transportation.nearestAirport.code': { $exists: true, $ne: null } });
};

locationSchema.query.highQualityData = function(minCompleteness = 70) {
  return this.where({ 'dataQuality.completeness': { $gte: minCompleteness } });
};

module.exports = mongoose.model('Location', locationSchema);
