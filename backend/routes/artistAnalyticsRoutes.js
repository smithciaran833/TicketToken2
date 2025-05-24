const express = require('express');
const router = express.Router();
const artistAnalyticsController = require('../controllers/artistAnalyticsController');
const { protect, authorize } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Artist royalty endpoints
router.get('/royalties', artistAnalyticsController.getRoyaltyAnalytics);
router.post('/royalties/sync', artistAnalyticsController.syncBlockchainSales);
router.get('/royalties/report', artistAnalyticsController.generateRoyaltyReport);
router.get('/royalties/pending', artistAnalyticsController.getPendingRoyalties);
router.get('/royalties/settings', artistAnalyticsController.getRoyaltySettings);
router.put('/royalties/settings', artistAnalyticsController.updateRoyaltySettings);

// Resource-specific royalty distribution
router.get(
  '/royalties/distribution/:resourceType/:resourceId',
  artistAnalyticsController.getRoyaltyDistribution
);

// Admin-only endpoints
router.post(
  '/royalties/payment',
  authorize('admin'),
  artistAnalyticsController.recordRoyaltyPayment
);

router.post(
  '/royalties/pending',
  authorize('admin'),
  artistAnalyticsController.addPendingRoyalty
);

router.post(
  '/royalties/process-pending',
  authorize('admin'),
  artistAnalyticsController.processPendingRoyalties
);

module.exports = router;
