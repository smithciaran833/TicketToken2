// Transaction.js - Records of ticket purchases and sales

const mongoose = require('mongoose');

// Schema definition for transactions
const TransactionSchema = new mongoose.Schema({
  // Transaction identifier
  transactionId: { type: String, required: true, unique: true },
  
  // Transaction type
  type: { 
    type: String, 
    enum: ['primary_purchase', 'secondary_sale', 'transfer'],
    required: true
  },
  
  // Who bought the ticket(s)
  buyer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  
  // Who sold the ticket(s) (for resales)
  seller: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User'
  },
  
  // The tickets involved in this transaction
  tickets: [{
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
    price: Number
  }],
  
  // Financial details
  totalAmount: Number,
  paymentMethod: String,
  
  // Transaction status
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'refunded'], 
    default: 'pending' 
  },
  
  // When the transaction occurred
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
});

// Create the model from the schema
const Transaction = mongoose.model('Transaction', TransactionSchema);

// Export the model
module.exports = Transaction;
