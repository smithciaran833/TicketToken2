// Add this function to your existing validators.js file
/**
 * Validate content creation/update schema
 */
exports.validateContentSchema = (req, res, next) => {
  const { title, description, contentType, contentUrl } = req.body;
  const errors = {};
  
  // Validate required fields
  if (!title || title.trim() === '') {
    errors.title = 'Title is required';
  }
  
  if (!description || description.trim() === '') {
    errors.description = 'Description is required';
  }
  
  if (!contentType) {
    errors.contentType = 'Content type is required';
  } else if (!['video', 'audio', 'document', 'livestream', 'image', 'other'].includes(contentType)) {
    errors.contentType = 'Invalid content type';
  }
  
  if (!contentUrl || contentUrl.trim() === '') {
    errors.contentUrl = 'Content URL is required';
  } else if (!validateUrl(contentUrl)) {
    errors.contentUrl = 'Invalid URL format';
  }
  
  // Validate required tokens if provided
  if (req.body.requiredTokens) {
    if (!Array.isArray(req.body.requiredTokens)) {
      errors.requiredTokens = 'Required tokens must be an array';
    } else {
      req.body.requiredTokens.forEach((token, index) => {
        if (!token.tokenId) {
          errors[`requiredTokens[${index}].tokenId`] = 'Token ID is required';
        }
        if (token.minQuantity !== undefined && (isNaN(token.minQuantity) || token.minQuantity < 1)) {
          errors[`requiredTokens[${index}].minQuantity`] = 'Minimum quantity must be a positive number';
        }
      });
    }
  }
  
  // Validate access levels if provided
  if (req.body.accessLevels) {
    if (!Array.isArray(req.body.accessLevels)) {
      errors.accessLevels = 'Access levels must be an array';
    } else {
      req.body.accessLevels.forEach((level, index) => {
        if (!level.name) {
          errors[`accessLevels[${index}].name`] = 'Access level name is required';
        }
        if (level.requiredTokenQuantity !== undefined && (isNaN(level.requiredTokenQuantity) || level.requiredTokenQuantity < 0)) {
          errors[`accessLevels[${index}].requiredTokenQuantity`] = 'Required token quantity must be a non-negative number';
        }
        if (level.price !== undefined && (isNaN(level.price) || level.price < 0)) {
          errors[`accessLevels[${index}].price`] = 'Price must be a non-negative number';
        }
        if (level.currency && !['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CNY', 'ETH'].includes(level.currency)) {
          errors[`accessLevels[${index}].currency`] = 'Invalid currency';
        }
        if (level.features && !Array.isArray(level.features)) {
          errors[`accessLevels[${index}].features`] = 'Features must be an array';
        }
      });
    }
  }
  
  // Validate exclusivity settings if provided
  if (req.body.exclusivity) {
    const { type, expirationDate, maxUsers } = req.body.exclusivity;
    
    if (!type) {
      errors['exclusivity.type'] = 'Exclusivity type is required';
    } else if (!['time-limited', 'user-limited', 'token-gated', 'none'].includes(type)) {
      errors['exclusivity.type'] = 'Invalid exclusivity type';
    }
    
    if (type === 'time-limited' && !expirationDate) {
      errors['exclusivity.expirationDate'] = 'Expiration date is required for time-limited exclusivity';
    } else if (expirationDate && new Date(expirationDate) <= new Date()) {
      errors['exclusivity.expirationDate'] = 'Expiration date must be in the future';
    }
    
    if (type === 'user-limited') {
      if (!maxUsers) {
        errors['exclusivity.maxUsers'] = 'Maximum users is required for user-limited exclusivity';
      } else if (isNaN(maxUsers) || maxUsers < 1) {
        errors['exclusivity.maxUsers'] = 'Maximum users must be a positive number';
      }
    }
  }
  
  // Return errors if any
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

/**
 * Validate URL format
 */
function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validate content access request
 */
exports.validateContentAccessRequest = (req, res, next) => {
  const { contentId, userId, accessLevelId } = req.body;
  const errors = {};
  
  if (!contentId) {
    errors.contentId = 'Content ID is required';
  }
  
  if (!userId) {
    errors.userId = 'User ID is required';
  }
  
  if (!accessLevelId) {
    errors.accessLevelId = 'Access level ID is required';
  }
  
  // Return errors if any
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

/**
 * Validate token ownership for content access
 */
exports.validateTokenOwnership = (req, res, next) => {
  const { tokenId, walletAddress, minQuantity } = req.body;
  const errors = {};
  
  if (!tokenId) {
    errors.tokenId = 'Token ID is required';
  }
  
  if (!walletAddress) {
    errors.walletAddress = 'Wallet address is required';
  } else if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    errors.walletAddress = 'Invalid wallet address format';
  }
  
  if (minQuantity !== undefined && (isNaN(minQuantity) || minQuantity < 1)) {
    errors.minQuantity = 'Minimum quantity must be a positive number';
  }
  
  // Return errors if any
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};
