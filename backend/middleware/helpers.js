const crypto = require('crypto');
const bcrypt = require('bcrypt');

// =============================================================================
// DATE/TIME UTILITIES
// =============================================================================

/**
 * Format a date to a specified format
 * @param {Date|string} date - The date to format
 * @param {string} format - Format string ('YYYY-MM-DD', 'MM/DD/YYYY', 'ISO', 'locale')
 * @param {string} timezone - Optional timezone (e.g., 'America/New_York')
 * @returns {string} Formatted date string
 */
const formatDate = (date, format = 'YYYY-MM-DD', timezone = null) => {
  const d = new Date(date);
  
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date provided');
  }
  
  const options = timezone ? { timeZone: timezone } : {};
  
  switch (format) {
    case 'ISO':
      return d.toISOString();
    case 'locale':
      return d.toLocaleDateString('en-US', options);
    case 'YYYY-MM-DD':
      return d.toISOString().split('T')[0];
    case 'MM/DD/YYYY':
      return d.toLocaleDateString('en-US', options);
    case 'DD/MM/YYYY':
      return d.toLocaleDateString('en-GB', options);
    default:
      return d.toLocaleDateString('en-US', options);
  }
};

/**
 * Parse timezone from date string or convert date to specific timezone
 * @param {Date|string} date - The date to convert
 * @param {string} timezone - Target timezone (e.g., 'America/New_York')
 * @returns {Date} Date object in specified timezone
 */
const parseTimezone = (date, timezone) => {
  const d = new Date(date);
  
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date provided');
  }
  
  return new Date(d.toLocaleString('en-US', { timeZone: timezone }));
};

/**
 * Add specified number of days to a date
 * @param {Date|string} date - The base date
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date} New date with days added
 */
const addDays = (date, days) => {
  const d = new Date(date);
  
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date provided');
  }
  
  d.setDate(d.getDate() + days);
  return d;
};

// =============================================================================
// STRING UTILITIES
// =============================================================================

/**
 * Convert string to URL-friendly slug
 * @param {string} text - Text to slugify
 * @param {string} separator - Separator character (default: '-')
 * @returns {string} Slugified string
 */
const slugify = (text, separator = '-') => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, separator)           // Replace spaces with separator
    .replace(/[^\w\-]+/g, '')            // Remove non-word chars
    .replace(/\-\-+/g, separator)        // Replace multiple separators
    .replace(/^-+/, '')                  // Trim separator from start
    .replace(/-+$/, '');                 // Trim separator from end
};

/**
 * Sanitize input string to prevent XSS and injection attacks
 * @param {string} input - Input string to sanitize
 * @param {Object} options - Sanitization options
 * @param {boolean} options.allowHTML - Allow HTML tags (default: false)
 * @param {number} options.maxLength - Maximum length (default: unlimited)
 * @returns {string} Sanitized string
 */
const sanitizeInput = (input, options = {}) => {
  if (typeof input !== 'string') {
    return '';
  }
  
  let sanitized = input;
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Apply max length if specified
  if (options.maxLength && sanitized.length > options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
  }
  
  // Remove HTML tags unless explicitly allowed
  if (!options.allowHTML) {
    sanitized = sanitized.replace(/<[^>]*>/g, '');
  }
  
  // Escape special characters
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
  
  return sanitized;
};

/**
 * Generate a unique ID
 * @param {number} length - Length of the ID (default: 12)
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} Generated unique ID
 */
const generateId = (length = 12, prefix = '') => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return prefix ? `${prefix}${result}` : result;
};

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validate email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate cryptocurrency wallet address (basic validation)
 * @param {string} address - Wallet address to validate
 * @param {string} type - Wallet type ('bitcoin', 'ethereum', 'litecoin')
 * @returns {boolean} True if valid wallet address format
 */
const isValidWallet = (address, type = 'ethereum') => {
  if (!address || typeof address !== 'string') {
    return false;
  }
  
  switch (type.toLowerCase()) {
    case 'bitcoin':
      // Bitcoin address validation (simplified)
      return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) ||
             /^bc1[a-z0-9]{39,59}$/.test(address);
    case 'ethereum':
      // Ethereum address validation
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    case 'litecoin':
      // Litecoin address validation (simplified)
      return /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(address);
    default:
      return false;
  }
};

/**
 * Validate price format and range
 * @param {number|string} price - Price to validate
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum price (default: 0)
 * @param {number} options.max - Maximum price (default: unlimited)
 * @param {number} options.decimals - Maximum decimal places (default: 2)
 * @returns {boolean} True if valid price
 */
const isValidPrice = (price, options = {}) => {
  const { min = 0, max = Infinity, decimals = 2 } = options;
  
  const numPrice = parseFloat(price);
  
  if (isNaN(numPrice) || numPrice < min || numPrice > max) {
    return false;
  }
  
  // Check decimal places
  const decimalPlaces = (numPrice.toString().split('.')[1] || '').length;
  return decimalPlaces <= decimals;
};

// =============================================================================
// CRYPTO UTILITIES
// =============================================================================

/**
 * Hash password using bcrypt
 * @param {string} password - Plain text password
 * @param {number} saltRounds - Number of salt rounds (default: 12)
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password, saltRounds = 12) => {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  
  return await bcrypt.hash(password, saltRounds);
};

/**
 * Generate secure random token
 * @param {number} length - Token length in bytes (default: 32)
 * @param {string} encoding - Encoding format ('hex', 'base64', 'base64url')
 * @returns {string} Generated token
 */
const generateToken = (length = 32, encoding = 'hex') => {
  const token = crypto.randomBytes(length);
  
  switch (encoding) {
    case 'base64':
      return token.toString('base64');
    case 'base64url':
      return token.toString('base64url');
    case 'hex':
    default:
      return token.toString('hex');
  }
};

/**
 * Encrypt data using AES-256-GCM
 * @param {string} data - Data to encrypt
 * @param {string} key - Encryption key (32 bytes)
 * @returns {Object} Encrypted data with IV and auth tag
 */
const encryptData = (data, key) => {
  if (!data || !key) {
    throw new Error('Data and key are required');
  }
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher('aes-256-gcm', key);
  cipher.setAAD(Buffer.from('authenticated'));
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
};

// =============================================================================
// ARRAY UTILITIES
// =============================================================================

/**
 * Paginate an array
 * @param {Array} array - Array to paginate
 * @param {number} page - Page number (1-based)
 * @param {number} limit - Items per page
 * @returns {Object} Pagination result with data and metadata
 */
const paginate = (array, page = 1, limit = 10) => {
  if (!Array.isArray(array)) {
    throw new Error('First argument must be an array');
  }
  
  const totalItems = array.length;
  const totalPages = Math.ceil(totalItems / limit);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * limit;
  const endIndex = Math.min(startIndex + limit, totalItems);
  
  return {
    data: array.slice(startIndex, endIndex),
    pagination: {
      currentPage,
      totalPages,
      totalItems,
      limit,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1
    }
  };
};

/**
 * Sort array by property or custom function
 * @param {Array} array - Array to sort
 * @param {string|Function} sortBy - Property name or comparison function
 * @param {string} order - Sort order ('asc' or 'desc')
 * @returns {Array} Sorted array
 */
const sort = (array, sortBy, order = 'asc') => {
  if (!Array.isArray(array)) {
    throw new Error('First argument must be an array');
  }
  
  const sorted = [...array];
  
  if (typeof sortBy === 'function') {
    return sorted.sort(sortBy);
  }
  
  return sorted.sort((a, b) => {
    const aVal = typeof sortBy === 'string' ? a[sortBy] : a;
    const bVal = typeof sortBy === 'string' ? b[sortBy] : b;
    
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
};

/**
 * Remove duplicate items from array
 * @param {Array} array - Array to deduplicate
 * @param {string|Function} key - Property name or function to determine uniqueness
 * @returns {Array} Array with duplicates removed
 */
const deduplicate = (array, key = null) => {
  if (!Array.isArray(array)) {
    throw new Error('First argument must be an array');
  }
  
  if (!key) {
    return [...new Set(array)];
  }
  
  const seen = new Set();
  return array.filter(item => {
    const identifier = typeof key === 'function' ? key(item) : item[key];
    if (seen.has(identifier)) {
      return false;
    }
    seen.add(identifier);
    return true;
  });
};

/**
 * Group array items by property or function result
 * @param {Array} array - Array to group
 * @param {string|Function} groupBy - Property name or grouping function
 * @returns {Object} Grouped object
 */
const groupBy = (array, groupBy) => {
  if (!Array.isArray(array)) {
    throw new Error('First argument must be an array');
  }
  
  return array.reduce((groups, item) => {
    const key = typeof groupBy === 'function' ? groupBy(item) : item[groupBy];
    
    if (!groups[key]) {
      groups[key] = [];
    }
    
    groups[key].push(item);
    return groups;
  }, {});
};

// =============================================================================
// OBJECT UTILITIES
// =============================================================================

/**
 * Deep merge multiple objects
 * @param {Object} target - Target object
 * @param {...Object} sources - Source objects to merge
 * @returns {Object} Merged object
 */
const deepMerge = (target, ...sources) => {
  if (!sources.length) return target;
  
  const source = sources.shift();
  
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  
  return deepMerge(target, ...sources);
};

/**
 * Pick specified properties from object
 * @param {Object} obj - Source object
 * @param {Array<string>} keys - Keys to pick
 * @returns {Object} Object with only picked properties
 */
const pick = (obj, keys) => {
  if (!isObject(obj)) {
    throw new Error('First argument must be an object');
  }
  
  return keys.reduce((result, key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
    return result;
  }, {});
};

/**
 * Omit specified properties from object
 * @param {Object} obj - Source object
 * @param {Array<string>} keys - Keys to omit
 * @returns {Object} Object without omitted properties
 */
const omit = (obj, keys) => {
  if (!isObject(obj)) {
    throw new Error('First argument must be an object');
  }
  
  const keysSet = new Set(keys);
  return Object.keys(obj).reduce((result, key) => {
    if (!keysSet.has(key)) {
      result[key] = obj[key];
    }
    return result;
  }, {});
};

/**
 * Flatten nested object to single level with dot notation
 * @param {Object} obj - Object to flatten
 * @param {string} prefix - Key prefix for nested properties
 * @returns {Object} Flattened object
 */
const flatten = (obj, prefix = '') => {
  if (!isObject(obj)) {
    throw new Error('First argument must be an object');
  }
  
  return Object.keys(obj).reduce((flattened, key) => {
    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (isObject(value) && !Array.isArray(value)) {
      Object.assign(flattened, flatten(value, newKey));
    } else {
      flattened[newKey] = value;
    }
    
    return flattened;
  }, {});
};

// =============================================================================
// NUMBER UTILITIES
// =============================================================================

/**
 * Format number as currency
 * @param {number} amount - Amount to format
 * @param {Object} options - Formatting options
 * @param {string} options.currency - Currency code (default: 'USD')
 * @param {string} options.locale - Locale for formatting (default: 'en-US')
 * @param {number} options.decimals - Number of decimal places
 * @returns {string} Formatted currency string
 */
const formatCurrency = (amount, options = {}) => {
  const { currency = 'USD', locale = 'en-US', decimals } = options;
  
  const formatOptions = {
    style: 'currency',
    currency: currency
  };
  
  if (decimals !== undefined) {
    formatOptions.minimumFractionDigits = decimals;
    formatOptions.maximumFractionDigits = decimals;
  }
  
  return new Intl.NumberFormat(locale, formatOptions).format(amount);
};

/**
 * Calculate percentage between two numbers
 * @param {number} value - Current value
 * @param {number} total - Total value
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {number} Percentage value
 */
const calculatePercentage = (value, total, decimals = 2) => {
  if (total === 0) {
    return 0;
  }
  
  const percentage = (value / total) * 100;
  return Number(percentage.toFixed(decimals));
};

/**
 * Round number to specified decimal places
 * @param {number} number - Number to round
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {number} Rounded number
 */
const roundToDecimals = (number, decimals = 2) => {
  const multiplier = Math.pow(10, decimals);
  return Math.round(number * multiplier) / multiplier;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if value is a plain object
 * @param {*} obj - Value to check
 * @returns {boolean} True if plain object
 */
const isObject = (obj) => {
  return obj !== null && typeof obj === 'object' && obj.constructor === Object;
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Date/time utilities
  formatDate,
  parseTimezone,
  addDays,
  
  // String utilities
  slugify,
  sanitizeInput,
  generateId,
  
  // Validation utilities
  isValidEmail,
  isValidWallet,
  isValidPrice,
  
  // Crypto utilities
  hashPassword,
  generateToken,
  encryptData,
  
  // Array utilities
  paginate,
  sort,
  deduplicate,
  groupBy,
  
  // Object utilities
  deepMerge,
  pick,
  omit,
  flatten,
  
  // Number utilities
  formatCurrency,
  calculatePercentage,
  roundToDecimals
};
