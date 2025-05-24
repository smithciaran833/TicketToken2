// generate-keypair.js - Generates a new Solana keypair

// Import dependencies
const { createWallet, saveWalletToFile } = require('../solana-config/wallet');
const path = require('path');
const fs = require('fs');

// Directory to store wallets
const WALLET_DIR = path.join(__dirname, '..', 'dev-wallets');

/**
 * Generates a new keypair and saves it to a file
 */
function generateKeypair() {
  try {
    // Create wallet directory if it doesn't exist
    if (!fs.existsSync(WALLET_DIR)) {
      fs.mkdirSync(WALLET_DIR, { recursive: true });
    }
    
    // Generate wallet
    const wallet = createWallet();
    const publicKey = wallet.publicKey.toString();
    
    // Create filename based on first 8 characters of public key
    const filename = `wallet-${publicKey.slice(0, 8)}.json`;
    const walletPath = path.join(WALLET_DIR, filename);
    
    // Save wallet to file
    saveWalletToFile(wallet, walletPath);
    
    console.log(`New keypair generated: ${publicKey}`);
    console.log(`Saved to: ${walletPath}`);
  } catch (error) {
    console.error('Failed to generate keypair:', error.message);
    process.exit(1);
  }
}

// Run generator
generateKeypair();
