const mongoose = require('mongoose');

const tokenGatedContentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  contentType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'html'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  requiredTokens: [{
    contractAddress: {
      type: String,
      required: true,
      trim: true
    },
    tokenId: {
      type: String,
      required: false,
      trim: true
    },
    minAmount: {
      type: Number,
      default: 1
    }
  }],
  accessControl: {
    type: String,
    enum: ['anyToken', 'allTokens', 'specificToken'],
    default: 'anyToken'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  expiresAt: {
    type: Date,
    required: false
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for faster queries
tokenGatedContentSchema.index({ 'requiredTokens.contractAddress': 1 });
tokenGatedContentSchema.index({ createdBy: 1 });
tokenGatedContentSchema.index({ isActive: 1 });

const TokenGatedContent = mongoose.model('TokenGatedContent', tokenGatedContentSchema);

module.exports = TokenGatedContent;
