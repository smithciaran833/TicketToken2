// middleware/nftAccessMiddleware.js - NFT ownership verification and access control

const nftAccessService = require('../services/nftAccessService');
const AccessGrant = require('../models/AccessGrant');

/**
 * Middleware to verify NFT ownership for a resource
 * Use on routes that need to check NFT ownership for access
 */
const verifyNFTAccess = (resourceType) => {
  return async (req, res, next) => {
    try {
      // Get resource ID from params or body
      const resourceId = req.params.id || req.body.resourceId || req.query.resourceId;
      
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          message: 'Resource ID is required',
          errors: { resource: 'Resource ID is required for access verification' }
        });
      }
      
      // Check access using NFT service
      const accessResult = await nftAccessService.checkAccess(
        req.user._id,
        resourceId,
        resourceType,
        req.body.accessLevel || 'view'
      );
      
      // Save access result to request for downstream use
      req.nftAccess = accessResult;
      
      // If no access, return error
      if (!accessResult.hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'NFT ownership verification failed',
          errors: { access: accessResult.reason },
          requiredNFTs: accessResult.missingNFTs
        });
      }
      
      // Access granted, continue
      next();
    } catch (error) {
      console.error('NFT access verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error verifying NFT access',
        errors: { server: 'Failed to verify NFT ownership' }
      });
    }
  };
};

/**
 * Middleware to verify an access token
 * Use on content/file delivery routes
 */
const verifyAccessToken = async (req, res, next) => {
  try {
    // Get token from query, header, or body
    const token = 
      req.query.access_token || 
      req.body.access_token || 
      (req.headers.authorization?.startsWith('Bearer ') 
        ? req.headers.authorization.slice(7) 
        : null);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required',
        errors: { token: 'No access token provided' }
      });
    }
    
    // Verify token
    const verification = await nftAccessService.verifyAccessGrant(token);
    
    if (!verification.isValid) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired access token',
        errors: { token: verification.reason }
      });
    }
    
    // Add grant and resource to request
    req.accessGrant = verification.grant;
    req.accessedResource = verification.resource;
    
    // Continue
    next();
  } catch (error) {
    console.error('Access token verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying access token',
      errors: { server: 'Failed to verify access token' }
    });
  }
};

/**
 * Middleware to record resource access
 * Use after access verification to track usage
 */
const recordAccess = (accessType = 'view') => {
  return async (req, res, next) => {
    try {
      // Skip if no access grant
      if (!req.accessGrant) {
        return next();
      }
      
      // Update usage stats asynchronously (don't wait for it)
      req.accessGrant.usageCount += 1;
      req.accessGrant.lastUsedAt = new Date();
      req.accessGrant.save()
        .catch(err => console.error('Error recording access:', err));
      
      // Continue without waiting
      next();
    } catch (error) {
      // Log but don't fail the request
      console.error('Record access error:', error);
      next();
    }
  };
};

/**
 * Middleware to verify creator ownership of resource
 * Use on routes that modify access rules
 */
const verifyResourceOwnership = (resourceModel) => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id || req.body.resourceId;
      
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          message: 'Resource ID is required',
          errors: { resource: 'Resource ID is required' }
        });
      }
      
      // Get the resource model
      const model = resourceModel || req.body.resourceType;
      
      if (!model) {
        return res.status(400).json({
          success: false,
          message: 'Resource type is required',
          errors: { resourceType: 'Resource type is required' }
        });
      }
      
      // Get the model constructor
      const Model = require(`../models/${model}`);
      
      // Find the resource
      const resource = await Model.findById(resourceId);
      
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found',
          errors: { resource: 'Resource does not exist' }
        });
      }
      
      // Check if user owns the resource
      // This assumes the resource has a 'createdBy', 'creator' or similar field
      // Adjust according to your actual model field names
      const creatorField = 
        resource.createdBy || 
        resource.creator || 
        resource.artist || 
        resource.owner || 
        resource.user;
      
      const isOwner = creatorField?.toString() === req.user._id.toString();
      const isAdmin = req.user.role === 'admin';
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized',
          errors: { permission: 'You do not own this resource' }
        });
      }
      
      // Add resource to request for downstream use
      req.resource = resource;
      
      // Continue
      next();
    } catch (error) {
      console.error('Resource ownership verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error verifying resource ownership',
        errors: { server: 'Failed to verify resource ownership' }
      });
    }
  };
};

/**
 * Middleware factory to validate access level
 * @param {Array|string} requiredLevels - Required access level(s)
 */
const requireAccessLevel = (requiredLevels) => {
  return (req, res, next) => {
    const grantedLevel = req.accessGrant?.accessLevel || req.nftAccess?.accessLevel;
    
    if (!grantedLevel) {
      return res.status(403).json({
        success: false,
        message: 'Access verification required',
        errors: { access: 'No access level found' }
      });
    }
    
    // Convert to array for easier handling
    const requiredArray = Array.isArray(requiredLevels) ? requiredLevels : [requiredLevels];
    
    // Access level values for comparison
    const levels = {
      'admin': 5,
      'edit': 4,
      'download': 3,
      'stream': 2,
      'view': 1
    };
    
    // Check if granted level covers any required level
    const grantedValue = levels[grantedLevel] || 0;
    const hasAccess = requiredArray.some(level => {
      const requiredValue = levels[level] || 0;
      return grantedValue >= requiredValue;
    });
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient access level',
        errors: { 
          access: `Access level '${grantedLevel}' is insufficient. Required: ${requiredArray.join(' or ')}` 
        }
      });
    }
    
    next();
  };
};

module.exports = {
  verifyNFTAccess,
  verifyAccessToken,
  recordAccess,
  verifyResourceOwnership,
  requireAccessLevel
};
