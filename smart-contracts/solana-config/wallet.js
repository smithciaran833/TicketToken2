// wallet.js - Wallet configuration and utilities for Solana

// Import dependencies
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

/**
 * Creates a new Solana wallet (keypair)
 * 
 * @returns {Keypair} Solana keypair
 */
function createWallet() {
  return Keypair.generate();
}

/**
 * Loads a wallet from a file
 * 
 * @param {string} filePath - Path to the wallet file
 * @returns {Keypair} Solana keypair
 */
function loadWalletFromFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Keypair.fromSecretKey(Buffer.from(data));
  } catch (error) {
    console.error('Error loading wallet:', error);
    throw new Error('Failed to load wallet from file');
  }
}

/**
 * Saves a wallet to a file
 * 
 * @param {Keypair} keypair - Solana keypair
 * @param {string} filePath - Path to save the wallet file
 */
function saveWalletToFile(keypair, filePath) {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Save keypair to file
    fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
  } catch (error) {
    console.error('Error saving wallet:', error);
    throw new Error('Failed to save wallet to file');
  }
}

// Export functions
module.exports = {
  createWallet,
  loadWalletFromFile,
  saveWalletToFile
};
