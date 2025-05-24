// request-airdrop.js - Requests an airdrop of SOL to a wallet

// Import dependencies
const { createConnection } = require('../solana-config/connection');
const { loadWalletFromFile } = require('../solana-config/wallet');
const path = require('path');

// Directory with development wallets
const WALLET_DIR = path.join(__dirname, '..', 'dev-wallets');

// Network to use (devnet for development)
const NETWORK = 'devnet';

// Amount of SOL to request (2 SOL)
const AMOUNT = 2 * 1000000000; // in lamports (1 SOL = 1,000,000,000 lamports)

/**
 * Requests an airdrop of SOL to a wallet
 */
async function requestAirdrop() {
  try {
    // Load wallet
    const walletPath = path.join(WALLET_DIR, 'dev-wallet.json');
    const wallet = loadWalletFromFile(walletPath);
    
    console.log(`Requesting airdrop for wallet: ${wallet.publicKey.toString()}`);
    
    // Create connection
    const connection = createConnection(NETWORK);
    
    // Request airdrop
    console.log(`Requesting ${AMOUNT / 1000000000} SOL from ${NETWORK}...`);
    const signature = await connection.requestAirdrop(wallet.publicKey, AMOUNT);
    
    // Confirm transaction
    console.log('Confirming transaction...');
    await connection.confirmTransaction(signature);
    
    console.log(`Airdrop successful! Transaction signature: ${signature}`);
    
    // Get balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`Wallet balance: ${balance / 1000000000} SOL`);
  } catch (error) {
    console.error('Airdrop request failed:', error.message);
    process.exit(1);
  }
}

// Run airdrop request
requestAirdrop().catch(console.error);
