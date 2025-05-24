const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const crypto = require('crypto');
const onHeaders = require('on-headers');
const onFinished = require('on-finished');

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../logs');
const LOG_REQUESTS = process.env.LOG_REQUESTS !== 'false';
const LOG_BODIES = process.env.LOG_BODIES === 'true';
const LOG_RESPONSES = process.env.LOG_RESPONSES === 'true';
const SLOW_REQUEST_THRESHOLD = parseInt(process.env.SLOW_REQUEST_THRESHOLD) || 1000; // ms

// Sensitive fields to redact from logs
const SENSITIVE_FIELDS = [
  'password', 'token', 'secret', 'key', 'authorization', 'auth',
  'cookie', 'session', 'csrf', 'api_key', 'apikey', 'access_token',
  'refresh_token', 'jwt', 'bearer', 'x-api-key', 'x-auth-token',
  'credit_card', 'creditcard', 'ccn', 'ssn', 'social_security',
  'private_key', 'privatekey', 'wallet_private_key', 'mnemonic'
];

// Request body size limit for logging (in bytes)
const MAX_BODY_SIZE = parseInt(process.env.MAX_LOG_BODY_SIZE) || 10000; // 10KB

// Custom log format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...meta
    });
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, requestId, method, url, statusCode, responseTime, userId, ...meta }) => {
    let logLine = `${timestamp} [${level}]`;
    
    if (requestId) {
      logLine += ` [${requestId.substring(0, 8)}]`;
    }
    
    if (method && url) {
      logLine += ` ${method} ${url}`;
    }
    
    if (statusCode) {
      logLine += ` ${statusCode}`;
    }
    
    if (responseTime) {
      logLine += ` ${responseTime}ms`;
    }
    
    if (userId) {
      logLine += ` user:${userId}`;
    }
    
    logLine += ` ${message}`;
    
    if (Object.keys(meta).length > 0) {
      logLine += ` ${JSON.stringify(meta)}`;
    }
    
    return logLine;
  })
);

// Create log directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Winston logger configuration
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: logFormat,
  defaultMeta: {
    service: 'token-gated-platform',
    environment: NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0'
  },
  transports: [
    // Console transport for development
    ...(NODE_ENV === 'development' ? [
      new winston.transports.Console({
        format: consoleFormat,
        level: 'debug'
      })
    ] : []),
    
    // File transports with rotation
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '30d',
      level: 'info',
      format: logFormat
    }),
    
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '90d',
      level: 'error',
      format: logFormat
    }),
    
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'requests-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '500m',
      maxFiles: '7d',
      level: 'http',
      format: logFormat
    }),
    
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'performance-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '14d',
      level: 'warn',
      format: logFormat,
      // Only log performance-related entries
      filter: (info) => info.type === 'performance'
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '30d'
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '100m',
      maxFiles: '30d'
    })
  ]
});

// Add HTTP level to Winston
winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'cyan',
  debug: 'blue'
});

// Utility functions
const generateRequestId = () => {
  return crypto.randomUUID();
};

const redactSensitiveData = (obj, depth = 0) => {
  if (depth > 5 || !obj || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, depth + 1));
  }
  
  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some(field => 
      lowerKey.includes(field.toLowerCase())
    );
    
    if (isSensitive) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
};

const getClientIP = (req) => {
  return req.ip || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         (req.connection?.socket ? req.connection.socket.remoteAddress : null) ||
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         'unknown';
};

const getUserAgent = (req) => {
  return req.headers['user-agent'] || 'unknown';
};

const getRequestSize = (req) => {
  const contentLength = req.headers['content-length'];
  return contentLength ? parseInt(contentLength, 10) : 0;
};

const sanitizeUrl = (url) => {
  // Remove query parameters that might contain sensitive data
  const sensitiveParams = ['token', 'key', 'secret', 'password', 'auth'];
  const urlObj = new URL(url, 'http://localhost');
  
  for (const param of sensitiveParams) {
    if (urlObj.searchParams.has(param)) {
      urlObj.searchParams.set(param, '[REDACTED]');
    }
  }
  
  return urlObj.pathname + urlObj.search;
};

const shouldLogBody = (req, res) => {
  if (!LOG_BODIES) return false;
  
  // Don't log large bodies
  const contentLength = getRequestSize(req);
  if (contentLength > MAX_BODY_SIZE) return false;
  
  // Don't log file uploads
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) return false;
  if (contentType.includes('application/octet-stream')) return false;
  
  // Don't log binary content
  const binaryTypes = ['image/', 'video/', 'audio/', 'application/pdf'];
  if (binaryTypes.some(type => contentType.includes(type))) return false;
  
  return true;
};

// Request logging middleware
const requestLoggingMiddleware = (req, res, next) => {
  // Skip logging for certain routes
  const skipRoutes = ['/health', '/ping', '/favicon.ico'];
  if (skipRoutes.some(route => req.url.startsWith(route))) {
    return next();
  }
  
  // Generate request ID
  req.id = generateRequestId();
  res.set('X-Request-ID', req.id);
  
  // Capture start time
  const startTime = Date.now();
  req.startTime = startTime;
  
  // Extract request information
  const requestInfo = {
    requestId: req.id,
    method: req.method,
    url: sanitizeUrl(req.url),
    originalUrl: req.originalUrl,
    ip: getClientIP(req),
    userAgent: getUserAgent(req),
    referer: req.headers.referer || req.headers.referrer,
    contentType: req.headers['content-type'],
    contentLength: getRequestSize(req),
    host: req.headers.host,
    protocol: req.protocol,
    secure: req.secure,
    httpVersion: req.httpVersion,
    headers: redactSensitiveData(req.headers)
  };
  
  // Add user information if authenticated
  if (req.user) {
    requestInfo.userId = req.user.id || req.user._id;
    requestInfo.userType = req.user.type || req.user.role;
    requestInfo.username = req.user.username;
  }
  
  // Log request body if enabled and appropriate
  if (shouldLogBody(req, res) && req.body) {
    requestInfo.requestBody = redactSensitiveData(req.body);
  }
  
  // Store request info for response logging
  req.logInfo = requestInfo;
  
  // Log incoming request
  if (LOG_REQUESTS) {
    logger.http('Incoming request', requestInfo);
  }
  
  // Capture response data
  let responseBody;
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override res.send to capture response body
  res.send = function(body) {
    if (LOG_RESPONSES && shouldLogBody(req, res)) {
      try {
        responseBody = typeof body === 'string' ? JSON.parse(body) : body;
      } catch (e) {
        responseBody = body;
      }
    }
    return originalSend.call(this, body);
  };
  
  // Override res.json to capture response body
  res.json = function(obj) {
    if (LOG_RESPONSES && shouldLogBody(req, res)) {
      responseBody = obj;
    }
    return originalJson.call(this, obj);
  };
  
  // Log response when finished
  onFinished(res, (err, res) => {
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    const responseSize = res.get('content-length') || 0;
    
    const responseInfo = {
      ...requestInfo,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      responseTime,
      responseSize,
      timestamp: new Date().toISOString()
    };
    
    // Add response body if logging is enabled
    if (responseBody && LOG_RESPONSES) {
      responseInfo.responseBody = redactSensitiveData(responseBody);
    }
    
    // Add error information if present
    if (err) {
      responseInfo.error = {
        message: err.message,
        stack: err.stack,
        code: err.code
      };
    }
    
    // Determine log level based on status code and response time
    let logLevel = 'http';
    let logMessage = 'Request completed';
    
    if (res.statusCode >= 500) {
      logLevel = 'error';
      logMessage = 'Request failed with server error';
    } else if (res.statusCode >= 400) {
      logLevel = 'warn';
      logMessage = 'Request failed with client error';
    } else if (responseTime > SLOW_REQUEST_THRESHOLD) {
      logLevel = 'warn';
      logMessage = 'Slow request detected';
      responseInfo.type = 'performance';
      responseInfo.performanceIssue = 'slow_request';
    }
    
    // Log response
    logger.log(logLevel, logMessage, responseInfo);
    
    // Log performance metrics for slow requests
    if (responseTime > SLOW_REQUEST_THRESHOLD) {
      logger.warn('Performance issue detected', {
        type: 'performance',
        issue: 'slow_request',
        threshold: SLOW_REQUEST_THRESHOLD,
        actual: responseTime,
        requestId: req.id,
        method: req.method,
        url: req.url,
        userId: req.user?.id
      });
    }
  });
  
  next();
};

// Error logging middleware
const errorLoggingMiddleware = (err, req, res, next) => {
  const errorInfo = {
    requestId: req.id,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      status: err.status || err.statusCode
    },
    request: {
      method: req.method,
      url: req.url,
      ip: getClientIP(req),
      userAgent: getUserAgent(req),
      userId: req.user?.id,
      body: shouldLogBody(req, res) ? redactSensitiveData(req.body) : undefined
    },
    timestamp: new Date().toISOString()
  };
  
  // Log error with appropriate level
  if (err.status >= 500 || !err.status) {
    logger.error('Server error occurred', errorInfo);
  } else if (err.status >= 400) {
    logger.warn('Client error occurred', errorInfo);
  } else {
    logger.info('Error handled', errorInfo);
  }
  
  next(err);
};

// Performance monitoring middleware
const performanceMiddleware = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    
    // Track memory usage
    const memUsage = process.memoryUsage();
    
    const performanceData = {
      requestId: req.id,
      type: 'performance',
      metrics: {
        responseTime: duration,
        memoryUsage: {
          rss: memUsage.rss,
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external
        },
        cpuUsage: process.cpuUsage()
      },
      request: {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode
      },
      timestamp: new Date().toISOString()
    };
    
    // Log performance data for analysis
    logger.debug('Performance metrics', performanceData);
    
    // Alert on performance issues
    if (duration > SLOW_REQUEST_THRESHOLD) {
      logger.warn('Performance alert: Slow request', {
        ...performanceData,
        alert: 'slow_request',
        threshold: SLOW_REQUEST_THRESHOLD
      });
    }
    
    if (memUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
      logger.warn('Performance alert: High memory usage', {
        ...performanceData,
        alert: 'high_memory',
        heapUsed: memUsage.heapUsed
      });
    }
  });
  
  next();
};

// Request correlation middleware
const correlationMiddleware = (req, res, next) => {
  // Extract correlation ID from headers or generate new one
  const correlationId = req.headers['x-correlation-id'] || 
                       req.headers['x-request-id'] || 
                       req.id || 
                       generateRequestId();
  
  req.correlationId = correlationId;
  res.set('X-Correlation-ID', correlationId);
  
  // Add correlation ID to all logs for this request
  const originalLog = logger.log;
  logger.log = function(level, message, meta = {}) {
    return originalLog.call(this, level, message, {
      ...meta,
      correlationId: correlationId
    });
  };
  
  next();
};

// Security event logging
const securityEventLogger = (event, req, details = {}) => {
  const securityEvent = {
    type: 'security',
    event: event,
    requestId: req.id,
    correlationId: req.correlationId,
    ip: getClientIP(req),
    userAgent: getUserAgent(req),
    url: req.url,
    method: req.method,
    userId: req.user?.id,
    timestamp: new Date().toISOString(),
    details: redactSensitiveData(details)
  };
  
  logger.warn('Security event detected', securityEvent);
  
  // In production, you might want to send this to a SIEM system
  if (NODE_ENV === 'production') {
    // Example: Send to security monitoring
    // securityMonitor.logEvent(securityEvent);
  }
};

// Database query logging
const queryLogger = (query, duration, error = null) => {
  const queryLog = {
    type: 'database',
    query: query.toString().substring(0, 1000), // Limit query length
    duration,
    error: error ? {
      message: error.message,
      code: error.code
    } : null,
    timestamp: new Date().toISOString()
  };
  
  if (error) {
    logger.error('Database query failed', queryLog);
  } else if (duration > 1000) { // Slow query threshold
    logger.warn('Slow database query detected', queryLog);
  } else {
    logger.debug('Database query executed', queryLog);
  }
};

// Cleanup old logs
const cleanupLogs = () => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    files.forEach(file => {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        logger.info('Cleaned up old log file', { file: filePath });
      }
    });
  } catch (error) {
    logger.error('Error cleaning up logs', { error: error.message });
  }
};

// Schedule log cleanup (daily)
if (NODE_ENV === 'production') {
  setInterval(cleanupLogs, 24 * 60 * 60 * 1000);
}

// Export middleware and utilities
module.exports = {
  // Main logging middleware
  requestLogger: requestLoggingMiddleware,
  errorLogger: errorLoggingMiddleware,
  performanceLogger: performanceMiddleware,
  correlationLogger: correlationMiddleware,
  
  // Combined middleware
  all: [
    correlationMiddleware,
    requestLoggingMiddleware,
    performanceMiddleware
  ],
  
  // Logger instance
  logger,
  
  // Utility functions
  securityEventLogger,
  queryLogger,
  redactSensitiveData,
  generateRequestId,
  cleanupLogs,
  
  // Configuration
  config: {
    logLevel: LOG_LEVEL,
    logDir: LOG_DIR,
    logRequests: LOG_REQUESTS,
    logBodies: LOG_BODIES,
    logResponses: LOG_RESPONSES,
    slowRequestThreshold: SLOW_REQUEST_THRESHOLD,
    maxBodySize: MAX_BODY_SIZE
  }
};

// Log startup information
logger.info('Logging middleware initialized', {
  logLevel: LOG_LEVEL,
  environment: NODE_ENV,
  logDir: LOG_DIR,
  features: {
    requestLogging: LOG_REQUESTS,
    bodyLogging: LOG_BODIES,
    responseLogging: LOG_RESPONSES,
    performanceMonitoring: true,
    errorTracking: true,
    securityEvents: true
  },
  thresholds: {
    slowRequest: SLOW_REQUEST_THRESHOLD,
    maxBodySize: MAX_BODY_SIZE
  }
});
