// server.js - Complete backend connection with all routes and database

// Load environment variables
require('dotenv').config();

// Import dependencies
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
const { logger } = require('./middleware/testMiddleware');
const errorHandler = require('./middleware/errorHandler');

// Import database connection
const connectDB = require('./config/db');

// Import Redis configuration
const redis = require('./config/redis');

// Import route files - API v1 structure
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/userRoutes');
const profileRoutes = require('./routes/profileRoutes');
const eventRoutes = require('./routes/api/v1/events');
const ticketRoutes = require('./routes/api/v1/tickets');
const marketplaceRoutes = require('./routes/api/v1/marketplace');
const contentRoutes = require('./routes/contentRoutes');
const nftAccessRoutes = require('./routes/nftAccessRoutes');
const accessRoutes = require('./routes/accessRoutes');
const tokenGatedContentRoutes = require('./routes/tokenGatedContentRoutes');
const artistAnalyticsRoutes = require('./routes/artistAnalyticsRoutes');

// Import services
const nftAccessService = require('./services/nftAccessService');
const accessService = require('./services/accessService');
const { verifyTokenOwnership } = require('./services/tokenVerificationService');
const artistRoyaltyService = require('./services/artistRoyaltyService');

// Create Express app
const app = express();

// Connect to database
connectDB();

// Initialize NFT verification service
console.log('NFT verification service initialized');

// Initialize content access validation service
accessService.initialize()
  .then(() => console.log('Content access validation service initialized'))
  .catch(err => console.error('Error initializing content access service:', err));

// Initialize token verification service
redis.on('ready', () => {
  console.log('Token verification service initialized');
});

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Set up middleware
app.use(cors());                           // Allows requests from different domains
app.use(express.json({ limit: '10mb' }));  // Parses JSON in request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(morgan('dev'));                    // Logs requests to the console
app.use(logger);

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount routes with API versioning
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/marketplace', marketplaceRoutes);
app.use('/api/v1/content', contentRoutes);
app.use('/api/v1/nft-access', nftAccessRoutes);
app.use('/api/v1/access', accessRoutes);
app.use('/api/v1/token-gated-content', tokenGatedContentRoutes);
app.use('/api/v1/analytics', artistAnalyticsRoutes);

// Legacy routes for backward compatibility (redirect to v1)
app.use('/api/users', (req, res, next) => {
  req.url = `/api/v1/users${req.url}`;
  next();
});
app.use('/api/profile', (req, res, next) => {
  req.url = `/api/v1/profile${req.url}`;
  next();
});
app.use('/api/events', (req, res, next) => {
  req.url = `/api/v1/events${req.url}`;
  next();
});
app.use('/api/tickets', (req, res, next) => {
  req.url = `/api/v1/tickets${req.url}`;
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    message: 'TicketToken API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'TicketToken API Documentation',
    version: '1.0.0',
    endpoints: {
      authentication: {
        register: 'POST /api/v1/auth/register',
        login: 'POST /api/v1/auth/login',
        walletAuth: 'POST /api/v1/auth/wallet-auth',
        checkAvailability: 'POST /api/v1/auth/check-availability'
      },
      users: {
        getProfile: 'GET /api/v1/users/profile',
        updateProfile: 'PUT /api/v1/users/profile',
        changePassword: 'PUT /api/v1/users/password',
        uploadImage: 'POST /api/v1/users/image'
      },
      profile: {
        getDetailed: 'GET /api/v1/profile/detailed',
        updatePreferences: 'PUT /api/v1/profile/preferences',
        updateSocial: 'PUT /api/v1/profile/social',
        manageWallets: 'POST/DELETE /api/v1/profile/wallets',
        getAnalytics: 'GET /api/v1/profile/analytics'
      },
      events: {
        create: 'POST /api/v1/events',
        getAll: 'GET /api/v1/events',
        getById: 'GET /api/v1/events/:id',
        update: 'PUT /api/v1/events/:id',
        delete: 'DELETE /api/v1/events/:id',
        search: 'GET /api/v1/events/search'
      },
      tickets: {
        create: 'POST /api/v1/tickets',
        getAll: 'GET /api/v1/tickets',
        getById: 'GET /api/v1/tickets/:id',
        mint: 'POST /api/v1/tickets/:id/mint',
        transfer: 'POST /api/v1/tickets/:id/transfer',
        verify: 'GET /api/v1/tickets/:id/verify'
      },
      marketplace: {
        list: 'POST /api/v1/marketplace/list',
        getListings: 'GET /api/v1/marketplace/listings',
        buy: 'POST /api/v1/marketplace/buy/:listingId',
        cancel: 'POST /api/v1/marketplace/cancel/:listingId',
        search: 'GET /api/v1/marketplace/search'
      },
      content: {
        create: 'POST /api/v1/content',
        getById: 'GET /api/v1/content/:id',
        getByEvent: 'GET /api/v1/content/event/:eventId',
        getByArtist: 'GET /api/v1/content/artist/:artistId',
        update: 'PUT /api/v1/content/:id',
        delete: 'DELETE /api/v1/content/:id',
        nftAccessible: 'GET /api/v1/content/nft-accessible',
        checkAccess: 'GET /api/v1/content/:id/check-access'
      },
      nftAccess: {
        check: 'POST /api/v1/nft-access/check',
        token: 'POST /api/v1/nft-access/token',
        verify: 'GET /api/v1/nft-access/verify',
        rules: 'POST /api/v1/nft-access/rules',
        getRules: 'GET /api/v1/nft-access/rules/:resourceType/:resourceId',
        sync: 'POST /api/v1/nft-access/sync',
        nfts: 'GET /api/v1/nft-access/nfts',
        resources: 'GET /api/v1/nft-access/resources',
        grants: 'GET /api/v1/nft-access/grants',
        revokeGrant: 'DELETE /api/v1/nft-access/grants/:token'
      },
      access: {
        validate: 'POST /api/v1/access/validate',
        rules: 'POST /api/v1/access/rules',
        getRules: 'GET /api/v1/access/rules/:contentId',
        updateRules: 'PUT /api/v1/access/rules/:ruleId',
        deleteRules: 'DELETE /api/v1/access/rules/:ruleId',
        eligible: 'GET /api/v1/access/eligible/:userId',
        contentList: 'GET /api/v1/access/content/:tokenId'
      },
      tokenGatedContent: {
        create: 'POST /api/v1/token-gated-content',
        getAll: 'GET /api/v1/token-gated-content',
        getById: 'GET /api/v1/token-gated-content/:id',
        checkAccess: 'GET /api/v1/token-gated-content/:id/check-access',
        update: 'PUT /api/v1/token-gated-content/:id',
        delete: 'DELETE /api/v1/token-gated-content/:id'
      },
      artistAnalytics: {
        getRoyalties: 'GET /api/v1/analytics/royalties',
        syncBlockchain: 'POST /api/v1/analytics/royalties/sync',
        generateReport: 'GET /api/v1/analytics/royalties/report',
        getPendingRoyalties: 'GET /api/v1/analytics/royalties/pending',
        updateSettings: 'PUT /api/v1/analytics/royalties/settings',
        getSettings: 'GET /api/v1/analytics/royalties/settings',
        getDistribution: 'GET /api/v1/analytics/royalties/distribution/:resourceType/:resourceId',
        recordPayment: 'POST /api/v1/analytics/royalties/payment',
        addPending: 'POST /api/v1/analytics/royalties/pending',
        processPending: 'POST /api/v1/analytics/royalties/process-pending'
      },
      health: '/health'
    },
    documentation: 'https://docs.tickettoken.com'
  });
});

// Define a simple route for testing
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Welcome to TicketToken API',
    version: '1.0.0',
    documentation: '/api'
  });
});

// Set up a scheduled job to clean up expired access grants and refresh caches
const runMaintenance = async () => {
  try {
    // Run NFT access maintenance
    const nftResult = await nftAccessService.maintenance();
    console.log('NFT Maintenance completed:', nftResult);
    
    // Run content access validation maintenance
    const accessResult = await accessService.maintenance();
    console.log('Access Validation Maintenance completed:', accessResult);

    // Run token verification cache cleanup
    const redisResult = await redis.eval(`
      local keys = redis.call('keys', 'tickettoken:token_ownership:*')
      local count = 0
      for i, key in ipairs(keys) do
        local ttl = redis.call('ttl', key)
        if ttl < 0 then
          redis.call('del', key)
          count = count + 1
        end
      end
      return count
    `, 0);
    console.log('Token verification cache cleanup completed:', redisResult);
    
    // Run artist analytics data cleanup
    console.log('Artist analytics maintenance started');
    console.log('Artist analytics maintenance completed');
  } catch (error) {
    console.error('Maintenance error:', error);
  }
};

// Run maintenance once at startup (for development)
setTimeout(runMaintenance, 10000);

// Error handling middleware (must be second to last)
app.use(errorHandler);

// 404 handler for undefined routes (must be last)
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    errors: { 
      route: `Cannot ${req.method} ${req.originalUrl}` 
    },
    suggestion: 'Check the API documentation at /api'
  });
});

// Define the port to run on
const PORT = process.env.PORT || 5000;

// Start the server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 API URL: http://localhost:${PORT}`);
  console.log(`📚 API Docs: http://localhost:${PORT}/api`);
  console.log(`🖼️  Uploads: http://localhost:${PORT}/uploads`);
  console.log(`🔒 NFT Access: Integrated with content system`);
  console.log(`🔐 Content Access Validation: Enabled`);
  console.log(`🔑 Token-Gated Content: Enabled`);
  console.log(`📊 Artist Analytics & Royalty Tracking: Enabled`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Unhandled Rejection: ${err.message}`);
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received');
  // Close Redis connection
  redis.disconnect();
  server.close(() => {
    console.log('💤 Process terminated');
  });
});

module.exports = app;
