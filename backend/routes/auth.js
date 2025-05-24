const express = require('express');
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { authController, handleAuthError } = require('../controllers/authController');
const { 
  requireAuth, 
  optionalAuth, 
  createRateLimit,
  requireCompleteProfile,
  requireRole
} = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ========================================
// RATE LIMITING CONFIGURATIONS
// ========================================

// General authentication rate limiting
const authRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  20, // 20 requests per window
  'Too many authentication requests, please try again later'
);

// Strict rate limiting for registration
const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registration attempts per hour per IP
  message: {
    success: false,
    message: 'Too many registration attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Registration rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      message: 'Too many registration attempts, please try again later'
    });
  }
});

// Strict rate limiting for login attempts
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per window per IP
  message: {
    success: false,
    message: 'Too many login attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts
  handler: (req, res) => {
    logger.warn('Login rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      message: 'Too many login attempts, please try again later'
    });
  }
});

// Rate limiting for password reset requests
const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset requests per hour per IP
  message: {
    success: false,
    message: 'Too many password reset requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      message: 'Too many password reset requests, please try again later'
    });
  }
});

// Rate limiting for email verification requests
const emailVerificationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 verification attempts per hour per IP
  message: {
    success: false,
    message: 'Too many email verification attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ========================================
// VALIDATION SCHEMAS
// ========================================

// User registration validation
const registerValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .isLength({ max: 254 })
    .withMessage('Please provide a valid email address (max 254 characters)')
    .custom(async (value) => {
      // Additional email format validation
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(value)) {
        throw new Error('Invalid email format');
      }
      return true;
    }),

  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Password confirmation does not match password');
      }
      return true;
    }),

  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),

  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),

  body('username')
    .optional()
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),

  body('walletAddress')
    .optional()
    .isLength({ min: 32, max: 44 })
    .withMessage('Invalid Solana wallet address format')
    .matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .withMessage('Invalid Solana wallet address characters'),

  body('termsAccepted')
    .isBoolean()
    .custom((value) => {
      if (!value) {
        throw new Error('You must accept the terms and conditions');
      }
      return true;
    }),

  body('privacyAccepted')
    .isBoolean()
    .custom((value) => {
      if (!value) {
        throw new Error('You must accept the privacy policy');
      }
      return true;
    })
];

// User login validation
const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ max: 128 })
    .withMessage('Password too long'),

  body('rememberMe')
    .optional()
    .isBoolean()
    .withMessage('Remember me must be a boolean value')
];

// Wallet authentication validation
const walletAuthValidation = [
  body('walletAddress')
    .isLength({ min: 32, max: 44 })
    .withMessage('Invalid Solana wallet address format')
    .matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .withMessage('Invalid Solana wallet address characters'),

  body('signature')
    .isLength({ min: 64, max: 128 })
    .withMessage('Invalid signature format')
    .matches(/^[A-Za-z0-9+/=]+$/)
    .withMessage('Signature contains invalid characters'),

  body('message')
    .isLength({ min: 10, max: 500 })
    .withMessage('Message must be between 10 and 500 characters')
    .custom((value) => {
      // Ensure message contains timestamp for replay attack prevention
      if (!value.includes('timestamp:')) {
        throw new Error('Message must contain timestamp for security');
      }
      return true;
    }),

  body('walletType')
    .optional()
    .isIn(['phantom', 'solflare', 'coinbase', 'other'])
    .withMessage('Invalid wallet type')
];

// Email validation (reusable)
const emailValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
];

// Token parameter validation
const tokenParamValidation = [
  param('token')
    .isLength({ min: 32, max: 128 })
    .withMessage('Invalid token format')
    .matches(/^[a-zA-Z0-9]+$/)
    .withMessage('Token contains invalid characters')
];

// Password reset validation
const passwordResetValidation = [
  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match password');
      }
      return true;
    }),

  ...tokenParamValidation
];

// ========================================
// PUBLIC ROUTES (No Authentication Required)
// ========================================

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user account
 * @access  Public
 * @rateLimit 3 requests per hour per IP
 */
router.post('/register', 
  registerRateLimit,
  authRateLimit,
  registerValidation,
  authController.register
);

/**
 * @route   POST /api/auth/login
 * @desc    Login with email and password
 * @access  Public
 * @rateLimit 5 requests per 15 minutes per IP
 */
router.post('/login',
  loginRateLimit,
  authRateLimit,
  loginValidation,
  authController.login
);

/**
 * @route   POST /api/auth/wallet-auth
 * @desc    Authenticate with Solana wallet signature
 * @access  Public
 * @rateLimit 20 requests per 15 minutes per IP
 */
router.post('/wallet-auth',
  authRateLimit,
  walletAuthValidation,
  authController.walletAuth
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public (requires refresh token)
 * @rateLimit 20 requests per 15 minutes per IP
 */
router.post('/refresh',
  authRateLimit,
  authController.refresh
);

/**
 * @route   GET /api/auth/verify-email/:token
 * @desc    Verify user email address
 * @access  Public
 * @rateLimit 5 requests per hour per IP
 */
router.get('/verify-email/:token',
  emailVerificationRateLimit,
  tokenParamValidation,
  authController.verifyEmail
);

/**
 * @route   POST /api/auth/request-reset
 * @desc    Request password reset email
 * @access  Public
 * @rateLimit 3 requests per hour per IP
 */
router.post('/request-reset',
  passwordResetRateLimit,
  emailValidation,
  authController.requestPasswordReset
);

/**
 * @route   POST /api/auth/reset-password/:token
 * @desc    Reset password with token
 * @access  Public
 * @rateLimit 5 requests per hour per IP
 */
router.post('/reset-password/:token',
  emailVerificationRateLimit,
  passwordResetValidation,
  authController.resetPassword
);

/**
 * @route   POST /api/auth/resend-verification
 * @desc    Resend email verification
 * @access  Public
 * @rateLimit 5 requests per hour per IP
 */
router.post('/resend-verification',
  emailVerificationRateLimit,
  emailValidation,
  authController.resendVerification
);

/**
 * @route   GET /api/auth/status
 * @desc    Check authentication status
 * @access  Public (with optional auth)
 */
router.get('/status',
  optionalAuth,
  authController.checkAuthStatus
);

// ========================================
// PROTECTED ROUTES (Authentication Required)
// ========================================

/**
 * @route   POST /api/auth/logout
 * @desc    Logout current session
 * @access  Private
 */
router.post('/logout',
  requireAuth,
  authController.logout
);

/**
 * @route   POST /api/auth/logout-all
 * @desc    Logout from all devices
 * @access  Private
 * @rateLimit 5 requests per hour per user
 */
router.post('/logout-all',
  requireAuth,
  createRateLimit(60 * 60 * 1000, 5, 'Too many logout requests'),
  authController.logoutAll
);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me',
  requireAuth,
  authController.getCurrentUser
);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 * @rateLimit 10 requests per hour per user
 */
router.put('/profile',
  requireAuth,
  createRateLimit(60 * 60 * 1000, 10, 'Too many profile update requests'),
  [
    body('firstName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters'),
    
    body('lastName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Last name must be between 2 and 50 characters'),
    
    body('username')
      .optional()
      .trim()
      .isLength({ min: 3, max: 30 })
      .withMessage('Username must be between 3 and 30 characters')
  ],
  authController.updateProfile || ((req, res) => {
    res.status(501).json({
      success: false,
      message: 'Profile update not implemented yet'
    });
  })
);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 * @rateLimit 3 requests per hour per user
 */
router.post('/change-password',
  requireAuth,
  requireCompleteProfile,
  createRateLimit(60 * 60 * 1000, 3, 'Too many password change requests'),
  [
    body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),
    
    body('newPassword')
      .isLength({ min: 8, max: 128 })
      .withMessage('Password must be between 8 and 128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    
    body('confirmPassword')
      .custom((value, { req }) => {
        if (value !== req.body.newPassword) {
          throw new Error('Password confirmation does not match password');
        }
        return true;
      })
  ],
  authController.changePassword || ((req, res) => {
    res.status(501).json({
      success: false,
      message: 'Password change not implemented yet'
    });
  })
);

/**
 * @route   POST /api/auth/connect-wallet
 * @desc    Connect wallet to existing account
 * @access  Private
 * @rateLimit 5 requests per hour per user
 */
router.post('/connect-wallet',
  requireAuth,
  createRateLimit(60 * 60 * 1000, 5, 'Too many wallet connection requests'),
  walletAuthValidation,
  authController.connectWallet || ((req, res) => {
    res.status(501).json({
      success: false,
      message: 'Wallet connection not implemented yet'
    });
  })
);

/**
 * @route   DELETE /api/auth/disconnect-wallet
 * @desc    Disconnect wallet from account
 * @access  Private
 * @rateLimit 5 requests per hour per user
 */
router.delete('/disconnect-wallet',
  requireAuth,
  createRateLimit(60 * 60 * 1000, 5, 'Too many wallet disconnection requests'),
  authController.disconnectWallet || ((req, res) => {
    res.status(501).json({
      success: false,
      message: 'Wallet disconnection not implemented yet'
    });
  })
);

// ========================================
// ADMIN ROUTES (Admin Role Required)
// ========================================

/**
 * @route   GET /api/auth/users
 * @desc    Get all users (admin only)
 * @access  Private (Admin)
 * @rateLimit 100 requests per hour per admin
 */
router.get('/users',
  requireAuth,
  requireRole('admin'),
  createRateLimit(60 * 60 * 1000, 100, 'Too many admin requests'),
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    
    query('search')
      .optional()
      .isLength({ max: 100 })
      .withMessage('Search query too long'),
    
    query('status')
      .optional()
      .isIn(['active', 'suspended', 'deleted'])
      .withMessage('Invalid status filter')
  ],
  authController.getAllUsers || ((req, res) => {
    res.status(501).json({
      success: false,
      message: 'User management not implemented yet'
    });
  })
);

/**
 * @route   PUT /api/auth/users/:userId/status
 * @desc    Update user status (admin only)
 * @access  Private (Admin)
 * @rateLimit 50 requests per hour per admin
 */
router.put('/users/:userId/status',
  requireAuth,
  requireRole('admin'),
  createRateLimit(60 * 60 * 1000, 50, 'Too many admin status updates'),
  [
    param('userId')
      .isMongoId()
      .withMessage('Invalid user ID'),
    
    body('status')
      .isIn(['active', 'suspended', 'deleted'])
      .withMessage('Status must be active, suspended, or deleted'),
    
    body('reason')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Reason must be less than 500 characters')
  ],
  authController.updateUserStatus || ((req, res) => {
    res.status(501).json({
      success: false,
      message: 'User status management not implemented yet'
    });
  })
);

// ========================================
// ERROR HANDLING
// ========================================

// Auth-specific error handling middleware
router.use(handleAuthError);

// Route not found handler
router.use('*', (req, res) => {
  logger.warn('Auth route not found', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });
  
  res.status(404).json({
    success: false,
    message: 'Authentication endpoint not found'
  });
});

module.exports = router;
