// middleware/walletMiddleware.js - Wallet authentication middleware

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const WalletService = require('../services/walletService');
const { generateToken } = require('../utils/jwtUtils');

/**
 * Middleware to authenticate users with wallet signatures
 */
const authenticateWallet = async (req, res, next) => {
  try {
    const { walletAddress, signature, message, nonce } = req.body;

    if (!walletAddress || !signature || !message || !nonce) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        errors: {
          walletAddress: !walletAddress ? 'Wallet address is required' : undefined,
          signature: !signature ? 'Signature is required' : undefined,
          message: !message ? 'Message is required' : undefined,
          nonce: !nonce ? 'Nonce is required' : undefined
        }
      });
    }

    // Authenticate with wallet
    const authResult = await WalletService.authenticateWithWallet(
      walletAddress,
      signature,
      message,
      nonce
    );

    if (!authResult.success) {
      return res.status(401).json({
        success: false,
        message: 'Wallet authentication failed',
        errors: { wallet: 'Invalid signature or expired nonce' }
      });
    }

    // Add user to request object
    req.user = authResult.user;
    req.walletAuth = {
      walletAddress: authResult.walletAddress,
      isNewUser: authResult.isNewUser
    };

    next();
  } catch (error) {
    console.error('Wallet authentication middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Wallet authentication failed',
      errors: { wallet: error.message }
    });
  }
};

/**
 * Middleware to verify wallet ownership for linking
 */
const verifyWalletOwnership = async (req, res, next) => {
  try {
    const { walletAddress, signature, message } = req.body;

    if (!walletAddress || !signature || !message) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields for wallet verification',
        errors: {
          walletAddress: !walletAddress ? 'Wallet address is required' : undefined,
          signature: !signature ? 'Signature is required' : undefined,
          message: !message ? 'Message is required' : undefined
        }
      });
    }

    // Verify signature
    const verification = await WalletService.verifyWalletSignature(
      walletAddress,
      message,
      signature
    );

    if (!verification.isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid wallet signature',
        errors: { signature: 'Signature verification failed' }
      });
    }

    // Add verification result to request
    req.walletVerification = verification;
    next();
  } catch (error) {
    console.error('Wallet verification middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Wallet verification failed',
      errors: { wallet: error.message }
    });
  }
};

/**
 * Middleware to check if wallet is available for linking
 */
const checkWalletAvailability = async (req, res, next) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required',
        errors: { walletAddress: 'Wallet address is required' }
      });
    }

    // Check if wallet is already linked to another user
    const isAvailable = await WalletService.isWalletAvailable(walletAddress);

    if (!isAvailable) {
      // Check if it's linked to the current user
      if (req.user) {
        const userWallet = req.user.walletAddresses.find(w => w.address === walletAddress);
        if (userWallet) {
          return res.status(409).json({
            success: false,
            message: 'Wallet already linked to your account',
            errors: { walletAddress: 'This wallet is already linked to your account' }
          });
        }
      }

      return res.status(409).json({
        success: false,
        message: 'Wallet address already in use',
        errors: { walletAddress: 'This wallet is already linked to another account' }
      });
    }

    next();
  } catch (error) {
    console.error('Wallet availability check error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking wallet availability',
      errors: { server: 'Failed to check wallet availability' }
    });
  }
};

/**
 * Middleware to protect routes with wallet or token authentication
 */
const protectWithWalletOrToken = async (req, res, next) => {
  let token;

  // Check for JWT token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-passwordHash');
      
      if (req.user) {
        return next();
      }
    } catch (error) {
      // Token verification failed, continue to check for wallet auth
    }
  }

  // Check for wallet authentication
  const { walletAddress, signature, message, nonce } = req.body;

  if (walletAddress && signature && message && nonce) {
    return authenticateWallet(req, res, next);
  }

  // No valid authentication found
  res.status(401).json({
    success: false,
    message: 'Authentication required',
    errors: { auth: 'Please provide a valid token or wallet signature' }
  });
};

/**
 * Middleware to generate JWT token after wallet authentication
 */
const generateWalletToken = (req, res, next) => {
  if (req.user && req.walletAuth) {
    req.authToken = generateToken(req.user._id);
  }
  next();
};

/**
 * Rate limiting middleware for wallet operations
 */
const walletRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();

  return (req, res, next) => {
    const key = req.ip + (req.body.walletAddress || '');
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old attempts
    const userAttempts = attempts.get(key) || [];
    const recentAttempts = userAttempts.filter(time => time > windowStart);

    if (recentAttempts.length >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: 'Too many wallet authentication attempts',
        errors: { rateLimit: 'Please try again later' },
        retryAfter: Math.ceil((recentAttempts[0] + windowMs - now) / 1000)
      });
    }

    // Add current attempt
    recentAttempts.push(now);
    attempts.set(key, recentAttempts);

    next();
  };
};

/**
 * Middleware to validate wallet message format
 */
const validateWalletMessage = (req, res, next) => {
  const { message, walletAddress, nonce } = req.body;

  if (!message) {
    return res.status(400).json({
      success: false,
      message: 'Message is required',
      errors: { message: 'Message is required for signature verification' }
    });
  }

  // Check if message contains required elements
  const requiredElements = [walletAddress, nonce];
  const hasAllElements = requiredElements.every(element => 
    element && message.includes(element)
  );

  if (!hasAllElements) {
    return res.status(400).json({
      success: false,
      message: 'Invalid message format',
      errors: { message: 'Message must contain wallet address and nonce' }
    });
  }

  // Check message age (prevent old messages from being reused)
  const timestampMatch = message.match(/Timestamp: ([\d-T:.Z]+)/);
  if (timestampMatch) {
    const messageTime = new Date(timestampMatch[1]);
    const now = new Date();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    if (now - messageTime > maxAge) {
      return res.status(400).json({
        success: false,
        message: 'Message expired',
        errors: { message: 'Message is too old, please generate a new one' }
      });
    }
  }

  next();
};

module.exports = {
  authenticateWallet,
  verifyWalletOwnership,
  checkWalletAvailability,
  protectWithWalletOrToken,
  generateWalletToken,
  walletRateLimit,
  validateWalletMessage
};
