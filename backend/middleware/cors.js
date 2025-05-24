const cors = require('cors');
const logger = require('../utils/logger');

// Environment variables with fallbacks
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3000;

// Default allowed origins for different environments
const DEFAULT_ORIGINS = {
  development: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'http://localhost:8081',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:8081'
  ],
  test: [
    'http://localhost:3000',
    'http://localhost:8080'
  ],
  staging: [
    'https://staging.yourapp.com',
    'https://staging-admin.yourapp.com',
    'https://staging-api.yourapp.com'
  ],
  production: [
    'https://yourapp.com',
    'https://www.yourapp.com',
    'https://admin.yourapp.com',
    'https://api.yourapp.com',
    'https://app.yourapp.com'
  ]
};

// Parse allowed origins from environment variables
const parseAllowedOrigins = () => {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  
  if (envOrigins) {
    try {
      // Handle comma-separated string or JSON array
      if (envOrigins.startsWith('[')) {
        return JSON.parse(envOrigins);
      } else {
        return envOrigins.split(',').map(origin => origin.trim());
      }
    } catch (error) {
      logger.error('Error parsing CORS_ALLOWED_ORIGINS from environment:', error);
      logger.warn('Falling back to default origins for environment:', NODE_ENV);
    }
  }
  
  return DEFAULT_ORIGINS[NODE_ENV] || DEFAULT_ORIGINS.development;
};

// Get allowed origins
const allowedOrigins = parseAllowedOrigins();

// Validate origin against allowed list
const isOriginAllowed = (origin) => {
  // Allow requests with no origin (mobile apps, Postman, etc.)
  if (!origin) {
    return NODE_ENV === 'development' || process.env.ALLOW_NO_ORIGIN === 'true';
  }
  
  // Check exact matches
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  
  // Check wildcard patterns (only in development)
  if (NODE_ENV === 'development') {
    const wildcardPatterns = allowedOrigins.filter(pattern => pattern.includes('*'));
    return wildcardPatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(origin);
    });
  }
  
  return false;
};

// Log CORS violations
const logCorsViolation = (origin, req) => {
  const logData = {
    timestamp: new Date().toISOString(),
    origin: origin || 'no-origin',
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    headers: {
      referer: req.get('Referer'),
      host: req.get('Host'),
      'x-forwarded-for': req.get('X-Forwarded-For')
    }
  };
  
  logger.warn('CORS violation detected:', logData);
  
  // In production, you might want to send this to a security monitoring service
  if (NODE_ENV === 'production') {
    // Example: Send to security monitoring
    // securityMonitor.reportCorsViolation(logData);
  }
};

// Dynamic origin validation function
const originValidator = (origin, callback) => {
  if (isOriginAllowed(origin)) {
    logger.debug(`CORS: Origin allowed - ${origin || 'no-origin'}`);
    callback(null, true);
  } else {
    logger.warn(`CORS: Origin blocked - ${origin || 'no-origin'}`);
    
    // Create a detailed error for CORS violations
    const error = new Error(`CORS policy violation: Origin '${origin}' is not allowed`);
    error.statusCode = 403;
    error.code = 'CORS_VIOLATION';
    
    callback(error, false);
  }
};

// Main CORS configuration
const corsOptions = {
  // Dynamic origin validation
  origin: (origin, callback) => {
    // Log the origin request for debugging
    if (NODE_ENV === 'development') {
      logger.debug(`CORS origin check: ${origin || 'no-origin'}`);
    }
    
    originValidator(origin, callback);
  },
  
  // Enable credentials (cookies, authorization headers, TLS client certificates)
  credentials: true,
  
  // Allowed HTTP methods
  methods: [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'OPTIONS',
    'HEAD'
  ],
  
  // Allowed headers
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'Expires',
    'X-API-Key',
    'X-Client-Version',
    'X-Platform',
    'X-Request-ID',
    'X-Forwarded-For',
    'X-Real-IP',
    'User-Agent',
    'If-None-Match',
    'If-Modified-Since'
  ],
  
  // Headers exposed to the client
  exposedHeaders: [
    'Content-Length',
    'Content-Range',
    'X-Total-Count',
    'X-Page-Count',
    'X-Per-Page',
    'X-Rate-Limit-Limit',
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Reset',
    'ETag',
    'Last-Modified',
    'Link',
    'X-Request-ID'
  ],
  
  // Preflight cache duration (in seconds)
  maxAge: NODE_ENV === 'production' ? 86400 : 600, // 24 hours in prod, 10 minutes in dev
  
  // Handle preflight requests
  preflightContinue: false,
  
  // Provide a successful status for OPTIONS requests
  optionsSuccessStatus: 204
};

// Environment-specific CORS configurations
const getEnvironmentSpecificOptions = () => {
  const baseOptions = { ...corsOptions };
  
  switch (NODE_ENV) {
    case 'development':
      return {
        ...baseOptions,
        // More permissive in development
        origin: (origin, callback) => {
          // Allow localhost and common development patterns
          if (!origin || 
              origin.includes('localhost') || 
              origin.includes('127.0.0.1') || 
              origin.includes('192.168.') ||
              origin.includes('10.0.') ||
              isOriginAllowed(origin)) {
            callback(null, true);
          } else {
            originValidator(origin, callback);
          }
        },
        maxAge: 600, // 10 minutes
        // Additional debugging headers in development
        exposedHeaders: [
          ...baseOptions.exposedHeaders,
          'X-Debug-Info',
          'X-Environment'
        ]
      };
      
    case 'test':
      return {
        ...baseOptions,
        origin: true, // Allow all origins in test environment
        maxAge: 0 // No caching in tests
      };
      
    case 'staging':
      return {
        ...baseOptions,
        maxAge: 3600, // 1 hour
        // Stricter validation in staging
        origin: originValidator
      };
      
    case 'production':
      return {
        ...baseOptions,
        maxAge: 86400, // 24 hours
        // Strictest validation in production
        origin: originValidator,
        // Remove debug headers in production
        exposedHeaders: baseOptions.exposedHeaders.filter(header => 
          !header.startsWith('X-Debug')
        )
      };
      
    default:
      return baseOptions;
  }
};

// Create CORS middleware with environment-specific configuration
const corsMiddleware = cors(getEnvironmentSpecificOptions());

// Enhanced CORS middleware with additional features
const enhancedCorsMiddleware = (req, res, next) => {
  // Add request ID for tracking
  if (!req.id) {
    req.id = require('crypto').randomUUID();
  }
  
  // Log CORS requests in development
  if (NODE_ENV === 'development') {
    logger.debug(`CORS request: ${req.method} ${req.url}`, {
      origin: req.get('Origin'),
      userAgent: req.get('User-Agent'),
      requestId: req.id
    });
  }
  
  // Apply CORS middleware
  corsMiddleware(req, res, (err) => {
    if (err) {
      // Log CORS violation
      logCorsViolation(req.get('Origin'), req);
      
      // Send appropriate error response
      if (err.code === 'CORS_VIOLATION') {
        return res.status(403).json({
          error: 'CORS Policy Violation',
          message: 'Your origin is not allowed to access this resource',
          code: 'CORS_VIOLATION',
          requestId: req.id,
          timestamp: new Date().toISOString()
        });
      }
      
      // Handle other CORS errors
      logger.error('CORS middleware error:', err);
      return res.status(500).json({
        error: 'CORS Configuration Error',
        message: 'An error occurred while processing CORS policy',
        requestId: req.id,
        timestamp: new Date().toISOString()
      });
    }
    
    // Add security headers
    addSecurityHeaders(res);
    
    // Continue to next middleware
    next();
  });
};

// Add additional security headers
const addSecurityHeaders = (res) => {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy (basic)
  if (NODE_ENV === 'production') {
    res.setHeader('Content-Security-Policy', "default-src 'self'");
  }
  
  // HSTS (only in production with HTTPS)
  if (NODE_ENV === 'production' && process.env.HTTPS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
};

// Manual preflight handler for complex scenarios
const handlePreflight = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.get('Origin');
    const requestMethod = req.get('Access-Control-Request-Method');
    const requestHeaders = req.get('Access-Control-Request-Headers');
    
    logger.debug('Handling preflight request:', {
      origin,
      method: requestMethod,
      headers: requestHeaders,
      requestId: req.id
    });
    
    // Validate origin
    if (!isOriginAllowed(origin)) {
      logCorsViolation(origin, req);
      return res.status(403).json({
        error: 'CORS Policy Violation',
        message: 'Preflight request from unauthorized origin',
        code: 'CORS_PREFLIGHT_VIOLATION',
        requestId: req.id
      });
    }
    
    // Set CORS headers for preflight
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Max-Age', corsOptions.maxAge);
    
    // Add security headers
    addSecurityHeaders(res);
    
    return res.status(204).end();
  }
  
  next();
};

// CORS health check endpoint
const corsHealthCheck = (req, res) => {
  const origin = req.get('Origin');
  const isAllowed = isOriginAllowed(origin);
  
  res.json({
    cors: {
      origin: origin || 'no-origin',
      allowed: isAllowed,
      environment: NODE_ENV,
      allowedOrigins: NODE_ENV === 'development' ? allowedOrigins : allowedOrigins.length,
      timestamp: new Date().toISOString()
    }
  });
};

// Export middleware and utilities
module.exports = {
  // Main CORS middleware
  cors: enhancedCorsMiddleware,
  
  // Manual preflight handler
  preflight: handlePreflight,
  
  // Health check
  healthCheck: corsHealthCheck,
  
  // Utility functions
  isOriginAllowed,
  
  // Configuration
  allowedOrigins,
  corsOptions: getEnvironmentSpecificOptions(),
  
  // Environment-specific middleware
  development: cors({
    ...getEnvironmentSpecificOptions(),
    origin: true // Allow all origins in development
  }),
  
  production: cors(getEnvironmentSpecificOptions()),
  
  // Strict CORS for sensitive endpoints
  strict: cors({
    ...getEnvironmentSpecificOptions(),
    origin: (origin, callback) => {
      // Even stricter validation for sensitive endpoints
      if (origin && allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        const error = new Error('Strict CORS: Origin not allowed for sensitive endpoint');
        error.statusCode = 403;
        callback(error, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST'], // Limited methods for sensitive endpoints
    maxAge: 0 // No caching for sensitive endpoints
  }),
  
  // Public CORS for public APIs
  public: cors({
    origin: true,
    credentials: false,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 86400
  })
};

// Log CORS configuration on startup
logger.info('CORS middleware configured:', {
  environment: NODE_ENV,
  allowedOrigins: NODE_ENV === 'development' ? allowedOrigins : `${allowedOrigins.length} origins`,
  credentialsEnabled: corsOptions.credentials,
  maxAge: corsOptions.maxAge,
  methods: corsOptions.methods,
  allowedHeaders: corsOptions.allowedHeaders.length
});
