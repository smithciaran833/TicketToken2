const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');
const xss = require('xss');
const validator = require('validator');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const csrf = require('csurf');
const ipfilter = require('express-ipfilter').IpFilter;
const slowDown = require('express-slow-down');
const logger = require('../utils/logger');

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const ENABLE_REDIS = process.env.ENABLE_REDIS !== 'false';
const MAX_REQUEST_SIZE = process.env.MAX_REQUEST_SIZE || '10mb';
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 15; // minutes
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100;
const STRICT_RATE_LIMIT_MAX = parseInt(process.env.STRICT_RATE_LIMIT_MAX) || 5;

// Security configuration
const TRUSTED_PROXIES = process.env.TRUSTED_PROXIES ? 
  process.env.TRUSTED_PROXIES.split(',').map(ip => ip.trim()) : 
  ['127.0.0.1', '::1'];

const IP_WHITELIST = process.env.IP_WHITELIST ? 
  process.env.IP_WHITELIST.split(',').map(ip => ip.trim()) : 
  [];

const IP_BLACKLIST = process.env.IP_BLACKLIST ? 
  process.env.IP_BLACKLIST.split(',').map(ip => ip.trim()) : 
  [];

// Create Redis client for rate limiting
let redisClient = null;
if (ENABLE_REDIS) {
  try {
    redisClient = redis.createClient({
      url: REDIS_URL,
      retry_unfulfilled_commands: true,
      retry_delay_on_failover: 100,
      enable_offline_queue: false
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected for rate limiting');
    });

    // Initialize Redis connection
    redisClient.connect().catch(err => {
      logger.error('Failed to connect to Redis:', err);
      redisClient = null;
    });
  } catch (error) {
    logger.error('Redis setup error:', error);
    redisClient = null;
  }
}

// Utility functions
const getClientIP = (req) => {
  return req.ip || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         'unknown';
};

const isPrivateIP = (ip) => {
  if (!ip || ip === 'unknown') return false;
  
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^::1$/,
    /^fe80:/,
    /^fc00:/,
    /^fd00:/
  ];
  
  return privateRanges.some(range => range.test(ip));
};

const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    // XSS protection
    input = xss(input, {
      whiteList: {}, // Allow no HTML tags
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script']
    });
    
    // Additional sanitization
    input = input.replace(/[<>]/g, '');
    input = validator.escape(input);
  }
  
  return input;
};

const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

// Security event logger
const logSecurityEvent = (event, req, details = {}) => {
  const securityEvent = {
    type: 'security_violation',
    event: event,
    ip: getClientIP(req),
    userAgent: req.headers['user-agent'],
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    requestId: req.id,
    userId: req.user?.id,
    details: details
  };
  
  logger.warn('Security event detected', securityEvent);
  
  // In production, send to SIEM or security monitoring service
  if (NODE_ENV === 'production') {
    // Example: securityMonitor.reportViolation(securityEvent);
  }
};

// Helmet configuration for security headers
const helmetConfig = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Only for development
        ...(NODE_ENV === 'development' ? ["'unsafe-eval'"] : []),
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdnjs.cloudflare.com"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "blob:"
      ],
      connectSrc: [
        "'self'",
        "https://api.yourapp.com",
        ...(NODE_ENV === 'development' ? ["http://localhost:*", "ws://localhost:*"] : [])
      ],
      mediaSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: NODE_ENV === 'production' ? [] : null
    },
    reportOnly: NODE_ENV === 'development'
  },
  
  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  
  // X-Frame-Options
  frameguard: {
    action: 'deny'
  },
  
  // X-Content-Type-Options
  noSniff: true,
  
  // Referrer Policy
  referrerPolicy: {
    policy: ['strict-origin-when-cross-origin']
  },
  
  // X-Permitted-Cross-Domain-Policies
  permittedCrossDomainPolicies: false,
  
  // X-DNS-Prefetch-Control
  dnsPrefetchControl: {
    allow: false
  },
  
  // Expect-CT
  expectCt: {
    maxAge: 30,
    enforce: NODE_ENV === 'production'
  }
});

// Rate limiting configuration
const createRateLimit = (options = {}) => {
  const defaultOptions = {
    windowMs: RATE_LIMIT_WINDOW * 60 * 1000, // Convert minutes to milliseconds
    max: options.max || RATE_LIMIT_MAX,
    message: {
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later',
      retryAfter: RATE_LIMIT_WINDOW * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    keyGenerator: (req) => {
      return req.ip || getClientIP(req);
    },
    handler: (req, res, next) => {
      logSecurityEvent('rate_limit_exceeded', req, {
        limit: options.max || RATE_LIMIT_MAX,
        windowMs: RATE_LIMIT_WINDOW * 60 * 1000
      });
      
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests from this IP, please try again later',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW * 60),
        requestId: req.id
      });
    },
    ...options
  };
  
  // Use Redis store if available
  if (redisClient && ENABLE_REDIS) {
    defaultOptions.store = new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args)
    });
  }
  
  return rateLimit(defaultOptions);
};

// Different rate limits for different endpoints
const generalRateLimit = createRateLimit({
  max: RATE_LIMIT_MAX,
  message: 'Too many requests from this IP'
});

const strictRateLimit = createRateLimit({
  max: STRICT_RATE_LIMIT_MAX,
  windowMs: 15 * 60 * 1000, // 15 minutes
  message: 'Too many requests to this endpoint'
});

const authRateLimit = createRateLimit({
  max: 5, // 5 attempts per window
  windowMs: 15 * 60 * 1000, // 15 minutes
  skipSuccessfulRequests: true, // Don't count successful requests
  message: 'Too many authentication attempts'
});

// Brute force protection with progressive delays
const bruteForceProtection = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 2, // Allow 2 requests per windowMs without delay
  delayMs: 500, // Add 500ms delay per request after delayAfter
  maxDelayMs: 20000, // Maximum delay of 20 seconds
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Use combination of IP and user ID for more granular control
    const ip = getClientIP(req);
    const user = req.body?.username || req.body?.email || '';
    return `${ip}:${user}`;
  },
  handler: (req, res, next) => {
    logSecurityEvent('brute_force_detected', req, {
      target: req.body?.username || req.body?.email,
      delay: req.slowDown.delay
    });
    next();
  }
});

// IP filtering middleware
const ipFilterMiddleware = (req, res, next) => {
  const clientIP = getClientIP(req);
  
  // Skip filtering for private IPs in development
  if (NODE_ENV === 'development' && isPrivateIP(clientIP)) {
    return next();
  }
  
  // Check whitelist first
  if (IP_WHITELIST.length > 0) {
    if (!IP_WHITELIST.includes(clientIP)) {
      logSecurityEvent('ip_not_whitelisted', req, { ip: clientIP });
      return res.status(403).json({
        error: 'Access denied',
        message: 'Your IP address is not authorized to access this resource',
        requestId: req.id
      });
    }
  }
  
  // Check blacklist
  if (IP_BLACKLIST.includes(clientIP)) {
    logSecurityEvent('ip_blacklisted', req, { ip: clientIP });
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP address has been blocked',
      requestId: req.id
    });
  }
  
  next();
};

// Request size limiting
const requestSizeLimit = require('express').raw({
  limit: MAX_REQUEST_SIZE,
  type: '*/*'
});

// Input sanitization middleware
const inputSanitization = (req, res, next) => {
  try {
    // Sanitize request body
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    
    // Sanitize query parameters
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    
    // Sanitize URL parameters
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }
    
    next();
  } catch (error) {
    logSecurityEvent('sanitization_error', req, { error: error.message });
    res.status(400).json({
      error: 'Invalid input',
      message: 'Request contains invalid or malicious content',
      requestId: req.id
    });
  }
};

// XSS protection middleware
const xssProtection = (req, res, next) => {
  // Check for common XSS patterns
  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload=/gi,
    /onerror=/gi,
    /onclick=/gi,
    /onfocus=/gi,
    /onmouseover=/gi
  ];
  
  const checkForXSS = (obj) => {
    if (typeof obj === 'string') {
      return xssPatterns.some(pattern => pattern.test(obj));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      return Object.values(obj).some(value => checkForXSS(value));
    }
    
    return false;
  };
  
  if (checkForXSS(req.body) || checkForXSS(req.query) || checkForXSS(req.params)) {
    logSecurityEvent('xss_attempt', req, {
      body: req.body,
      query: req.query,
      params: req.params
    });
    
    return res.status(400).json({
      error: 'Security violation',
      message: 'Request contains potentially malicious content',
      requestId: req.id
    });
  }
  
  next();
};

// SQL injection protection (for raw queries)
const sqlInjectionProtection = (req, res, next) => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
    /('|(\\')|(;)|(\|)|(\*)|(%)|(<|>)|(\\n)|(\\r))/gi,
    /(\b(OR|AND)\b.*=.*)/gi,
    /(\/\*[\s\S]*?\*\/)/gi
  ];
  
  const checkForSQL = (obj) => {
    if (typeof obj === 'string') {
      return sqlPatterns.some(pattern => pattern.test(obj));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      return Object.values(obj).some(value => checkForSQL(value));
    }
    
    return false;
  };
  
  if (checkForSQL(req.body) || checkForSQL(req.query) || checkForSQL(req.params)) {
    logSecurityEvent('sql_injection_attempt', req, {
      body: req.body,
      query: req.query,
      params: req.params
    });
    
    return res.status(400).json({
      error: 'Security violation',
      message: 'Request contains potentially malicious SQL content',
      requestId: req.id
    });
  }
  
  next();
};

// CSRF protection configuration
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000 // 1 hour
  },
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
  value: (req) => {
    return req.body?._csrf || 
           req.query?._csrf || 
           req.headers['x-csrf-token'] || 
           req.headers['x-xsrf-token'];
  }
});

// CSRF error handler
const csrfErrorHandler = (err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    logSecurityEvent('csrf_token_invalid', req, {
      token: req.body?._csrf || req.headers['x-csrf-token']
    });
    
    return res.status(403).json({
      error: 'CSRF token invalid',
      message: 'Invalid or missing CSRF token',
      requestId: req.id
    });
  }
  
  next(err);
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  // Add custom security headers
  res.setHeader('X-Request-ID', req.id);
  res.setHeader('X-Response-Time', Date.now() - req.startTime);
  
  // Add security policy headers
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  
  // Feature policy (Permissions Policy)
  res.setHeader('Permissions-Policy', 
    'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
  );
  
  next();
};

// Comprehensive security middleware stack
const securityStack = [
  // Trust proxy settings
  (req, res, next) => {
    req.app.set('trust proxy', TRUSTED_PROXIES);
    next();
  },
  
  // Security headers
  helmetConfig,
  securityHeaders,
  
  // IP filtering
  ipFilterMiddleware,
  
  // Rate limiting
  generalRateLimit,
  
  // Request size limiting
  require('express').json({ limit: MAX_REQUEST_SIZE }),
  require('express').urlencoded({ limit: MAX_REQUEST_SIZE, extended: true }),
  
  // NoSQL injection protection
  mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      logSecurityEvent('nosql_injection_attempt', req, { sanitizedKey: key });
    }
  }),
  
  // HTTP Parameter Pollution protection
  hpp({
    whitelist: ['tags', 'categories'] // Allow arrays for these parameters
  }),
  
  // Input sanitization
  inputSanitization,
  
  // XSS protection
  xssProtection,
  
  // SQL injection protection
  sqlInjectionProtection
];

// Authentication-specific security middleware
const authSecurity = [
  authRateLimit,
  bruteForceProtection
];

// CSRF protection for state-changing operations
const csrfSecurity = [
  csrfProtection,
  csrfErrorHandler
];

// Strict security for sensitive endpoints
const strictSecurity = [
  strictRateLimit,
  (req, res, next) => {
    // Additional validation for sensitive endpoints
    const suspiciousPatterns = [
      /\.\./g, // Path traversal
      /[<>'"]/g, // Potentially malicious characters
      /base64/gi, // Base64 encoded content
      /eval\(/gi // Code execution attempts
    ];
    
    const requestString = JSON.stringify({
      body: req.body,
      query: req.query,
      params: req.params
    });
    
    if (suspiciousPatterns.some(pattern => pattern.test(requestString))) {
      logSecurityEvent('suspicious_request_pattern', req, {
        patterns: 'detected'
      });
      
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Request contains suspicious patterns',
        requestId: req.id
      });
    }
    
    next();
  }
];

// Export middleware and utilities
module.exports = {
  // Main security stack
  security: securityStack,
  
  // Specialized middleware
  auth: authSecurity,
  csrf: csrfSecurity,
  strict: strictSecurity,
  
  // Individual middleware components
  helmet: helmetConfig,
  rateLimit: generalRateLimit,
  strictRateLimit: strictRateLimit,
  authRateLimit: authRateLimit,
  bruteForceProtection: bruteForceProtection,
  ipFilter: ipFilterMiddleware,
  inputSanitization: inputSanitization,
  xssProtection: xssProtection,
  sqlInjectionProtection: sqlInjectionProtection,
  
  // Utility functions
  sanitizeInput,
  sanitizeObject,
  logSecurityEvent,
  getClientIP,
  isPrivateIP,
  
  // Rate limit creators
  createRateLimit,
  
  // Configuration
  config: {
    rateLimitWindow: RATE_LIMIT_WINDOW,
    rateLimitMax: RATE_LIMIT_MAX,
    strictRateLimitMax: STRICT_RATE_LIMIT_MAX,
    maxRequestSize: MAX_REQUEST_SIZE,
    redisEnabled: ENABLE_REDIS && !!redisClient,
    trustedProxies: TRUSTED_PROXIES,
    ipWhitelist: IP_WHITELIST,
    ipBlacklist: IP_BLACKLIST
  }
};

// Log security middleware initialization
logger.info('Security middleware initialized', {
  environment: NODE_ENV,
  redisEnabled: ENABLE_REDIS && !!redisClient,
  rateLimiting: {
    window: RATE_LIMIT_WINDOW,
    general: RATE_LIMIT_MAX,
    strict: STRICT_RATE_LIMIT_MAX,
    auth: 5
  },
  ipFiltering: {
    whitelist: IP_WHITELIST.length,
    blacklist: IP_BLACKLIST.length
  },
  features: {
    helmet: true,
    csrf: true,
    xss: true,
    sqlInjection: true,
    bruteForce: true,
    inputSanitization: true
  }
});
