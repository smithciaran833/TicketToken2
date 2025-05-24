// routes/accessRoutes.js - Routes for content access control

const express = require('express');
const router = express.Router();
const {
  generateAccessToken,
  verifyAccessToken,
  recordContentAccess,
  revokeAccess,
  getContentAccessStats
} = require('../controllers/accessController');
const { protect, admin } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');

// All access routes require authentication
router.use(protect);

// Token generation and verification
router.post('/token', 
  rateLimiter(), 
  generateAccessToken
);

router.get('/verify', 
  rateLimiter(), 
  verifyAccessToken
);

// Access recording
router.post('/record', 
  rateLimiter(), 
  recordContentAccess
);

// Admin routes
router.post('/revoke', 
  rateLimiter(), 
  admin, 
  revokeAccess
);

// Stats
router.get('/stats/:contentId', 
  rateLimiter(), 
  getContentAccessStats
);

module.exports = router;
