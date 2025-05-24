const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
require('dotenv').config();

// Import database connection
const connectDB = require('./config/database');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/logging');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const eventRoutes = require('./routes/events');
const ticketRoutes = require('./routes/tickets');
const contentRoutes = require('./routes/content');
const marketplaceRoutes = require('./routes/marketplace');
const venueRoutes = require('./routes/venues');
const artistRoutes = require('./routes/artists');
const promoterRoutes = require('./routes/promoters');
const analyticsRoutes = require('./routes/analytics');
const notificationRoutes = require('./routes/notifications');
const paymentRoutes = require('./routes/payments');
const verificationRoutes = require('./routes/verification');

const app = express();

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', 1);

// Connect to MongoDB
connectDB();

// Security middleware - Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:3000'],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      process.env.ADMIN_PORTAL_URL || 'http://localhost:3001',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining']
};

app.use(cors(corsOptions));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 5000, // Production: 1000 requests per 15 min, Dev: 5000
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(15 * 60) // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil(15 * 60)
    });
  }
});

app.use(globalLimiter);

// Compression middleware
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Body parsing middleware
app.use(express.json({ 
  limit: process.env.MAX_JSON_SIZE || '50mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook verification if needed
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.MAX_FORM_SIZE || '50mb' 
}));

// Cookie parser
app.use(cookieParser(process.env.COOKIE_SECRET || 'fallback-cookie-secret'));

// Data sanitization against NoSQL query injection
app.use(mongoSanitize({
  allowDots: true,
  replaceWith: '_'
}));

// Data sanitization against XSS
app.use(xss());

// Prevent HTTP Parameter Pollution
app.use(hpp({
  whitelist: ['sort', 'fields', 'page', 'limit', 'category', 'tags', 'status']
}));

// Request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Custom request logging middleware
app.use(requestLogger);

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.requestId = require('crypto').randomBytes(16).toString('hex');
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// API Documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'TicketToken API v1.0',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      events: '/api/events',
      tickets: '/api/tickets',
      content: '/api/content',
      marketplace: '/api/marketplace',
      venues: '/api/venues',
      artists: '/api/artists',
      promoters: '/api/promoters',
      analytics: '/api/analytics',
      notifications: '/api/notifications',
      payments: '/api/payments',
      verification: '/api/verification'
    },
    documentation: '/api/docs',
    status: '/health'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'TicketToken API',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    memory: {
      used: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
      total: Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100,
      external: Math.round((process.memoryUsage().external / 1024 / 1024) * 100) / 100
    }
  };

  try {
    res.status(200).json({
      success: true,
      data: healthCheck
    });
  } catch (error) {
    healthCheck.status = 'ERROR';
    healthCheck.error = error.message;
    res.status(503).json({
      success: false,
      data: healthCheck
    });
  }
});

// Detailed health endpoint for monitoring
app.get('/health/detailed', (req, res) => {
  const mongoose = require('mongoose');
  
  const detailedHealth = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    checks: {
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      version: process.version,
      environment: process.env.NODE_ENV
    }
  };

  const statusCode = detailedHealth.checks.database === 'connected' ? 200 : 503;
  
  res.status(statusCode).json({
    success: statusCode === 200,
    data: detailedHealth
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/promoters', promoterRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/verification', verificationRoutes);

// Catch-all for API documentation redirect
app.get('/api/docs', (req, res) => {
  res.json({
    success: true,
    message: 'API Documentation',
    note: 'Full API documentation with interactive examples',
    postman: process.env.POSTMAN_DOCS_URL || 'https://documenter.getpostman.com/view/tickettoken-api',
    swagger: process.env.SWAGGER_DOCS_URL || '/api/swagger',
    openapi: {
      version: '3.0.0',
      format: 'Available at /api/openapi.json'
    },
    examples: {
      authentication: {
        login: 'POST /api/auth/login',
        register: 'POST /api/auth/register',
        refreshToken: 'POST /api/auth/refresh'
      },
      events: {
        list: 'GET /api/events',
        create: 'POST /api/events',
        details: 'GET /api/events/:id'
      }
    }
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    suggestion: 'Check /api for available endpoints',
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});

// General 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    suggestion: 'Visit /api for API documentation or /health for service status',
    timestamp: new Date().toISOString()
  });
});

// Global error handling middleware (must be last)
app.use(errorHandler);

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.error(`❌ Unhandled Promise Rejection: ${err.message}`);
  console.error(err.stack);
  // Close server & exit process
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`❌ Uncaught Exception: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

module.exports = app;
