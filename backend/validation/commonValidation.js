// utils/validators.js - Input validation utilities

// Email validation using regex
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Password validation - at least 8 chars, upper, lower, number, special char
const validatePassword = (password) => {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

// Solana wallet address validation (base58, 32-44 chars)
const validateWalletAddress = (address) => {
  if (!address) return false;
  
  // Basic validation for Solana addresses
  const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return solanaAddressRegex.test(address);
};

// Username validation (3-20 chars, alphanumeric and underscore only)
const validateUsername = (username) => {
  if (!username) return false;
  
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
};

// Phone number validation (basic international format)
const validatePhoneNumber = (phone) => {
  if (!phone) return false;
  
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
};

// Display name validation (2-50 chars, letters, numbers, spaces, basic punctuation)
const validateDisplayName = (displayName) => {
  if (!displayName) return false;
  
  const displayNameRegex = /^[a-zA-Z0-9\s\.\-_]{2,50}$/;
  return displayNameRegex.test(displayName.trim());
};

// Bio validation (max 500 chars)
const validateBio = (bio) => {
  if (!bio) return true; // Bio is optional
  
  return bio.length <= 500;
};

// URL validation
const validateUrl = (url) => {
  if (!url) return false;
  
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  validateEmail,
  validatePassword,
  validateWalletAddress,
  validateUsername,
  validatePhoneNumber,
  validateDisplayName,
  validateBio,
  validateUrl,
};
