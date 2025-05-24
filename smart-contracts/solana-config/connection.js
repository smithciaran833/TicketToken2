// connection.js - Functions for connecting to Solana networks

// Import dependencies
const { Connection } = require('@solana/web3.js');
const { NETWORKS, DEFAULT_NETWORK, CONNECTION_CONFIG } = require('./constants');

/**
 * Creates a connection to the Solana network
 * 
 * @param {string} network - Network to connect to (mainnet, testnet, devnet, localhost)
 * @returns {Connection} Solana connection object
 */
function createConnection(network = DEFAULT_NETWORK.name.toLowerCase()) {
  // Get network configuration
  const networkConfig = NETWORKS[network.toLowerCase()] || DEFAULT_NETWORK;
  
  // Create and return connection
  return new Connection(networkConfig.endpoint, CONNECTION_CONFIG.commitment);
}

/**
 * Gets information about the connected network
 * 
 * @param {string} network - Network name
 * @returns {Object} Network information
 */
function getNetworkInfo(network = DEFAULT_NETWORK.name.toLowerCase()) {
  return NETWORKS[network.toLowerCase()] || DEFAULT_NETWORK;
}

// Export functions
module.exports = {
  createConnection,
  getNetworkInfo
};
