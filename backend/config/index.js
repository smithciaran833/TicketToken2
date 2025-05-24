const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// ========================================
// ENVIRONMENT SETUP
// ========================================

// Load environment variables from .env files
const loadEnvironment = () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const envFiles = [
    `.env.${nodeEnv}.local`,
    `.env.local`,
    `.env.${nodeEnv}`,
    '.env'
  ];

  envFiles.forEach(envFile => {
    const envPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (result.error) {
        console.warn(`Warning: Could not load ${envFile}:`, result.error.message);
      } else {
        console.log(`✓ Loaded environment from ${envFile}`);
      }
    }
  });
};

// Load environment variables
loadEnvironment();

// ========================================
// CONFIGURATION MODULES
// ========================================

// Import configuration modules
const authConfig = require('./auth');

// Import other config modules (create placeholders if they don't exist)
const getDatabaseConfig = () => {
  try {
    return require('./database');
  } catch (error) {
    console.warn('Database config not found, using defaults');
    return {
      mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/eventplatform',
        options: {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 10,
          serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT) || 5000,
          socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT) || 45000,
          family: 4
        }
      }
    };
  }
};

const getStorageConfig = () => {
  try {
    return require('./storage');
  } catch (error) {
    console.warn('Storage config not found, using defaults');
    return {
      local: {
        uploadsDir: process.env.UPLOADS_DIR || './uploads',
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
        allowedTypes: (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(',')
      },
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
        s3: {
          bucket: process.env.AWS_S3_BUCKET,
          prefix: process.env.AWS_S3_PREFIX || 'uploads/'
        }
      },
      cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET
      }
    };
  }
};

const getEmailConfig = () => {
  try {
    return require('./email');
  } catch (error) {
    console.warn('Email config not found, using defaults');
    return {
      provider: process.env.EMAIL_PROVIDER || 'smtp',
      smtp: {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      },
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY
      },
      mailgun: {
        apiKey: process.env.MAILGUN_API_KEY,
        domain: process.env.MAILGUN_DOMAIN
      }
    };
  }
};

const getPaymentConfig = () => {
  try {
    return require('./payment');
  } catch (error) {
    console.warn('Payment config not found, using defaults');
    return {
      stripe: {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        secretKey: process.env.STRIPE_SECRET_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        currency: process.env.STRIPE_CURRENCY || 'usd'
      },
      paypal: {
        clientId: process.env.PAYPAL_CLIENT_ID,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET,
        mode: process.env.PAYPAL_MODE || 'sandbox'
      }
    };
  }
};

const getRedisConfig = () => {
  try {
    return require('./redis');
  } catch (error) {
    console.warn('Redis config not found, using defaults');
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false
    };
  }
};

// ========================================
// ENVIRONMENT VALIDATION
// ========================================

/**
 * Required environment variables by environment
 */
const requiredEnvVars = {
  production: [
    'NODE_ENV',
    'PORT',
    'MONGODB_URI',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
    'API_URL'
  ],
  staging: [
    'NODE_ENV',
    'PORT',
    'MONGODB_URI',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL'
  ],
  development: [
    'NODE_ENV'
  ],
  test: [
    'NODE_ENV'
  ]
};

/**
 * Validate required environment variables
 */
const validateEnvironment = () => {
  const environment = process.env.NODE_ENV || 'development';
  const required = requiredEnvVars[environment] || requiredEnvVars.development;
  const missing = required.filter(varName => !process.env[varName]);

  if (missing.length > 0) {
    const errorMessage = `Missing required environment variables for ${environment}: ${missing.join(', ')}`;
    
    if (environment === 'production') {
      throw new Error(errorMessage);
    } else {
      console.warn(`⚠️  ${errorMessage}`);
      console.warn('Some features may not work correctly.');
    }
  }

  return missing.length === 0;
};

/**
 * Validate configuration integrity
 */
const validateConfiguration = (config) => {
  const errors = [];
  const warnings = [];

  // Validate database configuration
  if (!config.database.mongodb.uri) {
    errors.push('Database URI is required');
  }

  // Validate authentication configuration
  if (config.environment === 'production') {
    if (config.auth.jwt.secret.length < 32) {
      errors.push('JWT secret must be at least 32 characters in production');
    }
    if (config.auth.refreshToken.secret.length < 32) {
      errors.push('Refresh token secret must be at least 32 characters in production');
    }
  }

  // Validate URL configurations
  const urlFields = ['app.frontendUrl', 'app.apiUrl'];
  urlFields.forEach(field => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
    if (value && !isValidUrl(value)) {
      warnings.push(`Invalid URL format for ${field}: ${value}`);
    }
  });

  // Validate port configuration
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push(`Invalid port number: ${config.server.port}`);
  }

  // Validate storage configuration if using cloud storage
  if (config.storage.provider === 'aws' && !config.storage.aws.s3.bucket) {
    warnings.push('AWS S3 bucket not configured, file uploads may fail');
  }

  return { errors, warnings };
};

/**
 * Check if string is a valid URL
 */
const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

/**
 * Get default values for optional configurations
 */
const getDefaults = () => ({
  server: {
    port: parseInt(process.env.PORT) || 3001,
    host: process.env.HOST || '0.0.0.0',
    timeout: parseInt(process.env.SERVER_TIMEOUT) || 30000,
    keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT) || 61000,
    headersTimeout: parseInt(process.env.HEADERS_TIMEOUT) || 62000
  },
  app: {
    name: process.env.APP_NAME || 'Event Platform API',
    version: process.env.APP_VERSION || '1.0.0',
    description: process.env.APP_DESCRIPTION || 'Event management and ticketing platform',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    apiUrl: process.env.API_URL || 'http://localhost:3001',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@eventplatform.com',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@eventplatform.com'
  },
  cors: {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'],
    credentials: process.env.CORS_CREDENTIALS !== 'false',
    optionsSuccessStatus: 200
  },
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: process.env.LOG_FORMAT || 'combined',
    file: process.env.LOG_FILE || null,
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
    datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD'
  },
  security: {
    trustProxy: process.env.TRUST_PROXY === 'true',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    helmetEnabled: process.env.HELMET_ENABLED !== 'false',
    corsEnabled: process.env.CORS_ENABLED !== 'false'
  },
  monitoring: {
    enabled: process.env.MONITORING_ENABLED === 'true',
    endpoint: process.env.MONITORING_ENDPOINT,
    apiKey: process.env.MONITORING_API_KEY,
    sampleRate: parseFloat(process.env.MONITORING_SAMPLE_RATE) || 0.1
  }
});

// ========================================
// ENVIRONMENT-SPECIFIC OVERRIDES
// ========================================

/**
 * Get environment-specific configuration overrides
 */
const getEnvironmentOverrides = (environment) => {
  const overrides = {};

  switch (environment) {
    case 'production':
      overrides.logging = {
        level: 'warn',
        format: 'json'
      };
      overrides.security = {
        trustProxy: true,
        helmetEnabled: true
      };
      overrides.auth = {
        development: {
          enabled: false,
          mockAuth: false,
          disableRateLimit: false
        }
      };
      break;

    case 'staging':
      overrides.logging = {
        level: 'info',
        format: 'json'
      };
      overrides.auth = {
        development: {
          enabled: false,
          mockAuth: false
        }
      };
      break;

    case 'development':
      overrides.logging = {
        level: 'debug',
        format: 'dev'
      };
      overrides.security = {
        rateLimitMax: 1000,
        helmetEnabled: false
      };
      break;

    case 'test':
      overrides.logging = {
        level: 'error'
      };
      overrides.database = {
        mongodb: {
          uri: process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/eventplatform_test'
        }
      };
      overrides.auth = {
        development: {
          enabled: true,
          mockAuth: true,
          disableRateLimit: true
        }
      };
      break;
  }

  return overrides;
};

/**
 * Deep merge objects
 */
const deepMerge = (target, source) => {
  const output = Object.assign({}, target);
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
};

/**
 * Check if value is object
 */
const isObject = (item) => {
  return item && typeof item === 'object' && !Array.isArray(item);
};

// ========================================
// MAIN CONFIGURATION
// ========================================

/**
 * Build unified configuration object
 */
const buildConfiguration = () => {
  const environment = process.env.NODE_ENV || 'development';
  
  console.log(`🔧 Building configuration for environment: ${environment}`);
  
  // Start with defaults
  let config = getDefaults();
  
  // Add module configurations
  config.auth = authConfig;
  config.database = getDatabaseConfig();
  config.storage = getStorageConfig();
  config.email = getEmailConfig();
  config.payment = getPaymentConfig();
  config.redis = getRedisConfig();
  
  // Add environment info
  config.environment = environment;
  config.isProduction = environment === 'production';
  config.isDevelopment = environment === 'development';
  config.isTest = environment === 'test';
  config.isStaging = environment === 'staging';
  
  // Apply environment-specific overrides
  const overrides = getEnvironmentOverrides(environment);
  config = deepMerge(config, overrides);
  
  // Add computed values
  config.server.url = `http://${config.server.host}:${config.server.port}`;
  config.app.fullApiUrl = `${config.app.apiUrl}/api/v1`;
  
  return config;
};

/**
 * Initialize and validate configuration
 */
const initializeConfiguration = () => {
  try {
    console.log('🚀 Initializing application configuration...');
    
    // Validate environment
    const envValid = validateEnvironment();
    
    // Build configuration
    const config = buildConfiguration();
    
    // Validate configuration
    const { errors, warnings } = validateConfiguration(config);
    
    // Handle validation results
    if (errors.length > 0) {
      console.error('❌ Configuration errors:');
      errors.forEach(error => console.error(`  - ${error}`));
      throw new Error('Configuration validation failed');
    }
    
    if (warnings.length > 0) {
      console.warn('⚠️  Configuration warnings:');
      warnings.forEach(warning => console.warn(`  - ${warning}`));
    }
    
    // Log configuration summary
    console.log('✅ Configuration initialized successfully');
    console.log(`   Environment: ${config.environment}`);
    console.log(`   Server: ${config.server.url}`);
    console.log(`   Database: ${config.database.mongodb.uri.replace(/\/\/.*@/, '//***:***@')}`);
    console.log(`   Frontend: ${config.app.frontendUrl}`);
    console.log(`   Log Level: ${config.logging.level}`);
    
    return config;
    
  } catch (error) {
    console.error('💥 Failed to initialize configuration:', error.message);
    process.exit(1);
  }
};

// ========================================
// EXPORT CONFIGURATION
// ========================================

// Initialize and export configuration
const config = initializeConfiguration();

// Add utility methods
config.get = (path, defaultValue = null) => {
  return path.split('.').reduce((obj, key) => obj?.[key], config) || defaultValue;
};

config.has = (path) => {
  return path.split('.').reduce((obj, key) => obj?.[key], config) !== undefined;
};

config.reload = () => {
  console.log('🔄 Reloading configuration...');
  loadEnvironment();
  return buildConfiguration();
};

// Freeze configuration to prevent accidental mutations
Object.freeze(config);

module.exports = config;
