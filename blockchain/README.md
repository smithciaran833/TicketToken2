# TicketToken Blockchain Integration

This directory contains the code for integrating with the Solana blockchain, including:

- Network connections
- Wallet management
- Transaction utilities
- NFT handling

## Directory Structure

- `config/` - Configuration for Solana networks and wallets
- `utils/` - Utility functions for blockchain operations
- `nft/` - NFT-related functionality
- `tests/` - Test scripts for blockchain integration

## Setup

To use the blockchain integration code:

1. Make sure you have Node.js installed
2. Install dependencies with `npm install`
3. Test connections with `npm run test-connections`

## Network Connections

The connection utility supports the following Solana networks:

- Mainnet (`mainnet-beta`)
- Testnet (`testnet`)
- Devnet (`devnet`)
- Local (`localhost`)

## Usage Examples

```javascript
// Import connection utility
const { createConnection, testConnection } = require('./config/connection');

// Create connection to devnet
const connection = createConnection('devnet');

// Test the connection
const test = await testConnection(connection);
console.log(`Connection successful: ${test.success}`);
```
