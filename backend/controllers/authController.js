const { validationResult, body, param } = require('express-validator');
const authService = require('../services/authService');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

class AuthController {
  /**
   * User registration endpoint
   * POST /api/auth/register
   */
  register = [
    // Validation middleware
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    body('firstName')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('First name can only contain letters and spaces'),
    body('lastName')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Last name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Last name can only contain letters and spaces'),
    body('walletAddress')
      .optional()
      .isLength({ min: 32, max: 44 })
      .withMessage('Invalid Solana wallet address format'),

    catchAsync(async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      // Apply rate limiting
      authService.registerLimiter(req, res, async () => {
        try {
          const result = await authService.register(req.body);

          // Set httpOnly cookie for refresh token
          this.setRefreshTokenCookie(res, result.refreshToken);

          logger.info('User registration successful', {
            userId: result.user._id,
            email: result.user.email,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });

          res.status(201).json({
            success: true,
            message: result.message,
            data: {
              user: result.user,
              accessToken: result.accessToken
            }
          });
        } catch (error) {
          logger.error('Registration failed', {
            email: req.body.email,
            error: error.message,
            ip: req.ip
          });
          throw error;
        }
      });
    })
  ];

  /**
   * User login endpoint
   * POST /api/auth/login
   */
  login = [
    // Validation middleware
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .notEmpty()
      .withMessage('Password is required'),

    catchAsync(async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      // Apply rate limiting
      authService.loginLimiter(req, res, async () => {
        try {
          const { email, password } = req.body;
          const result = await authService.login(email, password);

          // Set httpOnly cookie for refresh token
          this.setRefreshTokenCookie(res, result.refreshToken);

          logger.info('User login successful', {
            userId: result.user._id,
            email: result.user.email,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });

          res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
              user: result.user,
              accessToken: result.accessToken
            }
          });
        } catch (error) {
          logger.error('Login failed', {
            email: req.body.email,
            error: error.message,
            ip: req.ip
          });
          throw error;
        }
      });
    })
  ];

  /**
   * Solana wallet authentication endpoint
   * POST /api/auth/wallet-auth
   */
  walletAuth = [
    // Validation middleware
    body('walletAddress')
      .isLength({ min: 32, max: 44 })
      .withMessage('Invalid Solana wallet address format'),
    body('signature')
      .isLength({ min: 64 })
      .withMessage('Invalid signature format'),
    body('message')
      .isLength({ min: 10 })
      .withMessage('Message is required for signature verification'),

    catchAsync(async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      try {
        const { walletAddress, signature, message } = req.body;
        const result = await authService.authenticateWallet(walletAddress, signature, message);

        // Set httpOnly cookie for refresh token
        this.setRefreshTokenCookie(res, result.refreshToken);

        logger.info('Wallet authentication successful', {
          userId: result.user._id,
          walletAddress,
          isNewUser: result.isNewUser,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        res.status(200).json({
          success: true,
          message: result.isNewUser ? 'Wallet connected and account created' : 'Wallet authentication successful',
          data: {
            user: result.user,
            accessToken: result.accessToken,
            isNewUser: result.isNewUser
          }
        });
      } catch (error) {
        logger.error('Wallet authentication failed', {
          walletAddress: req.body.walletAddress,
          error: error.message,
          ip: req.ip
        });
        throw error;
      }
    })
  ];

  /**
   * Token refresh endpoint
   * POST /api/auth/refresh
   */
  refresh = catchAsync(async (req, res) => {
    try {
      // Get refresh token from httpOnly cookie or request body
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token not provided'
        });
      }

      const result = await authService.refreshToken(refreshToken);

      // Set new httpOnly cookie for refresh token
      this.setRefreshTokenCookie(res, result.refreshToken);

      logger.info('Token refresh successful', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: result.accessToken
        }
      });
    } catch (error) {
      // Clear invalid refresh token cookie
      this.clearRefreshTokenCookie(res);
      
      logger.error('Token refresh failed', {
        error: error.message,
        ip: req.ip
      });
      throw error;
    }
  });

  /**
   * User logout endpoint
   * POST /api/auth/logout
   */
  logout = catchAsync(async (req, res) => {
    try {
      const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
      const userId = req.user?.id; // From auth middleware

      if (refreshToken && userId) {
        await authService.logout(refreshToken, userId);
      }

      // Clear refresh token cookie
      this.clearRefreshTokenCookie(res);

      logger.info('User logout successful', {
        userId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      // Still clear the cookie even if logout fails
      this.clearRefreshTokenCookie(res);
      
      logger.error('Logout failed', {
        userId: req.user?.id,
        error: error.message,
        ip: req.ip
      });
      
      // Don't throw error for logout - always succeed from client perspective
      res.status(200).json({
        success: true,
        message: 'Logout completed'
      });
    }
  });

  /**
   * Get current user endpoint (protected)
   * GET /api/auth/me
   */
  getCurrentUser = catchAsync(async (req, res) => {
    try {
      // User is attached by auth middleware
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated'
        });
      }

      res.status(200).json({
        success: true,
        message: 'User retrieved successfully',
        data: {
          user: authService.sanitizeUser(user)
        }
      });
    } catch (error) {
      logger.error('Get current user failed', {
        userId: req.user?.id,
        error: error.message
      });
      throw error;
    }
  });

  /**
   * Email verification endpoint
   * GET /api/auth/verify-email/:token
   */
  verifyEmail = [
    // Validation middleware
    param('token')
      .isLength({ min: 32, max: 128 })
      .withMessage('Invalid verification token format'),

    catchAsync(async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid verification token',
          errors: errors.array()
        });
      }

      try {
        const { token } = req.params;
        const result = await authService.verifyEmail(token);

        logger.info('Email verification successful', {
          token: token.substring(0, 8) + '...',
          ip: req.ip
        });

        res.status(200).json({
          success: true,
          message: result.message
        });
      } catch (error) {
        logger.error('Email verification failed', {
          token: req.params.token?.substring(0, 8) + '...',
          error: error.message,
          ip: req.ip
        });
        throw error;
      }
    })
  ];

  /**
   * Password reset request endpoint
   * POST /api/auth/request-reset
   */
  requestPasswordReset = [
    // Validation middleware
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),

    catchAsync(async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      // Apply rate limiting
      authService.passwordResetLimiter(req, res, async () => {
        try {
          const { email } = req.body;
          const result = await authService.requestPasswordReset(email);

          logger.info('Password reset requested', {
            email,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });

          res.status(200).json({
            success: true,
            message: result.message
          });
        } catch (error) {
          logger.error('Password reset request failed', {
            email: req.body.email,
            error: error.message,
            ip: req.ip
          });
          throw error;
        }
      });
    })
  ];

  /**
   * Password reset completion endpoint
   * POST /api/auth/reset-password/:token
   */
  resetPassword = [
    // Validation middleware
    param('token')
      .isLength({ min: 32, max: 128 })
      .withMessage('Invalid reset token format'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    body('confirmPassword')
      .custom((value, { req }) => {
        if (value !== req.body.newPassword) {
          throw new Error('Password confirmation does not match password');
        }
        return true;
      }),

    catchAsync(async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      try {
        const { token } = req.params;
        const { newPassword } = req.body;
        
        const result = await authService.resetPassword(token, newPassword);

        logger.info('Password reset successful', {
          token: token.substring(0, 8) + '...',
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        res.status(200).json({
          success: true,
          message: result.message
        });
      } catch (error) {
        logger.error('Password reset failed', {
          token: req.params.token?.substring(0, 8) + '...',
          error: error.message,
          ip: req.ip
        });
        throw error;
      }
    })
  ];

  /**
   * Logout from all devices endpoint
   * POST /api/auth/logout-all
   */
  logoutAll = catchAsync(async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated'
        });
      }

      await authService.logoutAll(userId);

      // Clear refresh token cookie
      this.clearRefreshTokenCookie(res);

      logger.info('User logged out from all devices', {
        userId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(200).json({
        success: true,
        message: 'Logged out from all devices successfully'
      });
    } catch (error) {
      // Still clear the cookie even if logout fails
      this.clearRefreshTokenCookie(res);
      
      logger.error('Logout all failed', {
        userId: req.user?.id,
        error: error.message,
        ip: req.ip
      });
      
      // Don't throw error for logout - always succeed from client perspective
      res.status(200).json({
        success: true,
        message: 'Logout completed'
      });
    }
  });

  /**
   * Resend email verification endpoint
   * POST /api/auth/resend-verification
   */
  resendVerification = [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),

    catchAsync(async (req, res) => {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      try {
        const { email } = req.body;
        
        // This would need to be implemented in authService
        // For now, return a standard response
        logger.info('Verification email resend requested', {
          email,
          ip: req.ip
        });

        res.status(200).json({
          success: true,
          message: 'If an unverified account with that email exists, a new verification email has been sent.'
        });
      } catch (error) {
        logger.error('Resend verification failed', {
          email: req.body.email,
          error: error.message,
          ip: req.ip
        });
        throw error;
      }
    })
  ];

  /**
   * Set httpOnly cookie for refresh token
   * @param {Object} res - Express response object
   * @param {string} refreshToken - Refresh token to set
   */
  setRefreshTokenCookie(res, refreshToken) {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    };

    res.cookie('refreshToken', refreshToken, cookieOptions);
  }

  /**
   * Clear refresh token cookie
   * @param {Object} res - Express response object
   */
  clearRefreshTokenCookie(res) {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/'
    };

    res.clearCookie('refreshToken', cookieOptions);
  }

  /**
   * Check authentication status endpoint
   * GET /api/auth/status
   */
  checkAuthStatus = catchAsync(async (req, res) => {
    try {
      const accessToken = req.headers.authorization?.replace('Bearer ', '');
      const refreshToken = req.cookies.refreshToken;

      res.status(200).json({
        success: true,
        data: {
          isAuthenticated: !!req.user,
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
          user: req.user ? authService.sanitizeUser(req.user) : null
        }
      });
    } catch (error) {
      logger.error('Auth status check failed', {
        error: error.message,
        ip: req.ip
      });
      
      res.status(200).json({
        success: true,
        data: {
          isAuthenticated: false,
          hasAccessToken: false,
          hasRefreshToken: false,
          user: null
        }
      });
    }
  });
}

// Error handling middleware specifically for auth routes
const handleAuthError = (err, req, res, next) => {
  logger.error('Auth controller error', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(err.errors).map(e => ({
        field: e.path,
        message: e.message
      }))
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  if (err.name === 'MongoError' && err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'User already exists'
    });
  }

  // Handle custom AppError
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : err.message
  });
};

module.exports = {
  authController: new AuthController(),
  handleAuthError
};
