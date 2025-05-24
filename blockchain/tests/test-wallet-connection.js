/**
 * Test script for wallet connection functionality
 */

// Import dependencies
const { WalletAdapter, WALLET_TYPES, CONNECTION_STATUS } = require('../wallet/wallet-adapter');
const { isValidAddress, formatAddress } = require('../wallet/wallet-utils');
const { createConnection } = require('../config/connection');

/**
 * Wallet connection test for browser environments
 */
class WalletConnectionTest {
  constructor() {
    // Create wallet adapter
    this.walletAdapter = new WalletAdapter({
      network: 'devnet',
      onStatusChange: this.handleStatusChange.bind(this)
    });
    
    // Create Solana connection
    this.connection = createConnection('devnet');
    
    // Store wallet information
    this.walletInfo = null;
  }
  
  /**
   * Initializes the test
   */
  initialize() {
    console.log('Initializing wallet connection test...');
    
    // Check available wallets
    this.checkAvailableWallets();
    
    // Set up UI events
    this.setupUIEvents();
  }
  
  /**
   * Checks which wallets are available in the browser
   */
  checkAvailableWallets() {
    const availableWallets = [];
    
    if (this.walletAdapter.isPhantomAvailable()) {
      availableWallets.push(WALLET_TYPES.PHANTOM);
    }
    
    if (this.walletAdapter.isSolflareAvailable()) {
      availableWallets.push(WALLET_TYPES.SOLFLARE);
    }
    
    // Update UI with available wallets
    this.updateAvailableWalletsUI(availableWallets);
    
    return availableWallets;
  }
  
  /**
   * Updates UI with available wallets
   * 
   * @param {Array} wallets - Available wallet types
   */
  updateAvailableWalletsUI(wallets) {
    console.log('Available wallets:', wallets);
    
    // In a real implementation, this would update the UI
    // For this test, we just log to console
    
    const walletList = document.getElementById('wallet-list');
    if (walletList) {
      walletList.innerHTML = '';
      
      if (wallets.length === 0) {
        const message = document.createElement('p');
        message.textContent = 'No Solana wallets detected. Please install Phantom or Solflare.';
        walletList.appendChild(message);
      } else {
        wallets.forEach(wallet => {
          const button = document.createElement('button');
          button.textContent = `Connect to ${wallet}`;
          button.onclick = () => this.connectWallet(wallet);
          walletList.appendChild(button);
        });
      }
    }
  }
  
  /**
   * Sets up UI event handlers
   */
  setupUIEvents() {
    // Connect button
    const connectButton = document.getElementById('connect-wallet');
    if (connectButton) {
      connectButton.addEventListener('click', () => {
        const availableWallets = this.checkAvailableWallets();
        if (availableWallets.length > 0) {
          this.connectWallet(availableWallets[0]);
        } else {
          console.log('No wallets available to connect');
        }
      });
    }
    
    // Disconnect button
    const disconnectButton = document.getElementById('disconnect-wallet');
    if (disconnectButton) {
      disconnectButton.addEventListener('click', () => {
        this.disconnectWallet();
      });
    }
    
    // Sign message button
    const signButton = document.getElementById('sign-message');
    if (signButton) {
      signButton.addEventListener('click', () => {
        this.signMessage('Welcome to TicketToken!');
      });
    }
  }
  
  /**
   * Connects to a wallet
   * 
   * @param {string} walletType - Type of wallet to connect to
   */
  async connectWallet(walletType) {
    console.log(`Connecting to ${walletType}...`);
    
    try {
      const success = await this.walletAdapter.connect(walletType);
      
      if (success) {
        console.log('Connected successfully!');
        this.walletInfo = this.walletAdapter.getWalletInfo();
        this.updateWalletInfoUI();
      } else {
        console.error('Failed to connect');
      }
    } catch (error) {
      console.error('Connection error:', error);
    }
  }
  
  /**
   * Disconnects from the wallet
   */
  async disconnectWallet() {
    console.log('Disconnecting wallet...');
    
    try {
      const success = await this.walletAdapter.disconnect();
      
      if (success) {
        console.log('Disconnected successfully!');
        this.walletInfo = null;
        this.updateWalletInfoUI();
      } else {
        console.error('Failed to disconnect');
      }
    } catch (error) {
      console.error('Disconnection error:', error);
    }
  }
  
  /**
   * Signs a message with the connected wallet
   * 
   * @param {string} message - Message to sign
   */
  async signMessage(message) {
    if (!this.walletAdapter.isConnected()) {
      console.error('Please connect a wallet first');
      return;
    }
    
    console.log(`Signing message: "${message}"`);
    
    try {
      const signature = await this.walletAdapter.signMessage(message);
      
      console.log('Message signed successfully!');
      console.log('Signature:', signature);
      
      // Update UI with signature
      this.updateSignatureUI(signature);
    } catch (error) {
      console.error('Signing error:', error);
    }
  }
  
  /**
   * Handles wallet status changes
   * 
   * @param {string} status - New status
   * @param {Error} error - Optional error
   */
  handleStatusChange(status, error) {
    console.log(`Wallet status changed: ${status}`);
    
    if (error) {
      console.error('Error:', error);
    }
    
    // Update UI with new status
    this.updateStatusUI(status);
  }
  
  /**
   * Updates wallet info in the UI
   */
  updateWalletInfoUI() {
    console.log('Wallet info:', this.walletInfo);
    
    // In a real implementation, this would update the UI
    // For this test, we just log to console
    
    const walletInfo = document.getElementById('wallet-info');
    if (walletInfo) {
      if (this.walletInfo && this.walletInfo.connected) {
        walletInfo.innerHTML = `
          <p><strong>Connected to:</strong> ${this.walletInfo.walletType}</p>
          <p><strong>Address:</strong> ${formatAddress(this.walletInfo.publicKey)}</p>
          <p><strong>Network:</strong> ${this.walletInfo.network}</p>
        `;
      } else {
        walletInfo.innerHTML = '<p>No wallet connected</p>';
      }
    }
  }
  
  /**
   * Updates status in the UI
   * 
   * @param {string} status - New status
   */
  updateStatusUI(status) {
    const statusElement = document.getElementById('wallet-status');
    if (statusElement) {
      statusElement.textContent = `Status: ${status}`;
      
      // Update status class
      statusElement.className = `status-${status}`;
    }
  }
  
  /**
   * Updates signature in the UI
   * 
   * @param {Uint8Array} signature - Message signature
   */
  updateSignatureUI(signature) {
    const signatureElement = document.getElementById('signature-result');
    if (signatureElement) {
      // Convert signature to hex string
      const signatureHex = Array.from(signature)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      signatureElement.textContent = `Signature: ${signatureHex}`;
    }
  }
}

// Execute test in browser environment
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const test = new WalletConnectionTest();
    test.initialize();
    
    // Expose test instance to window for debugging
    window.walletTest = test;
  });
}

// Export test class
if (typeof module !== 'undefined') {
  module.exports = { WalletConnectionTest };
}
