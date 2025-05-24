/**
 * Test script for Solana network connections
 * 
 * This script tests connections to all configured Solana networks
 * and displays the results.
 */

// Import connection utilities
const { createConnection, testConnection, getNetworkInfo } = require('../config/connection');
const { NETWORKS } = require('../config/constants');

/**
 * Tests connection to a single network
 * 
 * @param {string} network - Network name
 * @returns {Promise<Object>} Test result
 */
async function testSingleNetwork(network) {
  console.log(`\nTesting connection to ${network}...`);
  
  try {
    // Get network info
    const networkInfo = getNetworkInfo(network);
    if (!networkInfo) {
      console.log(`❌ Unknown network: ${network}`);
      return { network, success: false, error: 'Unknown network' };
    }
    
    // Create connection
    const connection = createConnection(network);
    
    // Test connection
    const result = await testConnection(connection);
    
    if (result.success) {
      console.log(`✅ Successfully connected to ${networkInfo.name}`);
      console.log(`   Endpoint: ${networkInfo.endpoint}`);
      console.log(`   Solana version: ${result.version}`);
      console.log(`   Latest blockhash: ${result.blockhash}`);
    } else {
      console.log(`❌ Failed to connect to ${networkInfo.name}`);
      console.log(`   Error: ${result.error}`);
    }
    
    return { network, ...result };
  } catch (error) {
    console.log(`❌ Error testing ${network}: ${error.message}`);
    return { network, success: false, error: error.message };
  }
}

/**
 * Tests connections to all configured networks
 */
async function testAllNetworks() {
  console.log('TicketToken - Solana Network Connection Test');
  console.log('==========================================');
  
  const results = {};
  
  // Test each network
  for (const network in NETWORKS) {
    results[network] = await testSingleNetwork(network);
  }
  
  // Display summary
  console.log('\nConnection Test Summary:');
  console.log('======================');
  
  for (const network in results) {
    const result = results[network];
    console.log(`${result.success ? '✅' : '❌'} ${network}: ${result.success ? 'Connected' : 'Failed'}`);
  }
  
  return results;
}

// Execute test if this file is run directly
if (require.main === module) {
  console.log('Running network connection tests...');
  testAllNetworks()
    .then(() => {
      console.log('\nTests completed.');
    })
    .catch(error => {
      console.error('Error running tests:', error);
      process.exit(1);
    });
}

// Export functions for use in other files
module.exports = {
  testSingleNetwork,
  testAllNetworks
};
