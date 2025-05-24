const express = require('express');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import route modules
const authRoutes = require('./auth');
const userRoutes = require('./users');
const eventRoutes = require('./events');
const ticketRoutes = require('./tickets');
const contentRoutes = require('./content');
const marketplaceRoutes = require('./marketplace');

// Import middleware
const { optionalAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const router = express.Router();

// ========================================
// GLOBAL MIDDLEWARE
// ========================================

// Security headers
router.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// Compression middleware
router.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024 // Only compress responses larger than 1KB
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://localhost:3000',
      'https://localhost:3001'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      logger.warn('CORS origin blocked', { origin, allowedOrigins });
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Auth-Token',
    'X-API-Key',
    'X-Request-ID',
    'X-Forwarded-For'
  ],
  exposedHeaders: [
    'X-Request-ID',
    'X-Total-Count',
    'X-Page-Count',
    'X-Rate-Limit-Limit',
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Reset'
  ],
  maxAge: 86400 // 24 hours
};

router.use(cors(corsOptions));

// ========================================
// REQUEST TRACING MIDDLEWARE
// ========================================

/**
 * Generate unique request ID for tracing
 */
const requestIdMiddleware = (req, res, next) => {
  // Use existing request ID if provided, otherwise generate new one
  const requestId = req.headers['x-request-id'] || uuidv4();
  
  // Attach to request and response
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  // Add to response locals for use in templates/logging
  res.locals.requestId = requestId;
  
  next();
};

router.use(requestIdMiddleware);

// ========================================
// LOGGING MIDDLEWARE
// ========================================

/**
 * Custom Morgan token for request ID
 */
morgan.token('request-id', (req) => req.requestId);

/**
 * Custom Morgan token for user ID
 */
morgan.token('user-id', (req) => req.user?.id || 'anonymous');

/**
 * Custom Morgan token for response time in different units
 */
morgan.token('response-time-ms', (req, res) => {
  if (!req._startAt || !res._startAt) {
    return '-';
  }
  
  const ms = (res._startAt[0] - req._startAt[0]) * 1000 +
             (res._startAt[1] - req._startAt[1]) * 1e-6;
  return ms.toFixed(3);
});

/**
 * Custom Morgan format for API logging
 */
const apiLogFormat = process.env.NODE_ENV === 'production'
  ? ':remote-addr - :user-id [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time-ms ms :request-id'
  : ':method :url :status :response-time-ms ms - :res[content-length] bytes :request-id :user-id';

/**
 * API call logging middleware
 */
const apiLogger = morgan(apiLogFormat, {
  stream: {
    write: (message) => {
      // Parse the log message and extract relevant info
      const logData = message.trim();
      
      // Determine log level based on status code
      let level = 'info';
      if (logData.includes(' 4')) level = 'warn';
      if (logData.includes(' 5')) level = 'error';
      
      logger[level]('API Request', { message: logData });
    }
  },
  skip: (req, res) => {
    // Skip logging for health checks and static assets
    return req.url === '/health' || 
           req.url === '/api/health' ||
           req.url.startsWith('/static/') ||
           req.url.endsWith('.ico');
  }
});

router.use(apiLogger);

// ========================================
// REQUEST METRICS MIDDLEWARE
// ========================================

/**
 * Request metrics and timing middleware
 */
const metricsMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Override res.end to capture metrics
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - startTime;
    
    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow API request detected', {
        method: req.method,
        url: req.originalUrl,
        duration: `${duration}ms`,
        requestId: req.requestId,
        userId: req.user?.id,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    }
    
    // Add timing header
    res.setHeader('X-Response-Time', `${duration}ms`);
    
    // Log API usage metrics
    logger.info('API Metrics', {
      method: req.method,
      endpoint: req.route?.path || req.url,
      statusCode: res.statusCode,
      duration,
      requestId: req.requestId,
      userId: req.user?.id,
      contentLength: res.get('content-length') || 0
    });
    
    originalEnd.apply(this, args);
  };
  
  next();
};

router.use(metricsMiddleware);

// ========================================
// GLOBAL RATE LIMITING
// ========================================

/**
 * Global API rate limiting
 */
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Different limits based on authentication status
    if (req.user) {
      // Authenticated users get higher limits
      return req.user.role === 'admin' ? 1000 : 500;
    }
    // Unauthenticated users get lower limits
    return 100;
  },
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Global rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      requestId: req.requestId,
      userId: req.user?.id
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
      retryAfter: '15 minutes',
      requestId: req.requestId
    });
  }
});

// Apply optional auth before rate limiting to get user context
router.use(optionalAuth);
router.use(globalRateLimit);

// ========================================
// API HEALTH CHECK
// ========================================

/**
 * API health check endpoint
 */
router.get('/health', (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    version: process.env.API_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid
    }
  };
  
  res.status(200).json(healthData);
});

// ========================================
// API DOCUMENTATION ENDPOINT
// ========================================

/**
 * API documentation and endpoints listing
 */
router.get('/docs', (req, res) => {
  const apiDocs = {
    title: 'Event Platform API Documentation',
    version: process.env.API_VERSION || '1.0.0',
    description: 'RESTful API for event management, ticketing, and marketplace functionality',
    baseUrl: `${req.protocol}://${req.get('host')}/api/v1`,
    requestId: req.requestId,
    endpoints: {
      authentication: {
        base: '/auth',
        description: 'User authentication and account management',
        endpoints: [
          'POST /auth/register - User registration',
          'POST /auth/login - User login',
          'POST /auth/wallet-auth - Wallet authentication',
          'POST /auth/refresh - Token refresh',
          'POST /auth/logout - User logout',
          'GET /auth/me - Get current user',
          'GET /auth/verify-email/:token - Email verification',
          'POST /auth/request-reset - Request password reset',
          'POST /auth/reset-password/:token - Reset password'
        ]
      },
      users: {
        base: '/users',
        description: 'User profile and account management',
        endpoints: [
          'GET /users/profile - Get user profile',
          'PUT /users/profile - Update user profile',
          'GET /users/:id - Get user by ID',
          'DELETE /users/account - Delete user account'
        ]
      },
      events: {
        base: '/events',
        description: 'Event creation and management',
        endpoints: [
          'GET /events - List events',
          'POST /events - Create event',
          'GET /events/:id - Get event details',
          'PUT /events/:id - Update event',
          'DELETE /events/:id - Delete event'
        ]
      },
      tickets: {
        base: '/tickets',
        description: 'Ticket management and booking',
        endpoints: [
          'GET /tickets - List user tickets',
          'POST /tickets/purchase - Purchase tickets',
          'GET /tickets/:id - Get ticket details',
          'PUT /tickets/:id/transfer - Transfer ticket'
        ]
      },
      content: {
        base: '/content',
        description: 'Content management system',
        endpoints: [
          'GET /content/posts - List content posts',
          'POST /content/posts - Create content post',
          'GET /content/posts/:id - Get post details',
          'PUT /content/posts/:id - Update post'
        ]
      },
      marketplace: {
        base: '/marketplace',
        description: 'NFT and digital asset marketplace',
        endpoints: [
          'GET /marketplace/items - List marketplace items',
          'POST /marketplace/items - Create marketplace item',
          'GET /marketplace/items/:id - Get item details',
          'POST /marketplace/items/:id/purchase - Purchase item'
        ]
      }
    },
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer <token>',
      alternativeHeaders: [
        'X-Auth-Token: <token>',
        'X-API-Key: <api-key>'
      ]
    },
    rateLimit: {
      global: '100 requests per 15 minutes (unauthenticated)',
      authenticated: '500 requests per 15 minutes',
      admin: '1000 requests per 15 minutes'
    },
    responseFormat: {
      success: {
        success: true,
        message: 'Operation successful',
        data: '{ ... }',
        requestId: 'uuid-v4'
      },
      error: {
        success: false,
        message: 'Error description',
        errors: '[ ... ]',
        requestId: 'uuid-v4'
      }
    }
  };
  
  res.status(200).json(apiDocs);
});

// ========================================
// API VERSION 1 ROUTES
// ========================================

/**
 * Mount all route modules under /api/v1 prefix
 */
const v1Router = express.Router();

// Authentication routes
v1Router.use('/auth', authRoutes);

// User management routes
v1Router.use('/users', userRoutes);

// Event management routes
v1Router.use('/events', eventRoutes);

// Ticket management routes
v1Router.use('/tickets', ticketRoutes);

// Content management routes
v1Router.use('/content', contentRoutes);

// Marketplace routes
v1Router.use('/marketplace', marketplaceRoutes);

// Mount v1 router
router.use('/v1', v1Router);

// ========================================
// API VERSION MANAGEMENT
// ========================================

/**
 * Default to latest version (v1) for /api routes
 */
router.use('/', v1Router);

/**
 * API version information endpoint
 */
router.get('/version', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      currentVersion: 'v1',
      supportedVersions: ['v1'],
      latestVersion: 'v1',
      deprecatedVersions: [],
      versionInfo: {
        v1: {
          status: 'current',
          releaseDate: '2024-01-01',
          deprecationDate: null,
          endOfLifeDate: null,
          features: [
            'Authentication & Authorization',
            'Event Management',
            'Ticket Booking',
            'Content Management',
            'NFT Marketplace',
            'Wallet Integration'
          ]
        }
      }
    },
    requestId: req.requestId
  });
});

// ========================================
// ERROR HANDLING
// ========================================

/**
 * Route not found handler
 */
router.use('*', (req, res) => {
  logger.warn('API endpoint not found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.requestId,
    userId: req.user?.id
  });
  
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    suggestion: 'Check the API documentation at /api/docs for available endpoints',
    requestId: req.requestId
  });
});

/**
 * Global error handler for API routes
 */
router.use((err, req, res, next) => {
  // Add request ID to error
  err.requestId = req.requestId;
  
  logger.error('API Error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.requestId,
    userId: req.user?.id,
    body: process.env.NODE_ENV === 'development' ? req.body : undefined
  });
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(err.errors).map(e => ({
        field: e.path,
        message: e.message
      })),
      requestId: req.requestId
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
      requestId: req.requestId
    });
  }
  
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate field value',
      requestId: req.requestId
    });
  }
  
  // Handle custom AppError
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      requestId: req.requestId
    });
  }
  
  // Default server error
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    requestId: req.requestId
  });
});

module.exports = router;
