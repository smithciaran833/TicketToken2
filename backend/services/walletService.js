// services/walletService.js - Core wallet management service

const { PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const User = require('../models/User');
const { validateWalletAddress } = require('../utils/validators');
const { sendSuccess, sendError } = require('../utils/responseHelper');

class WalletService {
  /**
   * Verify wallet signature for authentication
   * 
   * @param {string} walletAddress - The wallet address
   * @param {string} message - The signed message
   * @param {string|Array} signature - The signature (hex string or byte array)
   * @returns {Promise<Object>} Verification result
   */
  static async verifyWalletSignature(walletAddress, message, signature) {
    try {
      // Validate wallet address format
      if (!validateWalletAddress(walletAddress)) {
        throw new Error('Invalid wallet address format');
      }

      // Convert wallet address to PublicKey
      const publicKey = new PublicKey(walletAddress);

      // Prepare message for verification
      const messageBytes = new TextEncoder().encode(message);

      // Convert signature to Uint8Array if it's a hex string or array
      let signatureBytes;
      if (typeof signature === 'string') {
        // Remove 0x prefix if present
        const cleanSignature = signature.startsWith('0x') ? signature.slice(2) : signature;
        signatureBytes = new Uint8Array(Buffer.from(cleanSignature, 'hex'));
      } else if (Array.isArray(signature)) {
        signatureBytes = new Uint8Array(signature);
      } else {
        signatureBytes = signature;
      }

      // Verify signature
      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      );

      return {
        isValid,
        walletAddress,
        publicKey: publicKey.toString()
      };
    } catch (error) {
      console.error('Wallet signature verification error:', error);
      return {
        isValid: false,
        error: error.message
      };
    }
  }

  /**
   * Generate authentication message for wallet signing
   * 
   * @param {string} walletAddress - The wallet address
   * @param {string} nonce - Unique nonce for this request
   * @returns {string} Message to be signed
   */
  static generateAuthMessage(walletAddress, nonce) {
    const timestamp = new Date().toISOString();
    const domain = process.env.DOMAIN || 'TicketToken';
    
    return `Welcome to ${domain}!

Please sign this message to verify your wallet ownership.

Wallet: ${walletAddress}
Nonce: ${nonce}
Timestamp: ${timestamp}

This signature will not trigger any blockchain transaction or cost any fees.`;
  }

  /**
   * Link wallet to existing user account
   * 
   * @param {string} userId - User ID
   * @param {string} walletAddress - Wallet address to link
   * @param {string} signature - Signature proving ownership
   * @param {string} message - The message that was signed
   * @param {boolean} isPrimary - Whether this should be the primary wallet
   * @returns {Promise<Object>} Link result
   */
  static async linkWalletToUser(userId, walletAddress, signature, message, isPrimary = false) {
    try {
      // Verify the signature
      const verification = await this.verifyWalletSignature(walletAddress, message, signature);
      
      if (!verification.isValid) {
        throw new Error('Invalid wallet signature');
      }

      // Find the user
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if wallet is already linked to this user
      const existingWallet = user.walletAddresses.find(w => w.address === walletAddress);
      if (existingWallet) {
        throw new Error('Wallet already linked to this account');
      }

      // Check if wallet is linked to another user
      const otherUser = await User.findOne({
        'walletAddresses.address': walletAddress,
        _id: { $ne: userId }
      });
      
      if (otherUser) {
        throw new Error('Wallet is already linked to another account');
      }

      // If setting as primary, remove primary status from other wallets
      if (isPrimary) {
        user.walletAddresses.forEach(wallet => {
          wallet.isPrimary = false;
        });
      }

      // Add wallet to user
      user.walletAddresses.push({
        address: walletAddress,
        isPrimary: isPrimary || user.walletAddresses.length === 0,
        addedAt: new Date(),
        verified: true
      });

      await user.save();

      return {
        success: true,
        message: 'Wallet linked successfully',
        walletAddress,
        isPrimary: isPrimary || user.walletAddresses.length === 1
      };
    } catch (error) {
      console.error('Wallet linking error:', error);
      throw error;
    }
  }

  /**
   * Unlink wallet from user account
   * 
   * @param {string} userId - User ID
   * @param {string} walletAddress - Wallet address to unlink
   * @returns {Promise<Object>} Unlink result
   */
  static async unlinkWalletFromUser(userId, walletAddress) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Find wallet index
      const walletIndex = user.walletAddresses.findIndex(w => w.address === walletAddress);
      if (walletIndex === -1) {
        throw new Error('Wallet not found in user account');
      }

      // Check if this is the only wallet for a wallet-only user
      if (user.authMethod === 'wallet' && user.walletAddresses.length === 1) {
        throw new Error('Cannot remove the last wallet from a wallet-only account');
      }

      // Remove wallet
      const removedWallet = user.walletAddresses[walletIndex];
      user.walletAddresses.splice(walletIndex, 1);

      // If removed wallet was primary, set another as primary
      if (removedWallet.isPrimary && user.walletAddresses.length > 0) {
        user.walletAddresses[0].isPrimary = true;
      }

      await user.save();

      return {
        success: true,
        message: 'Wallet unlinked successfully',
        walletAddress
      };
    } catch (error) {
      console.error('Wallet unlinking error:', error);
      throw error;
    }
  }

  /**
   * Set primary wallet for user
   * 
   * @param {string} userId - User ID
   * @param {string} walletAddress - Wallet address to set as primary
   * @returns {Promise<Object>} Update result
   */
  static async setPrimaryWallet(userId, walletAddress) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Find the wallet
      const walletIndex = user.walletAddresses.findIndex(w => w.address === walletAddress);
      if (walletIndex === -1) {
        throw new Error('Wallet not found in user account');
      }

      // Remove primary status from all wallets
      user.walletAddresses.forEach(wallet => {
        wallet.isPrimary = false;
      });

      // Set the specified wallet as primary
      user.walletAddresses[walletIndex].isPrimary = true;

      await user.save();

      return {
        success: true,
        message: 'Primary wallet updated successfully',
        walletAddress
      };
    } catch (error) {
      console.error('Set primary wallet error:', error);
      throw error;
    }
  }

  /**
   * Get user's wallet information
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Wallet information
   */
  static async getUserWallets(userId) {
    try {
      const user = await User.findById(userId).select('walletAddresses');
      if (!user) {
        throw new Error('User not found');
      }

      const wallets = user.walletAddresses.map(wallet => ({
        address: wallet.address,
        isPrimary: wallet.isPrimary,
        addedAt: wallet.addedAt,
        verified: wallet.verified
      }));

      const primaryWallet = wallets.find(w => w.isPrimary)?.address || null;

      return {
        wallets,
        primaryWallet,
        totalWallets: wallets.length
      };
    } catch (error) {
      console.error('Get user wallets error:', error);
      throw error;
    }
  }

  /**
   * Find user by wallet address
   * 
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object|null>} User object or null
   */
  static async findUserByWallet(walletAddress) {
    try {
      const user = await User.findOne({
        'walletAddresses.address': walletAddress
      }).select('-passwordHash');

      return user;
    } catch (error) {
      console.error('Find user by wallet error:', error);
      throw error;
    }
  }

  /**
   * Check if wallet address is available (not linked to any user)
   * 
   * @param {string} walletAddress - Wallet address to check
   * @returns {Promise<boolean>} True if available
   */
  static async isWalletAvailable(walletAddress) {
    try {
      const existingUser = await User.findOne({
        'walletAddresses.address': walletAddress
      });

      return !existingUser;
    } catch (error) {
      console.error('Check wallet availability error:', error);
      return false;
    }
  }

  /**
   * Generate nonce for authentication
   * 
   * @returns {string} Random nonce
   */
  static generateNonce() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Validate authentication nonce (to prevent replay attacks)
   * 
   * @param {string} nonce - Nonce to validate
   * @param {string} userId - User ID (optional)
   * @returns {boolean} True if nonce is valid
   */
  static validateNonce(nonce, userId = null) {
    // In a production environment, you would:
    // 1. Store used nonces in Redis with expiration
    // 2. Check if nonce has been used before
    // 3. Mark nonce as used after successful authentication
    
    // For now, basic validation
    return nonce && nonce.length >= 20;
  }

  /**
   * Create user account with wallet authentication
   * 
   * @param {string} walletAddress - Wallet address
   * @param {string} signature - Signature proving ownership
   * @param {string} message - The message that was signed
   * @param {Object} userData - Additional user data
   * @returns {Promise<Object>} Created user
   */
  static async createUserWithWallet(walletAddress, signature, message, userData = {}) {
    try {
      // Verify the signature
      const verification = await this.verifyWalletSignature(walletAddress, message, signature);
      
      if (!verification.isValid) {
        throw new Error('Invalid wallet signature');
      }

      // Check if wallet is already in use
      const existingUser = await this.findUserByWallet(walletAddress);
      if (existingUser) {
        throw new Error('Wallet is already registered');
      }

      // Create user with wallet
      const { v4: uuidv4 } = require('uuid');
      const userId = uuidv4();

      const user = await User.create({
        userId,
        walletAddresses: [{
          address: walletAddress,
          isPrimary: true,
          addedAt: new Date(),
          verified: true
        }],
        authMethod: 'wallet',
        displayName: userData.displayName || `User-${userId.substring(0, 8)}`,
        ...userData,
        isActive: true
      });

      return user;
    } catch (error) {
      console.error('Create user with wallet error:', error);
      throw error;
    }
  }

  /**
   * Authenticate user with wallet
   * 
   * @param {string} walletAddress - Wallet address
   * @param {string} signature - Signature proving ownership
   * @param {string} message - The message that was signed
   * @param {string} nonce - Authentication nonce
   * @returns {Promise<Object>} Authentication result
   */
  static async authenticateWithWallet(walletAddress, signature, message, nonce) {
    try {
      // Validate nonce
      if (!this.validateNonce(nonce)) {
        throw new Error('Invalid nonce');
      }

      // Verify the signature
      const verification = await this.verifyWalletSignature(walletAddress, message, signature);
      
      if (!verification.isValid) {
        throw new Error('Invalid wallet signature');
      }

      // Find user by wallet
      let user = await this.findUserByWallet(walletAddress);
      
      if (!user) {
        // Create new user if not found
        user = await this.createUserWithWallet(walletAddress, signature, message);
      } else {
        // Update last login time
        user.lastLoginAt = new Date();
        await user.save();
      }

      return {
        success: true,
        user,
        isNewUser: !user.lastLoginAt || user.createdAt.getTime() === user.updatedAt.getTime(),
        walletAddress
      };
    } catch (error) {
      console.error('Wallet authentication error:', error);
      throw error;
    }
  }

  /**
   * Get wallet balance (if needed for display purposes)
   * 
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object>} Balance information
   */
  static async getWalletBalance(walletAddress) {
    try {
      // This would integrate with your blockchain connection
      // For now, return placeholder data
      return {
        sol: 0,
        tokens: [],
        nfts: []
      };
    } catch (error) {
      console.error('Get wallet balance error:', error);
      throw error;
    }
  }
}

module.exports = WalletService;
