// constants.js - Solana network configuration

// Network endpoints
const NETWORKS = {
  // Mainnet (production) endpoint
  mainnet: {
    endpoint: 'https://api.mainnet-beta.solana.com',
    name: 'Mainnet',
    isProduction: true
  },
  // Testnet endpoint (more stable than devnet)
  testnet: {
    endpoint: 'https://api.testnet.solana.com',
    name: 'Testnet',
    isProduction: false
  },
  // Devnet endpoint (for development)
  devnet: {
    endpoint: 'https://api.devnet.solana.com',
    name: 'Devnet',
    isProduction: false
  },
  // Local endpoint (for local validator)
  localhost: {
    endpoint: 'http://localhost:8899',
    name: 'Localhost',
    isProduction: false
  }
};

// Default network to use for development
const DEFAULT_NETWORK = NETWORKS.devnet;

// Commitment level for transactions
// (how many confirmations to wait for)
const COMMITMENT = 'confirmed';

// Connection configuration
const CONNECTION_CONFIG = {
  commitment: COMMITMENT,
  confirmTransactionInitialTimeout: 60000 // 1 minute
};

// Metaplex configuration
const METAPLEX = {
  // Metaplex program IDs
  TOKEN_METADATA_PROGRAM_ID: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  // Symbol for NFT tickets
  TICKET_SYMBOL: 'TKTTKN'
};

// Export constants
module.exports = {
  NETWORKS,
  DEFAULT_NETWORK,
  COMMITMENT,
  CONNECTION_CONFIG,
  METAPLEX
};
