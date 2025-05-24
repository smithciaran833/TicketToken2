// server.js - Updated with NFT access routes, exclusive content access validation, token-gated content, and artist analytics

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

// Import route files
const userRoutes = require('./routes/userRoutes');
const profileRoutes = require('./routes/profileRoutes');
const eventRoutes = require('./routes/eventRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const contentRoutes = require('./routes/contentRoutes');
const nftAccessRoutes = require('./routes/nftAccessRoutes');
const accessRoutes = require('./routes/accessRoutes'); // Added new access routes
const tokenGatedContentRoutes = require('./routes/tokenGatedContentRoutes'); // Added token-gated content routes
const artistAnalyticsRoutes = require('./routes/artistAnalyticsRoutes'); // Added artist analytics routes
const marketplaceRoutes = require('./routes/marketplaceRoutes');

// Import services
const nftAccessService = require('./services/nftAccessService');
const accessService = require('./services/accessService'); // Added new access service
const { verifyTokenOwnership } = require('./services/tokenVerificationService'); // Added token verification service
const artistRoyaltyService = require('./services/artistRoyaltyService'); // Added artist royalty service

// Create Express app
const app = express();

// Connect to database
connectDB();

// Initialize NFT verification service (if needed)
// This would happen in production when the server starts
// For now, we'll just log that it's ready
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

// Use routes
// Use routes
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/nft-access', nftAccessRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/token-gated-content', tokenGatedContentRoutes);
app.use('/api/analytics', artistAnalyticsRoutes);
app.use('/api/marketplace', marketplaceRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    message: 'TicketToken API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '0.3.0' // Updated version to reflect new features
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'TicketToken API Documentation',
    version: '0.3.0', // Updated version
    endpoints: {
      authentication: {
        register: 'POST /api/users/register',
        login: 'POST /api/users/login',
        walletAuth: 'POST /api/users/wallet-auth',
        checkAvailability: 'POST /api/users/check-availability'
      },
      profile: {
        getProfile: 'GET /api/users/profile',
        updateProfile: 'PUT /api/users/profile',
        getDetailed: 'GET /api/profile/detailed',
        updatePreferences: 'PUT /api/profile/preferences',
        updateSocial: 'PUT /api/profile/social',
        manageWallets: 'POST/DELETE /api/profile/wallets',
        changePassword: 'PUT /api/profile/password',
        uploadImage: 'POST /api/profile/image',
        getAnalytics: 'GET /api/profile/analytics'
      },
      events: '/api/events',
      tickets: '/api/tickets',
      content: {
        create: 'POST /api/content',
        getById: 'GET /api/content/:id',
        getByEvent: 'GET /api/content/event/:eventId',
        getByArtist: 'GET /api/content/artist/:artistId',
        update: 'PUT /api/content/:id',
        delete: 'DELETE /api/content/:id',
        nftAccessible: 'GET /api/content/nft-accessible',
        checkAccess: 'GET /api/content/:id/check-access'
      },
      nftAccess: {
        check: 'POST /api/nft-access/check',
        token: 'POST /api/nft-access/token',
        verify: 'GET /api/nft-access/verify',
        rules: 'POST /api/nft-access/rules',
        getRules: 'GET /api/nft-access/rules/:resourceType/:resourceId',
        sync: 'POST /api/nft-access/sync',
        nfts: 'GET /api/nft-access/nfts',
        resources: 'GET /api/nft-access/resources',
        grants: 'GET /api/nft-access/grants',
        revokeGrant: 'DELETE /api/nft-access/grants/:token'
      },
      access: {
        validate: 'POST /api/access/validate',
        rules: 'POST /api/access/rules',
        getRules: 'GET /api/access/rules/:contentId',
        updateRules: 'PUT /api/access/rules/:ruleId',
        deleteRules: 'DELETE /api/access/rules/:ruleId',
        eligible: 'GET /api/access/eligible/:userId',
        contentList: 'GET /api/access/content/:tokenId'
      },
      tokenGatedContent: {
        create: 'POST /api/token-gated-content',
        getAll: 'GET /api/token-gated-content',
        getById: 'GET /api/token-gated-content/:id',
        checkAccess: 'GET /api/token-gated-content/:id/check-access',
        update: 'PUT /api/token-gated-content/:id',
        delete: 'DELETE /api/token-gated-content/:id'
      },
      artistAnalytics: {
        getRoyalties: 'GET /api/analytics/royalties',
        syncBlockchain: 'POST /api/analytics/royalties/sync',
        generateReport: 'GET /api/analytics/royalties/report',
        getPendingRoyalties: 'GET /api/analytics/royalties/pending',
        updateSettings: 'PUT /api/analytics/royalties/settings',
        getSettings: 'GET /api/analytics/royalties/settings',
        getDistribution: 'GET /api/analytics/royalties/distribution/:resourceType/:resourceId',
        recordPayment: 'POST /api/analytics/royalties/payment',
        addPending: 'POST /api/analytics/royalties/pending',
        processPending: 'POST /api/analytics/royalties/process-pending'
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
    version: '0.3.0', // Updated version
    documentation: '/api'
  });
});

// Set up a scheduled job to clean up expired access grants and refresh caches
// This would run periodically in production
// For development, we'll run it manually
const runMaintenance = async () => {
  try {
    // Run NFT access maintenance
    const nftResult = await nftAccessService.maintenance();
    console.log('NFT Maintenance completed:', nftResult);
    
    // Run content access validation maintenance
    const accessResult = await accessService.maintenance();
    console.log('Access Validation Maintenance completed:', accessResult);

    // Run token verification cache cleanup
    // Clear expired Redis keys
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
    // This would clean up old data points and optimize storage
    console.log('Artist analytics maintenance started');
    // In production, this would run actual maintenance tasks
    console.log('Artist analytics maintenance completed');
  } catch (error) {
    console.error('Maintenance error:', error);
  }
};

// Run maintenance once at startup (for development)
setTimeout(runMaintenance, 10000);

// 404 handler for undefined routes
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

// Error handling middleware (must be last)
app.use(errorHandler);

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
