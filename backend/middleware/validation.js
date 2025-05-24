// middleware/validation.js - Request validation middleware

const { validateEmail, validatePassword, validateWalletAddress, validateUsername } = require('../utils/validators');

// Validation middleware for user registration
const validateUserRegistration = (req, res, next) => {
  const { username, email, password, walletAddress, displayName } = req.body;
  const errors = {};

  // Check required fields
  if (!email && !walletAddress) {
    errors.general = 'Either email or wallet address is required';
  }

  // Validate email if provided
  if (email && !validateEmail(email)) {
    errors.email = 'Invalid email format';
  }

  // Validate username if provided
  if (username && !validateUsername(username)) {
    errors.username = 'Username must be 3-20 characters, alphanumeric and underscore only';
  }

  // Validate password if provided
  if (password && !validatePassword(password)) {
    errors.password = 'Password must be at least 8 characters with uppercase, lowercase, number, and special character';
  }

  // Validate wallet address if provided
  if (walletAddress && !validateWalletAddress(walletAddress)) {
    errors.walletAddress = 'Invalid Solana wallet address format';
  }

  // Validate display name if provided
  if (displayName && (displayName.length < 2 || displayName.length > 50)) {
    errors.displayName = 'Display name must be between 2 and 50 characters';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

// Validation middleware for user login
const validateUserLogin = (req, res, next) => {
  const { email, password } = req.body;
  const errors = {};

  if (!email) {
    errors.email = 'Email is required';
  } else if (!validateEmail(email)) {
    errors.email = 'Invalid email format';
  }

  if (!password) {
    errors.password = 'Password is required';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

// Validation middleware for wallet authentication
const validateWalletAuth = (req, res, next) => {
  const { walletAddress } = req.body;
  const errors = {};

  if (!walletAddress) {
    errors.walletAddress = 'Wallet address is required';
  } else if (!validateWalletAddress(walletAddress)) {
    errors.walletAddress = 'Invalid Solana wallet address format';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

// Validation middleware for profile updates
const validateProfileUpdate = (req, res, next) => {
  const { username, email, displayName, bio, password } = req.body;
  const errors = {};

  // Validate username if being updated
  if (username !== undefined && !validateUsername(username)) {
    errors.username = 'Username must be 3-20 characters, alphanumeric and underscore only';
  }

  // Validate email if being updated
  if (email !== undefined && !validateEmail(email)) {
    errors.email = 'Invalid email format';
  }

  // Validate display name if being updated
  if (displayName !== undefined && (displayName.length < 2 || displayName.length > 50)) {
    errors.displayName = 'Display name must be between 2 and 50 characters';
  }

  // Validate bio if being updated
  if (bio !== undefined && bio.length > 500) {
    errors.bio = 'Bio must be 500 characters or less';
  }

  // Validate password if being updated
  if (password !== undefined && !validatePassword(password)) {
    errors.password = 'Password must be at least 8 characters with uppercase, lowercase, number, and special character';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

// Validation middleware for availability check
const validateAvailabilityCheck = (req, res, next) => {
  const { username, email } = req.body;
  const errors = {};

  if (!username && !email) {
    errors.general = 'Username or email is required';
  }

  if (username && !validateUsername(username)) {
    errors.username = 'Invalid username format';
  }

  if (email && !validateEmail(email)) {
    errors.email = 'Invalid email format';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

module.exports = {
  validateUserRegistration,
  validateUserLogin,
  validateWalletAuth,
  validateProfileUpdate,
  validateAvailabilityCheck,
};
