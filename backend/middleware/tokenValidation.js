const jwt = require('jsonwebtoken');
const User = require('../models/user');
const TicketToken = require('../models/ticketToken');
const UserToken = require('../models/userToken');

/**
 * Middleware to validate user's JWT token
 */
exports.validateJWT = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No authentication token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid authentication token' });
  }
};

/**
 * Middleware to validate if user has required tokens for content access
 * @param {boolean} strictMode - If true, will reject access if any required token is missing
 */
exports.validateContentAccess = (strictMode = true) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
      }

      const contentId = req.params.contentId || req.body.contentId;
      if (!contentId) {
        return res.status(400).json({ success: false, message: 'Content ID is required' });
      }

      // Load the content to check required tokens
      const ContentAccess = require('../models/contentAccess');
      const content = await ContentAccess.findById(contentId);
      
      if (!content) {
        return res.status(404).json({ success: false, message: 'Content not found' });
      }

      // Check if content is still active and within valid date range
      const now = new Date();
      if (!content.isActive) {
        return res.status(403).json({ success: false, message: 'This content is no longer active' });
      }
      
      if (content.validFrom && content.validFrom > now) {
        return res.status(403).json({ success: false, message: 'This content is not yet available' });
      }
      
      if (content.validUntil && content.validUntil < now) {
        return res.status(403).json({ success: false, message: 'This content has expired' });
      }

      // If no tokens required, allow access
      if (!content.requiredTokens || content.requiredTokens.length === 0) {
        req.content = content;
        return next();
      }

      // Get user's tokens
      const userTokens = await UserToken.find({ 
        userId: req.user.id,
        // Only include tokens that are in the requiredTokens list
        tokenId: { $in: content.requiredTokens.map(t => t.tokenId) }
      });

      // Create a map of user's token quantities
      const userTokenMap = {};
      userTokens.forEach(ut => {
        userTokenMap[ut.tokenId.toString()] = ut.quantity;
      });

      // Check if user has all required tokens in sufficient quantities
      let hasAllRequiredTokens = true;
      const missingTokens = [];

      for (const requiredToken of content.requiredTokens) {
        const tokenId = requiredToken.tokenId.toString();
        const requiredQuantity = requiredToken.minQuantity || 1;
        const userQuantity = userTokenMap[tokenId] || 0;

        if (userQuantity < requiredQuantity) {
          hasAllRequiredTokens = false;
          
          // Get token details for better error message
          const tokenDetails = await TicketToken.findById(tokenId).select('name');
          missingTokens.push({
            tokenId,
            name: tokenDetails ? tokenDetails.name : 'Unknown Token',
            required: requiredQuantity,
            userHas: userQuantity
          });
          
          // In non-strict mode, we continue checking other tokens
          if (!strictMode) continue;
          
          // In strict mode, we immediately reject
          break;
        }
      }

      if (!hasAllRequiredTokens) {
        return res.status(403).json({ 
          success: false, 
          message: 'You do not have the required tokens to access this content',
          missingTokens
        });
      }

      // If we reach here, the user has all required tokens
      // Let's determine their access level based on token quantities
      let highestAccessLevel = null;
      
      if (content.accessLevels && content.accessLevels.length > 0) {
        // Sort access levels by required quantity (descending)
        const sortedLevels = [...content.accessLevels].sort(
          (a, b) => b.requiredTokenQuantity - a.requiredTokenQuantity
        );

        // Find the highest access level the user qualifies for
        for (const level of sortedLevels) {
          const totalUserTokens = Object.values(userTokenMap).reduce((sum, qty) => sum + qty, 0);
          
          if (totalUserTokens >= level.requiredTokenQuantity) {
            highestAccessLevel = level;
            break;
          }
        }
      }

      // Attach content and access level to request object
      req.content = content;
      req.accessLevel = highestAccessLevel;
      req.userTokens = userTokens;

      next();
    } catch (error) {
      console.error('Token validation error:', error);
      return res.status(500).json({ success: false, message: 'Error validating token access' });
    }
  };
};
