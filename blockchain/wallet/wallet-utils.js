/**
 * Utility functions for working with Solana wallet addresses
 */

// Import dependencies
const { PublicKey } = require('@solana/web3.js');

/**
 * Validates a Solana wallet address
 * 
 * @param {string} address - Address to validate
 * @returns {boolean} True if address is valid
 */
function isValidAddress(address) {
  try {
    new PublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Formats a wallet address for display
 * 
 * @param {string} address - Address to format
 * @param {number} prefixLength - Number of characters to show at start
 * @param {number} suffixLength - Number of characters to show at end
 * @returns {string} Formatted address
 */
function formatAddress(address, prefixLength = 4, suffixLength = 4) {
  if (!address || !isValidAddress(address)) {
    return '';
  }
  
  if (address.length <= prefixLength + suffixLength) {
    return address;
  }
  
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

/**
 * Gets an address's SOL balance
 * 
 * @param {string|PublicKey} address - Wallet address
 * @param {Connection} connection - Solana connection
 * @returns {Promise<number>} Balance in SOL
 */
async function getAddressBalance(address, connection) {
  try {
    const publicKey = typeof address === 'string' ? new PublicKey(address) : address;
    const balance = await connection.getBalance(publicKey);
    
    // Convert lamports to SOL (1 SOL = 1,000,000,000 lamports)
    return balance / 1000000000;
  } catch (error) {
    throw new Error(`Failed to get address balance: ${error.message}`);
  }
}

/**
 * Creates a message for wallet signing to verify ownership
 * 
 * @param {string} purpose - Purpose of the signature
 * @param {string} nonce - Unique nonce for this request
 * @returns {string} Message to sign
 */
function createSignMessage(purpose, nonce) {
  const timestamp = new Date().toISOString();
  
  return `Sign this message to verify your wallet ownership with TicketToken.
Purpose: ${purpose}
Timestamp: ${timestamp}
Nonce: ${nonce}
This signature will not create any blockchain transaction or cost any fees.`;
}

/**
 * Verifies a wallet signature
 * 
 * @param {string} message - Signed message
 * @param {Uint8Array} signature - Signature bytes
 * @param {string|PublicKey} publicKey - Wallet public key
 * @returns {boolean} True if signature is valid
 */
function verifySignature(message, signature, publicKey) {
  try {
    // This is a placeholder for actual signature verification
    // For production, use nacl or ed25519 libraries
    console.warn('Signature verification not fully implemented');
    return true;
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

// Export utility functions
module.exports = {
  isValidAddress,
  formatAddress,
  getAddressBalance,
  createSignMessage,
  verifySignature
};
