// controllers/nftAccessController.js - NFT access control endpoints

const NFTAccess = require('../models/NFTAccess');
const NFTOwnership = require('../models/NFTOwnership');
const AccessGrant = require('../models/AccessGrant');
const nftAccessService = require('../services/nftAccessService');
const nftVerificationService = require('../services/nftVerificationService');
const { validateWalletAddress } = require('../utils/validators');

// @desc    Check if user has access to a resource
// @route   POST /api/nft-access/check
// @access  Private
const checkAccess = async (req, res) => {
  try {
    const { resourceId, resourceType, accessLevel } = req.body;
    
    if (!resourceId || !resourceType) {
      return res.status(400).json({
        success: false,
        message: 'Resource ID and type are required',
        errors: {
          resourceId: !resourceId ? 'Resource ID is required' : undefined,
          resourceType: !resourceType ? 'Resource type is required' : undefined
        }
      });
    }
    
    // Check access using NFT service
    const accessResult = await nftAccessService.checkAccess(
      req.user._id,
      resourceId,
      resourceType,
      accessLevel || 'view'
    );
    
    // Format response based on result
    if (accessResult.hasAccess) {
      return res.json({
        success: true,
        message: 'Access granted',
        data: {
          hasAccess: true,
          accessLevel: accessLevel || 'view',
          accessRules: accessResult.accessRules
        }
      });
    } else {
      return res.json({
        success: true,
        message: 'Access denied',
        data: {
          hasAccess: false,
          reason: accessResult.reason,
          missingNFTs: accessResult.missingNFTs,
          requiredAccess: accessLevel || 'view'
        }
      });
    }
  } catch (error) {
    console.error('Check access error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check access',
      errors: { server: 'Server error processing access check' }
    });
  }
};

// @desc    Generate access token for a resource
// @route   POST /api/nft-access/token
// @access  Private
const generateAccessToken = async (req, res) => {
  try {
    const { resourceId, resourceType, resourceTitle, nftAddress, walletAddress, accessLevel } = req.body;
    
    if (!resourceId || !resourceType || !nftAddress || !walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        errors: {
          resourceId: !resourceId ? 'Resource ID is required' : undefined,
          resourceType: !resourceType ? 'Resource type is required' : undefined,
          nftAddress: !nftAddress ? 'NFT address is required' : undefined,
          walletAddress: !walletAddress ? 'Wallet address is required' : undefined
        }
      });
    }
    
    // Validate addresses
    if (!validateWalletAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address',
        errors: { walletAddress: 'Must be a valid Solana wallet address' }
      });
    }
    
    // Verify the user owns the NFT
    const ownsNFT = await NFTOwnership.isNFTOwner(nftAddress, walletAddress);
    const userHasWallet = req.user.walletAddresses?.some(w => w.address === walletAddress);
    
    if (!ownsNFT || !userHasWallet) {
      // Try on-chain verification
      const isOwnerOnChain = await nftVerificationService.verifyNFTOwnership(
        nftAddress,
        walletAddress
      );
      
      if (!isOwnerOnChain) {
        return res.status(403).json({
          success: false,
          message: 'NFT ownership verification failed',
          errors: { nft: 'You do not own this NFT or it could not be verified' }
        });
      }
      
      // Record verified ownership
      await NFTOwnership.recordOwnership({
        nftAddress,
        walletAddress,
        metadata: await nftVerificationService.getNFTMetadata(nftAddress)
      }, req.user._id);
    }
    
    // Check if this NFT grants access to the resource
    const accessCheck = await nftAccessService.checkAccess(
      req.user._id,
      resourceId,
      resourceType,
      accessLevel || 'view'
    );
    
    if (!accessCheck.hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: { access: accessCheck.reason }
      });
    }
    
    // Generate access grant
    const grant = await nftAccessService.generateAccessGrant(
      req.user._id,
      {
        id: resourceId,
        model: resourceType,
        title: resourceTitle || 'Untitled Resource',
        type: 'content',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      },
      {
        address: nftAddress,
        walletAddress
      },
      accessLevel || 'view'
    );
    
    return res.json({
      success: true,
      message: 'Access token generated successfully',
      data: {
        token: grant.token,
        expiresAt: grant.expiresAt,
        accessLevel: grant.accessLevel,
        resource: {
          id: resourceId,
          type: resourceType,
          title: resourceTitle || 'Untitled Resource'
        }
      }
    });
  } catch (error) {
    console.error('Generate access token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate access token',
      errors: { server: 'Server error generating access token' }
    });
  }
};

// @desc    Verify an access token
// @route   GET /api/nft-access/verify
// @access  Private
const verifyAccessToken = async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
        errors: { token: 'Access token is required' }
      });
    }
    
    // Verify token
    const verification = await nftAccessService.verifyAccessGrant(token);
    
    if (!verification.isValid) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token',
        errors: { token: verification.reason }
      });
    }
    
    return res.json({
      success: true,
      message: 'Access token verified',
      data: {
        isValid: true,
        accessLevel: verification.grant.accessLevel,
        resource: verification.resource,
        usageCount: verification.grant.usageCount,
        expiresAt: verification.grant.expiresAt
      }
    });
  } catch (error) {
    console.error('Verify access token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify access token',
      errors: { server: 'Server error verifying access token' }
    });
  }
};

// @desc    Define NFT access rules for a resource
// @route   POST /api/nft-access/rules
// @access  Private (Admin/Creator)
const defineAccessRules = async (req, res) => {
  try {
    const { resourceId, resourceType, rules } = req.body;
    
    if (!resourceId || !resourceType || !rules || !Array.isArray(rules)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: {
          resourceId: !resourceId ? 'Resource ID is required' : undefined,
          resourceType: !resourceType ? 'Resource type is required' : undefined,
          rules: !rules ? 'Rules array is required' : (!Array.isArray(rules) ? 'Rules must be an array' : undefined)
        }
      });
    }
    
    // Validate each rule
    const validationErrors = [];
    
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      
      if (!rule.nftAddress) {
        validationErrors.push(`Rule #${i+1}: NFT address is required`);
      } else if (!validateWalletAddress(rule.nftAddress)) {
        validationErrors.push(`Rule #${i+1}: Invalid NFT address format`);
      }
      
      if (rule.accessLevel && !['view', 'download', 'stream', 'edit', 'admin'].includes(rule.accessLevel)) {
        validationErrors.push(`Rule #${i+1}: Invalid access level`);
      }
      
      if (rule.temporaryAccess && !rule.expiresAt) {
        validationErrors.push(`Rule #${i+1}: Expiration date required for temporary access`);
      }
    }
    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors in access rules',
        errors: { rules: validationErrors }
      });
    }
    
    // Create the rules
    const result = await nftAccessService.defineAccessRules(
      resourceId,
      resourceType,
      rules,
      req.user._id
    );
    
    return res.json({
      success: true,
      message: 'Access rules defined successfully',
      data: result
    });
  } catch (error) {
    console.error('Define access rules error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to define access rules',
      errors: { server: 'Server error defining access rules' }
    });
  }
};

// @desc    Get access rules for a resource
// @route   GET /api/nft-access/rules/:resourceType/:resourceId
// @access  Private
const getAccessRules = async (req, res) => {
  try {
    const { resourceType, resourceId } = req.params;
    
    if (!resourceId || !resourceType) {
      return res.status(400).json({
        success: false,
        message: 'Resource ID and type are required',
        errors: {
          resourceId: !resourceId ? 'Resource ID is required' : undefined,
          resourceType: !resourceType ? 'Resource type is required' : undefined
        }
      });
    }
    
    // Get rules
    const rules = await NFTAccess.find({
      resourceId,
      resourceModel: resourceType,
      isActive: true
    }).sort({ createdAt: -1 });
    
    return res.json({
      success: true,
      message: 'Access rules retrieved successfully',
      data: {
        count: rules.length,
        rules
      }
    });
  } catch (error) {
    console.error('Get access rules error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve access rules',
      errors: { server: 'Server error retrieving access rules' }
    });
  }
};

// @desc    Sync user's NFTs
// @route   POST /api/nft-access/sync
// @access  Private
const syncUserNFTs = async (req, res) => {
  try {
    const result = await nftAccessService.syncUserNFTs(req.user._id);
    
    return res.json({
      success: true,
      message: 'NFT synchronization completed',
      data: result
    });
  } catch (error) {
    console.error('Sync NFTs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync NFTs',
      errors: { server: 'Server error syncing NFTs' }
    });
  }
};

// @desc    Get user's NFTs
// @route   GET /api/nft-access/nfts
// @access  Private
const getUserNFTs = async (req, res) => {
  try {
    const nfts = await NFTOwnership.find({
      user: req.user._id,
      status: 'active'
    }).sort({ acquiredAt: -1 });
    
    return res.json({
      success: true,
      message: 'NFT list retrieved successfully',
      data: {
        count: nfts.length,
        nfts
      }
    });
  } catch (error) {
    console.error('Get user NFTs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve NFTs',
      errors: { server: 'Server error retrieving NFTs' }
    });
  }
};

// @desc    Get resources accessible by user
// @route   GET /api/nft-access/resources
// @access  Private
const getAccessibleResources = async (req, res) => {
  try {
    const result = await nftAccessService.getAccessibleResources(req.user._id);
    
    return res.json({
      success: true,
      message: 'Accessible resources retrieved successfully',
      data: result
    });
  } catch (error) {
    console.error('Get accessible resources error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve accessible resources',
      errors: { server: 'Server error retrieving resources' }
    });
  }
};

// @desc    Get user's active access grants
// @route   GET /api/nft-access/grants
// @access  Private
const getUserGrants = async (req, res) => {
  try {
    const grants = await AccessGrant.findUserGrants(req.user._id);
    
    return res.json({
      success: true,
      message: 'Access grants retrieved successfully',
      data: {
        count: grants.length,
        grants
      }
    });
  } catch (error) {
    console.error('Get user grants error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve access grants',
      errors: { server: 'Server error retrieving grants' }
    });
  }
};

// @desc    Revoke an access grant
// @route   DELETE /api/nft-access/grants/:token
// @access  Private
const revokeAccessGrant = async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
        errors: { token: 'Access token is required' }
      });
    }
    
    // Find the grant
    const grant = await AccessGrant.findOne({ 
      token,
      user: req.user._id,
      status: 'active'
    });
    
    if (!grant) {
      return res.status(404).json({
        success: false,
        message: 'Access grant not found',
        errors: { token: 'No active grant found with this token' }
      });
    }
    
    // Revoke the grant
    await grant.revoke('User initiated revocation');
    
    return res.json({
      success: true,
      message: 'Access grant revoked successfully',
      data: {
        token,
        revokedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Revoke access grant error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to revoke access grant',
      errors: { server: 'Server error revoking grant' }
    });
  }
};

module.exports = {
  checkAccess,
  generateAccessToken,
  verifyAccessToken,
  defineAccessRules,
  getAccessRules,
  syncUserNFTs,
  getUserNFTs,
  getAccessibleResources,
  getUserGrants,
  revokeAccessGrant
};
