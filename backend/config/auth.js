const crypto = require('crypto');

/**
 * Authentication Configuration
 * Centralizes all authentication-related settings with environment fallbacks
 */

// Helper function to generate secure random string
const generateSecureSecret = (length = 64) => {
  return crypto.randomBytes(length).toString('hex');
};

// Helper function to parse time duration strings
const parseDuration = (duration, defaultMs) => {
  if (typeof duration === 'number') return duration;
  if (typeof duration === 'string') {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return defaultMs;
      }
    }
  }
  return defaultMs;
};

// Validate required environment variables
const validateRequiredEnvVars = () => {
  const required = ['JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    } else {
      console.warn('Using generated secrets for development. DO NOT use in production!');
    }
  }
};

// Validate environment on startup
validateRequiredEnvVars();

const authConfig = {
  // ========================================
  // JWT CONFIGURATION
  // ========================================
  jwt: {
    // Main JWT secret for access tokens
    secret: process.env.JWT_SECRET || (() => {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be set in production');
      }
      console.warn('JWT_SECRET not set, generating random secret for development');
      return generateSecureSecret();
    })(),
    
    // Access token expiration
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    
    // JWT algorithm
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    
    // JWT issuer
    issuer: process.env.JWT_ISSUER || 'event-platform-api',
    
    // JWT audience
    audience: process.env.JWT_AUDIENCE || 'event-platform-users',
    
    // Clock tolerance for token validation (in seconds)
    clockTolerance: parseInt(process.env.JWT_CLOCK_TOLERANCE) || 30,
    
    // Token not before leeway (in seconds)
    notBefore: parseInt(process.env.JWT_NOT_BEFORE) || 0
  },

  // ========================================
  // REFRESH TOKEN CONFIGURATION
  // ========================================
  refreshToken: {
    // Refresh token secret (should be different from JWT secret)
    secret: process.env.JWT_REFRESH_SECRET || (() => {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_REFRESH_SECRET must be set in production');
      }
      console.warn('JWT_REFRESH_SECRET not set, generating random secret for development');
      return generateSecureSecret();
    })(),
    
    // Refresh token expiration
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
    
    // Maximum number of refresh tokens per user
    maxTokensPerUser: parseInt(process.env.MAX_REFRESH_TOKENS_PER_USER) || 5,
    
    // Automatic cleanup interval for expired tokens (in milliseconds)
    cleanupInterval: parseDuration(process.env.REFRESH_TOKEN_CLEANUP_INTERVAL, 24 * 60 * 60 * 1000), // 24 hours
    
    // Enable refresh token rotation (security best practice)
    rotateOnUse: process.env.REFRESH_TOKEN_ROTATION === 'true' || true,
    
    // Refresh token length for generated tokens
    tokenLength: parseInt(process.env.REFRESH_TOKEN_LENGTH) || 32
  },

  // ========================================
  // PASSWORD CONFIGURATION
  // ========================================
  password: {
    // bcrypt salt rounds (higher = more secure but slower)
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
    
    // Password strength requirements
    minLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
    maxLength: parseInt(process.env.PASSWORD_MAX_LENGTH) || 128,
    
    // Password complexity requirements
    requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
    requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
    requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== 'false',
    requireSpecialChars: process.env.PASSWORD_REQUIRE_SPECIAL !== 'false',
    
    // Special characters allowed in passwords
    specialChars: process.env.PASSWORD_SPECIAL_CHARS || '@$!%*?&',
    
    // Password history (prevent reusing recent passwords)
    historyCount: parseInt(process.env.PASSWORD_HISTORY_COUNT) || 5,
    
    // Password reset token expiration
    resetTokenExpiry: parseDuration(process.env.PASSWORD_RESET_EXPIRY, 60 * 60 * 1000), // 1 hour
    
    // Password reset token length
    resetTokenLength: parseInt(process.env.PASSWORD_RESET_TOKEN_LENGTH) || 32
  },

  // ========================================
  // EMAIL VERIFICATION CONFIGURATION
  // ========================================
  emailVerification: {
    // Email verification token expiration
    tokenExpiry: parseDuration(process.env.EMAIL_VERIFICATION_EXPIRY, 24 * 60 * 60 * 1000), // 24 hours
    
    // Email verification token length
    tokenLength: parseInt(process.env.EMAIL_VERIFICATION_TOKEN_LENGTH) || 32,
    
    // Require email verification for sensitive operations
    required: process.env.EMAIL_VERIFICATION_REQUIRED !== 'false',
    
    // Allow login without email verification
    allowUnverifiedLogin: process.env.ALLOW_UNVERIFIED_LOGIN === 'true',
    
    // Maximum verification attempts before account lock
    maxAttempts: parseInt(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS) || 5,
    
    // Resend verification email cooldown (in milliseconds)
    resendCooldown: parseDuration(process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN, 5 * 60 * 1000), // 5 minutes
    
    // Email verification URL template
    urlTemplate: process.env.EMAIL_VERIFICATION_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email`,
    
    // Email sender configuration
    sender: {
      name: process.env.EMAIL_SENDER_NAME || 'Event Platform',
      email: process.env.EMAIL_SENDER_ADDRESS || 'noreply@eventplatform.com'
    }
  },

  // ========================================
  // RATE LIMITING CONFIGURATION
  // ========================================
  rateLimit: {
    // Global authentication rate limiting
    global: {
      windowMs: parseDuration(process.env.AUTH_RATE_LIMIT_WINDOW, 15 * 60 * 1000), // 15 minutes
      max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 20,
      message: 'Too many authentication requests, please try again later'
    },
    
    // Login rate limiting
    login: {
      windowMs: parseDuration(process.env.LOGIN_RATE_LIMIT_WINDOW, 15 * 60 * 1000), // 15 minutes
      max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
      maxPerUser: parseInt(process.env.LOGIN_RATE_LIMIT_PER_USER) || 3,
      lockoutDuration: parseDuration(process.env.LOGIN_LOCKOUT_DURATION, 30 * 60 * 1000), // 30 minutes
      maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS) || 5
    },
    
    // Registration rate limiting
    register: {
      windowMs: parseDuration(process.env.REGISTER_RATE_LIMIT_WINDOW, 60 * 60 * 1000), // 1 hour
      max: parseInt(process.env.REGISTER_RATE_LIMIT_MAX) || 3,
      requireEmailVerification: process.env.REGISTER_REQUIRE_EMAIL_VERIFICATION !== 'false'
    },
    
    // Password reset rate limiting
    passwordReset: {
      windowMs: parseDuration(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW, 60 * 60 * 1000), // 1 hour
      max: parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_MAX) || 3,
      cooldown: parseDuration(process.env.PASSWORD_RESET_COOLDOWN, 5 * 60 * 1000) // 5 minutes
    },
    
    // Email verification rate limiting
    emailVerification: {
      windowMs: parseDuration(process.env.EMAIL_VERIFICATION_RATE_LIMIT_WINDOW, 60 * 60 * 1000), // 1 hour
      max: parseInt(process.env.EMAIL_VERIFICATION_RATE_LIMIT_MAX) || 5
    },
    
    // Failed authentication attempts
    failedAuth: {
      windowMs: parseDuration(process.env.FAILED_AUTH_RATE_LIMIT_WINDOW, 15 * 60 * 1000), // 15 minutes
      max: parseInt(process.env.FAILED_AUTH_RATE_LIMIT_MAX) || 10
    }
  },

  // ========================================
  // WALLET SIGNATURE VERIFICATION
  // ========================================
  wallet: {
    // Supported wallet types
    supportedWallets: (process.env.SUPPORTED_WALLETS || 'phantom,solflare,coinbase,backpack').split(','),
    
    // Signature verification settings
    signature: {
      // Message timeout for replay attack prevention (in milliseconds)
      messageTimeout: parseDuration(process.env.WALLET_MESSAGE_TIMEOUT, 5 * 60 * 1000), // 5 minutes
      
      // Required message format
      messageFormat: process.env.WALLET_MESSAGE_FORMAT || 'Sign this message to authenticate with Event Platform.\n\nTimestamp: {timestamp}\nNonce: {nonce}',
      
      // Nonce length for message uniqueness
      nonceLength: parseInt(process.env.WALLET_NONCE_LENGTH) || 16,
      
      // Enable strict message validation
      strictValidation: process.env.WALLET_STRICT_VALIDATION !== 'false',
      
      // Maximum message length
      maxMessageLength: parseInt(process.env.WALLET_MAX_MESSAGE_LENGTH) || 500
    },
    
    // Wallet connection settings
    connection: {
      // Maximum wallets per user
      maxWalletsPerUser: parseInt(process.env.MAX_WALLETS_PER_USER) || 3,
      
      // Require wallet verification for sensitive operations
      requireVerification: process.env.WALLET_REQUIRE_VERIFICATION !== 'false',
      
      // Wallet verification expiry
      verificationExpiry: parseDuration(process.env.WALLET_VERIFICATION_EXPIRY, 30 * 24 * 60 * 60 * 1000) // 30 days
    },
    
    // Solana-specific settings
    solana: {
      // Network configuration
      network: process.env.SOLANA_NETWORK || 'mainnet-beta',
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      
      // Wallet address validation
      validateAddress: process.env.SOLANA_VALIDATE_ADDRESS !== 'false',
      
      // Transaction verification settings
      verifyTransactions: process.env.SOLANA_VERIFY_TRANSACTIONS === 'true',
      maxTransactionAge: parseDuration(process.env.SOLANA_MAX_TRANSACTION_AGE, 5 * 60 * 1000) // 5 minutes
    }
  },

  // ========================================
  // SESSION MANAGEMENT
  // ========================================
  session: {
    // Session duration
    duration: parseDuration(process.env.SESSION_DURATION, 24 * 60 * 60 * 1000), // 24 hours
    
    // Session cleanup interval
    cleanupInterval: parseDuration(process.env.SESSION_CLEANUP_INTERVAL, 60 * 60 * 1000), // 1 hour
    
    // Maximum concurrent sessions per user
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 5,
    
    // Session extension on activity
    extendOnActivity: process.env.SESSION_EXTEND_ON_ACTIVITY !== 'false',
    
    // Session extension threshold (extend session if less than this time remaining)
    extensionThreshold: parseDuration(process.env.SESSION_EXTENSION_THRESHOLD, 30 * 60 * 1000), // 30 minutes
    
    // Remember me duration
    rememberMeDuration: parseDuration(process.env.REMEMBER_ME_DURATION, 30 * 24 * 60 * 60 * 1000), // 30 days
    
    // Session cookie settings
    cookie: {
      name: process.env.SESSION_COOKIE_NAME || 'session_id',
      httpOnly: process.env.SESSION_COOKIE_HTTP_ONLY !== 'false',
      secure: process.env.NODE_ENV === 'production' ? true : (process.env.SESSION_COOKIE_SECURE === 'true'),
      sameSite: process.env.SESSION_COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
      domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
      path: process.env.SESSION_COOKIE_PATH || '/'
    },
    
    // Refresh token cookie settings
    refreshTokenCookie: {
      name: process.env.REFRESH_TOKEN_COOKIE_NAME || 'refreshToken',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' ? true : (process.env.REFRESH_TOKEN_COOKIE_SECURE === 'true'),
      sameSite: process.env.REFRESH_TOKEN_COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
      domain: process.env.REFRESH_TOKEN_COOKIE_DOMAIN || undefined,
      path: process.env.REFRESH_TOKEN_COOKIE_PATH || '/',
      maxAge: parseDuration(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000) // 7 days
    }
  },

  // ========================================
  // ACCOUNT SECURITY
  // ========================================
  security: {
    // Account lockout settings
    accountLockout: {
      enabled: process.env.ACCOUNT_LOCKOUT_ENABLED !== 'false',
      maxAttempts: parseInt(process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS) || 5,
      lockoutDuration: parseDuration(process.env.ACCOUNT_LOCKOUT_DURATION, 30 * 60 * 1000), // 30 minutes
      progressiveDelay: process.env.ACCOUNT_LOCKOUT_PROGRESSIVE === 'true'
    },
    
    // Two-factor authentication
    twoFactor: {
      enabled: process.env.TWO_FACTOR_ENABLED === 'true',
      issuer: process.env.TWO_FACTOR_ISSUER || 'Event Platform',
      windowSeconds: parseInt(process.env.TWO_FACTOR_WINDOW) || 30,
      backupCodes: parseInt(process.env.TWO_FACTOR_BACKUP_CODES) || 10
    },
    
    // Device tracking
    deviceTracking: {
      enabled: process.env.DEVICE_TRACKING_ENABLED !== 'false',
      maxDevices: parseInt(process.env.MAX_DEVICES_PER_USER) || 10,
      deviceTrustDuration: parseDuration(process.env.DEVICE_TRUST_DURATION, 30 * 24 * 60 * 60 * 1000) // 30 days
    },
    
    // IP allowlist/blocklist
    ipSecurity: {
      enableAllowlist: process.env.IP_ALLOWLIST_ENABLED === 'true',
      allowlist: process.env.IP_ALLOWLIST ? process.env.IP_ALLOWLIST.split(',') : [],
      enableBlocklist: process.env.IP_BLOCKLIST_ENABLED === 'true',
      blocklist: process.env.IP_BLOCKLIST ? process.env.IP_BLOCKLIST.split(',') : []
    }
  },

  // ========================================
  // EXTERNAL SERVICES
  // ========================================
  external: {
    // Email service configuration
    email: {
      provider: process.env.EMAIL_PROVIDER || 'smtp',
      from: process.env.EMAIL_FROM || 'noreply@eventplatform.com',
      replyTo: process.env.EMAIL_REPLY_TO || 'support@eventplatform.com'
    },
    
    // OAuth providers
    oauth: {
      google: {
        enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackUrl: process.env.GOOGLE_CALLBACK_URL
      },
      github: {
        enabled: process.env.GITHUB_OAUTH_ENABLED === 'true',
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackUrl: process.env.GITHUB_CALLBACK_URL
      },
      discord: {
        enabled: process.env.DISCORD_OAUTH_ENABLED === 'true',
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackUrl: process.env.DISCORD_CALLBACK_URL
      }
    }
  },

  // ========================================
  // DEVELOPMENT & DEBUGGING
  // ========================================
  development: {
    // Enable development mode features
    enabled: process.env.NODE_ENV === 'development',
    
    // Allow insecure features in development
    allowInsecure: process.env.DEV_ALLOW_INSECURE === 'true',
    
    // Mock authentication
    mockAuth: process.env.DEV_MOCK_AUTH === 'true',
    
    // Disable rate limiting in development
    disableRateLimit: process.env.DEV_DISABLE_RATE_LIMIT === 'true',
    
    // Log detailed auth events
    verboseLogging: process.env.DEV_VERBOSE_LOGGING === 'true',
    
    // Test user credentials
    testUser: {
      email: process.env.DEV_TEST_USER_EMAIL || 'test@example.com',
      password: process.env.DEV_TEST_USER_PASSWORD || 'TestPassword123!'
    }
  }
};

// Validate configuration
const validateConfig = () => {
  // Validate JWT secret strength in production
  if (process.env.NODE_ENV === 'production') {
    if (authConfig.jwt.secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long in production');
    }
    if (authConfig.refreshToken.secret.length < 32) {
      throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long in production');
    }
  }
  
  // Validate bcrypt rounds
  if (authConfig.password.saltRounds < 10 || authConfig.password.saltRounds > 15) {
    console.warn('bcrypt salt rounds should be between 10-15 for optimal security/performance balance');
  }
  
  return true;
};

// Validate configuration on module load
validateConfig();

module.exports = authConfig;
