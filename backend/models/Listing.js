// Listing.js - Defines marketplace listings for ticket resales

const mongoose = require('mongoose');

// Schema definition for marketplace listings
const ListingSchema = new mongoose.Schema({
  // Listing identifier
  listingId: { type: String, required: true, unique: true },
  
  // Who is selling the ticket
  seller: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  
  // Which ticket is being sold
  ticket: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Ticket',
    required: true
  },
  
  // Quick reference to the event (makes searching easier)
  event: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Event',
    required: true
  },
  
  // Pricing information
  price: { type: Number, required: true },
  
  // Listing status
  status: { 
    type: String, 
    enum: ['active', 'sold', 'cancelled'], 
    default: 'active' 
  },
  
  // When the listing was created
  createdAt: { type: Date, default: Date.now },
  
  // Optional expiration date
  expiresAt: Date
});

// Create the model from the schema
const Listing = mongoose.model('Listing', ListingSchema);

// Export the model
module.exports = Listing;
