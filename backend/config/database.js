const mongoose = require('mongoose');

/**
 * MongoDB Connection Configuration
 * Handles database connection with retry logic, event handlers, and graceful shutdown
 */

// Connection options for optimal performance and reliability
const connectionOptions = {
  // Use new URL parser and unified topology
  useNewUrlParser: true,
  useUnifiedTopology: true,
  
  // Connection pool settings
  maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 10, // Maximum number of connections
  minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE) || 2,  // Minimum number of connections
  maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME) || 30000, // Close after 30 seconds of inactivity
  
  // Timeout settings
  serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT) || 5000, // How long to try selecting a server
  socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT) || 45000, // How long to wait for a response
  connectTimeoutMS: parseInt(process.env.DB_CONNECT_TIMEOUT) || 10000, // How long to wait for initial connection
  
  // Heartbeat settings
  heartbeatFrequencyMS: parseInt(process.env.DB_HEARTBEAT_FREQUENCY) || 10000, // How often to check server
  
  // Buffer settings
  bufferMaxEntries: 0, // Disable mongoose buffering
  bufferCommands: false, // Disable mongoose buffering
  
  // Index settings
  autoIndex: process.env.NODE_ENV !== 'production', // Build indexes in development
  autoCreate: process.env.NODE_ENV !== 'production', // Auto-create collections in development
  
  // Additional settings
  family: 4, // Use IPv4, skip trying IPv6
  keepAlive: true,
  keepAliveInitialDelay: 300000, // 5 minutes
  
  // Authentication (if needed)
  ...(process.env.DB_AUTH_SOURCE && {
    authSource: process.env.DB_AUTH_SOURCE
  })
};

// Retry configuration
const retryConfig = {
  maxRetries: parseInt(process.env.DB_MAX_RETRIES) || 5,
  retryDelayMS: parseInt(process.env.DB_RETRY_DELAY) || 5000,
  backoffMultiplier: parseFloat(process.env.DB_BACKOFF_MULTIPLIER) || 2
};

let retryCount = 0;
let isConnecting = false;

/**
 * Validates the database connection string and extracts database name
 */
const validateConnectionString = (uri) => {
  if (!uri) {
    throw new Error('❌ Database connection string is required. Please set MONGODB_URI environment variable.');
  }

  try {
    const url = new URL(uri);
    const dbName = url.pathname.slice(1); // Remove leading slash
    
    if (!dbName) {
      throw new Error('❌ Database name is required in connection string');
    }

    // Validate database name format
    const validDbNameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!validDbNameRegex.test(dbName)) {
      throw new Error('❌ Invalid database name format. Use only letters, numbers, underscores, and hyphens.');
    }

    console.log(`🔍 Database validation passed: ${dbName}`);
    return { uri, dbName };
  } catch (error) {
    if (error.message.startsWith('❌')) {
      throw error;
    }
    throw new Error(`❌ Invalid MongoDB connection string format: ${error.message}`);
  }
};

/**
 * Sleep function for retry delays
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate retry delay with exponential backoff
 */
const calculateRetryDelay = (attempt) => {
  return retryConfig.retryDelayMS * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
};

/**
 * Main database connection function with retry logic
 */
const connectDB = async () => {
  if (isConnecting) {
    console.log('🔄 Database connection already in progress...');
    return;
  }

  const connectionString = process.env.MONGODB_URI || process.env.DATABASE_URL;
  
  try {
    // Validate connection string
    const { uri, dbName } = validateConnectionString(connectionString);
    
    isConnecting = true;
    console.log(`🚀 Attempting to connect to MongoDB database: ${dbName}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Attempt connection
    const conn = await mongoose.connect(uri, connectionOptions);
    
    // Reset retry count on successful connection
    retryCount = 0;
    isConnecting = false;
    
    console.log(`✅ MongoDB Connected Successfully!`);
    console.log(`📍 Host: ${conn.connection.host}`);
    console.log(`🗄️  Database: ${conn.connection.name}`);
    console.log(`🔌 Connection State: ${getConnectionStateText(conn.connection.readyState)}`);
    
    return conn;
    
  } catch (error) {
    isConnecting = false;
    retryCount++;
    
    console.error(`❌ MongoDB connection attempt ${retryCount} failed:`, error.message);
    
    // If we haven't exceeded max retries, try again
    if (retryCount <= retryConfig.maxRetries) {
      const delay = calculateRetryDelay(retryCount);
      console.log(`⏳ Retrying connection in ${delay / 1000} seconds... (${retryCount}/${retryConfig.maxRetries})`);
      
      await sleep(delay);
      return connectDB(); // Recursive retry
    } else {
      console.error(`💥 Failed to connect to MongoDB after ${retryConfig.maxRetries} attempts`);
      console.error(`🔧 Please check your connection string and database availability`);
      
      // In production, we might want to keep trying or exit
      if (process.env.NODE_ENV === 'production') {
        console.error('🚨 Exiting application due to database connection failure');
        process.exit(1);
      } else {
        throw error;
      }
    }
  }
};

/**
 * Get human-readable connection state
 */
const getConnectionStateText = (state) => {
  const states = {
    0: 'Disconnected',
    1: 'Connected',
    2: 'Connecting',
    3: 'Disconnecting'
  };
  return states[state] || 'Unknown';
};

/**
 * Set up database connection event handlers
 */
const setupConnectionHandlers = () => {
  // Connection successful
  mongoose.connection.on('connected', () => {
    console.log('🔗 Mongoose connected to MongoDB');
  });

  // Connection error
  mongoose.connection.on('error', (err) => {
    console.error('❌ Mongoose connection error:', err.message);
    
    // Log additional error details in development
    if (process.env.NODE_ENV === 'development') {
      console.error('🔍 Error details:', err);
    }
  });

  // Connection disconnected
  mongoose.connection.on('disconnected', () => {
    console.log('⚠️  Mongoose disconnected from MongoDB');
    
    // Attempt to reconnect if not in graceful shutdown
    if (!isGracefulShutdown) {
      console.log('🔄 Attempting to reconnect...');
      setTimeout(() => {
        if (mongoose.connection.readyState === 0) { // Only if truly disconnected
          connectDB();
        }
      }, 5000);
    }
  });

  // Connection reconnected
  mongoose.connection.on('reconnected', () => {
    console.log('🔄 Mongoose reconnected to MongoDB');
    retryCount = 0; // Reset retry count on reconnection
  });

  // MongoDB server selection error
  mongoose.connection.on('serverSelectionError', (err) => {
    console.error('🚫 MongoDB server selection error:', err.message);
  });

  // Index build events
  mongoose.connection.on('index', () => {
    console.log('📝 Index build completed');
  });

  mongoose.connection.on('indexError', (err) => {
    console.error('❌ Index build error:', err.message);
  });
};

// Track graceful shutdown state
let isGracefulShutdown = false;

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = async (signal) => {
  console.log(`🔄 ${signal} received. Closing MongoDB connection...`);
  isGracefulShutdown = true;
  
  try {
    await mongoose.connection.close();
    console.log('🔒 MongoDB connection closed successfully');
    
    // Give a moment for cleanup
    setTimeout(() => {
      console.log('👋 Graceful shutdown complete');
      process.exit(0);
    }, 1000);
    
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error.message);
    process.exit(1);
  }
};

/**
 * Set up graceful shutdown handlers
 */
const setupShutdownHandlers = () => {
  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Handle SIGTERM (Docker, PM2, etc.)
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Handle SIGUSR2 (nodemon restart)
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error.message);
    console.error(error.stack);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
  });
};

/**
 * Get current connection status
 */
const getConnectionStatus = () => {
  const state = mongoose.connection.readyState;
  return {
    isConnected: state === 1,
    state: getConnectionStateText(state),
    host: mongoose.connection.host,
    name: mongoose.connection.name,
    port: mongoose.connection.port
  };
};

/**
 * Initialize database connection and handlers
 */
const initializeDatabase = async () => {
  console.log('🔧 Initializing database connection...');
  
  // Set up event handlers first
  setupConnectionHandlers();
  setupShutdownHandlers();
  
  // Enable Mongoose debugging in development
  if (process.env.NODE_ENV === 'development' && process.env.MONGOOSE_DEBUG === 'true') {
    mongoose.set('debug', true);
    console.log('🐛 Mongoose debugging enabled');
  }
  
  // Connect to database
  return await connectDB();
};

// Export the connection function and utilities
module.exports = {
  connectDB: initializeDatabase,
  getConnectionStatus,
  mongoose
};
