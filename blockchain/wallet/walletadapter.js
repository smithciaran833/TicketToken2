/**
 * TicketToken wallet connection utilities
 * 
 * This module provides functionality for connecting to Solana wallets
 * and managing wallet interactions.
 */

// Import dependencies
const { PublicKey } = require('@solana/web3.js');
const { createConnection } = require('../config/connection');

/**
 * Supported wallet types
 */
const WALLET_TYPES = {
  PHANTOM: 'phantom',
  SOLFLARE: 'solflare',
  SLOPE: 'slope',
  SOLLET: 'sollet',
  MATH: 'math',
  COIN98: 'coin98',
  CLOVER: 'clover',
  NIGHTLY: 'nightly',
  // Add more supported wallets as needed
};

/**
 * Wallet connection status
 */
const CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

/**
 * Wallet adapter class
 * 
 * This class provides a unified interface for interacting with different
 * Solana wallet providers.
 */
class WalletAdapter {
  constructor(options = {}) {
    this.network = options.network || 'devnet';
    this.autoConnect = options.autoConnect || false;
    this.walletType = null;
    this.wallet = null;
    this.publicKey = null;
    this.connection = null;
    this.status = CONNECTION_STATUS.DISCONNECTED;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.connectionConfig = options.connectionConfig || {};
    
    // Initialize connection
    this.connection = createConnection(this.network, this.connectionConfig);
    
    // Auto-connect if enabled
    if (this.autoConnect) {
      this.autoDetectAndConnect();
    }
  }
  
  /**
   * Auto-detects available wallets and connects to the first one
   * 
   * @returns {Promise<boolean>} True if connection successful
   */
  async autoDetectAndConnect() {
    // Check for Phantom
    if (this.isPhantomAvailable()) {
      return this.connect(WALLET_TYPES.PHANTOM);
    }
    
    // Check for Solflare
    if (this.isSolflareAvailable()) {
      return this.connect(WALLET_TYPES.SOLFLARE);
    }
    
    // No supported wallets found
    return false;
  }
  
  /**
   * Connects to a specific wallet type
   * 
   * @param {string} walletType - Type of wallet to connect to
   * @returns {Promise<boolean>} True if connection successful
   */
  async connect(walletType) {
    // Update status to connecting
    this.setStatus(CONNECTION_STATUS.CONNECTING);
    
    try {
      switch (walletType) {
        case WALLET_TYPES.PHANTOM:
          return await this.connectToPhantom();
        case WALLET_TYPES.SOLFLARE:
          return await this.connectToSolflare();
        // Add more wallet types as needed
        default:
          throw new Error(`Unsupported wallet type: ${walletType}`);
      }
    } catch (error) {
      this.setStatus(CONNECTION_STATUS.ERROR, error);
      return false;
    }
  }
  
  /**
   * Connects to Phantom wallet
   * 
   * @returns {Promise<boolean>} True if connection successful
   * @private
   */
  async connectToPhantom() {
    if (!this.isPhantomAvailable()) {
      throw new Error('Phantom wallet is not available');
    }
    
    try {
      // Request connection to Phantom
      const provider = window.solana;
      const response = await provider.connect();
      
      // Update wallet information
      this.wallet = provider;
      this.walletType = WALLET_TYPES.PHANTOM;
      this.publicKey = new PublicKey(response.publicKey.toString());
      
      // Set status to connected
      this.setStatus(CONNECTION_STATUS.CONNECTED);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to connect to Phantom: ${error.message}`);
    }
  }
  
  /**
   * Connects to Solflare wallet
   * 
   * @returns {Promise<boolean>} True if connection successful
   * @private
   */
  async connectToSolflare() {
    if (!this.isSolflareAvailable()) {
      throw new Error('Solflare wallet is not available');
    }
    
    try {
      // Request connection to Solflare
      const provider = window.solflare;
      const response = await provider.connect();
      
      // Update wallet information
      this.wallet = provider;
      this.walletType = WALLET_TYPES.SOLFLARE;
      this.publicKey = new PublicKey(response.publicKey.toString());
      
      // Set status to connected
      this.setStatus(CONNECTION_STATUS.CONNECTED);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to connect to Solflare: ${error.message}`);
    }
  }
  
  /**
   * Disconnects from the current wallet
   * 
   * @returns {Promise<boolean>} True if disconnection successful
   */
  async disconnect() {
    if (!this.wallet || this.status !== CONNECTION_STATUS.CONNECTED) {
      return true;
    }
    
    try {
      // Disconnect based on wallet type
      if (this.walletType === WALLET_TYPES.PHANTOM || this.walletType === WALLET_TYPES.SOLFLARE) {
        await this.wallet.disconnect();
      }
      
      // Reset wallet information
      this.wallet = null;
      this.walletType = null;
      this.publicKey = null;
      
      // Set status to disconnected
      this.setStatus(CONNECTION_STATUS.DISCONNECTED);
      
      return true;
    } catch (error) {
      this.setStatus(CONNECTION_STATUS.ERROR, error);
      return false;
    }
  }
  
  /**
   * Signs a message using the connected wallet
   * 
   * @param {Uint8Array|string} message - Message to sign
   * @returns {Promise<Uint8Array>} Signature
   */
  async signMessage(message) {
    if (!this.isConnected()) {
      throw new Error('Wallet not connected');
    }
    
    // Convert string to buffer if needed
    const messageBuffer = typeof message === 'string' 
      ? new TextEncoder().encode(message)
      : message;
    
    try {
      // Sign message based on wallet type
      let signature;
      
      if (this.walletType === WALLET_TYPES.PHANTOM) {
        const { signature: phantomSignature } = await this.wallet.signMessage(messageBuffer, 'utf8');
        signature = phantomSignature;
      } else if (this.walletType === WALLET_TYPES.SOLFLARE) {
        signature = await this.wallet.signMessage(messageBuffer, 'utf8');
      } else {
        throw new Error(`Signing not implemented for wallet type: ${this.walletType}`);
      }
      
      return signature;
    } catch (error) {
      throw new Error(`Failed to sign message: ${error.message}`);
    }
  }
  
  /**
   * Signs a transaction using the connected wallet
   * 
   * @param {Transaction} transaction - Transaction to sign
   * @returns {Promise<Transaction>} Signed transaction
   */
  async signTransaction(transaction) {
    if (!this.isConnected()) {
      throw new Error('Wallet not connected');
    }
    
    try {
      // Sign transaction based on wallet type
      let signedTransaction;
      
      if (this.walletType === WALLET_TYPES.PHANTOM || this.walletType === WALLET_TYPES.SOLFLARE) {
        signedTransaction = await this.wallet.signTransaction(transaction);
      } else {
        throw new Error(`Transaction signing not implemented for wallet type: ${this.walletType}`);
      }
      
      return signedTransaction;
    } catch (error) {
      throw new Error(`Failed to sign transaction: ${error.message}`);
    }
  }
  
  /**
   * Signs and sends a transaction
   * 
   * @param {Transaction} transaction - Transaction to sign and send
   * @returns {Promise<string>} Transaction signature
   */
  async signAndSendTransaction(transaction) {
    if (!this.isConnected()) {
      throw new Error('Wallet not connected');
    }
    
    try {
      // Sign and send transaction based on wallet type
      let signature;
      
      if (this.walletType === WALLET_TYPES.PHANTOM || this.walletType === WALLET_TYPES.SOLFLARE) {
        const { signature: txSignature } = await this.wallet.signAndSendTransaction(transaction);
        signature = txSignature;
      } else {
        throw new Error(`Transaction sending not implemented for wallet type: ${this.walletType}`);
      }
      
      return signature;
    } catch (error) {
      throw new Error(`Failed to sign and send transaction: ${error.message}`);
    }
  }
  
  /**
   * Checks if wallet is connected
   * 
   * @returns {boolean} True if wallet is connected
   */
  isConnected() {
    return this.status === CONNECTION_STATUS.CONNECTED && this.publicKey !== null;
  }
  
  /**
   * Checks if Phantom wallet is available
   * 
   * @returns {boolean} True if Phantom is available
   */
  isPhantomAvailable() {
    return window?.solana?.isPhantom || false;
  }
  
  /**
   * Checks if Solflare wallet is available
   * 
   * @returns {boolean} True if Solflare is available
   */
  isSolflareAvailable() {
    return window?.solflare?.isSolflare || false;
  }
  
  /**
   * Sets the connection status and triggers status change callback
   * 
   * @param {string} status - New status
   * @param {Error} error - Optional error
   * @private
   */
  setStatus(status, error = null) {
    this.status = status;
    this.onStatusChange(status, error);
  }
  
  /**
   * Gets the wallet's public key as string
   * 
   * @returns {string|null} Public key as string or null if not connected
   */
  getPublicKeyString() {
    return this.publicKey ? this.publicKey.toString() : null;
  }
  
  /**
   * Gets wallet information
   * 
   * @returns {Object} Wallet information
   */
  getWalletInfo() {
    return {
      connected: this.isConnected(),
      walletType: this.walletType,
      publicKey: this.getPublicKeyString(),
      network: this.network,
      status: this.status
    };
  }
}

// Export constants and classes
module.exports = {
  WALLET_TYPES,
  CONNECTION_STATUS,
  WalletAdapter
};
