// routes/nftAccessRoutes.js - Routes for NFT-based access control

const express = require('express');
const router = express.Router();
const {
  checkAccess,
  generateAccessToken,
  verifyAccessToken,
  defineAccessRules,
  getAccessRules,
  syncUserNFTs,
  getUserNFTs,
  getAccessibleResources,
  getUserGrants,
  revokeAccessGrant
} = require('../controllers/nftAccessController');
const { protect, admin } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');
const { verifyResourceOwnership } = require('../middleware/nftAccessMiddleware');

// All routes require authentication
router.use(protect);

// Access verification routes
router.post('/check', rateLimiter(), checkAccess);
router.post('/token', rateLimiter(), generateAccessToken);
router.get('/verify', rateLimiter(), verifyAccessToken);

// Access rules management
router.post('/rules', 
  rateLimiter(), 
  defineAccessRules
);

router.get('/rules/:resourceType/:resourceId', 
  rateLimiter(), 
  getAccessRules
);

// NFT management
router.post('/sync', 
  rateLimiter('sync'), 
  syncUserNFTs
);

router.get('/nfts', 
  rateLimiter(), 
  getUserNFTs
);

// Accessible resources
router.get('/resources', 
  rateLimiter(), 
  getAccessibleResources
);

// Access grants
router.get('/grants', 
  rateLimiter(), 
  getUserGrants
);

router.delete('/grants/:token', 
  rateLimiter(), 
  revokeAccessGrant
);

module.exports = router;
