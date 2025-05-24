// routes/marketplaceRoutes.js - Routes for marketplace functionality

const express = require('express');
const router = express.Router();
const marketplaceController = require('../controllers/marketplaceController');
const { protect } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');

// All marketplace routes require authentication
router.use(protect);

// Listing management
router.post('/listings', rateLimiter(), marketplaceController.createListing);
router.get('/listings', rateLimiter(), marketplaceController.getListings);
router.get('/listings/:id', rateLimiter(), marketplaceController.getListingById);
router.delete('/listings/:id', rateLimiter(), marketplaceController.cancelListing);

// Purchase routes
router.post('/purchase/:listingId', rateLimiter(), marketplaceController.purchaseListing);

// Marketplace stats
router.get('/stats', rateLimiter(), marketplaceController.getMarketplaceStats);
router.get('/stats/event/:eventId', rateLimiter(), marketplaceController.getEventMarketplaceStats);

module.exports = router;
