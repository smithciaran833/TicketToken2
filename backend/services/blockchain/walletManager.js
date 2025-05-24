const { 
  PublicKey, 
  Transaction, 
  LAMPORTS_PER_SOL,
  SystemProgram
} = require('@solana/web3.js');
const { 
  getAssociatedTokenAddress,
  getAccount
} = require('@solana/spl-token');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const solanaConnection = require('./solanaConnection');
const nftService = require('./nftService');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');

class WalletManager {
  constructor() {
    this.connectedWallets = new Map();
    this.walletSessions = new Map();
    this.supportedWallets = [
      'phantom',
      'solflare',
      'coinbase',
      'backpack',
      'slope',
      'sollet',
      'mathwallet',
      'coin98'
    ];
    
    // Session timeout (24 hours)
    this.sessionTimeout = 24 * 60 * 60 * 1000;
    
    // Nonce tracking for replay attack prevention
    this.usedNonces = new Set();
    this.nonceCleanupInterval = 5 * 60 * 1000; // 5 minutes
    
    this.initializeService();
  }

  /**
   * Initialize wallet manager service
   */
  initializeService() {
    try {
      // Start nonce cleanup interval
      setInterval(() => {
        this.cleanupExpiredNonces();
      }, this.nonceCleanupInterval);

      logger.info('Wallet Manager initialized', {
        supportedWallets: this.supportedWallets,
        sessionTimeout: this.sessionTimeout
      });
    } catch (error) {
      logger.error('Failed to initialize Wallet Manager', {
        error: error.message,
        stack: error.stack
      });
      throw new AppError('Failed to initialize Wallet Manager', 500);
    }
  }

  /**
   * Connect user wallet
   * @param {string} walletType - Type of wallet (phantom, solflare, etc.)
   * @param {string} publicKey - Wallet public key
   * @param {string} signature - Connection signature
   * @param {string} message - Signed message
   * @param {Object} metadata - Additional wallet metadata
   * @returns {Object} Connection result with session information
   */
  async connectWallet(walletType, publicKey, signature = null, message = null, metadata = {}) {
    try {
      logger.info('Connecting wallet', {
        walletType,
        publicKey,
        hasSignature: !!signature
      });

      // Validate wallet type
      if (!this.supportedWallets.includes(walletType.toLowerCase())) {
        throw new AppError(`Unsupported wallet type: ${walletType}`, 400);
      }

      // Validate public key
      this.validatePublicKey(publicKey);
      const walletPublicKey = new PublicKey(publicKey);

      // If signature provided, verify it
      if (signature && message) {
        const isValidSignature = await this.verifyWalletSignature(signature, message, publicKey);
        if (!isValidSignature) {
          throw new AppError('Invalid wallet signature', 401);
        }
      }

      // Check if wallet is already connected
      const existingSession = this.walletSessions.get(publicKey);
      if (existingSession && this.isSessionValid(existingSession)) {
        logger.info('Wallet already connected with valid session', {
          publicKey,
          sessionId: existingSession.sessionId
        });
        
        return {
          success: true,
          sessionId: existingSession.sessionId,
          walletAddress: publicKey,
          walletType,
          isExistingSession: true,
          expiresAt: existingSession.expiresAt
        };
      }

      // Get wallet balance and basic info
      const balance = await this.getWalletBalance(publicKey);
      
      // Create new session
      const sessionId = this.generateSessionId();
      const expiresAt = new Date(Date.now() + this.sessionTimeout);
      
      const walletSession = {
        sessionId,
        walletAddress: publicKey,
        walletType: walletType.toLowerCase(),
        balance,
        connectedAt: new Date(),
        expiresAt,
        lastActivity: new Date(),
        metadata: {
          ...metadata,
          userAgent: metadata.userAgent || 'unknown',
          ipAddress: metadata.ipAddress || 'unknown'
        },
        isActive: true
      };

      // Store session
      this.walletSessions.set(publicKey, walletSession);
      this.connectedWallets.set(sessionId, walletSession);

      logger.info('Wallet connected successfully', {
        publicKey,
        walletType,
        sessionId,
        balance: balance.sol
      });

      return {
        success: true,
        sessionId,
        walletAddress: publicKey,
        walletType,
        balance,
        expiresAt,
        isNewConnection: true
      };

    } catch (error) {
      logger.error('Failed to connect wallet', {
        error: error.message,
        walletType,
        publicKey,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Verify wallet signature
   * @param {string} signature - Base58 encoded signature
   * @param {string} message - Original message that was signed
   * @param {string} publicKey - Wallet public key
   * @returns {boolean} True if signature is valid
   */
  async verifyWalletSignature(signature, message, publicKey) {
    try {
      logger.debug('Verifying wallet signature', {
        publicKey,
        messageLength: message.length,
        hasSignature: !!signature
      });

      // Validate inputs
      this.validatePublicKey(publicKey);
      if (!signature || !message) {
        throw new AppError('Signature and message are required', 400);
      }

      // Parse message and extract nonce/timestamp
      const messageData = this.parseSignedMessage(message);
      
      // Check message timestamp (prevent replay attacks)
      if (messageData.timestamp) {
        const messageAge = Date.now() - messageData.timestamp;
        if (messageAge > 5 * 60 * 1000) { // 5 minutes
          throw new AppError('Message timestamp too old', 400);
        }
      }

      // Check nonce (prevent replay attacks)
      if (messageData.nonce) {
        if (this.usedNonces.has(messageData.nonce)) {
          throw new AppError('Nonce already used', 400);
        }
        this.usedNonces.add(messageData.nonce);
      }

      // Convert inputs for verification
      const walletPublicKey = new PublicKey(publicKey);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);

      // Verify signature using nacl
      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        walletPublicKey.toBytes()
      );

      logger.debug('Signature verification result', {
        publicKey,
        isValid,
        nonce: messageData.nonce
      });

      return isValid;

    } catch (error) {
      logger.error('Signature verification failed', {
        error: error.message,
        publicKey,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Get wallet balance information
   * @param {string} walletAddress - Wallet address
   * @param {string} cluster - Solana cluster (optional)
   * @returns {Object} Balance information
   */
  async getWalletBalance(walletAddress, cluster = null) {
    try {
      logger.debug('Getting wallet balance', { walletAddress });

      this.validatePublicKey(walletAddress);
      const targetCluster = cluster || solanaConnection.defaultCluster;

      // Get SOL balance
      const lamports = await solanaConnection.getBalance(walletAddress, targetCluster);
      const sol = lamports / LAMPORTS_PER_SOL;

      // Get basic token account info (for future token support)
      const walletPublicKey = new PublicKey(walletAddress);
      
      const balanceInfo = {
        walletAddress,
        cluster: targetCluster,
        sol,
        lamports,
        tokens: [], // Will be populated with SPL tokens if needed
        lastUpdated: new Date().toISOString()
      };

      logger.debug('Wallet balance retrieved', {
        walletAddress,
        sol,
        lamports
      });

      return balanceInfo;

    } catch (error) {
      logger.error('Failed to get wallet balance', {
        error: error.message,
        walletAddress,
        stack: error.stack
      });
      throw new AppError(`Failed to get wallet balance: ${error.message}`, 500);
    }
  }

  /**
   * Get user's NFT tickets
   * @param {string} walletAddress - Wallet address
   * @param {Object} filters - Optional filters for NFTs
   * @returns {Array} Array of NFT tickets owned by the wallet
   */
  async getUserNFTs(walletAddress, filters = {}) {
    try {
      logger.info('Getting user NFTs', {
        walletAddress,
        filters
      });

      this.validatePublicKey(walletAddress);

      // Get all tickets from NFT service
      const tickets = await nftService.getWalletTickets(walletAddress);

      // Apply filters if provided
      let filteredTickets = tickets;

      if (filters.eventId) {
        filteredTickets = filteredTickets.filter(ticket => 
          ticket.eventId === filters.eventId
        );
      }

      if (filters.ticketType) {
        filteredTickets = filteredTickets.filter(ticket => 
          ticket.ticketType === filters.ticketType
        );
      }

      if (filters.isUsed !== undefined) {
        filteredTickets = filteredTickets.filter(ticket => 
          ticket.isUsed === filters.isUsed
        );
      }

      if (filters.isListed !== undefined) {
        filteredTickets = filteredTickets.filter(ticket => 
          ticket.isListed === filters.isListed
        );
      }

      // Enhance tickets with additional metadata
      const enhancedTickets = await Promise.all(
        filteredTickets.map(async (ticket) => {
          try {
            // Get detailed metadata for each ticket
            const metadata = await nftService.getTicketMetadata(ticket.ticketId);
            
            return {
              ...ticket,
              detailedMetadata: metadata,
              contentAccess: metadata.contentAccess,
              transferRestrictions: metadata.transferRestrictions,
              royaltyRecipients: metadata.royaltyRecipients
            };
          } catch (error) {
            logger.warn('Failed to get detailed metadata for ticket', {
              ticketId: ticket.ticketId,
              error: error.message
            });
            return ticket;
          }
        })
      );

      const result = {
        walletAddress,
        totalTickets: enhancedTickets.length,
        tickets: enhancedTickets,
        filters,
        summary: {
          totalActive: enhancedTickets.filter(t => !t.isUsed).length,
          totalUsed: enhancedTickets.filter(t => t.isUsed).length,
          totalListed: enhancedTickets.filter(t => t.isListed).length,
          ticketTypes: [...new Set(enhancedTickets.map(t => t.ticketType))],
          events: [...new Set(enhancedTickets.map(t => t.eventId))]
        },
        lastUpdated: new Date().toISOString()
      };

      logger.debug('User NFTs retrieved', {
        walletAddress,
        totalTickets: result.totalTickets,
        activeTickets: result.summary.totalActive
      });

      return result;

    } catch (error) {
      logger.error('Failed to get user NFTs', {
        error: error.message,
        walletAddress,
        filters,
        stack: error.stack
      });
      throw new AppError(`Failed to get user NFTs: ${error.message}`, 500);
    }
  }

  /**
   * Process wallet transaction
   * @param {Object} transactionData - Transaction data and parameters
   * @param {string} walletAddress - Wallet address initiating transaction
   * @param {string} sessionId - Wallet session ID
   * @returns {Object} Transaction processing result
   */
  async processWalletTransaction(transactionData, walletAddress, sessionId) {
    try {
      logger.info('Processing wallet transaction', {
        transactionType: transactionData.type,
        walletAddress,
        sessionId
      });

      // Validate session
      if (!this.validateSession(sessionId, walletAddress)) {
        throw new AppError('Invalid or expired wallet session', 401);
      }

      // Update session activity
      this.updateSessionActivity(sessionId);

      let result;

      // Process different transaction types
      switch (transactionData.type) {
        case 'mint_ticket':
          result = await this.processMintTransaction(transactionData, walletAddress);
          break;
          
        case 'transfer_ticket':
          result = await this.processTransferTransaction(transactionData, walletAddress);
          break;
          
        case 'use_ticket':
          result = await this.processUseTicketTransaction(transactionData, walletAddress);
          break;
          
        case 'list_ticket':
          result = await this.processListingTransaction(transactionData, walletAddress);
          break;
          
        case 'purchase_ticket':
          result = await this.processPurchaseTransaction(transactionData, walletAddress);
          break;
          
        case 'custom':
          result = await this.processCustomTransaction(transactionData, walletAddress);
          break;
          
        default:
          throw new AppError(`Unsupported transaction type: ${transactionData.type}`, 400);
      }

      // Log transaction result
      logger.info('Wallet transaction processed', {
        transactionType: transactionData.type,
        walletAddress,
        success: result.success,
        signature: result.signature
      });

      return result;

    } catch (error) {
      logger.error('Failed to process wallet transaction', {
        error: error.message,
        transactionType: transactionData?.type,
        walletAddress,
        sessionId,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Process mint ticket transaction
   * @param {Object} transactionData - Mint transaction data
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Mint result
   */
  async processMintTransaction(transactionData, walletAddress) {
    try {
      const { eventData } = transactionData;
      
      if (!eventData) {
        throw new AppError('Event data is required for minting', 400);
      }

      const result = await nftService.mintTicket(eventData, walletAddress);
      
      return {
        type: 'mint_ticket',
        success: true,
        ticketId: result.ticketId,
        signature: result.signature,
        eventId: result.eventId,
        timestamp: result.timestamp
      };
    } catch (error) {
      throw new AppError(`Mint transaction failed: ${error.message}`, 500);
    }
  }

  /**
   * Process transfer ticket transaction
   * @param {Object} transactionData - Transfer transaction data
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Transfer result
   */
  async processTransferTransaction(transactionData, walletAddress) {
    try {
      const { ticketId, toWallet, transferType } = transactionData;
      
      if (!ticketId || !toWallet) {
        throw new AppError('Ticket ID and recipient wallet are required', 400);
      }

      const result = await nftService.transferTicket(
        walletAddress,
        toWallet,
        ticketId,
        transferType || 'Direct'
      );
      
      return {
        type: 'transfer_ticket',
        success: true,
        ticketId: result.ticketId,
        signature: result.signature,
        fromWallet: result.fromWallet,
        toWallet: result.toWallet,
        transferType: result.transferType,
        timestamp: result.timestamp
      };
    } catch (error) {
      throw new AppError(`Transfer transaction failed: ${error.message}`, 500);
    }
  }

  /**
   * Process use ticket transaction
   * @param {Object} transactionData - Use ticket transaction data
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Use ticket result
   */
  async processUseTicketTransaction(transactionData, walletAddress) {
    try {
      const { ticketId, verificationCode } = transactionData;
      
      if (!ticketId || !verificationCode) {
        throw new AppError('Ticket ID and verification code are required', 400);
      }

      const result = await nftService.useTicket(ticketId, walletAddress, verificationCode);
      
      return {
        type: 'use_ticket',
        success: true,
        ticketId: result.ticketId,
        signature: result.signature,
        eventId: result.eventId,
        usageTimestamp: result.usageTimestamp
      };
    } catch (error) {
      throw new AppError(`Use ticket transaction failed: ${error.message}`, 500);
    }
  }

  /**
   * Process listing transaction (placeholder for marketplace integration)
   * @param {Object} transactionData - Listing transaction data
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Listing result
   */
  async processListingTransaction(transactionData, walletAddress) {
    try {
      const { ticketId, price, listingType, duration } = transactionData;
      
      if (!ticketId || !price) {
        throw new AppError('Ticket ID and price are required for listing', 400);
      }

      // This would integrate with marketplace service
      // For now, return placeholder response
      return {
        type: 'list_ticket',
        success: true,
        ticketId,
        price,
        listingType: listingType || 'FixedPrice',
        duration,
        message: 'Listing functionality requires marketplace integration',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new AppError(`Listing transaction failed: ${error.message}`, 500);
    }
  }

  /**
   * Process purchase transaction (placeholder for marketplace integration)
   * @param {Object} transactionData - Purchase transaction data
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Purchase result
   */
  async processPurchaseTransaction(transactionData, walletAddress) {
    try {
      const { listingId, ticketId, price } = transactionData;
      
      if (!listingId || !ticketId) {
        throw new AppError('Listing ID and ticket ID are required for purchase', 400);
      }

      // This would integrate with marketplace service
      // For now, return placeholder response
      return {
        type: 'purchase_ticket',
        success: true,
        listingId,
        ticketId,
        price,
        buyer: walletAddress,
        message: 'Purchase functionality requires marketplace integration',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new AppError(`Purchase transaction failed: ${error.message}`, 500);
    }
  }

  /**
   * Process custom transaction
   * @param {Object} transactionData - Custom transaction data
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Custom transaction result
   */
  async processCustomTransaction(transactionData, walletAddress) {
    try {
      const { transaction, signers } = transactionData;
      
      if (!transaction) {
        throw new AppError('Transaction data is required', 400);
      }

      // Convert transaction data if needed
      let tx;
      if (typeof transaction === 'string') {
        // If transaction is serialized, deserialize it
        tx = Transaction.from(Buffer.from(transaction, 'base64'));
      } else {
        tx = transaction;
      }

      const signature = await solanaConnection.sendAndConfirmTransaction(
        tx,
        signers || [],
        solanaConnection.defaultCluster
      );
      
      return {
        type: 'custom',
        success: true,
        signature,
        walletAddress,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new AppError(`Custom transaction failed: ${error.message}`, 500);
    }
  }

  /**
   * Disconnect wallet session
   * @param {string} sessionId - Session ID to disconnect
   * @param {string} walletAddress - Wallet address (optional verification)
   * @returns {Object} Disconnect result
   */
  async disconnectWallet(sessionId, walletAddress = null) {
    try {
      logger.info('Disconnecting wallet', {
        sessionId,
        walletAddress
      });

      const session = this.connectedWallets.get(sessionId);
      if (!session) {
        throw new AppError('Session not found', 404);
      }

      // Verify wallet address if provided
      if (walletAddress && session.walletAddress !== walletAddress) {
        throw new AppError('Wallet address mismatch', 403);
      }

      // Remove session
      this.connectedWallets.delete(sessionId);
      this.walletSessions.delete(session.walletAddress);

      logger.info('Wallet disconnected successfully', {
        sessionId,
        walletAddress: session.walletAddress
      });

      return {
        success: true,
        sessionId,
        walletAddress: session.walletAddress,
        disconnectedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to disconnect wallet', {
        error: error.message,
        sessionId,
        walletAddress
      });
      throw error;
    }
  }

  /**
   * Get wallet session information
   * @param {string} sessionId - Session ID
   * @returns {Object} Session information
   */
  getWalletSession(sessionId) {
    try {
      const session = this.connectedWallets.get(sessionId);
      if (!session) {
        throw new AppError('Session not found', 404);
      }

      if (!this.isSessionValid(session)) {
        this.cleanupExpiredSession(sessionId);
        throw new AppError('Session expired', 401);
      }

      return {
        sessionId: session.sessionId,
        walletAddress: session.walletAddress,
        walletType: session.walletType,
        connectedAt: session.connectedAt,
        expiresAt: session.expiresAt,
        lastActivity: session.lastActivity,
        isActive: session.isActive,
        balance: session.balance
      };

    } catch (error) {
      logger.error('Failed to get wallet session', {
        error: error.message,
        sessionId
      });
      throw error;
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Validate public key format
   * @param {string} publicKey - Public key to validate
   */
  validatePublicKey(publicKey) {
    try {
      new PublicKey(publicKey);
    } catch (error) {
      throw new AppError('Invalid public key format', 400);
    }
  }

  /**
   * Generate unique session ID
   * @returns {string} Session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Check if session is valid
   * @param {Object} session - Session object
   * @returns {boolean} True if session is valid
   */
  isSessionValid(session) {
    return session && 
           session.isActive && 
           new Date() < new Date(session.expiresAt);
  }

  /**
   * Validate session for operations
   * @param {string} sessionId - Session ID
   * @param {string} walletAddress - Wallet address
   * @returns {boolean} True if session is valid
   */
  validateSession(sessionId, walletAddress) {
    const session = this.connectedWallets.get(sessionId);
    
    if (!session) {
      return false;
    }

    if (session.walletAddress !== walletAddress) {
      return false;
    }

    return this.isSessionValid(session);
  }

  /**
   * Update session activity timestamp
   * @param {string} sessionId - Session ID
   */
  updateSessionActivity(sessionId) {
    const session = this.connectedWallets.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      this.walletSessions.set(session.walletAddress, session);
    }
  }

  /**
   * Parse signed message for metadata
   * @param {string} message - Signed message
   * @returns {Object} Parsed message data
   */
  parseSignedMessage(message) {
    try {
      const data = {
        message,
        timestamp: null,
        nonce: null
      };

      // Extract timestamp
      const timestampMatch = message.match(/timestamp[:\s]+(\d+)/i);
      if (timestampMatch) {
        data.timestamp = parseInt(timestampMatch[1]);
      }

      // Extract nonce
      const nonceMatch = message.match(/nonce[:\s]+([a-zA-Z0-9]+)/i);
      if (nonceMatch) {
        data.nonce = nonceMatch[1];
      }

      return data;
    } catch (error) {
      logger.warn('Failed to parse signed message', {
        error: error.message,
        message: message.substring(0, 100)
      });
      return { message, timestamp: null, nonce: null };
    }
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = new Date();
    const expiredSessions = [];

    for (const [sessionId, session] of this.connectedWallets) {
      if (new Date(session.expiresAt) < now) {
        expiredSessions.push(sessionId);
      }
    }

    expiredSessions.forEach(sessionId => {
      this.cleanupExpiredSession(sessionId);
    });

    if (expiredSessions.length > 0) {
      logger.info('Cleaned up expired wallet sessions', {
        count: expiredSessions.length
      });
    }
  }

  /**
   * Clean up specific expired session
   * @param {string} sessionId - Session ID to cleanup
   */
  cleanupExpiredSession(sessionId) {
    const session = this.connectedWallets.get(sessionId);
    if (session) {
      this.connectedWallets.delete(sessionId);
      this.walletSessions.delete(session.walletAddress);
    }
  }

  /**
   * Clean up expired nonces
   */
  cleanupExpiredNonces() {
    // Clear all nonces periodically (simple approach)
    // In production, you might want to track nonce timestamps
    this.usedNonces.clear();
  }

  /**
   * Get service status and statistics
   * @returns {Object} Service status
   */
  getServiceStatus() {
    const now = new Date();
    const activeSessions = Array.from(this.connectedWallets.values())
      .filter(session => this.isSessionValid(session));

    const walletTypeStats = {};
    activeSessions.forEach(session => {
      walletTypeStats[session.walletType] = (walletTypeStats[session.walletType] || 0) + 1;
    });

    return {
      service: 'WalletManager',
      status: 'operational',
      statistics: {
        totalConnectedWallets: this.connectedWallets.size,
        activeSessions: activeSessions.length,
        expiredSessions: this.connectedWallets.size - activeSessions.length,
        walletTypeDistribution: walletTypeStats,
        supportedWallets: this.supportedWallets,
        usedNoncesCount: this.usedNonces.size
      },
      configuration: {
        sessionTimeout: this.sessionTimeout,
        nonceCleanupInterval: this.nonceCleanupInterval,
        supportedWalletCount: this.supportedWallets.length
      },
      timestamp: now.toISOString()
    };
  }

  /**
   * Force disconnect all sessions for a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Object} Cleanup result
   */
  async forceDisconnectWallet(walletAddress) {
    try {
      const sessionsToRemove = [];
      
      for (const [sessionId, session] of this.connectedWallets) {
        if (session.walletAddress === walletAddress) {
          sessionsToRemove.push(sessionId);
        }
      }

      sessionsToRemove.forEach(sessionId => {
        this.cleanupExpiredSession(sessionId);
      });

      logger.info('Force disconnected wallet sessions', {
        walletAddress,
        sessionsRemoved: sessionsToRemove.length
      });

      return {
        success: true,
        walletAddress,
        sessionsRemoved: sessionsToRemove.length,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to force disconnect wallet', {
        error: error.message,
        walletAddress
      });
      throw new AppError(`Failed to force disconnect wallet: ${error.message}`, 500);
    }
  }
}

// Create singleton instance
const walletManager = new WalletManager();

// Start periodic cleanup of expired sessions
setInterval(() => {
  walletManager.cleanupExpiredSessions();
}, 10 * 60 * 1000); // Every 10 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down Wallet Manager...');
});

process.on('SIGINT', async () => {
  logger.info('Shutting down Wallet Manager...');
});

module.exports = walletManager;
