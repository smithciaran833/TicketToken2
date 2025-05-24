const jwt = require('jsonwebtoken');
const User = require('../models/user');
const TokenGatedContent = require('../models/tokenGatedContent');
const ethers = require('ethers');
const { verifyTokenOwnership } = require('../services/tokenVerificationService');

/**
 * Middleware to authenticate user based on JWT token
 */
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * Middleware to verify token ownership for content access
 */
const verifyContentAccess = async (req, res, next) => {
  try {
    const contentId = req.params.id;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the content that the user is trying to access
    const content = await TokenGatedContent.findById(contentId);
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Check if content has expired
    if (content.expiresAt && new Date(content.expiresAt) < new Date()) {
      return res.status(403).json({ error: 'Content has expired' });
    }
    
    // Check if content is active
    if (!content.isActive) {
      return res.status(403).json({ error: 'Content is not active' });
    }
    
    // Content creator always has access
    if (content.createdBy.toString() === user._id.toString()) {
      req.content = content;
      return next();
    }
    
    // Get user's wallet addresses
    const walletAddresses = user.wallets || [];
    
    if (walletAddresses.length === 0) {
      return res.status(403).json({ 
        error: 'No connected wallets found',
        requiredTokens: content.requiredTokens 
      });
    }
    
    // Check if user has the required tokens based on access control type
    let hasAccess = false;
    
    if (content.accessControl === 'anyToken') {
      // User needs to own at least one of any required tokens
      for (const requiredToken of content.requiredTokens) {
        for (const walletAddress of walletAddresses) {
          const ownsToken = await verifyTokenOwnership(
            walletAddress,
            requiredToken.contractAddress,
            requiredToken.tokenId,
            requiredToken.minAmount
          );
          
          if (ownsToken) {
            hasAccess = true;
            break;
          }
        }
        
        if (hasAccess) break;
      }
    } else if (content.accessControl === 'allTokens') {
      // User needs to own all required tokens
      hasAccess = true;
      
      for (const requiredToken of content.requiredTokens) {
        let ownsThisToken = false;
        
        for (const walletAddress of walletAddresses) {
          const ownsToken = await verifyTokenOwnership(
            walletAddress,
            requiredToken.contractAddress,
            requiredToken.tokenId,
            requiredToken.minAmount
          );
          
          if (ownsToken) {
            ownsThisToken = true;
            break;
          }
        }
        
        if (!ownsThisToken) {
          hasAccess = false;
          break;
        }
      }
    } else if (content.accessControl === 'specificToken') {
      // User needs to own the specific token(s)
      hasAccess = true;
      
      for (const requiredToken of content.requiredTokens) {
        if (!requiredToken.tokenId) {
          continue; // Skip if no specific tokenId is required
        }
        
        let ownsThisToken = false;
        
        for (const walletAddress of walletAddresses) {
          const ownsToken = await verifyTokenOwnership(
            walletAddress,
            requiredToken.contractAddress,
            requiredToken.tokenId,
            requiredToken.minAmount
          );
          
          if (ownsToken) {
            ownsThisToken = true;
            break;
          }
        }
        
        if (!ownsThisToken) {
          hasAccess = false;
          break;
        }
      }
    }
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'You do not have the required tokens to access this content',
        requiredTokens: content.requiredTokens 
      });
    }
    
    // If we reach here, user has access
    req.content = content;
    next();
  } catch (error) {
    console.error('Error verifying content access:', error);
    return res.status(500).json({ error: 'Error verifying content access' });
  }
};

module.exports = {
  authenticateUser,
  verifyContentAccess
};
