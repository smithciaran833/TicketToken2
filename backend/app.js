// ==========================================
// FILE: backend/app.js
// ==========================================
/**
 * TicketToken Backend Application
 * Production-ready Express application with comprehensive security,
 * monitoring, and error handling for Web3 ticketing platform
 * 
 * @module app
 * @requires express
 */

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const passport = require('passport');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const RedisRateLimitStore = require('rate-limit-redis');
const slowDown = require('express-slow-down');
const statusMonitor = require('express-status-monitor');
const swaggerUi = require('swagger-ui-express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

// Import configurations
const config = require('./config');
const logger = require('./utils/logger');
const AppError = require('./utils/AppError');
const { redis } = require('./config/redis');

// Import routes with correct filenames
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const eventRoutes = require('./routes/eventRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const contentRoutes = require('./routes/contentRoutes');
const marketplaceRoutes = require('./routes/marketplaceRoutes');
const venueRoutes = require('./routes/venueRoutes');
const artistRoutes = require('./routes/artistRoutes');
const promoterRoutes = require('./routes/promoterRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const verificationRoutes = require('./routes/verificationRoutes');

// Import middleware
const { validateApiKey } = require('./middleware/auth/apiKey');
const { verifyRequestSignature } = require('./middleware/security/requestSigning');
const { sanitizeInput } = require('./middleware/security/sanitization');
const { metricsMiddleware } = require('./middleware/monitoring/metrics');
const { tracingMiddleware } = require('./middleware/monitoring/tracing');
const { auditLogger } = require('./middleware/logging/audit');

// Initialize Express app
const app = express();

// Trust proxy for accurate IP addresses behind load balancer
app.set('trust proxy', config.server.trustProxy);

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

// Helmet for security headers with custom CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'https:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: !config.isDevelopment,
}));

// Compression middleware with threshold
app.use(compression({
  threshold: 1024, // Only compress responses > 1KB
  level: 6, // Balanced compression level
}));

// ==========================================
// BODY PARSING & COOKIES
// ==========================================

// JSON body parser with size limits
app.use(express.json({
  limit: config.server.maxRequestSize || '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// URL-encoded body parser
app.use(express.urlencoded({
  extended: true,
  limit: config.server.maxRequestSize || '10mb',
  parameterLimit: 10000,
}));

// Cookie parser with signing
app.use(cookieParser(config.security.cookieSecret));

// ==========================================
// SESSION MANAGEMENT
// ==========================================

// Session configuration with Redis store
const sessionConfig = {
  store: new RedisStore({ client: redis }),
  secret: config.security.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: config.isProduction,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    sameSite: config.isProduction ? 'strict' : 'lax',
  },
  name: 'tickettoken.sid',
  genid: () => uuidv4(),
};

app.use(session(sessionConfig));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// ==========================================
// CORS CONFIGURATION
// ==========================================

// Dynamic CORS with whitelist
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin) return callback(null, true);
    
    if (config.cors.whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new AppError('Not allowed by CORS', 403, 'CORS_ERROR'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID', 'X-Signature'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// ==========================================
// REQUEST TRACKING & LOGGING
// ==========================================

// Request ID generation
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  req.startTime = Date.now();
  next();
});

// Morgan logging with custom tokens
morgan.token('request-id', (req) => req.id);
morgan.token('user-id', (req) => req.user?.id || 'anonymous');
morgan.token('response-time-ms', (req) => Date.now() - req.startTime);
morgan.token('real-ip', (req) => req.ip || req.connection.remoteAddress);

const morganFormat = config.isDevelopment
  ? 'dev'
  : ':real-ip - :user-id [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time-ms ms :request-id';

app.use(morgan(morganFormat, {
  stream: { write: (message) => logger.http(message.trim()) },
  skip: (req) => req.url === '/health' || req.url === '/metrics',
}));

// ==========================================
// RATE LIMITING & THROTTLING
// ==========================================

// General rate limiter with Redis store
const generalLimiter = rateLimit({
  store: new RedisRateLimitStore({
    client: redis,
    prefix: 'rl:general:',
  }),
  windowMs: 1 * 60 * 1000, // 1 minute
  max: config.rateLimit.general.max || 100,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path,
    });
    res.status(429).json({
      error: 'RATE_LIMIT_ERROR',
      message: 'Too many requests, please try again later',
      retryAfter: res.getHeader('Retry-After'),
    });
  },
});

// Strict rate limiter for auth endpoints
const authLimiter = rateLimit({
  store: new RedisRateLimitStore({
    client: redis,
    prefix: 'rl:auth:',
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit.auth.max || 5,
  skipSuccessfulRequests: true,
});

// Slow down middleware for gradual limiting
const speedLimiter = slowDown({
  store: new RedisRateLimitStore({
    client: redis,
    prefix: 'sd:general:',
  }),
  windowMs: 1 * 60 * 1000, // 1 minute
  delayAfter: 50,
  delayMs: 100,
  maxDelayMs: 2000,
});

// Apply rate limiters
app.use('/api/', generalLimiter);
app.use('/api/', speedLimiter);
app.use('/api/v1/auth/', authLimiter);

// ==========================================
// MONITORING & OBSERVABILITY
// ==========================================

// Status monitor (only in development)
if (config.isDevelopment) {
  app.use(statusMonitor({
    title: 'TicketToken API Status',
    path: '/status',
    spans: [
      { interval: 1, retention: 60 },
      { interval: 5, retention: 60 },
      { interval: 15, retention: 60 },
    ],
  }));
}

// Metrics middleware
app.use(metricsMiddleware);

// Distributed tracing
app.use(tracingMiddleware);

// Audit logging for sensitive operations
app.use(/\/(api\/v1\/(payments|users|admin))/, auditLogger);

// ==========================================
// API DOCUMENTATION
// ==========================================

// Swagger documentation
if (!config.isProduction || config.features.enableDocsInProduction) {
  const swaggerDocument = require('./docs/swagger.json');
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'TicketToken API Documentation',
  }));
}

// ==========================================
// HEALTH & READINESS ENDPOINTS
// ==========================================

// Deep health check
app.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.environment,
    version: config.version,
    checks: {},
  };

  try {
    // Database check
    const dbStart = Date.now();
    await require('./config/database').checkConnection();
    healthCheck.checks.database = {
      status: 'healthy',
      responseTime: Date.now() - dbStart,
    };

    // Redis check
    const redisStart = Date.now();
    await redis.ping();
    healthCheck.checks.redis = {
      status: 'healthy',
      responseTime: Date.now() - redisStart,
    };

    // Memory check
    const memUsage = process.memoryUsage();
    healthCheck.checks.memory = {
      status: memUsage.heapUsed < config.monitoring.maxMemory ? 'healthy' : 'unhealthy',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
    };

    res.json(healthCheck);
  } catch (error) {
    healthCheck.status = 'unhealthy';
    healthCheck.error = error.message;
    res.status(503).json(healthCheck);
  }
});

// Readiness probe
app.get('/ready', (req, res) => {
  // Check if app is ready to receive traffic
  if (app.locals.ready) {
    res.json({ ready: true });
  } else {
    res.status(503).json({ ready: false });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(require('./utils/metrics').register.metrics());
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    version: config.version,
    commit: config.git.commit,
    buildDate: config.buildDate,
    nodeVersion: process.version,
  });
});

// ==========================================
// API VERSIONING & SECURITY MIDDLEWARE
// ==========================================

// API key validation for public endpoints
app.use('/api/v1/public', validateApiKey);

// Request signature verification for sensitive operations
app.use('/api/v1/(payments|transfers|admin)', verifyRequestSignature);

// Input sanitization
app.use('/api/v1', sanitizeInput);

// ==========================================
// API ROUTES
// ==========================================

// Mount API routes with versioning
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/content', contentRoutes);
app.use('/api/v1/marketplace', marketplaceRoutes);
app.use('/api/v1/venues', venueRoutes);
app.use('/api/v1/artists', artistRoutes);
app.use('/api/v1/promoters', promoterRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/verification', verificationRoutes);

// ==========================================
// ERROR HANDLING
// ==========================================

// 404 handler
app.use((req, res, next) => {
  const error = new AppError(
    `Cannot ${req.method} ${req.originalUrl}`,
    404,
    'NOT_FOUND_ERROR',
    { method: req.method, path: req.originalUrl }
  );
  next(error);
});

// Global error handler
app.use((err, req, res, next) => {
  // Set default error properties
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log error
  logger.error('Request error', {
    error: err,
    request: {
      id: req.id,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userId: req.user?.id,
    },
  });

  // Send error tracking to Sentry/monitoring service
  if (config.monitoring.errorTracking.enabled && !err.isOperational) {
    err.capture({ req, user: req.user });
  }

  // Prepare error response
  let error = { ...err };
  error.message = err.message;

  // Handle specific error types
  if (err.name === 'CastError') {
    error = new AppError('Invalid ID format', 400, 'VALIDATION_ERROR');
  } else if (err.code === 11000) {
    error = new AppError('Duplicate field value', 400, 'CONFLICT_ERROR');
  } else if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    error = new AppError('Validation failed', 400, 'VALIDATION_ERROR', { errors });
  } else if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401, 'AUTHENTICATION_ERROR');
  } else if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401, 'AUTHENTICATION_ERROR');
  }

  // Sanitize error for production
  if (config.isProduction) {
    // Don't leak error details in production
    if (!error.isOperational) {
      error.message = 'An unexpected error occurred';
      error.statusCode = 500;
    }
    delete error.stack;
    delete error.details;
  }

  res.status(error.statusCode).json({
    status: error.status,
    error: error.errorCode || 'INTERNAL_ERROR',
    message: error.message,
    ...(config.isDevelopment && { stack: err.stack, details: error.details }),
    requestId: req.id,
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// PROCESS ERROR HANDLERS
// ==========================================

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught Exception', { error });
  
  // Give time for logs to be written
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  
  // Convert to exception in production
  if (config.isProduction) {
    throw reason;
  }
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`);
  
  // Stop accepting new connections
  app.locals.ready = false;
  
  try {
    // Close database connections
    await require('./config/database').closeConnection();
    
    // Close Redis connections
    await redis.quit();
    
    // Close any open handles
    // Add more cleanup as needed
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Set app as ready after initialization
app.locals.ready = true;

module.exports = app;

// ==========================================
// FILE: backend/utils/AppError.js
// ==========================================
/**
 * Custom Application Error Class
 * Extends native Error class with additional properties for
 * operational error handling in production environment
 * 
 * @module utils/AppError
 */

const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Error code constants for consistent error handling
 */
const ERROR_CODES = {
  // Client errors (4xx)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
  CONFLICT_ERROR: 'CONFLICT_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  INVALID_INPUT_ERROR: 'INVALID_INPUT_ERROR',
  EXPIRED_ERROR: 'EXPIRED_ERROR',
  
  // Server errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  BLOCKCHAIN_ERROR: 'BLOCKCHAIN_ERROR',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  EMAIL_ERROR: 'EMAIL_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  
  // Business logic errors
  INSUFFICIENT_FUNDS_ERROR: 'INSUFFICIENT_FUNDS_ERROR',
  TICKET_SOLD_OUT_ERROR: 'TICKET_SOLD_OUT_ERROR',
  EVENT_CANCELLED_ERROR: 'EVENT_CANCELLED_ERROR',
  DUPLICATE_PURCHASE_ERROR: 'DUPLICATE_PURCHASE_ERROR',
  INVALID_TICKET_ERROR: 'INVALID_TICKET_ERROR',
  TRANSFER_RESTRICTED_ERROR: 'TRANSFER_RESTRICTED_ERROR',
};

/**
 * Custom error class for application-specific errors
 * @class AppError
 * @extends Error
 */
class AppError extends Error {
  /**
   * Create an AppError instance
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   * @param {string} errorCode - Application error code
   * @param {object} details - Additional error details
   */
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR', details = {}) {
    super(message);
    
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true;
    this.id = uuidv4();
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
    
    // Add request context if available
    this.context = {};
    
    // Metadata for tracking
    this.metadata = {
      service: config.service.name,
      version: config.version,
      environment: config.environment,
    };
  }
  
  /**
   * Convert error to JSON representation
   * @returns {object} JSON representation of error
   */
  toJSON() {
    const json = {
      id: this.id,
      name: this.name,
      message: this.message,
      errorCode: this.errorCode,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      isOperational: this.isOperational,
    };
    
    // Include details in non-production or for operational errors
    if (!config.isProduction || this.isOperational) {
      json.details = this.details;
    }
    
    // Include stack trace in development
    if (config.isDevelopment) {
      json.stack = this.stack;
      json.metadata = this.metadata;
      json.context = this.context;
    }
    
    return json;
  }
  
  /**
   * Add metadata to error
   * @param {object} metadata - Additional metadata
   * @returns {AppError} This error instance for chaining
   */
  withMetadata(metadata) {
    Object.assign(this.metadata, metadata);
    return this;
  }
  
  /**
   * Add request context to error
   * @param {object} context - Request context
   * @returns {AppError} This error instance for chaining
   */
  withContext(context) {
    this.context = {
      ...this.context,
      ...context,
      requestId: context.requestId || this.context.requestId,
      userId: context.userId || this.context.userId,
      ip: context.ip || this.context.ip,
      userAgent: context.userAgent || this.context.userAgent,
    };
    return this;
  }
  
  /**
   * Sanitize error for external exposure
   * Removes sensitive information
   * @returns {object} Sanitized error object
   */
  sanitize() {
    const sanitized = {
      error: this.errorCode,
      message: this.isOperational ? this.message : 'An error occurred',
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      requestId: this.context.requestId,
    };
    
    // Only include safe details
    if (this.isOperational && this.details) {
      sanitized.details = this.sanitizeSensitiveData(this.details);
    }
    
    return sanitized;
  }
  
  /**
   * Remove sensitive data from object
   * @param {object} data - Data to sanitize
   * @returns {object} Sanitized data
   * @private
   */
  sanitizeSensitiveData(data) {
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'privateKey', 'creditCard', 'ssn'];
    const sanitized = { ...data };
    
    const recursiveSanitize = (obj) => {
      Object.keys(obj).forEach(key => {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          recursiveSanitize(obj[key]);
        }
      });
    };
    
    recursiveSanitize(sanitized);
    return sanitized;
  }
  
  /**
   * Send error to monitoring service
   * @param {object} options - Capture options
   * @returns {Promise<void>}
   */
  async capture(options = {}) {
    try {
      // Integration with error tracking service (e.g., Sentry)
      if (config.monitoring.errorTracking.enabled) {
        const errorTracking = require('../services/monitoring/errorTracking');
        await errorTracking.captureError(this, {
          ...options,
          extra: {
            ...this.metadata,
            ...this.context,
            details: this.details,
          },
          tags: {
            errorCode: this.errorCode,
            isOperational: this.isOperational,
            service: config.service.name,
          },
        });
      }
      
      // Log to centralized logging
      const logger = require('./logger');
      logger.error('Application error captured', {
        error: this.toJSON(),
        options,
      });
    } catch (captureError) {
      console.error('Failed to capture error:', captureError);
    }
  }
  
  /**
   * Check if error is retryable
   * @returns {boolean} Whether the operation can be retried
   */
  isRetryable() {
    const retryableErrors = [
      ERROR_CODES.DATABASE_ERROR,
      ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      ERROR_CODES.BLOCKCHAIN_ERROR,
    ];
    
    return retryableErrors.includes(this.errorCode) && 
           this.statusCode >= 500 &&
           !this.details.permanent;
  }
  
  /**
   * Get user-friendly error message
   * @returns {string} User-friendly message
   */
  getUserMessage() {
    const userMessages = {
      [ERROR_CODES.VALIDATION_ERROR]: 'Please check your input and try again.',
      [ERROR_CODES.AUTHENTICATION_ERROR]: 'Please log in to continue.',
      [ERROR_CODES.AUTHORIZATION_ERROR]: 'You do not have permission to perform this action.',
      [ERROR_CODES.NOT_FOUND_ERROR]: 'The requested resource was not found.',
      [ERROR_CODES.RATE_LIMIT_ERROR]: 'Too many requests. Please try again later.',
      [ERROR_CODES.PAYMENT_ERROR]: 'Payment processing failed. Please try again.',
      [ERROR_CODES.BLOCKCHAIN_ERROR]: 'Blockchain operation failed. Please try again.',
    };
    
    return userMessages[this.errorCode] || 'An error occurred. Please try again later.';
  }
  
  /**
   * Static factory methods for common errors
   */
  static badRequest(message, details) {
    return new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR, details);
  }
  
  static unauthorized(message = 'Unauthorized') {
    return new AppError(message, 401, ERROR_CODES.AUTHENTICATION_ERROR);
  }
  
  static forbidden(message = 'Forbidden') {
    return new AppError(message, 403, ERROR_CODES.AUTHORIZATION_ERROR);
  }
  
  static notFound(resource = 'Resource') {
    return new AppError(`${resource} not found`, 404, ERROR_CODES.NOT_FOUND_ERROR);
  }
  
  static conflict(message, details) {
    return new AppError(message, 409, ERROR_CODES.CONFLICT_ERROR, details);
  }
  
  static tooManyRequests(message = 'Too many requests') {
    return new AppError(message, 429, ERROR_CODES.RATE_LIMIT_ERROR);
  }
  
  static internal(message = 'Internal server error', details) {
    const error = new AppError(message, 500, ERROR_CODES.INTERNAL_ERROR, details);
    error.isOperational = false;
    return error;
  }
  
  static database(message, details) {
    return new AppError(message, 500, ERROR_CODES.DATABASE_ERROR, details);
  }
  
  static external(service, message, details) {
    return new AppError(
      `External service error: ${service} - ${message}`,
      502,
      ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      { service, ...details }
    );
  }
  
  static blockchain(message, details) {
    return new AppError(message, 500, ERROR_CODES.BLOCKCHAIN_ERROR, details);
  }
}

// Export error codes and class
module.exports = AppError;
module.exports.ERROR_CODES = ERROR_CODES;

// ==========================================
// FILE: backend/utils/logger.js
// ==========================================
/**
 * Production Logger Configuration
 * Uses Winston for structured logging with multiple transports,
 * log rotation, and integration with monitoring services
 * 
 * @module utils/logger
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { format } = winston;
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure log directory exists
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Custom format for redacting sensitive information
 */
const redactSensitiveData = format((info) => {
  const sensitiveFields = [
    'password', 'token', 'apiKey', 'secret', 'authorization',
    'creditCard', 'ssn', 'privateKey', 'sessionId', 'cookie'
  ];
  
  const redactObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    const redacted = Array.isArray(obj) ? [...obj] : { ...obj };
    
    Object.keys(redacted).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof redacted[key] === 'object') {
        redacted[key] = redactObject(redacted[key]);
      }
    });
    
    return redacted;
  };
  
  return {
    ...info,
    message: typeof info.message === 'object' ? redactObject(info.message) : info.message,
    meta: info.meta ? redactObject(info.meta) : info.meta,
  };
});

/**
 * Custom format for adding context
 */
const addContext = format((info) => {
  return {
    ...info,
    service: config.service.name,
    environment: config.environment,
    version: config.version,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    hostname: require('os').hostname(),
  };
});

/**
 * Format for console output
 */
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

/**
 * Format for file output
 */
const fileFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  redactSensitiveData(),
  addContext(),
  format.json()
);

/**
 * Create logger instance
 */
const logger = winston.createLogger({
  level: config.logging.level || 'info',
  levels: winston.config.npm.levels,
  exitOnError: false,
  
  // Default format
  format: fileFormat,
  
  // Exception handling
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  ],
  
  // Rejection handling
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  ],
});

/**
 * Console transport (development)
 */
if (config.isDevelopment) {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true,
  }));
}

/**
 * File transport with rotation - All logs
 */
logger.add(new DailyRotateFile({
  filename: path.join(logDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: config.logging.maxFileSize || '20m',
  maxFiles: config.logging.maxFiles || '14d',
  format: fileFormat,
}));

/**
 * File transport with rotation - Error logs only
 */
logger.add(new DailyRotateFile({
  filename: path.join(logDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: config.logging.maxFileSize || '20m',
  maxFiles: config.logging.maxFiles || '30d',
  level: 'error',
  format: fileFormat,
}));

/**
 * Performance logging transport
 */
const performanceLogger = new DailyRotateFile({
  filename: path.join(logDir, 'performance-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '50m',
  maxFiles: '7d',
  format: fileFormat,
});

/**
 * Audit logging transport
 */
const auditLogger = new DailyRotateFile({
  filename: path.join(logDir, 'audit-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '100m',
  maxFiles: '90d', // Keep audit logs for 90 days
  format: format.combine(
    format.timestamp(),
    addContext(),
    format.json()
  ),
});

/**
 * Syslog transport (production)
 */
if (config.isProduction && config.logging.syslog.enabled) {
  const Syslog = require('winston-syslog').Syslog;
  logger.add(new Syslog({
    host: config.logging.syslog.host,
    port: config.logging.syslog.port,
    protocol: config.logging.syslog.protocol,
    facility: 'local0',
    app_name: config.service.name,
  }));
}

/**
 * External logging service transport (e.g., Datadog, CloudWatch)
 */
if (config.logging.external.enabled) {
  // Example: Datadog transport
  if (config.logging.external.provider === 'datadog') {
    const DatadogTransport = require('winston-datadog-transport');
    logger.add(new DatadogTransport({
      apiKey: config.logging.external.apiKey,
      hostname: require('os').hostname(),
      service: config.service.name,
      ddsource: 'nodejs',
      ddtags: `env:${config.environment},version:${config.version}`,
    }));
  }
}

/**
 * Extended logger methods
 */

/**
 * Log performance metrics
 * @param {string} operation - Operation name
 * @param {number} duration - Duration in milliseconds
 * @param {object} metadata - Additional metadata
 */
logger.performance = function(operation, duration, metadata = {}) {
  this.log({
    level: 'info',
    message: `Performance: ${operation}`,
    type: 'performance',
    operation,
    duration,
    ...metadata,
    transport: [performanceLogger],
  });
};

/**
 * Log audit events
 * @param {string} action - Action performed
 * @param {object} actor - User performing action
 * @param {object} target - Target of action
 * @param {object} metadata - Additional metadata
 */
logger.audit = function(action, actor, target, metadata = {}) {
  this.log({
    level: 'info',
    message: `Audit: ${action}`,
    type: 'audit',
    action,
    actor,
    target,
    ...metadata,
    transport: [auditLogger],
  });
};

/**
 * Log database queries (development only)
 * @param {string} query - SQL/MongoDB query
 * @param {number} duration - Query duration
 * @param {object} metadata - Additional metadata
 */
logger.query = function(query, duration, metadata = {}) {
  if (config.isDevelopment || config.logging.logQueries) {
    this.debug('Database query', {
      type: 'query',
      query: query.substring(0, 1000), // Truncate long queries
      duration,
      ...metadata,
    });
  }
};

/**
 * Log HTTP requests
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {number} duration - Request duration
 */
logger.http = function(message, metadata = {}) {
  this.log({
    level: 'http',
    message,
    type: 'http',
    ...metadata,
  });
};

/**
 * Create child logger with context
 * @param {object} defaultMeta - Default metadata for child logger
 * @returns {winston.Logger} Child logger instance
 */
logger.child = function(defaultMeta) {
  return winston.createLogger({
    ...this.options,
    defaultMeta: {
      ...this.defaultMeta,
      ...defaultMeta,
    },
    transports: this.transports,
  });
};

/**
 * Utility function to create scoped logger
 * @param {string} scope - Logger scope/module name
 * @returns {winston.Logger} Scoped logger
 */
function createLogger(scope) {
  return logger.child({ scope });
}

/**
 * Stream for Morgan HTTP logger
 */
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// Export logger instance and factory
module.exports = logger;
module.exports.createLogger = createLogger;

// ==========================================
// FILE: backend/config/email.js
// ==========================================
/**
 * Email Configuration
 * Supports multiple email providers with fallback options
 * Includes template management and rate limiting
 * 
 * @module config/email
 */

const path = require('path');

/**
 * Email configuration with multi-provider support
 */
const emailConfig = {
  // Default provider
  defaultProvider: process.env.EMAIL_PROVIDER || 'smtp',
  
  // Provider configurations
  providers: {
    // SMTP Configuration (Default)
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true, // Use pooled connections
      maxConnections: parseInt(process.env.SMTP_MAX_CONNECTIONS, 10) || 5,
      maxMessages: parseInt(process.env.SMTP_MAX_MESSAGES, 10) || 100,
      rateDelta: 1000, // Rate limit time frame (ms)
      rateLimit: parseInt(process.env.SMTP_RATE_LIMIT, 10) || 5, // Messages per rateDelta
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    },
    
    // SendGrid Configuration
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY,
      sandbox: process.env.SENDGRID_SANDBOX === 'true',
      ipPoolName: process.env.SENDGRID_IP_POOL,
      batchSize: parseInt(process.env.SENDGRID_BATCH_SIZE, 10) || 1000,
      personalizations: {
        maxTo: 1000,
        maxCc: 1000,
        maxBcc: 1000,
      },
    },
    
    // AWS SES Configuration
    ses: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
      apiVersion: '2010-12-01',
      maxSendRate: parseInt(process.env.SES_MAX_SEND_RATE, 10) || 14, // Emails per second
      configurationSet: process.env.SES_CONFIGURATION_SET,
      tags: [
        { Name: 'service', Value: 'tickettoken' },
        { Name: 'environment', Value: process.env.NODE_ENV },
      ],
    },
    
    // Mailgun Configuration
    mailgun: {
      apiKey: process.env.MAILGUN_API_KEY,
      domain: process.env.MAILGUN_DOMAIN,
      host: process.env.MAILGUN_HOST || 'api.mailgun.net',
      version: 'v3',
      tracking: {
        clicks: true,
        opens: true,
        unsubscribe: true,
      },
      deliveryTime: {
        optimizePeriod: true,
        timeZone: 'America/New_York',
      },
    },
  },
  
  // Fallback provider order
  fallbackOrder: ['smtp', 'sendgrid', 'ses', 'mailgun'],
  
  // Default sender information
  defaults: {
    from: {
      name: process.env.EMAIL_FROM_NAME || 'TicketToken',
      address: process.env.EMAIL_FROM_ADDRESS || 'noreply@tickettoken.com',
    },
    replyTo: process.env.EMAIL_REPLY_TO || 'support@tickettoken.com',
  },
  
  // Template configuration
  templates: {
    // Template engine
    engine: 'handlebars',
    
    // Template directory
    directory: path.join(__dirname, '../templates/email'),
    
    // Default template data
    defaults: {
      companyName: 'TicketToken',
      companyUrl: process.env.APP_URL || 'https://tickettoken.com',
      supportEmail: 'support@tickettoken.com',
      currentYear: new Date().getFullYear(),
      socialLinks: {
        twitter: 'https://twitter.com/tickettoken',
        facebook: 'https://facebook.com/tickettoken',
        instagram: 'https://instagram.com/tickettoken',
      },
    },
    
    // Available templates
    available: {
      // Authentication emails
      welcome: 'auth/welcome',
      emailVerification: 'auth/verify-email',
      passwordReset: 'auth/password-reset',
      passwordChanged: 'auth/password-changed',
      twoFactorCode: 'auth/two-factor-code',
      
      // Transaction emails
      ticketPurchase: 'transactions/ticket-purchase',
      ticketTransfer: 'transactions/ticket-transfer',
      paymentReceipt: 'transactions/payment-receipt',
      refundProcessed: 'transactions/refund-processed',
      
      // Event emails
      eventReminder: 'events/reminder',
      eventCancelled: 'events/cancelled',
      eventUpdated: 'events/updated',
      
      // Marketing emails
      newsletter: 'marketing/newsletter',
      promotion: 'marketing/promotion',
      
      // System emails
      systemAlert: 'system/alert',
      accountSuspended: 'system/account-suspended',
    },
  },
  
  // Rate limiting configuration
  rateLimiting: {
    enabled: process.env.EMAIL_RATE_LIMIT_ENABLED !== 'false',
    
    // Per-user limits
    perUser: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: parseInt(process.env.EMAIL_USER_HOURLY_LIMIT, 10) || 10,
    },
    
    // Per-IP limits
    perIp: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: parseInt(process.env.EMAIL_IP_HOURLY_LIMIT, 10) || 50,
    },
    
    // Global limits
    global: {
      windowMs: 60 * 1000, // 1 minute
      max: parseInt(process.env.EMAIL_GLOBAL_MINUTE_LIMIT, 10) || 100,
    },
  },
  
  // Bounce handling
  bounceHandling: {
    enabled: process.env.EMAIL_BOUNCE_HANDLING_ENABLED !== 'false',
    webhookSecret: process.env.EMAIL_WEBHOOK_SECRET,
    
    // Actions based on bounce type
    actions: {
      hardBounce: 'disable', // Disable email sending to this address
      softBounce: 'retry', // Retry with exponential backoff
      complaint: 'disable', // Spam complaint - disable
      unsubscribe: 'respect', // Honor unsubscribe
    },
    
    // Retry configuration for soft bounces
    retry: {
      maxAttempts: 3,
      backoffMultiplier: 2,
      initialDelay: 300000, // 5 minutes
    },
  },
  
  // Analytics and tracking
  analytics: {
    enabled: process.env.EMAIL_ANALYTICS_ENABLED !== 'false',
    
    // Track email events
    trackEvents: {
      sent: true,
      delivered: true,
      opened: true,
      clicked: true,
      bounced: true,
      complained: true,
      unsubscribed: true,
    },
    
    // UTM parameters for links
    utmParams: {
      source: 'email',
      medium: 'transactional',
      campaign: 'system',
    },
    
    // Custom tracking domain
    trackingDomain: process.env.EMAIL_TRACKING_DOMAIN,
  },
  
  // Queue configuration
  queue: {
    enabled: process.env.EMAIL_QUEUE_ENABLED !== 'false',
    
    // Queue options
    options: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
    
    // Priority levels
    priorities: {
      critical: 10, // Password reset, 2FA
      high: 7, // Transaction receipts
      normal: 5, // Notifications
      low: 3, // Marketing
      bulk: 1, // Newsletters
    },
  },
  
  // Sandbox/Testing mode
  sandbox: {
    enabled: process.env.EMAIL_SANDBOX_ENABLED === 'true',
    
    // Whitelisted emails in sandbox mode
    whitelist: process.env.EMAIL_SANDBOX_WHITELIST
      ? process.env.EMAIL_SANDBOX_WHITELIST.split(',')
      : ['test@tickettoken.com'],
    
    // Redirect all emails to this address in sandbox
    redirectTo: process.env.EMAIL_SANDBOX_REDIRECT,
  },
  
  // Security settings
  security: {
    // DKIM signing
    dkim: {
      enabled: process.env.EMAIL_DKIM_ENABLED === 'true',
      privateKey: process.env.EMAIL_DKIM_PRIVATE_KEY,
      selector: process.env.EMAIL_DKIM_SELECTOR || 'default',
      domain: process.env.EMAIL_DKIM_DOMAIN || 'tickettoken.com',
    },
    
    // SPF records (informational)
    spf: {
      record: 'v=spf1 include:_spf.tickettoken.com ~all',
    },
    
    // DMARC policy (informational)
    dmarc: {
      record: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@tickettoken.com',
    },
  },
  
  // Compliance
  compliance: {
    // Include unsubscribe link
    includeUnsubscribe: true,
    unsubscribeUrl: process.env.EMAIL_UNSUBSCRIBE_URL || 'https://tickettoken.com/unsubscribe',
    
    // Include physical address (CAN-SPAM)
    includeAddress: true,
    physicalAddress: process.env.COMPANY_ADDRESS || '123 Main St, New York, NY 10001',
    
    // GDPR compliance
    gdpr: {
      enabled: true,
      privacyPolicyUrl: 'https://tickettoken.com/privacy',
      dataProcessingInfo: 'Your data is processed in accordance with our privacy policy.',
    },
  },
};

// Validate configuration on module load
function validateConfig() {
  const provider = emailConfig.providers[emailConfig.defaultProvider];
  
  if (!provider) {
    throw new Error(`Invalid email provider: ${emailConfig.defaultProvider}`);
  }
  
  // Validate SMTP configuration
  if (emailConfig.defaultProvider === 'smtp') {
    if (!provider.auth.user || !provider.auth.pass) {
      throw new Error('SMTP configuration missing authentication credentials');
    }
  }
  
  // Validate API-based providers
  const apiProviders = ['sendgrid', 'ses', 'mailgun'];
  if (apiProviders.includes(emailConfig.defaultProvider)) {
    const requiredKeys = {
      sendgrid: ['apiKey'],
      ses: ['accessKeyId', 'secretAccessKey'],
      mailgun: ['apiKey', 'domain'],
    };
    
    const required = requiredKeys[emailConfig.defaultProvider];
    for (const key of required) {
      if (!provider[key]) {
        throw new Error(`${emailConfig.defaultProvider} configuration missing: ${key}`);
      }
    }
  }
}

// Run validation in production
if (process.env.NODE_ENV === 'production') {
  validateConfig();
}

module.exports = emailConfig;

// ==========================================
// FILE: backend/config/payment.js
// ==========================================
/**
 * Payment Gateway Configuration
 * Multi-gateway support with Stripe, PayPal, and Cryptocurrency payments
 * Includes webhook handling, fee calculations, and fraud detection
 * 
 * @module config/payment
 */

/**
 * Payment configuration with multi-gateway support
 */
const paymentConfig = {
  // Default payment gateway
  defaultGateway: process.env.PAYMENT_DEFAULT_GATEWAY || 'stripe',
  
  // Supported currencies
  supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'],
  defaultCurrency: process.env.PAYMENT_DEFAULT_CURRENCY || 'USD',
  
  // Gateway configurations
  gateways: {
    // Stripe Configuration
    stripe: {
      enabled: process.env.STRIPE_ENABLED !== 'false',
      apiVersion: '2023-10-16',
      
      // API Keys
      keys: {
        publishable: process.env.STRIPE_PUBLISHABLE_KEY,
        secret: process.env.STRIPE_SECRET_KEY,
        webhook: process.env.STRIPE_WEBHOOK_SECRET,
      },
      
      // Payment methods
      paymentMethods: {
        card: true,
        achDebit: process.env.STRIPE_ACH_ENABLED === 'true',
        sepaDebit: process.env.STRIPE_SEPA_ENABLED === 'true',
        applePay: process.env.STRIPE_APPLE_PAY_ENABLED === 'true',
        googlePay: process.env.STRIPE_GOOGLE_PAY_ENABLED === 'true',
      },
      
      // Connect settings for marketplace
      connect: {
        enabled: process.env.STRIPE_CONNECT_ENABLED === 'true',
        accountType: 'express', // 'standard' | 'express' | 'custom'
        chargeType: 'destination', // 'direct' | 'destination'
      },
      
      // Billing settings
      billing: {
        statementDescriptor: 'TICKETTOKEN',
        dynamicDescriptor: true,
      },
      
      // 3D Secure settings
      threeDSecure: {
        required: process.env.STRIPE_3DS_REQUIRED === 'true',
        optional: process.env.STRIPE_3DS_OPTIONAL !== 'false',
      },
      
      // Radar (fraud detection) settings
      radar: {
        enabled: true,
        rules: {
          blockHighRiskPayments: true,
          requireCvv: true,
          requirePostalCode: true,
        },
      },
    },
    
    // PayPal Configuration
    paypal: {
      enabled: process.env.PAYPAL_ENABLED === 'true',
      
      // Environment
      environment: process.env.PAYPAL_ENVIRONMENT || 'production', // 'sandbox' | 'production'
      
      // API Credentials
      credentials: {
        clientId: process.env.PAYPAL_CLIENT_ID,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET,
        merchantId: process.env.PAYPAL_MERCHANT_ID,
      },
      
      // Webhook configuration
      webhook: {
        id: process.env.PAYPAL_WEBHOOK_ID,
        secret: process.env.PAYPAL_WEBHOOK_SECRET,
      },
      
      // Payment options
      options: {
        intent: 'capture', // 'capture' | 'authorize'
        landingPage: 'BILLING', // 'LOGIN' | 'BILLING' | 'NO_PREFERENCE'
        userAction: 'PAY_NOW', // 'CONTINUE' | 'PAY_NOW'
        shippingPreference: 'NO_SHIPPING', // We're selling digital tickets
      },
      
      // Seller protection
      sellerProtection: {
        enabled: true,
        eligibleTransactionOnly: true,
      },
      
      // Payout settings
      payouts: {
        enabled: process.env.PAYPAL_PAYOUTS_ENABLED === 'true',
        emailSubject: 'TicketToken Payout',
        note: 'Thank you for using TicketToken',
      },
    },
    
    // Cryptocurrency Configuration
    crypto: {
      enabled: process.env.CRYPTO_ENABLED === 'true',
      
      // Supported cryptocurrencies
      supportedCoins: {
        BTC: {
          enabled: true,
          network: 'bitcoin',
          confirmations: 3,
          processingTime: '10-60 minutes',
        },
        ETH: {
          enabled: true,
          network: 'ethereum',
          confirmations: 12,
          processingTime: '2-5 minutes',
        },
        USDC: {
          enabled: true,
          network: 'ethereum',
          contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          confirmations: 12,
          processingTime: '2-5 minutes',
        },
        USDT: {
          enabled: true,
          network: 'ethereum',
          contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          confirmations: 12,
          processingTime: '2-5 minutes',
        },
        SOL: {
          enabled: true,
          network: 'solana',
          confirmations: 31,
          processingTime: '< 1 minute',
        },
      },
      
      // Payment processor (e.g., Coinbase Commerce, BitPay, or custom)
      processor: process.env.CRYPTO_PROCESSOR || 'custom',
      
      // Coinbase Commerce settings
      coinbaseCommerce: {
        apiKey: process.env.COINBASE_COMMERCE_API_KEY,
        webhookSecret: process.env.COINBASE_COMMERCE_WEBHOOK_SECRET,
        checkoutTimeout: 3600, // 1 hour in seconds
      },
      
      // Custom crypto payment settings
      custom: {
        // HD wallet configuration
        hdWallet: {
          mnemonic: process.env.CRYPTO_HD_MNEMONIC,
          derivationPath: "m/44'/0'/0'/0",
        },
        
        // Node endpoints
        nodes: {
          bitcoin: process.env.BITCOIN_NODE_URL || 'https://btc.blockapi.com',
          ethereum: process.env.ETHEREUM_NODE_URL || 'https://mainnet.infura.io/v3/',
          solana: process.env.SOLANA_NODE_URL || 'https://api.mainnet-beta.solana.com',
        },
        
        // Gas settings for Ethereum
        ethereum: {
          gasLimit: 100000,
          gasPriceMultiplier: 1.2, // 20% above current gas price
          maxPriorityFeePerGas: '2', // Gwei
        },
      },
      
      // Price feeds
      priceFeeds: {
        provider: 'chainlink', // 'chainlink' | 'coingecko' | 'custom'
        updateInterval: 60000, // 1 minute
        tolerance: 0.02, // 2% price movement tolerance
      },
      
      // Address validation
      addressValidation: {
        enabled: true,
        checkChecksum: true,
        allowTestnet: process.env.NODE_ENV !== 'production',
      },
    },
  },
  
  // Webhook endpoints configuration
  webhooks: {
    baseUrl: process.env.WEBHOOK_BASE_URL || 'https://api.tickettoken.com',
    
    endpoints: {
      stripe: '/webhooks/stripe',
      paypal: '/webhooks/paypal',
      crypto: '/webhooks/crypto',
    },
    
    // Webhook verification
    verification: {
      toleranceSeconds: 300, // 5 minutes
      requireHttps: process.env.NODE_ENV === 'production',
    },
    
    // Retry configuration
    retry: {
      maxAttempts: 3,
      backoffMultiplier: 2,
      initialDelay: 1000, // 1 second
    },
  },
  
  // Fee calculation settings
  fees: {
    // Platform fees
    platform: {
      percentage: parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 2.5, // 2.5%
      fixed: parseFloat(process.env.PLATFORM_FEE_FIXED) || 0.30, // $0.30
      currency: 'USD',
    },
    
    // Payment processor fees (approximate, updated dynamically)
    processor: {
      stripe: {
        percentage: 2.9,
        fixed: 0.30,
      },
      paypal: {
        percentage: 2.9,
        fixed: 0.30,
      },
      crypto: {
        percentage: 1.0,
        fixed: 0,
      },
    },
    
    // Fee distribution
    distribution: {
      splitFees: process.env.SPLIT_FEES === 'true', // Split between platform and seller
      platformAbsorbs: process.env.PLATFORM_ABSORBS_FEES === 'true',
    },
    
    // Minimum transaction amount
    minimumAmount: {
      USD: 1.00,
      EUR: 1.00,
      GBP: 1.00,
    },
  },
  
  // Currency conversion configuration
  currency: {
    // Exchange rate provider
    provider: process.env.EXCHANGE_RATE_PROVIDER || 'fixer', // 'fixer' | 'openexchange' | 'custom'
    
    // API keys for providers
    apiKeys: {
      fixer: process.env.FIXER_API_KEY,
      openexchange: process.env.OPENEXCHANGE_API_KEY,
    },
    
    // Update settings
    updateInterval: 3600000, // 1 hour
    
    // Conversion settings
    conversion: {
      roundingMode: 'ROUND_HALF_UP',
      decimalPlaces: 2,
      markupPercentage: 0, // No markup on conversions
    },
  },
  
  // Fraud detection settings
  fraud: {
    enabled: process.env.FRAUD_DETECTION_ENABLED !== 'false',
    
    // Risk scoring thresholds
    riskThresholds: {
      low: 20,
      medium: 50,
      high: 75,
      block: 90,
    },
    
    // Velocity checks
    velocity: {
      // Max transactions per card per day
      cardDaily: parseInt(process.env.FRAUD_CARD_DAILY_LIMIT, 10) || 5,
      
      // Max transactions per IP per hour
      ipHourly: parseInt(process.env.FRAUD_IP_HOURLY_LIMIT, 10) || 10,
      
      // Max amount per user per day
      userDailyAmount: parseFloat(process.env.FRAUD_USER_DAILY_AMOUNT) || 5000,
    },
    
    // Blacklist checks
    blacklists: {
      checkCard: true,
      checkEmail: true,
      checkIp: true,
      checkDevice: true,
    },
    
    // Machine learning model
    ml: {
      enabled: process.env.FRAUD_ML_ENABLED === 'true',
      endpoint: process.env.FRAUD_ML_ENDPOINT,
      apiKey: process.env.FRAUD_ML_API_KEY,
      timeout: 3000, // 3 seconds
    },
    
    // Actions based on risk score
    actions: {
      low: 'allow',
      medium: 'review',
      high: '3ds_required',
      block: 'decline',
    },
  },
  
  // Refund policies
  refunds: {
    // Refund window in days
    windowDays: parseInt(process.env.REFUND_WINDOW_DAYS, 10) || 7,
    
    // Automatic approval thresholds
    autoApprove: {
      enabled: process.env.REFUND_AUTO_APPROVE === 'true',
      maxAmount: parseFloat(process.env.REFUND_AUTO_APPROVE_MAX) || 100,
      maxPercentage: 100, // Full refund
    },
    
    // Partial refunds
    partial: {
      enabled: true,
      minimumAmount: 1.00,
      reasons: [
        'event_cancelled',
        'duplicate_purchase',
        'technical_issue',
        'customer_request',
        'fraud',
      ],
    },
    
    // Processing time
    processing: {
      stripe: '5-10 days',
      paypal: '3-5 days',
      crypto: 'instant',
    },
  },
  
  // Settlement configuration
  settlement: {
    // Payout schedule
    schedule: process.env.SETTLEMENT_SCHEDULE || 'daily', // 'manual' | 'daily' | 'weekly' | 'monthly'
    
    // Minimum payout amounts
    minimumPayout: {
      USD: parseFloat(process.env.SETTLEMENT_MIN_USD) || 10.00,
      EUR: parseFloat(process.env.SETTLEMENT_MIN_EUR) || 10.00,
      GBP: parseFloat(process.env.SETTLEMENT_MIN_GBP) || 10.00,
    },
    
    // Hold period in days
    holdPeriod: parseInt(process.env.SETTLEMENT_HOLD_DAYS, 10) || 2,
    
    // Rolling reserve
    rollingReserve: {
      enabled: process.env.ROLLING_RESERVE_ENABLED === 'true',
      percentage: parseFloat(process.env.ROLLING_RESERVE_PERCENTAGE) || 10,
      duration: parseInt(process.env.ROLLING_RESERVE_DAYS, 10) || 90,
    },
  },
  
  // Tax handling settings
  tax: {
    enabled: process.env.TAX_CALCULATION_ENABLED === 'true',
    
    // Tax calculation provider
    provider: process.env.TAX_PROVIDER || 'taxjar', // 'taxjar' | 'avalara' | 'custom'
    
    // Provider API keys
    apiKeys: {
      taxjar: process.env.TAXJAR_API_KEY,
      avalara: {
        accountId: process.env.AVALARA_ACCOUNT_ID,
        licenseKey: process.env.AVALARA_LICENSE_KEY,
      },
    },
    
    // Tax settings
    settings: {
      nexusStates: process.env.TAX_NEXUS_STATES?.split(',') || ['NY', 'CA'],
      collectInAllStates: process.env.TAX_COLLECT_ALL_STATES === 'true',
      includeInPrice: process.env.TAX_INCLUDE_IN_PRICE === 'true',
      
      // EU VAT
      vat: {
        enabled: process.env.VAT_ENABLED === 'true',
        rates: {
          standard: 20,
          reduced: 10,
          zero: 0,
        },
        validateVatId: true,
        reverseCharge: true,
      },
    },
    
    // Reporting
    reporting: {
      generateReports: true,
      reportingPeriod: 'quarterly',
      autoFile: process.env.TAX_AUTO_FILE === 'true',
    },
  },
  
  // Compliance settings
  compliance: {
    // PCI DSS
    pci: {
      level: process.env.PCI_LEVEL || '1', // Level 1-4
      selfAssessment: 'SAQ-D', // Self-Assessment Questionnaire type
      scanningVendor: process.env.PCI_ASV || 'SecurityMetrics',
    },
    
    // Strong Customer Authentication (EU)
    sca: {
      enabled: true,
      exemptions: {
        lowValue: true, // < €30
        trustedBeneficiary: true,
        recurringTransaction: true,
      },
    },
    
    // Know Your Customer
    kyc: {
      enabled: process.env.KYC_ENABLED === 'true',
      provider: process.env.KYC_PROVIDER || 'jumio',
      thresholds: {
        basicVerification: 1000, // USD
        enhancedVerification: 10000, // USD
      },
    },
    
    // Anti-Money Laundering
    aml: {
      enabled: process.env.AML_ENABLED === 'true',
      provider: process.env.AML_PROVIDER || 'chainalysis',
      checkThreshold: 3000, // USD
      reportingThreshold: 10000, // USD
    },
  },
  
  // Testing configuration
  testing: {
    // Test mode
    testMode: process.env.PAYMENT_TEST_MODE === 'true',
    
    // Test cards
    testCards: {
      successful: '4242424242424242',
      declined: '4000000000000002',
      insufficientFunds: '4000000000009995',
      expired: '4000000000000069',
      processingError: '4000000000000119',
      requires3ds: '4000002500003155',
    },
    
    // Test amounts for specific behaviors
    testAmounts: {
      success: [100, 200, 300],
      decline: [9999],
      error: [666],
    },
  },
  
  // Monitoring and alerts
  monitoring: {
    // Failed payment alerts
    alerts: {
      enabled: true,
      thresholds: {
        failureRate: 10, // Percentage
        declineRate: 15, // Percentage
        chargebackRate: 1, // Percentage
      },
      channels: ['email', 'slack', 'pagerduty'],
    },
    
    // Metrics to track
    metrics: {
      paymentSuccess: true,
      paymentFailure: true,
      paymentDuration: true,
      conversionRate: true,
      averageOrderValue: true,
      chargebackRate: true,
      refundRate: true,
    },
  },
};

/**
 * Validate payment configuration
 */
function validateConfig() {
  const gateway = paymentConfig.gateways[paymentConfig.defaultGateway];
  
  if (!gateway || !gateway.enabled) {
    throw new Error(`Default payment gateway ${paymentConfig.defaultGateway} is not enabled`);
  }
  
  // Validate Stripe configuration
  if (gateway === paymentConfig.gateways.stripe && gateway.enabled) {
    if (!gateway.keys.secret) {
      throw new Error('Stripe secret key is required');
    }
    if (!gateway.keys.webhook) {
      console.warn('Stripe webhook secret not configured - webhooks will not be verified');
    }
  }
  
  // Validate PayPal configuration
  if (paymentConfig.gateways.paypal.enabled) {
    if (!paymentConfig.gateways.paypal.credentials.clientId || 
        !paymentConfig.gateways.paypal.credentials.clientSecret) {
      throw new Error('PayPal client credentials are required');
    }
  }
  
  // Validate crypto configuration
  if (paymentConfig.gateways.crypto.enabled) {
    if (paymentConfig.gateways.crypto.processor === 'custom' && 
        !paymentConfig.gateways.crypto.custom.hdWallet.mnemonic) {
      throw new Error('Crypto HD wallet mnemonic is required for custom processor');
    }
  }
}

// Run validation in production
if (process.env.NODE_ENV === 'production') {
  validateConfig();
}

module.exports = paymentConfig;

// ==========================================
// FILE: backend/config/storage.js
// ==========================================
/**
 * Storage Configuration
 * Multi-provider support for file storage with local, S3, and IPFS options
 * Includes CDN integration, virus scanning, and access control
 * 
 * @module config/storage
 */

const path = require('path');
const { URL } = require('url');

/**
 * Storage configuration with multi-provider support
 */
const storageConfig = {
  // Default storage provider
  defaultProvider: process.env.STORAGE_PROVIDER || 'local',
  
  // Storage providers configuration
  providers: {
    // Local file system storage
    local: {
      enabled: process.env.STORAGE_LOCAL_ENABLED !== 'false',
      
      // Base directory for uploads
      baseDir: process.env.STORAGE_LOCAL_PATH || path.join(__dirname, '../../uploads'),
      
      // Public URL prefix
      publicUrl: process.env.STORAGE_LOCAL_PUBLIC_URL || '/uploads',
      
      // Directory structure
      structure: {
        // Use dated folders: /uploads/2024/01/15/filename.jpg
        useDateFolders: true,
        dateFormat: 'YYYY/MM/DD',
        
        // Separate by type
        useTypeFolders: true,
        typeFolders: {
          image: 'images',
          video: 'videos',
          document: 'documents',
          audio: 'audio',
          other: 'misc',
        },
      },
      
      // Cleanup settings
      cleanup: {
        enabled: true,
        tempDir: path.join(__dirname, '../../temp'),
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        interval: 60 * 60 * 1000, // Run every hour
      },
    },
    
    // Amazon S3 storage
    s3: {
      enabled: process.env.STORAGE_S3_ENABLED === 'true',
      
      // AWS credentials
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
      },
      
      // S3 bucket configuration
      bucket: {
        name: process.env.S3_BUCKET_NAME || 'tickettoken-uploads',
        region: process.env.S3_BUCKET_REGION || 'us-east-1',
        acl: process.env.S3_ACL || 'private', // 'private' | 'public-read'
      },
      
      // Upload settings
      upload: {
        // Multipart upload threshold (5MB)
        multipartThreshold: 5 * 1024 * 1024,
        
        // Part size for multipart uploads (5MB)
        partSize: 5 * 1024 * 1024,
        
        // Concurrent parts
        queueSize: 4,
        
        // Server-side encryption
        serverSideEncryption: 'AES256', // 'AES256' | 'aws:kms'
        
        // Storage class
        storageClass: 'STANDARD', // 'STANDARD' | 'STANDARD_IA' | 'GLACIER'
      },
      
      // Signed URL settings
      signedUrl: {
        expiresIn: 3600, // 1 hour
        
        // Custom conditions
        conditions: [
          ['content-length-range', 0, 100 * 1024 * 1024], // Max 100MB
        ],
      },
      
      // Lifecycle rules
      lifecycle: {
        enabled: true,
        rules: [
          {
            id: 'archive-old-files',
            status: 'Enabled',
            transitions: [
              {
                days: 30,
                storageClass: 'STANDARD_IA',
              },
              {
                days: 90,
                storageClass: 'GLACIER',
              },
            ],
          },
          {
            id: 'delete-temp-files',
            status: 'Enabled',
            prefix: 'temp/',
            expiration: {
              days: 1,
            },
          },
        ],
      },
    },
    
    // IPFS (InterPlanetary File System) storage
    ipfs: {
      enabled: process.env.STORAGE_IPFS_ENABLED === 'true',
      
      // IPFS node configuration
      node: {
        host: process.env.IPFS_HOST || 'localhost',
        port: parseInt(process.env.IPFS_PORT, 10) || 5001,
        protocol: process.env.IPFS_PROTOCOL || 'http',
      },
      
      // Pinning service (e.g., Pinata, Infura)
      pinning: {
        service: process.env.IPFS_PINNING_SERVICE || 'pinata',
        
        // Pinata configuration
        pinata: {
          apiKey: process.env.PINATA_API_KEY,
          secretKey: process.env.PINATA_SECRET_KEY,
          gateway: 'https://gateway.pinata.cloud',
        },
        
        // Infura configuration
        infura: {
          projectId: process.env.INFURA_PROJECT_ID,
          projectSecret: process.env.INFURA_PROJECT_SECRET,
          gateway: 'https://ipfs.infura.io',
        },
      },
      
      // IPFS options
      options: {
        // Pin files to ensure persistence
        pin: true,
        
        // Wrap single files in directory
        wrapWithDirectory: false,
        
        // Progress callback
        progress: true,
        
        // Timeout for operations
        timeout: 30000, // 30 seconds
      },
      
      // Gateway URLs for retrieval
      gateways: [
        'https://ipfs.io',
        'https://gateway.pinata.cloud',
        'https://cloudflare-ipfs.com',
      ],
    },
  },
  
  // CDN configuration
  cdn: {
    enabled: process.env.CDN_ENABLED === 'true',
    
    // CDN provider
    provider: process.env.CDN_PROVIDER || 'cloudflare', // 'cloudflare' | 'cloudfront' | 'fastly'
    
    // CloudFlare configuration
    cloudflare: {
      zoneId: process.env.CLOUDFLARE_ZONE_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      baseUrl: process.env.CLOUDFLARE_CDN_URL || 'https://cdn.tickettoken.com',
      
      // Cache settings
      cache: {
        cacheEverything: true,
        edgeTTL: 2678400, // 31 days
        browserTTL: 86400, // 1 day
      },
      
      // Image optimization
      polish: 'lossless', // 'off' | 'lossless' | 'lossy'
      
      // Hotlink protection
      hotlinkProtection: true,
    },
    
    // AWS CloudFront configuration
    cloudfront: {
      distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
      baseUrl: process.env.CLOUDFRONT_CDN_URL,
      
      // Invalidation settings
      invalidation: {
        enabled: true,
        paths: ['/*'],
      },
      
      // Behaviors
      behaviors: {
        images: {
          pathPattern: '/images/*',
          ttl: 31536000, // 1 year
          compress: true,
        },
        documents: {
          pathPattern: '/documents/*',
          ttl: 86400, // 1 day
          compress: true,
        },
      },
    },
    
    // Purge settings
    purge: {
      enabled: true,
      onUpdate: true,
      onDelete: true,
    },
  },
  
  // Upload limits and validation
  upload: {
    // Maximum file size by type
    maxSize: {
      default: 10 * 1024 * 1024, // 10MB
      image: 5 * 1024 * 1024, // 5MB
      video: 100 * 1024 * 1024, // 100MB
      document: 20 * 1024 * 1024, // 20MB
      audio: 50 * 1024 * 1024, // 50MB
    },
    
    // Allowed MIME types
    allowedMimeTypes: {
      image: [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
      ],
      video: [
        'video/mp4',
        'video/quicktime',
        'video/x-msvideo',
        'video/x-ms-wmv',
        'video/webm',
      ],
      document: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
      ],
      audio: [
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/ogg',
        'audio/webm',
      ],
    },
    
    // File extension whitelist
    allowedExtensions: {
      image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
      video: ['.mp4', '.mov', '.avi', '.wmv', '.webm'],
      document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'],
      audio: ['.mp3', '.wav', '.ogg', '.webm'],
    },
    
    // Field limits
    fields: {
      maxFieldsSize: 2 * 1024 * 1024, // 2MB for all fields
      maxFields: 20,
      maxFileSize: 100 * 1024 * 1024, // 100MB absolute max
    },
  },
  
  // File type restrictions
  restrictions: {
    // Blocked file extensions
    blockedExtensions: [
      '.exe', '.bat', '.cmd', '.com', '.pif', '.scr',
      '.vbs', '.js', '.jar', '.zip', '.rar', '.7z',
    ],
    
    // Blocked MIME types
    blockedMimeTypes: [
      'application/x-executable',
      'application/x-sharedlib',
      'application/x-msdownload',
    ],
    
    // Magic number validation
    validateMagicNumbers: true,
    
    // Filename sanitization
    sanitizeFilenames: true,
    filenameMaxLength: 255,
    
    // Path traversal prevention
    preventPathTraversal: true,
  },
  
  // Virus scanning settings
  virusScanning: {
    enabled: process.env.VIRUS_SCAN_ENABLED === 'true',
    
    // Scanner provider
    provider: process.env.VIRUS_SCAN_PROVIDER || 'clamav', // 'clamav' | 'virustotal' | 'custom'
    
    // ClamAV settings
    clamav: {
      host: process.env.CLAMAV_HOST || 'localhost',
      port: parseInt(process.env.CLAMAV_PORT, 10) || 3310,
      timeout: 30000, // 30 seconds
      
      // Scan options
      options: {
        removeInfected: true,
        quarantineInfected: true,
        scanArchives: true,
        scanPE: true,
        scanELF: true,
        scanOLE2: true,
        scanHTML: true,
        scanMail: true,
      },
    },
    
    // VirusTotal settings
    virustotal: {
      apiKey: process.env.VIRUSTOTAL_API_KEY,
      timeout: 60000, // 60 seconds
      threshold: 3, // Number of engines that must detect malware
    },
    
    // Actions on detection
    actions: {
      onDetection: 'reject', // 'reject' | 'quarantine' | 'clean'
      notifyAdmin: true,
      logDetection: true,
    },
  },
  
  // Backup configuration
  backup: {
    enabled: process.env.BACKUP_ENABLED === 'true',
    
    // Backup schedule
    schedule: process.env.BACKUP_SCHEDULE || '0 3 * * *', // Daily at 3 AM
    
    // Backup destinations
    destinations: {
      s3: {
        enabled: true,
        bucket: process.env.BACKUP_S3_BUCKET || 'tickettoken-backups',
        prefix: 'storage-backups/',
        storageClass: 'GLACIER',
      },
      
      external: {
        enabled: process.env.BACKUP_EXTERNAL_ENABLED === 'true',
        provider: process.env.BACKUP_EXTERNAL_PROVIDER,
        credentials: {
          apiKey: process.env.BACKUP_EXTERNAL_API_KEY,
        },
      },
    },
    
    // Retention policy
    retention: {
      daily: 7, // Keep 7 daily backups
      weekly: 4, // Keep 4 weekly backups
      monthly: 12, // Keep 12 monthly backups
      yearly: 5, // Keep 5 yearly backups
    },
    
    // Encryption
    encryption: {
      enabled: true,
      algorithm: 'aes-256-gcm',
      key: process.env.BACKUP_ENCRYPTION_KEY,
    },
  },
  
  // Access control settings
  accessControl: {
    // Default permissions
    defaultPermissions: {
      owner: 'rw',
      group: 'r',
      others: 'none',
    },
    
    // Token-based access
    tokenAccess: {
      enabled: true,
      expiresIn: 3600, // 1 hour
      maxUses: null, // Unlimited
    },
    
    // IP whitelist for direct access
    ipWhitelist: process.env.STORAGE_IP_WHITELIST?.split(',') || [],
    
    // Rate limiting for downloads
    rateLimiting: {
      enabled: true,
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100,
      maxBandwidth: 100 * 1024 * 1024, // 100MB per minute
    },
    
    // Hotlink protection
    hotlinkProtection: {
      enabled: true,
      allowedDomains: [
        'tickettoken.com',
        '*.tickettoken.com',
        'localhost',
      ],
      redirectUrl: '/images/hotlink-protected.png',
    },
  },
  
  // Image processing
  imageProcessing: {
    enabled: true,
    
    // Sharp library options
    sharp: {
      failOnError: false,
      cache: true,
      cacheSize: 200 * 1024 * 1024, // 200MB
    },
    
    // Automatic optimization
    autoOptimize: {
      enabled: true,
      quality: {
        jpeg: 85,
        png: 90,
        webp: 80,
      },
      
      // Convert to WebP when supported
      convertToWebP: true,
      
      // Strip metadata
      stripMetadata: true,
    },
    
    // Responsive images
    responsive: {
      enabled: true,
      breakpoints: [320, 640, 768, 1024, 1280, 1920],
      formats: ['original', 'webp'],
    },
    
    // Thumbnails
    thumbnails: {
      small: { width: 150, height: 150, fit: 'cover' },
      medium: { width: 300, height: 300, fit: 'cover' },
      large: { width: 600, height: 600, fit: 'inside' },
    },
    
    // Watermarking
    watermark: {
      enabled: process.env.WATERMARK_ENABLED === 'true',
      image: process.env.WATERMARK_IMAGE_PATH,
      position: 'southeast',
      opacity: 0.5,
    },
  },
  
  // Monitoring and metrics
  monitoring: {
    // Track metrics
    metrics: {
      uploads: true,
      downloads: true,
      storage: true,
      bandwidth: true,
      errors: true,
    },
    
    // Alerts
    alerts: {
      storageThreshold: 90, // Alert when storage is 90% full
      bandwidthThreshold: 80, // Alert when bandwidth is 80% of limit
      errorRate: 5, // Alert when error rate exceeds 5%
    },
  },
};

/**
 * Create storage directories if they don't exist
 */
function ensureDirectories() {
  const fs = require('fs');
  
  if (storageConfig.defaultProvider === 'local') {
    const dirs = [
      storageConfig.providers.local.baseDir,
      storageConfig.providers.local.cleanup.tempDir,
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
}

/**
 * Validate storage configuration
 */
function validateConfig() {
  const provider = storageConfig.providers[storageConfig.defaultProvider];
  
  if (!provider || !provider.enabled) {
    throw new Error(`Storage provider ${storageConfig.defaultProvider} is not enabled`);
  }
  
  // Validate S3 configuration
  if (storageConfig.defaultProvider === 's3') {
    if (!provider.credentials.accessKeyId || !provider.credentials.secretAccessKey) {
      throw new Error('S3 credentials are required');
    }
    if (!provider.bucket.name) {
      throw new Error('S3 bucket name is required');
    }
  }
  
  // Validate IPFS configuration
  if (storageConfig.defaultProvider === 'ipfs') {
    if (provider.pinning.service === 'pinata' && 
        (!provider.pinning.pinata.apiKey || !provider.pinning.pinata.secretKey)) {
      throw new Error('Pinata API credentials are required');
    }
  }
  
  // Validate virus scanning
  if (storageConfig.virusScanning.enabled) {
    if (storageConfig.virusScanning.provider === 'virustotal' && 
        !storageConfig.virusScanning.virustotal.apiKey) {
      throw new Error('VirusTotal API key is required');
    }
  }
}

// Initialize on module load
ensureDirectories();

// Run validation in production
if (process.env.NODE_ENV === 'production') {
  validateConfig();
}

module.exports = storageConfig;
