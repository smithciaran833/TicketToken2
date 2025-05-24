const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// =============================================================================
// LOGGING CONFIGURATION
// =============================================================================

/**
 * Log levels with priorities
 */
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

/**
 * Log colors for console output
 */
const LOG_COLORS = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

/**
 * Environment configuration
 */
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// =============================================================================
// LOG DIRECTORY SETUP
// =============================================================================

/**
 * Ensure log directory exists
 */
const ensureLogDirectory = () => {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
};

// Create log directory on module load
ensureLogDirectory();

// =============================================================================
// CUSTOM FORMATS
// =============================================================================

/**
 * Custom format for console logging with colors
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, correlationId, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    const corrId = correlationId ? `[${correlationId}] ` : '';
    return `${timestamp} [${level}] ${corrId}${message}${metaStr}`;
  })
);

/**
 * Custom format for file logging with structured data
 */
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    // Add environment and service information
    const logEntry = {
      ...info,
      environment: NODE_ENV,
      service: process.env.SERVICE_NAME || 'ticketing-backend',
      version: process.env.APP_VERSION || '1.0.0',
      hostname: require('os').hostname(),
      pid: process.pid
    };
    return JSON.stringify(logEntry);
  })
);

/**
 * Error format for detailed error logging
 */
const errorFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const logEntry = {
      ...info,
      environment: NODE_ENV,
      service: process.env.SERVICE_NAME || 'ticketing-backend',
      hostname: require('os').hostname(),
      pid: process.pid,
      // Add additional error context
      errorType: info.error?.name || 'UnknownError',
      errorCode: info.error?.code || info.statusCode,
      userAgent: info.userAgent,
      ip: info.ip,
      userId: info.userId,
      requestId: info.correlationId || info.requestId
    };
    return JSON.stringify(logEntry);
  })
);

// =============================================================================
// TRANSPORTS CONFIGURATION
// =============================================================================

/**
 * Console transport for development
 */
const consoleTransport = new winston.transports.Console({
  level: LOG_LEVEL,
  format: consoleFormat,
  handleExceptions: true,
  handleRejections: true
});

/**
 * File transport for combined logs
 */
const fileTransport = new winston.transports.File({
  level: LOG_LEVEL,
  filename: path.join(LOG_DIR, 'combined.log'),
  format: fileFormat,
  maxsize: 10 * 1024 * 1024, // 10MB
  maxFiles: 10,
  tailable: true,
  handleExceptions: false
});

/**
 * File transport for error logs only
 */
const errorFileTransport = new winston.transports.File({
  level: 'error',
  filename: path.join(LOG_DIR, 'error.log'),
  format: errorFormat,
  maxsize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  tailable: true,
  handleExceptions: true,
  handleRejections: true
});

/**
 * Daily rotate file transport for production
 */
const DailyRotateFile = require('winston-daily-rotate-file');

const dailyRotateTransport = new DailyRotateFile({
  level: LOG_LEVEL,
  filename: path.join(LOG_DIR, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  format: fileFormat,
  maxSize: '20m',
  maxFiles: '30d',
  compress: true,
  handleExceptions: false
});

const dailyErrorRotateTransport = new DailyRotateFile({
  level: 'error',
  filename: path.join(LOG_DIR, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  format: errorFormat,
  maxSize: '20m',
  maxFiles: '30d',
  compress: true,
  handleExceptions: true,
  handleRejections: true
});

// =============================================================================
// WINSTON LOGGER CONFIGURATION
// =============================================================================

/**
 * Configure transports based on environment
 */
const getTransports = () => {
  const transports = [];

  // Always include console in development
  if (NODE_ENV === 'development' || NODE_ENV === 'test') {
    transports.push(consoleTransport);
  }

  // File logging for all environments except test
  if (NODE_ENV !== 'test') {
    if (NODE_ENV === 'production') {
      // Use daily rotation in production
      transports.push(dailyRotateTransport, dailyErrorRotateTransport);
    } else {
      // Use regular file transport in staging/development
      transports.push(fileTransport, errorFileTransport);
    }
  }

  return transports;
};

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: LOG_LEVEL,
  levels: LOG_LEVELS,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] })
  ),
  transports: getTransports(),
  exitOnError: false,
  silent: NODE_ENV === 'test' && !process.env.ENABLE_TEST_LOGS
});

// Set colors for console output
winston.addColors(LOG_COLORS);

// =============================================================================
// CORRELATION ID MIDDLEWARE
// =============================================================================

/**
 * Express middleware to add correlation IDs to requests
 */
const correlationMiddleware = (req, res, next) => {
  // Generate or use existing correlation ID
  const correlationId = req.headers['x-correlation-id'] || 
                       req.headers['x-request-id'] || 
                       uuidv4();
  
  // Store correlation ID in request
  req.correlationId = correlationId;
  
  // Add to response headers
  res.setHeader('x-correlation-id', correlationId);
  
  // Create request-scoped logger
  req.logger = logger.child({ correlationId });
  
  next();
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create child logger with additional context
 * @param {Object} context - Additional context to include in logs
 * @returns {Object} Child logger instance
 */
const createChildLogger = (context = {}) => {
  return logger.child(context);
};

/**
 * Log HTTP request details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} duration - Request duration in milliseconds
 */
const logHttpRequest = (req, res, duration) => {
  const logData = {
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    correlationId: req.correlationId,
    userId: req.user?.id,
    contentLength: res.get('Content-Length'),
    referer: req.get('Referer')
  };

  const level = res.statusCode >= 400 ? 'warn' : 'info';
  const message = `${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${duration}ms`;
  
  logger.log(level, message, logData);
};

/**
 * Log database query with performance metrics
 * @param {string} query - SQL query or operation name
 * @param {number} duration - Query duration in milliseconds
 * @param {Object} metadata - Additional metadata
 */
const logDatabaseQuery = (query, duration, metadata = {}) => {
  const logData = {
    query: query.substring(0, 1000), // Truncate long queries
    duration: `${duration}ms`,
    ...metadata
  };

  const level = duration > 1000 ? 'warn' : 'debug';
  const message = `Database query executed in ${duration}ms`;
  
  logger.log(level, message, logData);
};

/**
 * Log authentication events
 * @param {string} event - Authentication event type
 * @param {Object} userData - User data (sanitized)
 * @param {Object} metadata - Additional metadata
 */
const logAuthEvent = (event, userData = {}, metadata = {}) => {
  const logData = {
    event,
    userId: userData.id,
    email: userData.email,
    ip: metadata.ip,
    userAgent: metadata.userAgent,
    correlationId: metadata.correlationId,
    success: metadata.success !== false
  };

  const level = logData.success ? 'info' : 'warn';
  const message = `Authentication event: ${event}`;
  
  logger.log(level, message, logData);
};

/**
 * Log business events (e.g., ticket purchases, event creation)
 * @param {string} event - Business event type
 * @param {Object} data - Event data
 * @param {Object} metadata - Additional metadata
 */
const logBusinessEvent = (event, data = {}, metadata = {}) => {
  const logData = {
    event,
    ...data,
    ...metadata,
    timestamp: new Date().toISOString()
  };

  logger.info(`Business event: ${event}`, logData);
};

/**
 * Log security events
 * @param {string} event - Security event type
 * @param {Object} data - Event data
 * @param {string} severity - Severity level
 */
const logSecurityEvent = (event, data = {}, severity = 'warn') => {
  const logData = {
    securityEvent: event,
    severity,
    ...data,
    timestamp: new Date().toISOString()
  };

  logger.log(severity, `Security event: ${event}`, logData);
};

/**
 * Log performance metrics
 * @param {string} operation - Operation name
 * @param {number} duration - Operation duration
 * @param {Object} metadata - Additional metadata
 */
const logPerformance = (operation, duration, metadata = {}) => {
  const logData = {
    operation,
    duration: `${duration}ms`,
    ...metadata
  };

  const level = duration > 5000 ? 'warn' : duration > 1000 ? 'info' : 'debug';
  const message = `Performance: ${operation} completed in ${duration}ms`;
  
  logger.log(level, message, logData);
};

/**
 * Log blockchain transactions
 * @param {string} txHash - Transaction hash
 * @param {string} operation - Blockchain operation
 * @param {Object} data - Transaction data
 */
const logBlockchainTransaction = (txHash, operation, data = {}) => {
  const logData = {
    txHash,
    operation,
    network: data.network,
    gasUsed: data.gasUsed,
    gasPrice: data.gasPrice,
    status: data.status,
    blockNumber: data.blockNumber,
    ...data
  };

  const level = data.status === 'failed' ? 'error' : 'info';
  const message = `Blockchain transaction: ${operation}`;
  
  logger.log(level, message, logData);
};

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
    type: 'uncaughtException'
  });
  
  // Give time for the log to be written
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString(),
    type: 'unhandledRejection'
  });
});

/**
 * Graceful shutdown logging
 */
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  // Close all transports
  logger.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// =============================================================================
// EXPRESS MIDDLEWARE
// =============================================================================

/**
 * Express middleware for request logging
 */
const requestLoggingMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Log request start
  logger.debug('Request started', {
    method: req.method,
    url: req.originalUrl || req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    correlationId: req.correlationId
  });
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - startTime;
    logHttpRequest(req, res, duration);
    originalEnd.apply(this, args);
  };
  
  next();
};

/**
 * Express error handling middleware
 */
const errorLoggingMiddleware = (error, req, res, next) => {
  const logData = {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.originalUrl || req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    correlationId: req.correlationId,
    userId: req.user?.id,
    statusCode: error.statusCode || 500
  };

  logger.error('Request error', logData);
  next(error);
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Main logger instance
  logger,
  
  // Middleware
  correlationMiddleware,
  requestLoggingMiddleware,
  errorLoggingMiddleware,
  
  // Utility functions
  createChildLogger,
  logHttpRequest,
  logDatabaseQuery,
  logAuthEvent,
  logBusinessEvent,
  logSecurityEvent,
  logPerformance,
  logBlockchainTransaction,
  
  // Direct logging methods
  error: (message, meta = {}) => logger.error(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
  debug: (message, meta = {}) => logger.debug(message, meta),
  
  // Logger configuration
  LOG_LEVELS,
  LOG_DIR
};
