/**
 * Solana blockchain connection utilities
 * 
 * This module provides functions for connecting to different Solana networks
 * and testing the connections.
 */

// Import Solana web3.js library
const { Connection, clusterApiUrl } = require('@solana/web3.js');

// Import configuration
const { NETWORKS, DEFAULT_NETWORK, CONNECTION_CONFIG } = require('./constants');

/**
 * Creates a connection to a Solana network
 * 
 * @param {string} network - Network identifier ('mainnet-beta', 'testnet', 'devnet', 'localhost')
 * @param {Object} config - Optional configuration overrides
 * @returns {Connection} Solana connection object
 */
function createConnection(network = DEFAULT_NETWORK, config = {}) {
  // Merge default config with provided config
  const connectionConfig = { ...CONNECTION_CONFIG, ...config };
  
  // Determine endpoint URL
  let endpoint;
  
  if (network in NETWORKS) {
    endpoint = NETWORKS[network].endpoint;
  } else {
    // Use clusterApiUrl as fallback for standard networks
    try {
      endpoint = clusterApiUrl(network);
    } catch (error) {
      console.error(`Unknown network: ${network}, falling back to ${DEFAULT_NETWORK}`);
      endpoint = NETWORKS[DEFAULT_NETWORK].endpoint;
    }
  }
  
  // Create and return connection
  return new Connection(endpoint, {
    commitment: connectionConfig.commitment,
    confirmTransactionInitialTimeout: connectionConfig.confirmTransactionInitialTimeout,
    disableCaching: connectionConfig.disableCaching
  });
}

/**
 * Tests the connection to a Solana network
 * 
 * @param {Connection|string} connection - Connection object or network name
 * @returns {Promise<Object>} Result of the test containing version and status
 */
async function testConnection(connection) {
  // Convert network name to connection if needed
  if (typeof connection === 'string') {
    connection = createConnection(connection);
  }
  
  try {
    // Get version information
    const version = await connection.getVersion();
    
    // Get recent blockhash to verify connection is responsive
    const { blockhash } = await connection.getLatestBlockhash();
    
    // Return successful test result
    return {
      success: true,
      version: version['solana-core'],
      features: version.feature,
      blockhash: blockhash
    };
  } catch (error) {
    // Return failed test result
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Gets information about a Solana network
 * 
 * @param {string} network - Network identifier ('mainnet-beta', 'testnet', 'devnet', 'localhost')
 * @returns {Object} Network information
 */
function getNetworkInfo(network = DEFAULT_NETWORK) {
  return NETWORKS[network] || null;
}

/**
 * Creates connections to all configured networks
 * 
 * @returns {Object} Object with network connections
 */
function getAllNetworkConnections() {
  const connections = {};
  
  for (const network in NETWORKS) {
    connections[network] = createConnection(network);
  }
  
  return connections;
}

// Export functions
module.exports = {
  createConnection,
  testConnection,
  getNetworkInfo,
  getAllNetworkConnections
};
