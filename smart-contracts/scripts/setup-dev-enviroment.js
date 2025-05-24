// setup-dev-environment.js - Sets up the Solana development environment

// Import dependencies
const { createConnection, getNetworkInfo } = require('../solana-config/connection');
const { createWallet, saveWalletToFile } = require('../solana-config/wallet');
const { NETWORKS } = require('../solana-config/constants');
const { PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Directory to store development wallets
const WALLET_DIR = path.join(__dirname, '..', 'dev-wallets');

// Network to use (devnet for development)
const NETWORK = 'devnet';

/**
 * Sets up the development environment
 */
async function setupDevEnvironment() {
  console.log('Setting up Solana development environment...');
  
  // Create connection to Solana network
  const connection = createConnection(NETWORK);
  const networkInfo = getNetworkInfo(NETWORK);
  
  console.log(`Connected to ${networkInfo.name} (${networkInfo.endpoint})`);
  
  // Create wallet directory if it doesn't exist
  if (!fs.existsSync(WALLET_DIR)) {
    fs.mkdirSync(WALLET_DIR, { recursive: true });
    console.log(`Created wallet directory: ${WALLET_DIR}`);
  }
  
  // Generate development wallet if it doesn't exist
  const devWalletPath = path.join(WALLET_DIR, 'dev-wallet.json');
  if (!fs.existsSync(devWalletPath)) {
    console.log('Generating development wallet...');
    const wallet = createWallet();
    saveWalletToFile(wallet, devWalletPath);
    console.log(`Development wallet created: ${wallet.publicKey.toString()}`);
    console.log(`Wallet saved to: ${devWalletPath}`);
    
    // Request airdrop
    console.log(`Requesting airdrop of 2 SOL for development wallet...`);
    try {
      const signature = await connection.requestAirdrop(wallet.publicKey, 2 * 1000000000); // 2 SOL
      await connection.confirmTransaction(signature);
      console.log(`Airdrop successful! Transaction signature: ${signature}`);
    } catch (error) {
      console.error('Airdrop failed:', error.message);
      console.log('You can request an airdrop manually using the airdrop script.');
    }
  } else {
    const walletData = JSON.parse(fs.readFileSync(devWalletPath, 'utf8'));
    const publicKey = new PublicKey(walletData.publicKey);
    console.log(`Development wallet already exists: ${publicKey.toString()}`);
    console.log(`Wallet location: ${devWalletPath}`);
  }
  
  console.log('\nDevelopment environment setup complete!');
  console.log(`\nNext steps:
  1. Request an airdrop if needed: npm run airdrop
  2. Create an NFT ticket mint: [command to be added]
  3. Run tests: npm test`);
}

// Run setup
setupDevEnvironment().catch(console.error);
