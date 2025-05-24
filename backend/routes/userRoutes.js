// routes/userRoutes.js - Updated with profile route integration

const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  walletAuth,
  getUserProfile,
  updateUserProfile,
  checkAvailability,
} = require('../controllers/userController');
const { protect, admin } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');
const {
  validateUserRegistration,
  validateUserLogin,
  validateWalletAuth,
  validateProfileUpdate,
  validateAvailabilityCheck,
} = require('../middleware/validation');

// Public routes
router.post('/register', rateLimiter('register'), validateUserRegistration, registerUser);
router.post('/login', rateLimiter('login'), validateUserLogin, loginUser);
router.post('/wallet-auth', rateLimiter('wallet-auth'), validateWalletAuth, walletAuth);
router.post('/check-availability', rateLimiter('check'), validateAvailabilityCheck, checkAvailability);

// Protected routes - require authentication
router.route('/profile')
  .get(protect, getUserProfile)
  .put(protect, validateProfileUpdate, updateUserProfile);

// Test route to verify authentication
router.get('/auth-test', protect, require('../middleware/testMiddleware').authTest);

// Admin routes (for future implementation)
router.get('/admin/users', protect, admin, (req, res) => {
  res.json({ 
    success: true,
    message: 'Admin user list endpoint - to be implemented',
    data: []
  });
});

// Profile management routes redirect
router.use('/profile/*', (req, res, next) => {
  // Redirect profile management requests to dedicated profile routes
  const newPath = req.originalUrl.replace('/api/users/profile', '/api/profile');
  res.redirect(307, newPath);
});

module.exports = router;
