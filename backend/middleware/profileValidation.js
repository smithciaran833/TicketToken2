// middleware/profileValidation.js - Advanced profile validation

const { body, param, validationResult } = require('express-validator');
const { validateWalletAddress, validateUrl } = require('../utils/validators');

// Validation for preferences update
const validatePreferencesUpdate = [
  body('notifications.email').optional().isBoolean().withMessage('Email notification preference must be boolean'),
  body('notifications.push').optional().isBoolean().withMessage('Push notification preference must be boolean'),
  body('notifications.marketing').optional().isBoolean().withMessage('Marketing notification preference must be boolean'),
  body('notifications.events').optional().isBoolean().withMessage('Events notification preference must be boolean'),
  body('notifications.tickets').optional().isBoolean().withMessage('Tickets notification preference must be boolean'),
  
  body('privacy.showEmail').optional().isBoolean().withMessage('Show email preference must be boolean'),
  body('privacy.showWallet').optional().isBoolean().withMessage('Show wallet preference must be boolean'),
  body('privacy.allowMessaging').optional().isBoolean().withMessage('Allow messaging preference must be boolean'),
  body('privacy.profileVisibility').optional().isIn(['public', 'private', 'friends']).withMessage('Invalid profile visibility option'),
  
  body('language').optional().isIn(['en', 'es', 'fr', 'de', 'pt', 'jp', 'zh', 'ko']).withMessage('Invalid language selection'),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'SOL', 'BTC', 'ETH']).withMessage('Invalid currency selection'),
  body('theme').optional().isIn(['light', 'dark', 'auto']).withMessage('Invalid theme selection'),
  body('timezone').optional().isString().withMessage('Timezone must be a string'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }
    next();
  }
];

// Validation for social connections update
const validateSocialConnections = [
  body('twitter').optional().custom((value) => {
    if (value && !isValidSocialHandle(value, 'twitter')) {
      throw new Error('Invalid Twitter handle or URL format');
    }
    return true;
  }),
  body('instagram').optional().custom((value) => {
    if (value && !isValidSocialHandle(value, 'instagram')) {
      throw new Error('Invalid Instagram handle or URL format');
    }
    return true;
  }),
  body('discord').optional().custom((value) => {
    if (value && !isValidSocialHandle(value, 'discord')) {
      throw new Error('Invalid Discord username format');
    }
    return true;
  }),
  body('telegram').optional().custom((value) => {
    if (value && !isValidSocialHandle(value, 'telegram')) {
      throw new Error('Invalid Telegram username format');
    }
    return true;
  }),
  body('website').optional().custom((value) => {
    if (value && !validateUrl(value)) {
      throw new Error('Invalid website URL format');
    }
    return true;
  }),
  body('linkedin').optional().custom((value) => {
    if (value && !isValidSocialHandle(value, 'linkedin')) {
      throw new Error('Invalid LinkedIn URL format');
    }
    return true;
  }),
  body('github').optional().custom((value) => {
    if (value && !isValidSocialHandle(value, 'github')) {
      throw new Error('Invalid GitHub username format');
    }
    return true;
  }),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }
    next();
  }
];

// Validation for wallet address operations
const validateWalletAddressMiddleware = [
  body('walletAddress').notEmpty().withMessage('Wallet address is required')
    .custom((value) => {
      if (!validateWalletAddress(value)) {
        throw new Error('Invalid Solana wallet address format');
      }
      return true;
    }),
  body('isPrimary').optional().isBoolean().withMessage('isPrimary must be boolean'),
  body('label').optional().isLength({ max: 50 }).withMessage('Wallet label must be 50 characters or less'),
  body('signature').optional().isString().withMessage('Signature must be a string'),
  body('message').optional().isString().withMessage('Message must be a string'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }
    next();
  }
];

// Validation for password change
const validatePasswordChange = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain uppercase, lowercase, number, and special character'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }
    next();
  }
];

// Validation for profile image upload
const validateProfileImage = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No image file provided',
      errors: { image: 'Please select an image to upload' }
    });
  }

  // Check file size (already handled by multer, but adding extra check)
  if (req.file.size > 5 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: 'File too large',
      errors: { image: 'Image must be smaller than 5MB' }
    });
  }

  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid file type',
      errors: { image: 'Only JPEG, PNG, and WebP images are allowed' }
    });
  }

  next();
};

// Validation for wallet address parameter
const validateWalletParam = [
  param('address').custom((value) => {
    if (!validateWalletAddress(value)) {
      throw new Error('Invalid wallet address format');
    }
    return true;
  }),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }
    next();
  }
];

// Helper function to validate social media handles
const isValidSocialHandle = (handle, platform) => {
  const patterns = {
    twitter: /^@?[A-Za-z0-9_]{1,15}$|^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[A-Za-z0-9_]{1,15}\/?$/,
    instagram: /^@?[A-Za-z0-9_.]{1,30}$|^https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/,
    discord: /^.{3,32}#[0-9]{4}$|^@?[A-Za-z0-9_.]{2,32}$/,
    telegram: /^@?[A-Za-z0-9_]{5,32}$|^https?:\/\/(www\.)?t\.me\/[A-Za-z0-9_]{5,32}\/?$/,
    linkedin: /^https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9\-\.]+\/?$/,
    github: /^@?[A-Za-z0-9\-]{1,39}$|^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9\-]{1,39}\/?$/
  };

  return patterns[platform] ? patterns[platform].test(handle) : false;
};

// Validation for bulk operations (admin only)
const validateBulkUpdate = [
  body('userIds').isArray().withMessage('User IDs must be an array')
    .custom((value) => {
      if (value.length === 0) {
        throw new Error('At least one user ID is required');
      }
      if (value.length > 100) {
        throw new Error('Cannot update more than 100 users at once');
      }
      return true;
    }),
  body('userIds.*').isMongoId().withMessage('Invalid user ID format'),
  body('updateData').isObject().withMessage('Update data must be an object'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }
    next();
  }
];

// Validation for profile search
const validateProfileSearch = [
  body('query').optional().isString().isLength({ min: 1, max: 100 }).withMessage('Search query must be 1-100 characters'),
  body('filters.role').optional().isIn(['user', 'organizer', 'admin']).withMessage('Invalid role filter'),
  body('filters.isVerified').optional().isBoolean().withMessage('isVerified filter must be boolean'),
  body('sort').optional().isIn(['createdAt', 'lastLoginAt', 'displayName', 'username']).withMessage('Invalid sort field'),
  body('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
  body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  body('page').optional().isInt({ min: 1 }).withMessage('Page must be at least 1'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.mapped()
      });
    }
    next();
  }
];

module.exports = {
  validatePreferencesUpdate,
  validateSocialConnections,
  validateWalletAddress: validateWalletAddressMiddleware,  // ✅ Fixed
  validatePasswordChange,
  validateProfileImage,
  validateWalletParam,
  validateBulkUpdate,
  validateProfileSearch,
  isValidSocialHandle,
};
