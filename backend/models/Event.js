// backend/models/Event.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define a schema for ticket types
const TicketTypeSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  remaining: {
    type: Number,
    min: 0
  },
  maxPerOrder: {
    type: Number,
    default: 10
  },
  nftTemplate: {
    imageUrl: String,
    attributes: Schema.Types.Mixed
  },
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  }
});

// Define a schema for location with GeoJSON
const LocationSchema = new Schema({
  type: {
    type: String,
    enum: ['Point'],
    default: 'Point'
  },
  coordinates: {
    type: [Number], // [longitude, latitude]
    required: true,
    index: '2dsphere'
  },
  venue: {
    name: {
      type: String,
      required: true
    },
    address: {
      street: String,
      city: {
        type: String,
        required: true
      },
      state: {
        type: String,
        required: true
      },
      zipCode: String,
      country: {
        type: String,
        required: true
      }
    },
    website: String,
    capacity: Number,
    venueId: String,
    description: String
  }
});

// Main Event schema
const EventSchema = new Schema({
  eventId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  location: {
    type: LocationSchema,
    required: true
  },
  organizer: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  ticketTypes: [TicketTypeSchema],
  bannerImage: String,
  status: {
    type: String,
    enum: ['draft', 'published', 'completed', 'cancelled'],
    default: 'draft'
  },
  category: {
    type: String,
    index: true
  },
  tags: {
    type: [String],
    index: true
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'unlisted'],
    default: 'public'
  },
  featuredEvent: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Additional metadata for specific event types
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  }
});

// Create indexes
EventSchema.index({ title: 'text', description: 'text' });
EventSchema.index({ startDate: 1 });
EventSchema.index({ organizer: 1 });
EventSchema.index({ status: 1 });
EventSchema.index({ 'location.coordinates': '2dsphere' });

// Pre-save middleware to update timestamps
EventSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Set remaining tickets to total quantity if not specified
  if (this.isNew) {
    this.ticketTypes.forEach(ticketType => {
      if (ticketType.remaining === undefined) {
        ticketType.remaining = ticketType.quantity;
      }
    });
  }
  
  next();
});

// Virtual for checking if event is upcoming
EventSchema.virtual('isUpcoming').get(function() {
  return this.startDate > new Date();
});

// Virtual for checking if event is ongoing
EventSchema.virtual('isOngoing').get(function() {
  const now = new Date();
  return this.startDate <= now && this.endDate >= now;
});

// Method to check if event has available tickets
EventSchema.methods.hasAvailableTickets = function() {
  return this.ticketTypes.some(ticket => ticket.remaining > 0);
};

// Model instance method to update ticket count
EventSchema.methods.updateTicketCount = async function(ticketTypeId, quantity) {
  const ticketType = this.ticketTypes.id(ticketTypeId);
  
  if (!ticketType) {
    throw new Error('Ticket type not found');
  }
  
  if (ticketType.remaining < quantity) {
    throw new Error('Not enough tickets available');
  }
  
  ticketType.remaining -= quantity;
  return this.save();
};

const Event = mongoose.model('Event', EventSchema);

module.exports = Event;
