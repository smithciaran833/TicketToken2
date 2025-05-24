// routes/profileRoutes.js - Profile-specific routes

const express = require('express');
const router = express.Router();
const {
  getDetailedProfile,
  updatePreferences,
  updateSocialConnections,
  addWalletAddress,
  removeWalletAddress,
  setPrimaryWallet,
  changePassword,
  uploadProfileImage,
  deleteProfileImage,
  getProfileAnalytics,
} = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/uploadMiddleware');
const {
  validatePreferencesUpdate,
  validateSocialConnections,
  validateWalletAddress,
  validatePasswordChange,
} = require('../middleware/profileValidation');

// All profile routes require authentication
router.use(protect);

// Profile information routes
router.get('/detailed', rateLimiter('profile'), getDetailedProfile);
router.get('/analytics', rateLimiter('profile'), getProfileAnalytics);

// Profile preferences
router.put('/preferences', 
  rateLimiter('profile-update'), 
  validatePreferencesUpdate, 
  updatePreferences
);

// Social connections
router.put('/social', 
  rateLimiter('profile-update'), 
  validateSocialConnections, 
  updateSocialConnections
);

// Wallet management
router.post('/wallets', 
  rateLimiter('wallet'), 
  validateWalletAddress, 
  addWalletAddress
);
router.delete('/wallets/:address', 
  rateLimiter('wallet'), 
  removeWalletAddress
);
router.put('/wallets/:address/primary', 
  rateLimiter('wallet'), 
  setPrimaryWallet
);

// Password management
router.put('/password', 
  rateLimiter('password'), 
  validatePasswordChange, 
  changePassword
);

// Image management
router.post('/image', 
  rateLimiter('upload'), 
  upload.single('profileImage'), 
  uploadProfileImage
);
router.delete('/image', 
  rateLimiter('upload'), 
  deleteProfileImage
);

module.exports = router;
