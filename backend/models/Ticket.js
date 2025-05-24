// Ticket.js - Defines what information we store about individual tickets

const mongoose = require('mongoose');

// Schema definition for tickets
const TicketSchema = new mongoose.Schema({
  // Ticket identifiers
  ticketId: { type: String, required: true, unique: true },
  serialNumber: Number,
  
  // Which event this ticket is for
  event: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Event',
    required: true
  },
  
  // Which ticket type from the event
  ticketType: String,
  
  // Who owns this ticket
  owner: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  
  // Purchase information
  purchasePrice: Number,
  purchaseDate: { type: Date, default: Date.now },
  
  // NFT information
  nftData: {
    mintAddress: String,  // Blockchain address of this NFT
    imageUrl: String,     // The image for this ticket
    attributes: Object    // Any special properties
  },
  
  // Ticket status
  status: { 
    type: String, 
    enum: ['active', 'used', 'transferred', 'invalid'], 
    default: 'active' 
  },
  
  // Has this ticket been used to enter the event?
  isCheckedIn: { type: Boolean, default: false },
  checkedInAt: Date,
  
  // History of transfers (if this ticket changed hands)
  transferHistory: [{
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: Date,
    price: Number  // If it was sold
  }],
  
  // When the ticket was created
  createdAt: { type: Date, default: Date.now }
});

// Create the model from the schema
const Ticket = mongoose.model('Ticket', TicketSchema);

// Export the model
module.exports = Ticket;
