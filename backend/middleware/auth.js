const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

class AuthMiddleware {
  constructor() {
    // Rate limiting for failed authentication attempts
    this.authFailureLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 failed auth attempts per window
      message: 'Too many authentication failures, please try again later',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true, // Only count failed attempts
      handler: (req, res) => {
        logger.warn('Authentication rate limit exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          endpoint: req.originalUrl
        });
        throw new AppError('Too many authentication failures, please try again later', 429);
      }
    });

    // Cache for user objects to reduce database queries
    this.userCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Extract JWT token from request headers
   * @param {Object} req - Express request object
   * @returns {string|null} - JWT token or null if not found
   */
  extractToken(req) {
    const authHeader = req.headers.authorization;
    
    // Check Authorization header with Bearer format
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Fallback to custom header (for API clients)
    if (req.headers['x-auth-token']) {
      return req.headers['x-auth-token'];
    }

    // Fallback to query parameter (use sparingly, less secure)
    if (req.query.token) {
      logger.warn('Token provided via query parameter', {
        ip: req.ip,
        endpoint: req.originalUrl
      });
      return req.query.token;
    }

    return null;
  }

  /**
   * Verify JWT token and return decoded payload
   * @param {string} token - JWT token to verify
   * @returns {Object} - Decoded token payload
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new AppError('Token has expired', 401);
      } else if (error.name === 'JsonWebTokenError') {
        throw new AppError('Invalid token', 401);
      } else if (error.name === 'NotBeforeError') {
        throw new AppError('Token not active', 401);
      } else {
        throw new AppError('Token verification failed', 401);
      }
    }
  }

  /**
   * Get user from cache or database
   * @param {string} userId - User ID
   * @returns {Object} - User object
   */
  async getUser(userId) {
    // Check cache first
    const cacheKey = `user_${userId}`;
    const cachedUser = this.userCache.get(cacheKey);
    
    if (cachedUser && Date.now() - cachedUser.timestamp < this.cacheTimeout) {
      return cachedUser.user;
    }

    // Fetch from database
    const user = await User.findById(userId).select('-password -refreshTokens');
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Cache the user
    this.userCache.set(cacheKey, {
      user,
      timestamp: Date.now()
    });

    // Clean up old cache entries periodically
    if (this.userCache.size > 1000) {
      this.cleanCache();
    }

    return user;
  }

  /**
   * Clean up expired cache entries
   */
  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.userCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.userCache.delete(key);
      }
    }
  }

  /**
   * Clear user from cache (useful when user data changes)
   * @param {string} userId - User ID to clear from cache
   */
  clearUserCache(userId) {
    this.userCache.delete(`user_${userId}`);
  }

  /**
   * Required authentication middleware
   * Requires valid JWT token and active user
   */
  requireAuth = catchAsync(async (req, res, next) => {
    try {
      // Extract token
      const token = this.extractToken(req);
      
      if (!token) {
        throw new AppError('Access token is required', 401);
      }

      // Verify token
      const decoded = this.verifyToken(token);

      // Get user
      const user = await this.getUser(decoded.userId);

      // Check if user account is active
      if (user.status === 'suspended') {
        throw new AppError('Account is suspended', 403);
      }

      if (user.status === 'deleted') {
        throw new AppError('Account no longer exists', 404);
      }

      // Check if user's email is verified for sensitive operations
      if (user.requireEmailVerification && !user.isEmailVerified) {
        throw new AppError('Email verification required', 403);
      }

      // Attach user to request
      req.user = user;
      req.tokenPayload = decoded;

      logger.debug('Authentication successful', {
        userId: user._id,
        email: user.email,
        endpoint: req.originalUrl
      });

      next();
    } catch (error) {
      // Apply rate limiting for failed attempts
      this.authFailureLimiter(req, res, () => {
        logger.warn('Authentication failed', {
          error: error.message,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          endpoint: req.originalUrl,
          hasToken: !!this.extractToken(req)
        });
        throw error;
      });
    }
  });

  /**
   * Optional authentication middleware
   * Attaches user if token is valid, but doesn't require authentication
   */
  optionalAuth = catchAsync(async (req, res, next) => {
    try {
      const token = this.extractToken(req);
      
      if (!token) {
        // No token provided, continue without authentication
        req.user = null;
        return next();
      }

      // Verify token
      const decoded = this.verifyToken(token);

      // Get user
      const user = await this.getUser(decoded.userId);

      // Attach user even if account has issues (for partial access)
      req.user = user;
      req.tokenPayload = decoded;

      logger.debug('Optional authentication successful', {
        userId: user._id,
        endpoint: req.originalUrl
      });

      next();
    } catch (error) {
      // For optional auth, log but continue without user
      logger.debug('Optional authentication failed', {
        error: error.message,
        ip: req.ip,
        endpoint: req.originalUrl
      });
      
      req.user = null;
      req.tokenPayload = null;
      next();
    }
  });

  /**
   * Role-based access control middleware factory
   * @param {...string} allowedRoles - Roles that are allowed access
   * @returns {Function} - Express middleware function
   */
  requireRole = (...allowedRoles) => {
    return catchAsync(async (req, res, next) => {
      // Ensure user is authenticated first
      if (!req.user) {
        throw new AppError('Authentication required', 401);
      }

      const userRole = req.user.role || 'user';
      
      // Check if user has required role
      if (!allowedRoles.includes(userRole)) {
        logger.warn('Insufficient permissions', {
          userId: req.user._id,
          userRole,
          requiredRoles: allowedRoles,
          endpoint: req.originalUrl
        });
        throw new AppError('Insufficient permissions', 403);
      }

      logger.debug('Role authorization successful', {
        userId: req.user._id,
        userRole,
        endpoint: req.originalUrl
      });

      next();
    });
  };

  /**
   * Permission-based access control middleware factory
   * @param {...string} requiredPermissions - Permissions that are required
   * @returns {Function} - Express middleware function
   */
  requirePermission = (...requiredPermissions) => {
    return catchAsync(async (req, res, next) => {
      // Ensure user is authenticated first
      if (!req.user) {
        throw new AppError('Authentication required', 401);
      }

      const userPermissions = req.user.permissions || [];
      
      // Check if user has all required permissions
      const hasAllPermissions = requiredPermissions.every(permission => 
        userPermissions.includes(permission)
      );

      if (!hasAllPermissions) {
        logger.warn('Insufficient permissions', {
          userId: req.user._id,
          userPermissions,
          requiredPermissions,
          endpoint: req.originalUrl
        });
        throw new AppError('Insufficient permissions', 403);
      }

      logger.debug('Permission authorization successful', {
        userId: req.user._id,
        requiredPermissions,
        endpoint: req.originalUrl
      });

      next();
    });
  };

  /**
   * Resource ownership middleware
   * Checks if the authenticated user owns the requested resource
   * @param {string} resourceIdParam - Parameter name containing resource ID
   * @param {string} ownerField - Field name in resource that contains owner ID
   * @param {Function} resourceGetter - Function to get resource by ID
   * @returns {Function} - Express middleware function
   */
  requireOwnership = (resourceIdParam, ownerField = 'userId', resourceGetter) => {
    return catchAsync(async (req, res, next) => {
      // Ensure user is authenticated first
      if (!req.user) {
        throw new AppError('Authentication required', 401);
      }

      const resourceId = req.params[resourceIdParam];
      if (!resourceId) {
        throw new AppError('Resource ID is required', 400);
      }

      // Get resource
      const resource = await resourceGetter(resourceId);
      if (!resource) {
        throw new AppError('Resource not found', 404);
      }

      // Check ownership
      const resourceOwnerId = resource[ownerField]?.toString();
      const userId = req.user._id.toString();

      if (resourceOwnerId !== userId) {
        // Allow admins to bypass ownership check
        if (req.user.role !== 'admin') {
          logger.warn('Resource access denied - not owner', {
            userId,
            resourceId,
            resourceOwnerId,
            endpoint: req.originalUrl
          });
          throw new AppError('Access denied - not resource owner', 403);
        }
      }

      // Attach resource to request for use in controller
      req.resource = resource;

      logger.debug('Ownership check successful', {
        userId,
        resourceId,
        endpoint: req.originalUrl
      });

      next();
    });
  };

  /**
   * API key authentication middleware
   * For server-to-server communication
   */
  requireApiKey = catchAsync(async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      throw new AppError('API key is required', 401);
    }

    // Verify API key (you might want to store these in database)
    const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];
    
    if (!validApiKeys.includes(apiKey)) {
      logger.warn('Invalid API key attempted', {
        apiKey: apiKey.substring(0, 8) + '...',
        ip: req.ip,
        endpoint: req.originalUrl
      });
      throw new AppError('Invalid API key', 401);
    }

    logger.info('API key authentication successful', {
      apiKey: apiKey.substring(0, 8) + '...',
      ip: req.ip,
      endpoint: req.originalUrl
    });

    req.isApiRequest = true;
    next();
  });

  /**
   * Wallet ownership verification middleware
   * Ensures the authenticated user owns the specified wallet address
   */
  requireWalletOwnership = catchAsync(async (req, res, next) => {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    const walletAddress = req.params.walletAddress || req.body.walletAddress;
    
    if (!walletAddress) {
      throw new AppError('Wallet address is required', 400);
    }

    if (!req.user.wallet || req.user.wallet.address !== walletAddress) {
      logger.warn('Wallet ownership verification failed', {
        userId: req.user._id,
        requestedWallet: walletAddress,
        userWallet: req.user.wallet?.address,
        endpoint: req.originalUrl
      });
      throw new AppError('Wallet address does not belong to authenticated user', 403);
    }

    logger.debug('Wallet ownership verified', {
      userId: req.user._id,
      walletAddress,
      endpoint: req.originalUrl
    });

    next();
  });

  /**
   * Rate limiting middleware for sensitive operations
   * @param {number} windowMs - Time window in milliseconds
   * @param {number} max - Maximum requests per window
   * @param {string} message - Error message
   * @returns {Function} - Express middleware function
   */
  createRateLimit = (windowMs = 15 * 60 * 1000, max = 5, message = 'Too many requests') => {
    return rateLimit({
      windowMs,
      max,
      message,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          userId: req.user?.id,
          endpoint: req.originalUrl,
          limit: max,
          window: windowMs
        });
        throw new AppError(message, 429);
      }
    });
  };

  /**
   * Middleware to check if user account is fully set up
   */
  requireCompleteProfile = catchAsync(async (req, res, next) => {
    if (!req.user) {
      throw new AppError('Authentication required', 401);
    }

    // Check if profile is complete
    const requiredFields = ['firstName', 'lastName', 'email'];
    const missingFields = requiredFields.filter(field => !req.user[field]);

    if (missingFields.length > 0) {
      throw new AppError(`Profile incomplete. Missing: ${missingFields.join(', ')}`, 400);
    }

    if (!req.user.isEmailVerified) {
      throw new AppError('Email verification required', 403);
    }

    next();
  });

  /**
   * Development-only middleware to bypass authentication
   * WARNING: Only use in development environment
   */
  devBypass = (req, res, next) => {
    if (process.env.NODE_ENV !== 'development') {
      throw new AppError('Development bypass not allowed in production', 403);
    }

    logger.warn('Development authentication bypass used', {
      ip: req.ip,
      endpoint: req.originalUrl
    });

    // Create a mock user for development
    req.user = {
      _id: 'dev-user-id',
      email: 'dev@example.com',
      role: 'admin',
      permissions: ['*'],
      isEmailVerified: true
    };

    next();
  };
}

// Create singleton instance
const authMiddleware = new AuthMiddleware();

// Export individual middleware functions
module.exports = {
  // Authentication
  requireAuth: authMiddleware.requireAuth,
  optionalAuth: authMiddleware.optionalAuth,
  requireApiKey: authMiddleware.requireApiKey,
  
  // Authorization
  requireRole: authMiddleware.requireRole,
  requirePermission: authMiddleware.requirePermission,
  requireOwnership: authMiddleware.requireOwnership,
  requireWalletOwnership: authMiddleware.requireWalletOwnership,
  requireCompleteProfile: authMiddleware.requireCompleteProfile,
  
  // Rate limiting
  createRateLimit: authMiddleware.createRateLimit,
  authFailureLimiter: authMiddleware.authFailureLimiter,
  
  // Utilities
  extractToken: authMiddleware.extractToken.bind(authMiddleware),
  verifyToken: authMiddleware.verifyToken.bind(authMiddleware),
  clearUserCache: authMiddleware.clearUserCache.bind(authMiddleware),
  
  // Development
  devBypass: authMiddleware.devBypass,
  
  // Access to the instance for advanced usage
  authMiddleware
};
