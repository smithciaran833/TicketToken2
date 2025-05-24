// routes/walletRoutes.js - Wallet API routes

const express = require('express');
const router = express.Router();

// Import controllers
const {
  generateNonce,
  generateAuthMessage,
  authenticateWithWallet,
  linkWallet,
  unlinkWallet,
  setPrimaryWallet,
  getUserWallets,
  checkWalletAvailability,
  verifyWalletSignature,
  getWalletBalance
} = require('../controllers/walletController');

// Import middleware
const { protect } = require('../middleware/authMiddleware');
const {
  authenticateWallet,
  verifyWalletOwnership,
  checkWalletAvailability: checkAvailabilityMiddleware,
  generateWalletToken,
  walletRateLimit,
  validateWalletMessage
} = require('../middleware/walletMiddleware');

// Import validation
const {
  validateWalletAuth,
  validateWalletAddress
} = require('../middleware/validation');

// Public routes - no authentication required

// Generate nonce for wallet authentication
router.get('/nonce', generateNonce);

// Generate authentication message for signing
router.post('/auth-message',
  validateWalletAddress,
  generateAuthMessage
);

// Check if wallet address is available
router.post('/check-availability',
  validateWalletAddress,
  checkWalletAvailability
);

// Verify wallet signature
router.post('/verify',
  walletRateLimit(10, 5 * 60 * 1000), // 10 attempts per 5 minutes
  validateWalletMessage,
  verifyWalletSignature
);

// Authenticate with wallet signature (login/register)
router.post('/authenticate',
  walletRateLimit(5, 15 * 60 * 1000), // 5 attempts per 15 minutes
  validateWalletAuth,
  validateWalletMessage,
  authenticateWallet,
  generateWalletToken,
  authenticateWithWallet
);

// Protected routes - require authentication

// Get user's linked wallets
router.get('/list',
  protect,
  getUserWallets
);

// Link new wallet to existing account
router.post('/link',
  protect,
  validateWalletAddress,
  validateWalletMessage,
  checkAvailabilityMiddleware,
  verifyWalletOwnership,
  linkWallet
);

// Unlink wallet from account
router.delete('/unlink/:address',
  protect,
  unlinkWallet
);

// Set primary wallet
router.put('/primary/:address',
  protect,
  setPrimaryWallet
);

// Get wallet balance (if implemented)
router.get('/balance/:address',
  protect,
  getWalletBalance
);

module.exports = router;
