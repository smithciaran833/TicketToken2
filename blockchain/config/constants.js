/**
 * Solana network configuration constants
 */

// Network endpoints and configurations
const NETWORKS = {
  // Mainnet (production) endpoint
  'mainnet-beta': {
    name: 'Mainnet Beta',
    endpoint: 'https://api.mainnet-beta.solana.com',
    websocket: 'wss://api.mainnet-beta.solana.com',
    isProduction: true
  },
  // Testnet endpoint (more stable than devnet)
  'testnet': {
    name: 'Testnet',
    endpoint: 'https://api.testnet.solana.com',
    websocket: 'wss://api.testnet.solana.com',
    isProduction: false
  },
  // Devnet endpoint (for development)
  'devnet': {
    name: 'Devnet',
    endpoint: 'https://api.devnet.solana.com',
    websocket: 'wss://api.devnet.solana.com',
    isProduction: false
  },
  // Local endpoint (for local validator)
  'localhost': {
    name: 'Localhost',
    endpoint: 'http://localhost:8899',
    websocket: 'ws://localhost:8900',
    isProduction: false
  }
};

// Default network for development
const DEFAULT_NETWORK = 'devnet';

// Connection configuration
const CONNECTION_CONFIG = {
  // Commitment level for transactions
  commitment: 'confirmed',
  // Transaction confirmation timeout (60 seconds)
  confirmTransactionInitialTimeout: 60000,
  // Disable caching for testing
  disableCaching: false
};

module.exports = {
  NETWORKS,
  DEFAULT_NETWORK,
  CONNECTION_CONFIG
};
