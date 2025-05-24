/**
 * Configuration for content access validation
 * Defines settings and constants for the exclusive content access system
 */

module.exports = {
  // Access types supported by the system
  accessTypes: {
    TOKEN_BASED: 'token-based',
    TIER_BASED: 'tier-based',
    TIME_LIMITED: 'time-limited',
    ALL_ACCESS: 'all-access'
  },
  
  // Default tier level (for users with no specified tier)
  defaultTierLevel: 1,
  
  // Cache settings for token validation results
  cache: {
    enabled: true,
    ttl: 3600, // Time to live in seconds (1 hour)
    maxSize: 1000 // Maximum number of entries in the cache
  },
  
  // Rate limiting settings to prevent abuse
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // Max requests per window
    message: 'Too many access validation requests, please try again later'
  },
  
  // Default expiration time for time-limited content (in days)
  defaultExpirationDays: 30,
  
  // Content types that can have access rules
  contentTypes: ['video', 'audio', 'image', 'document', 'livestream', 'experience'],
  
  // Access validation error messages
  errors: {
    invalidToken: 'Invalid or expired token',
    insufficientTier: 'Your tier level does not grant access to this content',
    notAvailableYet: 'This content is not available yet',
    expired: 'Access to this content has expired',
    contentNotFound: 'The requested content does not exist',
    accessRuleNotFound: 'No access rules found for this content'
  },
  
  // Settings for token validation
  tokenValidation: {
    requiredFields: ['tokenId', 'contentId'],
    cacheResults: true,
    refreshInterval: 24 * 60 * 60 * 1000 // 24 hours
  },
  
  // Integration with NFT verification system
  nftIntegration: {
    enabled: true,
    verificationEndpoint: '/api/nft-access/verify',
    syncWithNftAccess: true
  }
};
