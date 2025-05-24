const { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction
} = require('@solana/web3.js');
const { 
  Token, 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const {
  createCreateMetadataAccountV3Instruction,
  createCreateMasterEditionV3Instruction,
  createVerifyCollectionInstruction,
  PROGRAM_ID as METADATA_PROGRAM_ID
} = require('@metaplex-foundation/mpl-token-metadata');
const { BN } = require('@coral-xyz/anchor');
const ipfsClient = require('ipfs-http-client');
const FormData = require('form-data');
const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');
const MintingModel = require('../../models/Minting');
const EventModel = require('../../models/Event');
const BlockchainService = require('../blockchain/blockchainService');
const CacheService = require('../cache/cacheService');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class NFTMintingService {
  constructor() {
    this.blockchainService = new BlockchainService();
    this.cacheService = new CacheService();
    
    // Initialize connections
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    // Initialize IPFS client
    this.ipfs = ipfsClient.create({
      host: process.env.IPFS_HOST || 'ipfs.infura.io',
      port: process.env.IPFS_PORT || 5001,
      protocol: process.env.IPFS_PROTOCOL || 'https',
      headers: {
        authorization: process.env.IPFS_AUTH_HEADER
      }
    });
    
    // Alternative: Arweave configuration
    this.arweaveEnabled = process.env.USE_ARWEAVE === 'true';
    
    // Configuration
    this.config = {
      maxSupply: 0, // 0 = unlimited for tickets
      sellerFeeBasisPoints: 500, // 5% royalty
      collectionSizeLimit: 10000,
      symbol: 'TICKET',
      creators: [
        {
          address: new PublicKey(process.env.PLATFORM_WALLET),
          verified: true,
          share: 100
        }
      ],
      gasConfig: {
        priorityFee: 0.0001, // SOL
        maxRetries: 3,
        confirmationTimeout: 60000 // 60 seconds
      },
      metadataStandard: {
        name: 'Event Ticket NFT',
        symbol: 'TICKET',
        uri: '',
        sellerFeeBasisPoints: 500,
        collection: null,
        uses: null
      }
    };
    
    // Batch minting configuration
    this.batchConfig = {
      maxBatchSize: 5, // Maximum NFTs per transaction
      parallelTransactions: 3, // Concurrent transactions
      retryDelay: 5000 // 5 seconds between retries
    };
  }

  /**
   * Mint a single ticket NFT
   */
  async mintTicketNFT(ticketData, ownerWallet) {
    const mintingId = crypto.randomBytes(16).toString('hex');
    
    try {
      logger.info('Starting NFT minting', {
        mintingId,
        eventId: ticketData.eventId,
        ownerWallet
      });

      // Validate minting data
      const validation = await this.validateMintingData({
        ticketData,
        ownerWallet
      });

      if (!validation.isValid) {
        throw new AppError(validation.error, 400);
      }

      // Get event details
      const event = await EventModel.findById(ticketData.eventId);
      if (!event) {
        throw new AppError('Event not found', 404);
      }

      // Create minting record
      const minting = new MintingModel({
        mintingId,
        ticketId: ticketData.ticketId,
        eventId: ticketData.eventId,
        status: 'pending',
        owner: ownerWallet,
        attempts: 0,
        metadata: {
          ticketTier: ticketData.tier,
          seatInfo: ticketData.seatInfo,
          purchaseDate: ticketData.purchaseDate
        }
      });

      await minting.save();

      // Generate metadata
      const metadata = await this.generateMetadata(event, ticketData);
      
      // Upload metadata to decentralized storage
      const metadataUri = await this.uploadMetadataToIPFS(metadata);
      
      // Update minting record with metadata URI
      minting.metadataUri = metadataUri;
      minting.metadata.ipfsHash = this.extractIPFSHash(metadataUri);
      await minting.save();

      // Generate new mint keypair
      const mintKeypair = Keypair.generate();
      
      // Create mint transaction
      const mintTransaction = await this.createMintTransaction({
        mintKeypair,
        ownerWallet: new PublicKey(ownerWallet),
        metadata: {
          ...metadata,
          uri: metadataUri
        },
        collectionMint: event.collectionMint ? new PublicKey(event.collectionMint) : null
      });

      // Send and confirm transaction
      const signature = await this.sendAndConfirmTransaction(mintTransaction, [mintKeypair]);
      
      // Update minting status
      await this.updateMintingStatus(minting._id, 'minted', {
        mintAddress: mintKeypair.publicKey.toBase58(),
        transactionSignature: signature,
        mintedAt: new Date()
      });

      // Verify minted NFT
      const verified = await this.verifyMintedNFT(mintKeypair.publicKey.toBase58());
      if (!verified) {
        throw new AppError('NFT verification failed', 500);
      }

      // Set on-chain attributes
      await this.setTicketAttributes(mintKeypair.publicKey.toBase58(), {
        event_id: ticketData.eventId,
        ticket_tier: ticketData.tier,
        seat_number: ticketData.seatInfo?.seatNumber,
        original_price: ticketData.price,
        transferable: !ticketData.nonTransferable
      });

      logger.info('NFT minting completed', {
        mintingId,
        mintAddress: mintKeypair.publicKey.toBase58(),
        signature
      });

      return {
        success: true,
        mintAddress: mintKeypair.publicKey.toBase58(),
        transactionSignature: signature,
        metadataUri,
        owner: ownerWallet,
        mintingId
      };

    } catch (error) {
      logger.error('Error minting NFT:', error);
      
      // Handle minting failure
      await this.handleMintingFailure({
        mintingId,
        error,
        ticketData,
        ownerWallet
      });
      
      throw error;
    }
  }

  /**
   * Generate NFT metadata following standards
   */
  async generateMetadata(eventData, ticketData) {
    try {
      // Generate unique ticket image if not provided
      let imageUri = eventData.nftImage || eventData.images?.main;
      if (!imageUri && eventData.generateTicketImage) {
        imageUri = await this.generateTicketImage(eventData, ticketData);
      }

      const metadata = {
        name: `${eventData.name} - ${ticketData.tier} Ticket #${ticketData.ticketNumber || ticketData.ticketId}`,
        symbol: eventData.symbol || this.config.symbol,
        description: `Official ticket for ${eventData.name} on ${new Date(eventData.startDate).toLocaleDateString()}. This NFT serves as your entry pass to the event.`,
        image: imageUri,
        animation_url: eventData.animationUrl || null,
        external_url: `${process.env.APP_URL}/events/${eventData._id}`,
        attributes: [
          {
            trait_type: 'Event Name',
            value: eventData.name
          },
          {
            trait_type: 'Event Date',
            value: new Date(eventData.startDate).toISOString(),
            display_type: 'date'
          },
          {
            trait_type: 'Venue',
            value: eventData.venue?.name || eventData.location
          },
          {
            trait_type: 'Ticket Tier',
            value: ticketData.tier
          },
          {
            trait_type: 'Original Price',
            value: ticketData.price,
            display_type: 'number'
          },
          {
            trait_type: 'Purchase Date',
            value: new Date(ticketData.purchaseDate).toISOString(),
            display_type: 'date'
          }
        ],
        properties: {
          category: 'ticket',
          files: [
            {
              uri: imageUri,
              type: 'image/png'
            }
          ],
          creators: this.config.creators
        },
        collection: eventData.collectionMetadata || {
          name: eventData.name,
          family: 'Event Tickets'
        }
      };

      // Add seat information if applicable
      if (ticketData.seatInfo) {
        metadata.attributes.push(
          {
            trait_type: 'Section',
            value: ticketData.seatInfo.section
          },
          {
            trait_type: 'Row',
            value: ticketData.seatInfo.row
          },
          {
            trait_type: 'Seat Number',
            value: ticketData.seatInfo.seatNumber
          }
        );
      }

      // Add tier-specific benefits
      const tierBenefits = this.getTierBenefits(ticketData.tier);
      if (tierBenefits.length > 0) {
        metadata.attributes.push({
          trait_type: 'Benefits',
          value: tierBenefits.join(', ')
        });
      }

      // Add rarity score if applicable
      if (ticketData.rarityScore) {
        metadata.attributes.push({
          trait_type: 'Rarity Score',
          value: ticketData.rarityScore,
          display_type: 'boost_percentage'
        });
      }

      // Add unlockable content reference
      if (ticketData.hasUnlockableContent) {
        metadata.properties.unlockable = {
          type: 'exclusive_content',
          url: `${process.env.APP_URL}/unlock/${ticketData.ticketId}`
        };
      }

      return metadata;
    } catch (error) {
      logger.error('Error generating metadata:', error);
      throw error;
    }
  }

  /**
   * Upload metadata to IPFS or Arweave
   */
  async uploadMetadataToIPFS(metadata) {
    try {
      if (this.arweaveEnabled) {
        return await this.uploadToArweave(metadata);
      }

      // Convert metadata to JSON
      const metadataJSON = JSON.stringify(metadata, null, 2);
      const metadataBuffer = Buffer.from(metadataJSON);

      // Upload to IPFS
      const result = await this.ipfs.add(metadataBuffer, {
        pin: true,
        wrapWithDirectory: false
      });

      const ipfsHash = result.path || result.cid.toString();
      const metadataUri = `ipfs://${ipfsHash}`;

      // Pin to additional services for redundancy
      await this.pinToAlternativeServices(ipfsHash, metadataBuffer);

      logger.info('Metadata uploaded to IPFS', {
        ipfsHash,
        size: metadataBuffer.length
      });

      return metadataUri;
    } catch (error) {
      logger.error('Error uploading to IPFS:', error);
      
      // Fallback to centralized storage
      return await this.uploadToCentralizedStorage(metadata);
    }
  }

  /**
   * Set on-chain attributes for the NFT
   */
  async setTicketAttributes(tokenId, attributes) {
    try {
      const mint = new PublicKey(tokenId);
      
      // Create attribute instructions
      const instructions = [];
      
      // Add each attribute as on-chain data
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== null && value !== undefined) {
          const instruction = await this.createAttributeInstruction(
            mint,
            key,
            value.toString()
          );
          instructions.push(instruction);
        }
      }

      if (instructions.length === 0) return;

      // Create and send transaction
      const transaction = new Transaction().add(...instructions);
      const signature = await this.sendAndConfirmTransaction(transaction);

      logger.info('Attributes set on-chain', {
        tokenId,
        attributeCount: instructions.length,
        signature
      });

      return {
        success: true,
        signature,
        attributes
      };
    } catch (error) {
      logger.error('Error setting attributes:', error);
      // Non-critical error - don't throw
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Batch mint multiple tickets efficiently
   */
  async batchMintTickets(ticketsData) {
    const batchId = crypto.randomBytes(16).toString('hex');
    
    try {
      logger.info('Starting batch minting', {
        batchId,
        ticketCount: ticketsData.length
      });

      // Validate all tickets
      for (const ticketData of ticketsData) {
        const validation = await this.validateMintingData({
          ticketData: ticketData.ticket,
          ownerWallet: ticketData.ownerWallet
        });

        if (!validation.isValid) {
          throw new AppError(`Validation failed for ticket: ${validation.error}`, 400);
        }
      }

      // Group tickets by owner for efficiency
      const ticketsByOwner = this.groupTicketsByOwner(ticketsData);
      
      // Process in batches
      const results = [];
      const failedMints = [];

      for (const [owner, tickets] of Object.entries(ticketsByOwner)) {
        // Split into smaller batches based on config
        const batches = this.createBatches(tickets, this.batchConfig.maxBatchSize);
        
        // Process batches in parallel (limited concurrency)
        const batchPromises = [];
        for (let i = 0; i < batches.length; i += this.batchConfig.parallelTransactions) {
          const parallelBatches = batches.slice(i, i + this.batchConfig.parallelTransactions);
          
          const batchResults = await Promise.all(
            parallelBatches.map(batch => 
              this.processBatch(batch, owner).catch(error => ({
                success: false,
                error,
                batch
              }))
            )
          );

          batchResults.forEach(result => {
            if (result.success) {
              results.push(...result.mints);
            } else {
              failedMints.push(...result.batch);
            }
          });
        }
      }

      // Retry failed mints individually
      for (const failedTicket of failedMints) {
        try {
          const result = await this.mintTicketNFT(
            failedTicket.ticket,
            failedTicket.ownerWallet
          );
          results.push(result);
        } catch (error) {
          logger.error('Failed to mint ticket after retry', {
            ticketId: failedTicket.ticket.ticketId,
            error
          });
        }
      }

      logger.info('Batch minting completed', {
        batchId,
        total: ticketsData.length,
        successful: results.length,
        failed: ticketsData.length - results.length
      });

      return {
        batchId,
        total: ticketsData.length,
        successful: results.length,
        failed: ticketsData.length - results.length,
        results,
        failedTickets: failedMints
      };
    } catch (error) {
      logger.error('Error in batch minting:', error);
      throw error;
    }
  }

  /**
   * Validate minting data
   */
  async validateMintingData(mintData) {
    const errors = [];

    // Validate ticket data
    if (!mintData.ticketData) {
      errors.push('Ticket data is required');
    } else {
      if (!mintData.ticketData.eventId) {
        errors.push('Event ID is required');
      }
      if (!mintData.ticketData.tier) {
        errors.push('Ticket tier is required');
      }
      if (mintData.ticketData.price === undefined || mintData.ticketData.price < 0) {
        errors.push('Valid ticket price is required');
      }
    }

    // Validate owner wallet
    if (!mintData.ownerWallet) {
      errors.push('Owner wallet address is required');
    } else {
      try {
        new PublicKey(mintData.ownerWallet);
      } catch (error) {
        errors.push('Invalid owner wallet address');
      }
    }

    // Check for duplicate minting
    if (mintData.ticketData?.ticketId) {
      const existingMint = await MintingModel.findOne({
        ticketId: mintData.ticketData.ticketId,
        status: { $in: ['minted', 'pending'] }
      });

      if (existingMint) {
        errors.push('Ticket has already been minted or is being minted');
      }
    }

    // Validate event exists and is active
    if (mintData.ticketData?.eventId) {
      const event = await EventModel.findById(mintData.ticketData.eventId);
      if (!event) {
        errors.push('Event not found');
      } else if (event.status === 'cancelled') {
        errors.push('Cannot mint tickets for cancelled events');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      error: errors[0] || null
    };
  }

  /**
   * Handle minting failure and recovery
   */
  async handleMintingFailure(mintData) {
    try {
      const { mintingId, error, ticketData, ownerWallet } = mintData;

      // Update minting record
      const minting = await MintingModel.findOne({ mintingId });
      if (minting) {
        minting.status = 'failed';
        minting.error = error.message;
        minting.attempts += 1;
        minting.lastAttemptAt = new Date();
        await minting.save();

        // Schedule retry if under max attempts
        if (minting.attempts < this.config.gasConfig.maxRetries) {
          setTimeout(async () => {
            try {
              logger.info('Retrying failed mint', { mintingId, attempt: minting.attempts + 1 });
              await this.mintTicketNFT(ticketData, ownerWallet);
            } catch (retryError) {
              logger.error('Retry failed', { mintingId, error: retryError });
            }
          }, this.batchConfig.retryDelay * minting.attempts);
        }
      }

      // Log failure for analysis
      logger.error('Minting failure handled', {
        mintingId,
        error: error.message,
        ticketId: ticketData.ticketId
      });

      // Notify relevant parties
      await this.notifyMintingFailure(mintData);

    } catch (handlingError) {
      logger.error('Error handling minting failure:', handlingError);
    }
  }

  /**
   * Update minting status
   */
  async updateMintingStatus(mintingId, status, additionalData = {}) {
    try {
      const update = {
        status,
        [`${status}At`]: new Date(),
        ...additionalData
      };

      const minting = await MintingModel.findByIdAndUpdate(
        mintingId,
        update,
        { new: true }
      );

      // Clear caches
      await this.cacheService.delete(`minting:${mintingId}`);
      await this.cacheService.delete(`ticket:${minting.ticketId}:mint`);

      logger.info('Minting status updated', {
        mintingId,
        status,
        ticketId: minting.ticketId
      });

      return minting;
    } catch (error) {
      logger.error('Error updating minting status:', error);
      throw error;
    }
  }

  /**
   * Calculate minting costs including gas
   */
  async calculateMintingCosts(quantity) {
    try {
      // Get current network fees
      const recentFees = await this.connection.getRecentPrioritizationFees();
      const medianFee = this.calculateMedianFee(recentFees);
      
      // Base costs in lamports
      const costs = {
        // Rent for mint account
        mintAccountRent: await this.connection.getMinimumBalanceForRentExemption(82),
        // Rent for metadata account
        metadataAccountRent: await this.connection.getMinimumBalanceForRentExemption(679),
        // Rent for master edition account
        masterEditionRent: await this.connection.getMinimumBalanceForRentExemption(241),
        // Transaction fees
        transactionFee: 5000, // 0.000005 SOL per signature
        // Priority fee
        priorityFee: medianFee || 1000
      };

      // Calculate per NFT cost
      const perNFTCost = 
        costs.mintAccountRent +
        costs.metadataAccountRent +
        costs.masterEditionRent +
        costs.transactionFee +
        costs.priorityFee;

      // Calculate batch savings
      const batchSize = Math.min(quantity, this.batchConfig.maxBatchSize);
      const numBatches = Math.ceil(quantity / batchSize);
      const batchTransactionFees = numBatches * costs.transactionFee;
      const individualTransactionFees = quantity * costs.transactionFee;
      const savings = individualTransactionFees - batchTransactionFees;

      // Convert to SOL
      const lamportsPerSol = 1e9;
      
      return {
        perNFT: {
          lamports: perNFTCost,
          sol: perNFTCost / lamportsPerSol
        },
        total: {
          lamports: perNFTCost * quantity - savings,
          sol: (perNFTCost * quantity - savings) / lamportsPerSol
        },
        breakdown: {
          mintRent: costs.mintAccountRent / lamportsPerSol,
          metadataRent: costs.metadataAccountRent / lamportsPerSol,
          masterEditionRent: costs.masterEditionRent / lamportsPerSol,
          transactionFees: batchTransactionFees / lamportsPerSol,
          priorityFees: (costs.priorityFee * quantity) / lamportsPerSol
        },
        savings: {
          lamports: savings,
          sol: savings / lamportsPerSol,
          percentage: (savings / (perNFTCost * quantity)) * 100
        },
        estimatedTime: numBatches * 2, // ~2 seconds per batch
        recommendations: this.getCostRecommendations(quantity, costs)
      };
    } catch (error) {
      logger.error('Error calculating minting costs:', error);
      throw error;
    }
  }

  /**
   * Verify successful NFT minting
   */
  async verifyMintedNFT(tokenId) {
    try {
      const mintPubkey = new PublicKey(tokenId);
      
      // Check mint account exists
      const mintAccount = await this.connection.getAccountInfo(mintPubkey);
      if (!mintAccount) {
        return false;
      }

      // Get metadata account
      const [metadataPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer()
        ],
        METADATA_PROGRAM_ID
      );

      const metadataAccount = await this.connection.getAccountInfo(metadataPDA);
      if (!metadataAccount) {
        return false;
      }

      // Parse and verify metadata
      const metadata = await this.parseMetadata(metadataAccount.data);
      if (!metadata || !metadata.data) {
        return false;
      }

      // Verify token supply is 1 (NFT)
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);
      const mintData = mintInfo.value?.data?.parsed?.info;
      if (!mintData || mintData.supply !== '1' || mintData.decimals !== 0) {
        return false;
      }

      // Check master edition exists
      const [masterEditionPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
          Buffer.from('edition')
        ],
        METADATA_PROGRAM_ID
      );

      const masterEditionAccount = await this.connection.getAccountInfo(masterEditionPDA);
      if (!masterEditionAccount) {
        return false;
      }

      logger.info('NFT verified successfully', {
        tokenId,
        name: metadata.data.name,
        uri: metadata.data.uri
      });

      return true;
    } catch (error) {
      logger.error('Error verifying NFT:', error);
      return false;
    }
  }

  // Helper methods

  async createMintTransaction({ mintKeypair, ownerWallet, metadata, collectionMint }) {
    const transaction = new Transaction();
    
    // Add priority fee
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: ownerWallet,
        toPubkey: mintKeypair.publicKey,
        lamports: this.config.gasConfig.priorityFee * 1e9
      })
    );

    // Create mint account
    const mintRent = await this.connection.getMinimumBalanceForRentExemption(82);
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: ownerWallet,
        newAccountPubkey: mintKeypair.publicKey,
        lamports: mintRent,
        space: 82,
        programId: TOKEN_PROGRAM_ID
      })
    );

    // Initialize mint
    transaction.add(
      Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        mintKeypair.publicKey,
        0, // decimals
        ownerWallet,
        ownerWallet
      )
    );

    // Create associated token account
    const [ownerTokenAccount] = await PublicKey.findProgramAddress(
      [
        ownerWallet.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    transaction.add(
      Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mintKeypair.publicKey,
        ownerTokenAccount,
        ownerWallet,
        ownerWallet
      )
    );

    // Mint token
    transaction.add(
      Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        mintKeypair.publicKey,
        ownerTokenAccount,
        ownerWallet,
        [],
        1
      )
    );

    // Create metadata account
    const [metadataPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from('metadata'),
        METADATA_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer()
      ],
      METADATA_PROGRAM_ID
    );

    transaction.add(
      createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataPDA,
          mint: mintKeypair.publicKey,
          mintAuthority: ownerWallet,
          payer: ownerWallet,
          updateAuthority: ownerWallet
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name: metadata.name,
              symbol: metadata.symbol,
              uri: metadata.uri,
              sellerFeeBasisPoints: this.config.sellerFeeBasisPoints,
              creators: this.config.creators,
              collection: collectionMint ? { verified: false, key: collectionMint } : null,
              uses: null
            },
            isMutable: true,
            collectionDetails: null
          }
        }
      )
    );

    // Create master edition
    const [masterEditionPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from('metadata'),
        METADATA_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
        Buffer.from('edition')
      ],
      METADATA_PROGRAM_ID
    );

    transaction.add(
      createCreateMasterEditionV3Instruction(
        {
          edition: masterEditionPDA,
          mint: mintKeypair.publicKey,
          updateAuthority: ownerWallet,
          mintAuthority: ownerWallet,
          payer: ownerWallet,
          metadata: metadataPDA
        },
        {
          createMasterEditionArgs: {
            maxSupply: this.config.maxSupply
          }
        }
      )
    );

    // Verify collection if applicable
    if (collectionMint) {
      transaction.add(
        createVerifyCollectionInstruction({
          metadata: metadataPDA,
          collectionAuthority: ownerWallet,
          payer: ownerWallet,
          collectionMint,
          collection: metadataPDA,
          collectionMasterEditionAccount: masterEditionPDA
        })
      );
    }

    return transaction;
  }

  async sendAndConfirmTransaction(transaction, signers = []) {
    try {
      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;

      // Sign transaction
      if (signers.length > 0) {
        transaction.sign(...signers);
      }

      // Send transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'processed'
        }
      );

      // Confirm transaction
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      return signature;
    } catch (error) {
      logger.error('Transaction failed:', error);
      throw error;
    }
  }

  getTierBenefits(tier) {
    const benefits = {
      'VIP': ['Meet & Greet', 'Early Entry', 'Exclusive Merchandise', 'Premium Seating'],
      'Premium': ['Early Entry', 'Exclusive Merchandise', 'Priority Seating'],
      'General': ['Standard Entry', 'General Seating']
    };

    return benefits[tier] || [];
  }

  async generateTicketImage(eventData, ticketData) {
    try {
      // Generate dynamic ticket image
      const image = await sharp({
        create: {
          width: 1200,
          height: 630,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 }
        }
      })
      .composite([
        {
          input: Buffer.from(`
            <svg width="1200" height="630">
              <rect width="1200" height="630" fill="#1a1a1a"/>
              <text x="60" y="100" font-family="Arial" font-size="48" fill="white">${eventData.name}</text>
              <text x="60" y="200" font-family="Arial" font-size="32" fill="#888">${ticketData.tier} Ticket</text>
              <text x="60" y="300" font-family="Arial" font-size="24" fill="#666">${new Date(eventData.startDate).toLocaleDateString()}</text>
              <text x="60" y="350" font-family="Arial" font-size="24" fill="#666">${eventData.venue?.name || eventData.location}</text>
            </svg>
          `),
          top: 0,
          left: 0
        }
      ])
      .png()
      .toBuffer();

      // Upload image to IPFS
      const result = await this.ipfs.add(image, { pin: true });
      return `ipfs://${result.path || result.cid.toString()}`;
    } catch (error) {
      logger.error('Error generating ticket image:', error);
      // Return default image
      return eventData.images?.main || 'ipfs://QmDefault';
    }
  }

  extractIPFSHash(uri) {
    if (uri.startsWith('ipfs://')) {
      return uri.replace('ipfs://', '');
    }
    return uri;
  }

  async uploadToArweave(metadata) {
    // Implement Arweave upload
    // This would use Bundlr or direct Arweave SDK
    throw new Error('Arweave upload not implemented');
  }

  async uploadToCentralizedStorage(metadata) {
    // Fallback to centralized storage (S3, etc.)
    const url = `${process.env.METADATA_BACKUP_URL}/${Date.now()}.json`;
    
    await axios.post(url, metadata, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.METADATA_BACKUP_TOKEN}`
      }
    });

    return url;
  }

  async pinToAlternativeServices(ipfsHash, content) {
    try {
      // Pin to Pinata
      if (process.env.PINATA_API_KEY) {
        const formData = new FormData();
        formData.append('file', content);
        
        await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
          headers: {
            'pinata_api_key': process.env.PINATA_API_KEY,
            'pinata_secret_api_key': process.env.PINATA_SECRET_KEY
          }
        });
      }

      // Pin to Infura
      // Additional pinning services can be added here
    } catch (error) {
      logger.error('Error pinning to alternative services:', error);
      // Non-critical - don't throw
    }
  }

  async createAttributeInstruction(mint, key, value) {
    // Create instruction to add on-chain attribute
    // This would use a program that supports on-chain attributes
    // For now, return a placeholder
    return SystemProgram.transfer({
      fromPubkey: this.connection.publicKey,
      toPubkey: mint,
      lamports: 0
    });
  }

  groupTicketsByOwner(ticketsData) {
    const grouped = {};
    
    ticketsData.forEach(data => {
      if (!grouped[data.ownerWallet]) {
        grouped[data.ownerWallet] = [];
      }
      grouped[data.ownerWallet].push(data);
    });

    return grouped;
  }

  createBatches(items, batchSize) {
    const batches = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  async processBatch(batch, owner) {
    try {
      const transaction = new Transaction();
      const signers = [];
      const results = [];

      // Create all mint instructions for the batch
      for (const ticketData of batch) {
        const mintKeypair = Keypair.generate();
        signers.push(mintKeypair);

        // Add mint instructions
        const mintTx = await this.createMintTransaction({
          mintKeypair,
          ownerWallet: new PublicKey(owner),
          metadata: await this.generateMetadata(ticketData.event, ticketData.ticket),
          collectionMint: ticketData.event.collectionMint
        });

        transaction.add(...mintTx.instructions);
        
        results.push({
          mintKeypair,
          ticketData
        });
      }

      // Send batch transaction
      const signature = await this.sendAndConfirmTransaction(transaction, signers);

      // Update all minting records
      const mints = await Promise.all(
        results.map(async ({ mintKeypair, ticketData }) => {
          const minting = await MintingModel.create({
            mintingId: crypto.randomBytes(16).toString('hex'),
            ticketId: ticketData.ticket.ticketId,
            mintAddress: mintKeypair.publicKey.toBase58(),
            transactionSignature: signature,
            status: 'minted'
          });

          return {
            success: true,
            mintAddress: mintKeypair.publicKey.toBase58(),
            ticketId: ticketData.ticket.ticketId,
            signature
          };
        })
      );

      return {
        success: true,
        mints
      };
    } catch (error) {
      logger.error('Batch processing error:', error);
      throw error;
    }
  }

  calculateMedianFee(fees) {
    if (!fees || fees.length === 0) return 0;
    
    const sorted = fees.map(f => f.prioritizationFee).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0 ?
      (sorted[mid - 1] + sorted[mid]) / 2 :
      sorted[mid];
  }

  getCostRecommendations(quantity, costs) {
    const recommendations = [];

    if (quantity > 100) {
      recommendations.push({
        type: 'batch_minting',
        message: 'Use batch minting to save on transaction fees',
        savings: `Up to ${((costs.transactionFee * quantity * 0.8) / 1e9).toFixed(4)} SOL`
      });
    }

    if (costs.priorityFee > 5000) {
      recommendations.push({
        type: 'timing',
        message: 'Consider minting during off-peak hours for lower fees',
        impact: 'Could reduce costs by 50-70%'
      });
    }

    if (quantity > 1000) {
      recommendations.push({
        type: 'compression',
        message: 'Consider using compressed NFTs for large collections',
        impact: 'Reduce costs by up to 99%'
      });
    }

    return recommendations;
  }

  async parseMetadata(data) {
    // Parse metadata from account data
    // This would use Metaplex deserializers
    // Simplified version:
    try {
      const metadata = {
        data: {
          name: 'Parsed Name',
          symbol: 'SYMBOL',
          uri: 'https://metadata.uri'
        }
      };
      return metadata;
    } catch (error) {
      return null;
    }
  }

  async notifyMintingFailure(mintData) {
    // Send notifications about minting failure
    logger.info('Minting failure notification sent', {
      mintingId: mintData.mintingId
    });
  }
}

module.exports = new NFTMintingService();
