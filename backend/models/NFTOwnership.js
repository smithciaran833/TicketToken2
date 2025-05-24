// models/NFTOwnership.js - Track NFT ownership for access control

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const NFTOwnershipSchema = new Schema({
  // The NFT mint address
  nftAddress: {
    type: String,
    required: true,
    index: true
  },
  
  // The wallet address that owns this NFT
  walletAddress: {
    type: String,
    required: true,
    index: true
  },
  
  // User that owns this wallet (if registered in our system)
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  
  // NFT metadata
  metadata: {
    name: String,
    description: String,
    image: String,
    attributes: [Schema.Types.Mixed],
    collection: String,
    collectionAddress: String,
    tokenId: String,
    standard: {
      type: String,
      enum: ['Metaplex', 'SPL', 'ERC721', 'ERC1155', 'Other'],
      default: 'Metaplex'
    }
  },
  
  // Verification information
  verified: {
    type: Boolean,
    default: false
  },
  verificationMethod: {
    type: String,
    enum: ['on-chain', 'off-chain', 'signature', 'centralized', 'manual'],
    default: 'on-chain'
  },
  lastVerifiedAt: {
    type: Date
  },
  
  // Ownership status
  status: {
    type: String,
    enum: ['active', 'transferred', 'burned', 'revoked'],
    default: 'active'
  },
  
  // When the NFT was acquired by this wallet
  acquiredAt: {
    type: Date,
    default: Date.now
  },
  
  // When the NFT was transferred or lost (if applicable)
  transferredAt: {
    type: Date
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for efficient querying
NFTOwnershipSchema.index({ nftAddress: 1, walletAddress: 1 }, { unique: true });
NFTOwnershipSchema.index({ user: 1, status: 1 });
NFTOwnershipSchema.index({ 'metadata.collection': 1, status: 1 });

// Pre-save middleware to update timestamps
NFTOwnershipSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods
NFTOwnershipSchema.methods.isOwner = function(walletAddress) {
  return this.walletAddress === walletAddress && this.status === 'active';
};

NFTOwnershipSchema.methods.markTransferred = function(newWalletAddress) {
  this.status = 'transferred';
  this.transferredAt = new Date();
  return this.save();
};

NFTOwnershipSchema.methods.updateVerification = async function(verified, method = 'on-chain') {
  this.verified = verified;
  this.verificationMethod = method;
  this.lastVerifiedAt = new Date();
  return await this.save();
};

// Static methods
NFTOwnershipSchema.statics.findByUser = function(userId) {
  return this.find({ user: userId, status: 'active' })
    .sort({ acquiredAt: -1 });
};

NFTOwnershipSchema.statics.findByWallet = function(walletAddress) {
  return this.find({ walletAddress, status: 'active' })
    .sort({ acquiredAt: -1 });
};

NFTOwnershipSchema.statics.findByCollection = function(collectionAddress) {
  return this.find({
    'metadata.collectionAddress': collectionAddress,
    status: 'active'
  }).sort({ acquiredAt: -1 });
};

NFTOwnershipSchema.statics.isNFTOwner = async function(nftAddress, walletAddress) {
  const ownership = await this.findOne({
    nftAddress,
    walletAddress,
    status: 'active'
  });
  
  return !!ownership;
};

NFTOwnershipSchema.statics.recordOwnership = async function(nftData, userId = null) {
  const { nftAddress, walletAddress, metadata } = nftData;
  
  // Check if this NFT is already recorded
  const existing = await this.findOne({ nftAddress, walletAddress });
  
  if (existing) {
    // Update existing record if status is not active
    if (existing.status !== 'active') {
      existing.status = 'active';
      existing.acquiredAt = new Date();
      existing.transferredAt = null;
      if (metadata) existing.metadata = { ...existing.metadata, ...metadata };
      if (userId) existing.user = userId;
      return await existing.save();
    }
    return existing;
  }
  
  // Create new ownership record
  return await this.create({
    nftAddress,
    walletAddress,
    user: userId,
    metadata,
    status: 'active',
    acquiredAt: new Date()
  });
};

const NFTOwnership = mongoose.model('NFTOwnership', NFTOwnershipSchema);

module.exports = NFTOwnership;
