const { 
  Connection, 
  PublicKey, 
  Transaction, 
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ConfirmOptions,
  Commitment
} = require('@solana/web3.js');
const { AnchorProvider, Wallet, Program } = require('@coral-xyz/anchor');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');

class SolanaConnectionService {
  constructor() {
    this.connections = new Map();
    this.wallets = new Map();
    this.providers = new Map();
    this.programs = new Map();
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 10000,  // 10 seconds
      backoffFactor: 2
    };
    
    // Initialize connections on startup
    this.initializeConnections();
  }

  /**
   * Initialize connections to different Solana clusters
   */
  initializeConnections() {
    try {
      // RPC endpoints configuration
      const endpoints = {
        localnet: process.env.SOLANA_LOCALNET_URL || 'http://127.0.0.1:8899',
        devnet: process.env.SOLANA_DEVNET_URL || 'https://api.devnet.solana.com',
        testnet: process.env.SOLANA_TESTNET_URL || 'https://api.testnet.solana.com',
        mainnet: process.env.SOLANA_MAINNET_URL || 'https://api.mainnet-beta.solana.com'
      };

      // Connection options
      const connectionOptions = {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000, // 60 seconds
        disableRetryOnRateLimit: false,
        httpHeaders: {
          'Content-Type': 'application/json',
        }
      };

      // Create connections for each cluster
      Object.entries(endpoints).forEach(([cluster, endpoint]) => {
        try {
          const connection = new Connection(endpoint, connectionOptions);
          this.connections.set(cluster, connection);
          
          logger.info(`Solana connection initialized for ${cluster}`, {
            endpoint,
            cluster
          });
        } catch (error) {
          logger.error(`Failed to initialize ${cluster} connection`, {
            endpoint,
            error: error.message
          });
        }
      });

      // Set default cluster
      this.defaultCluster = process.env.SOLANA_DEFAULT_CLUSTER || 'devnet';
      
      logger.info('Solana connection service initialized', {
        defaultCluster: this.defaultCluster,
        availableClusters: Array.from(this.connections.keys())
      });

    } catch (error) {
      logger.error('Failed to initialize Solana connections', {
        error: error.message,
        stack: error.stack
      });
      throw new AppError('Failed to initialize Solana blockchain connections', 500);
    }
  }

  /**
   * Get connection for specific cluster
   * @param {string} cluster - Cluster name (localnet, devnet, testnet, mainnet)
   * @returns {Connection} Solana connection
   */
  getConnection(cluster = this.defaultCluster) {
    const connection = this.connections.get(cluster);
    if (!connection) {
      throw new AppError(`Connection not found for cluster: ${cluster}`, 404);
    }
    return connection;
  }

  /**
   * Initialize wallet from private key
   * @param {string} privateKey - Base58 encoded private key
   * @param {string} cluster - Target cluster
   * @returns {Wallet} Anchor wallet instance
   */
  initializeWallet(privateKey, cluster = this.defaultCluster) {
    try {
      let keypair;
      
      if (privateKey) {
        // Decode private key (support both base58 and array formats)
        if (typeof privateKey === 'string') {
          keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
        } else if (Array.isArray(privateKey)) {
          keypair = Keypair.fromSecretKey(new Uint8Array(privateKey));
        } else {
          throw new Error('Invalid private key format');
        }
      } else {
        // Generate new keypair if no private key provided
        keypair = Keypair.generate();
        logger.warn('No private key provided, generated new keypair', {
          publicKey: keypair.publicKey.toString()
        });
      }

      const wallet = new Wallet(keypair);
      const walletKey = `${cluster}_${keypair.publicKey.toString()}`;
      this.wallets.set(walletKey, wallet);

      logger.info('Wallet initialized', {
        publicKey: keypair.publicKey.toString(),
        cluster
      });

      return wallet;
    } catch (error) {
      logger.error('Failed to initialize wallet', {
        error: error.message,
        cluster
      });
      throw new AppError('Failed to initialize wallet', 500);
    }
  }

  /**
   * Get or create Anchor provider
   * @param {string} cluster - Target cluster
   * @param {Wallet} wallet - Wallet instance
   * @returns {AnchorProvider} Anchor provider
   */
  getProvider(cluster = this.defaultCluster, wallet = null) {
    try {
      const providerKey = `${cluster}_${wallet?.publicKey?.toString() || 'default'}`;
      
      if (this.providers.has(providerKey)) {
        return this.providers.get(providerKey);
      }

      const connection = this.getConnection(cluster);
      
      if (!wallet) {
        // Use default wallet if none provided
        const defaultPrivateKey = process.env.SOLANA_PRIVATE_KEY;
        wallet = this.initializeWallet(defaultPrivateKey, cluster);
      }

      const provider = new AnchorProvider(
        connection,
        wallet,
        {
          commitment: 'confirmed',
          preflightCommitment: 'confirmed',
          skipPreflight: false
        }
      );

      this.providers.set(providerKey, provider);

      logger.info('Anchor provider created', {
        cluster,
        wallet: wallet.publicKey.toString()
      });

      return provider;
    } catch (error) {
      logger.error('Failed to create Anchor provider', {
        error: error.message,
        cluster
      });
      throw new AppError('Failed to create Anchor provider', 500);
    }
  }

  /**
   * Initialize Anchor program
   * @param {Object} idl - Program IDL
   * @param {string} programId - Program public key
   * @param {string} cluster - Target cluster
   * @param {Wallet} wallet - Wallet instance
   * @returns {Program} Anchor program instance
   */
  initializeProgram(idl, programId, cluster = this.defaultCluster, wallet = null) {
    try {
      const programKey = `${cluster}_${programId}`;
      
      if (this.programs.has(programKey)) {
        return this.programs.get(programKey);
      }

      const provider = this.getProvider(cluster, wallet);
      const program = new Program(idl, new PublicKey(programId), provider);
      
      this.programs.set(programKey, program);

      logger.info('Anchor program initialized', {
        programId,
        cluster,
        wallet: provider.wallet.publicKey.toString()
      });

      return program;
    } catch (error) {
      logger.error('Failed to initialize Anchor program', {
        error: error.message,
        programId,
        cluster
      });
      throw new AppError('Failed to initialize Anchor program', 500);
    }
  }

  /**
   * Send and confirm transaction with retry logic
   * @param {Transaction} transaction - Transaction to send
   * @param {Array<Keypair>} signers - Transaction signers
   * @param {string} cluster - Target cluster
   * @param {ConfirmOptions} options - Confirmation options
   * @returns {string} Transaction signature
   */
  async sendAndConfirmTransaction(
    transaction, 
    signers = [], 
    cluster = this.defaultCluster, 
    options = {}
  ) {
    const connection = this.getConnection(cluster);
    const defaultOptions = {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
      skipPreflight: false,
      maxRetries: 3
    };
    const confirmOptions = { ...defaultOptions, ...options };

    let lastError;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        logger.info(`Sending transaction (attempt ${attempt})`, {
          cluster,
          signers: signers.length,
          instructions: transaction.instructions.length
        });

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await this.getRecentBlockhash(cluster);
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;

        // Send and confirm transaction
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          signers,
          confirmOptions
        );

        logger.info('Transaction confirmed', {
          signature,
          cluster,
          attempt
        });

        return signature;

      } catch (error) {
        lastError = error;
        
        logger.warn(`Transaction failed (attempt ${attempt})`, {
          error: error.message,
          cluster,
          attempt,
          maxRetries: this.retryConfig.maxRetries
        });

        // Don't retry on certain errors
        if (this.isNonRetryableError(error) || attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffFactor, attempt - 1),
          this.retryConfig.maxDelay
        );
        
        await this.delay(delay);
      }
    }

    logger.error('Transaction failed after all retries', {
      error: lastError.message,
      cluster,
      maxRetries: this.retryConfig.maxRetries
    });

    throw new AppError(`Transaction failed: ${lastError.message}`, 500);
  }

  /**
   * Get recent blockhash with retry logic
   * @param {string} cluster - Target cluster
   * @returns {Object} Blockhash and validity info
   */
  async getRecentBlockhash(cluster = this.defaultCluster) {
    const connection = this.getConnection(cluster);
    
    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const blockhashInfo = await connection.getLatestBlockhash('confirmed');
        return blockhashInfo;
      } catch (error) {
        logger.warn(`Failed to get recent blockhash (attempt ${attempt})`, {
          error: error.message,
          cluster,
          attempt
        });

        if (attempt === this.retryConfig.maxRetries) {
          throw new AppError('Failed to get recent blockhash', 500);
        }

        await this.delay(1000 * attempt);
      }
    }
  }

  /**
   * Get account balance
   * @param {string|PublicKey} publicKey - Account public key
   * @param {string} cluster - Target cluster
   * @returns {number} Balance in lamports
   */
  async getBalance(publicKey, cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      const pubKey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
      
      const balance = await connection.getBalance(pubKey);
      
      logger.debug('Retrieved account balance', {
        publicKey: pubKey.toString(),
        balance,
        balanceSOL: balance / LAMPORTS_PER_SOL,
        cluster
      });

      return balance;
    } catch (error) {
      logger.error('Failed to get account balance', {
        error: error.message,
        publicKey: publicKey.toString(),
        cluster
      });
      throw new AppError('Failed to get account balance', 500);
    }
  }

  /**
   * Get SPL token balance
   * @param {string|PublicKey} tokenAccount - Token account public key
   * @param {string} cluster - Target cluster
   * @returns {Object} Token account info
   */
  async getTokenBalance(tokenAccount, cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      const tokenAccountPubKey = typeof tokenAccount === 'string' 
        ? new PublicKey(tokenAccount) 
        : tokenAccount;
      
      const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccountPubKey);
      
      logger.debug('Retrieved token balance', {
        tokenAccount: tokenAccountPubKey.toString(),
        balance: tokenAccountInfo.value,
        cluster
      });

      return tokenAccountInfo.value;
    } catch (error) {
      logger.error('Failed to get token balance', {
        error: error.message,
        tokenAccount: tokenAccount.toString(),
        cluster
      });
      throw new AppError('Failed to get token balance', 500);
    }
  }

  /**
   * Request airdrop (devnet/testnet only)
   * @param {string|PublicKey} publicKey - Recipient public key
   * @param {number} amount - Amount in SOL
   * @param {string} cluster - Target cluster
   * @returns {string} Transaction signature
   */
  async requestAirdrop(publicKey, amount = 1, cluster = this.defaultCluster) {
    if (cluster === 'mainnet') {
      throw new AppError('Airdrop not available on mainnet', 400);
    }

    try {
      const connection = this.getConnection(cluster);
      const pubKey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
      const lamports = amount * LAMPORTS_PER_SOL;
      
      const signature = await connection.requestAirdrop(pubKey, lamports);
      await connection.confirmTransaction(signature, 'confirmed');
      
      logger.info('Airdrop completed', {
        publicKey: pubKey.toString(),
        amount,
        signature,
        cluster
      });

      return signature;
    } catch (error) {
      logger.error('Airdrop failed', {
        error: error.message,
        publicKey: publicKey.toString(),
        amount,
        cluster
      });
      throw new AppError(`Airdrop failed: ${error.message}`, 500);
    }
  }

  /**
   * Get transaction details
   * @param {string} signature - Transaction signature
   * @param {string} cluster - Target cluster
   * @returns {Object} Transaction details
   */
  async getTransaction(signature, cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      
      const transaction = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        throw new AppError('Transaction not found', 404);
      }

      logger.debug('Retrieved transaction', {
        signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        cluster
      });

      return transaction;
    } catch (error) {
      logger.error('Failed to get transaction', {
        error: error.message,
        signature,
        cluster
      });
      throw new AppError('Failed to get transaction', 500);
    }
  }

  /**
   * Check if error should not be retried
   * @param {Error} error - Error to check
   * @returns {boolean} Whether error is non-retryable
   */
  isNonRetryableError(error) {
    const nonRetryableErrors = [
      'insufficient funds',
      'invalid signature',
      'already processed',
      'blockhash not found',
      'account not found',
      'invalid account data',
      'custom program error'
    ];

    const errorMessage = error.message.toLowerCase();
    return nonRetryableErrors.some(msg => errorMessage.includes(msg));
  }

  /**
   * Delay execution
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test connection health
   * @param {string} cluster - Target cluster
   * @returns {Object} Health status
   */
  async testConnection(cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      const start = Date.now();
      
      // Test basic connectivity
      const version = await connection.getVersion();
      const slot = await connection.getSlot();
      const blockhash = await connection.getLatestBlockhash();
      
      const latency = Date.now() - start;
      
      const health = {
        cluster,
        status: 'healthy',
        latency,
        version: version['solana-core'],
        slot,
        blockhash: blockhash.blockhash,
        timestamp: new Date().toISOString()
      };

      logger.info('Connection health check passed', health);
      return health;

    } catch (error) {
      const health = {
        cluster,
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };

      logger.error('Connection health check failed', health);
      return health;
    }
  }

  /**
   * Get network stats
   * @param {string} cluster - Target cluster
   * @returns {Object} Network statistics
   */
  async getNetworkStats(cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      
      const [
        epochInfo,
        supply,
        performanceSamples,
        inflation
      ] = await Promise.all([
        connection.getEpochInfo(),
        connection.getSupply(),
        connection.getRecentPerformanceSamples(1),
        connection.getInflationRate()
      ]);

      const stats = {
        cluster,
        epoch: epochInfo.epoch,
        slot: epochInfo.absoluteSlot,
        blockHeight: epochInfo.blockHeight,
        totalSupply: supply.value.total,
        circulatingSupply: supply.value.circulating,
        tps: performanceSamples[0]?.numTransactions / performanceSamples[0]?.samplePeriodSecs || 0,
        inflationRate: inflation.total,
        timestamp: new Date().toISOString()
      };

      logger.debug('Network stats retrieved', stats);
      return stats;

    } catch (error) {
      logger.error('Failed to get network stats', {
        error: error.message,
        cluster
      });
      throw new AppError('Failed to get network stats', 500);
    }
  }

  /**
   * Monitor account changes
   * @param {string|PublicKey} publicKey - Account to monitor
   * @param {Function} callback - Callback function
   * @param {string} cluster - Target cluster
   * @returns {number} Subscription ID
   */
  async subscribeToAccount(publicKey, callback, cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      const pubKey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
      
      const subscriptionId = connection.onAccountChange(
        pubKey,
        (accountInfo, context) => {
          logger.debug('Account change detected', {
            publicKey: pubKey.toString(),
            slot: context.slot,
            cluster
          });
          callback(accountInfo, context);
        },
        'confirmed'
      );

      logger.info('Account subscription created', {
        publicKey: pubKey.toString(),
        subscriptionId,
        cluster
      });

      return subscriptionId;
    } catch (error) {
      logger.error('Failed to subscribe to account', {
        error: error.message,
        publicKey: publicKey.toString(),
        cluster
      });
      throw new AppError('Failed to subscribe to account', 500);
    }
  }

  /**
   * Remove account subscription
   * @param {number} subscriptionId - Subscription ID to remove
   * @param {string} cluster - Target cluster
   */
  async unsubscribeFromAccount(subscriptionId, cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      await connection.removeAccountChangeListener(subscriptionId);
      
      logger.info('Account subscription removed', {
        subscriptionId,
        cluster
      });
    } catch (error) {
      logger.error('Failed to unsubscribe from account', {
        error: error.message,
        subscriptionId,
        cluster
      });
      throw new AppError('Failed to unsubscribe from account', 500);
    }
  }

  /**
   * Get program accounts
   * @param {string|PublicKey} programId - Program public key
   * @param {Object} filters - Account filters
   * @param {string} cluster - Target cluster
   * @returns {Array} Program accounts
   */
  async getProgramAccounts(programId, filters = [], cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      const pubKey = typeof programId === 'string' ? new PublicKey(programId) : programId;
      
      const accounts = await connection.getProgramAccounts(pubKey, {
        filters,
        commitment: 'confirmed'
      });

      logger.debug('Program accounts retrieved', {
        programId: pubKey.toString(),
        accountCount: accounts.length,
        cluster
      });

      return accounts;
    } catch (error) {
      logger.error('Failed to get program accounts', {
        error: error.message,
        programId: programId.toString(),
        cluster
      });
      throw new AppError('Failed to get program accounts', 500);
    }
  }

  /**
   * Simulate transaction
   * @param {Transaction} transaction - Transaction to simulate
   * @param {string} cluster - Target cluster
   * @returns {Object} Simulation result
   */
  async simulateTransaction(transaction, cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      
      // Get recent blockhash for simulation
      const { blockhash } = await this.getRecentBlockhash(cluster);
      transaction.recentBlockhash = blockhash;
      
      const simulation = await connection.simulateTransaction(transaction, {
        commitment: 'confirmed',
        sigVerify: false
      });

      logger.debug('Transaction simulated', {
        success: !simulation.value.err,
        logs: simulation.value.logs,
        cluster
      });

      return simulation.value;
    } catch (error) {
      logger.error('Transaction simulation failed', {
        error: error.message,
        cluster
      });
      throw new AppError('Transaction simulation failed', 500);
    }
  }

  /**
   * Get multiple accounts
   * @param {Array<string|PublicKey>} publicKeys - Array of public keys
   * @param {string} cluster - Target cluster
   * @returns {Array} Account info array
   */
  async getMultipleAccounts(publicKeys, cluster = this.defaultCluster) {
    try {
      const connection = this.getConnection(cluster);
      const pubKeys = publicKeys.map(key => 
        typeof key === 'string' ? new PublicKey(key) : key
      );
      
      const accounts = await connection.getMultipleAccountsInfo(pubKeys, 'confirmed');

      logger.debug('Multiple accounts retrieved', {
        requestedCount: pubKeys.length,
        retrievedCount: accounts.filter(Boolean).length,
        cluster
      });

      return accounts;
    } catch (error) {
      logger.error('Failed to get multiple accounts', {
        error: error.message,
        accountCount: publicKeys.length,
        cluster
      });
      throw new AppError('Failed to get multiple accounts', 500);
    }
  }

  /**
   * Close connection service and cleanup resources
   */
  async close() {
    try {
      // Close all WebSocket connections
      for (const [cluster, connection] of this.connections) {
        try {
          // Remove all listeners
          connection._rpcWebSocket.close();
        } catch (error) {
          logger.warn(`Failed to close connection for ${cluster}`, {
            error: error.message
          });
        }
      }

      // Clear all caches
      this.connections.clear();
      this.wallets.clear();
      this.providers.clear();
      this.programs.clear();

      logger.info('Solana connection service closed');
    } catch (error) {
      logger.error('Failed to close Solana connection service', {
        error: error.message
      });
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      defaultCluster: this.defaultCluster,
      availableClusters: Array.from(this.connections.keys()),
      activeConnections: this.connections.size,
      activeWallets: this.wallets.size,
      activeProviders: this.providers.size,
      activePrograms: this.programs.size,
      retryConfig: this.retryConfig,
      timestamp: new Date().toISOString()
    };
  }
}

// Create singleton instance
const solanaConnectionService = new SolanaConnectionService();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Closing Solana connection service...');
  await solanaConnectionService.close();
});

process.on('SIGINT', async () => {
  logger.info('Closing Solana connection service...');
  await solanaConnectionService.close();
});

module.exports = solanaConnectionService;
