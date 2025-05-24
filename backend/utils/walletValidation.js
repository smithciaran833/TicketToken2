/**
 * Validates wallet linking request
 * 
 * @param {Object} linkData - Wallet linking data
 * @returns {Object} Validation result
 */
function validateWalletLinkRequest(linkData) {
  const { walletAddress, signature, message, isPrimary } = linkData;
  const errors = {};

  // Validate wallet address
  if (!walletAddress) {
    errors.walletAddress = 'Wallet address is required';
  } else if (!validateSolanaAddress(walletAddress)) {
    errors.walletAddress = 'Invalid wallet address format';
  }

  // Validate signature
  if (!signature) {
    errors.signature = 'Signature is required';
  } else if (!validateSignatureFormat(signature)) {
    errors.signature = 'Invalid signature format';
  }

  // Validate message
  if (!message) {
    errors.message = 'Message is required';
  } else {
    const messageValidation = validateAuthMessage(message, walletAddress);
    if (!messageValidation.isValid) {
      errors.message = messageValidation.error;
    }
  }

  // Validate isPrimary flag
  if (isPrimary !== undefined && typeof isPrimary !== 'boolean') {
    errors.isPrimary = 'isPrimary must be a boolean value';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Normalizes wallet address to standard format
 * 
 * @param {string} address - Wallet address
 * @returns {string} Normalized address
 */
function normalizeWalletAddress(address) {
  if (!address || typeof address !== 'string') {
    return '';
  }

  try {
    // Create PublicKey object and convert back to string
    // This ensures consistent formatting
    const publicKey = new PublicKey(address);
    return publicKey.toString();
  } catch (error) {
    return address;
  }
}

/**
 * Normalizes signature to Uint8Array
 * 
 * @param {string|Array|Uint8Array} signature - Signature in various formats
 * @returns {Uint8Array} Normalized signature
 */
function normalizeSignature(signature) {
  if (!signature) {
    throw new Error('Signature is required');
  }

  if (signature instanceof Uint8Array) {
    return signature;
  }

  if (Array.isArray(signature)) {
    return new Uint8Array(signature);
  }

  if (typeof signature === 'string') {
    // Remove 0x prefix if present
    const cleanSignature = signature.startsWith('0x') ? signature.slice(2) : signature;
    
    // Convert hex string to Uint8Array
    const bytes = [];
    for (let i = 0; i < cleanSignature.length; i += 2) {
      bytes.push(parseInt(cleanSignature.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  }

  throw new Error('Invalid signature format');
}

/**
 * Checks if wallet address belongs to a known wallet provider
 * 
 * @param {string} address - Wallet address
 * @returns {Object} Provider information
 */
function detectWalletProvider(address) {
  // This is a basic implementation
  // In practice, you might want to check address patterns or maintain a registry
  
  if (!validateSolanaAddress(address)) {
    return { provider: 'unknown', confidence: 0 };
  }

  // For now, return generic Solana wallet
  return {
    provider: 'solana',
    confidence: 1,
    network: 'solana'
  };
}

/**
 * Validates multiple wallet addresses
 * 
 * @param {Array} addresses - Array of wallet addresses
 * @returns {Object} Validation result
 */
function validateMultipleWallets(addresses) {
  if (!Array.isArray(addresses)) {
    return { isValid: false, error: 'Addresses must be an array' };
  }

  const validAddresses = [];
  const invalidAddresses = [];
  const duplicates = [];
  const seen = new Set();

  for (const address of addresses) {
    if (seen.has(address)) {
      duplicates.push(address);
      continue;
    }
    seen.add(address);

    if (validateSolanaAddress(address)) {
      validAddresses.push(address);
    } else {
      invalidAddresses.push(address);
    }
  }

  return {
    isValid: invalidAddresses.length === 0 && duplicates.length === 0,
    validAddresses,
    invalidAddresses,
    duplicates,
    totalCount: addresses.length,
    validCount: validAddresses.length
  };
}

/**
 * Generates validation schema for wallet operations
 * 
 * @param {string} operation - Type of operation
 * @returns {Object} Validation schema
 */
function getWalletValidationSchema(operation) {
  const schemas = {
    authenticate: {
      required: ['walletAddress', 'signature', 'message', 'nonce'],
      optional: ['displayName'],
      validators: {
        walletAddress: validateSolanaAddress,
        signature: validateSignatureFormat,
        nonce: validateNonce
      }
    },
    link: {
      required: ['walletAddress', 'signature', 'message'],
      optional: ['isPrimary'],
      validators: {
        walletAddress: validateSolanaAddress,
        signature: validateSignatureFormat
      }
    },
    verify: {
      required: ['walletAddress', 'signature', 'message'],
      optional: [],
      validators: {
        walletAddress: validateSolanaAddress,
        signature: validateSignatureFormat
      }
    }
  };

  return schemas[operation] || null;
}

module.exports = {
  validateSolanaAddress,
  validateSignatureFormat,
  validateNonce,
  validateAuthMessage,
  validateWalletAuthRequest,
  validateWalletLinkRequest,
  normalizeWalletAddress,
  normalizeSignature,
  detectWalletProvider,
  validateMultipleWallets,
  getWalletValidationSchema
};
