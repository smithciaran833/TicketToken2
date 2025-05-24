const { 
  PublicKey, 
  Keypair, 
  Transaction, 
  SystemProgram,
  SYSVAR_RENT_PUBKEY 
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount
} = require('@solana/spl-token');
const { BN, Program } = require('@coral-xyz/anchor');
const solanaConnection = require('./solanaConnection');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');

// Import your program IDL
const ticketTokenIdl = require('../../contracts/idl/tickettoken.json');

class NFTService {
  constructor() {
    this.programId = new PublicKey(process.env.TICKETTOKEN_PROGRAM_ID || 'TicketToken11111111111111111111111111111111');
    this.cluster = process.env.SOLANA_CLUSTER || 'devnet';
    this.program = null;
    this.provider = null;
    
    this.initializeProgram();
  }

  /**
   * Initialize the ticket token program
   */
  async initializeProgram() {
    try {
      this.provider = solanaConnection.getProvider(this.cluster);
      this.program = solanaConnection.initializeProgram(
        ticketTokenIdl,
        this.programId.toString(),
        this.cluster
      );

      logger.info('NFT Service initialized', {
        programId: this.programId.toString(),
        cluster: this.cluster,
        wallet: this.provider.wallet.publicKey.toString()
      });
    } catch (error) {
      logger.error('Failed to initialize NFT Service', {
        error: error.message,
        stack: error.stack
      });
      throw new AppError('Failed to initialize NFT Service', 500);
    }
  }

  /**
   * Mint a new ticket NFT
   * @param {Object} eventData - Event and ticket information
   * @param {string} buyerWallet - Buyer's wallet address
   * @returns {Object} Minting result with ticket details
   */
  async mintTicket(eventData, buyerWallet) {
    try {
      logger.info('Starting ticket mint process', {
        eventId: eventData.eventId,
        buyerWallet,
        ticketType: eventData.ticketType
      });

      // Validate input data
      this.validateEventData(eventData);
      this.validateWalletAddress(buyerWallet);

      // Generate new ticket mint
      const ticketMint = Keypair.generate();
      const recipient = new PublicKey(buyerWallet);

      // Derive PDAs
      const [programState] = PublicKey.findProgramAddressSync(
        [Buffer.from('program_state')],
        this.programId
      );

      const [ticketData] = PublicKey.findProgramAddressSync(
        [Buffer.from('ticket_data'), ticketMint.publicKey.toBuffer()],
        this.programId
      );

      // Get or create associated token account
      const recipientTokenAccount = await getAssociatedTokenAddress(
        ticketMint.publicKey,
        recipient
      );

      // Prepare ticket metadata
      const metadata = this.formatTicketMetadata(eventData);
      const transferRestrictions = this.formatTransferRestrictions(eventData);
      const contentAccess = this.formatContentAccess(eventData);
      const royaltyRecipients = this.formatRoyaltyRecipients(eventData);

      logger.debug('Prepared mint parameters', {
        ticketMint: ticketMint.publicKey.toString(),
        metadata,
        transferRestrictions,
        contentAccess: contentAccess.length,
        royaltyRecipients: royaltyRecipients.length
      });

      // Create mint instruction
      const mintInstruction = await this.program.methods
        .mintTicket(
          eventData.eventId,
          this.mapTicketType(eventData.ticketType),
          metadata,
          transferRestrictions,
          contentAccess,
          royaltyRecipients
        )
        .accounts({
          programState,
          ticketMint: ticketMint.publicKey,
          ticketData,
          recipientTokenAccount,
          recipient,
          payer: this.provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([ticketMint])
        .instruction();

      // Create transaction
      const transaction = new Transaction().add(mintInstruction);

      // Send transaction
      const signature = await solanaConnection.sendAndConfirmTransaction(
        transaction,
        [ticketMint],
        this.cluster
      );

      const result = {
        success: true,
        ticketId: ticketMint.publicKey.toString(),
        mintAddress: ticketMint.publicKey.toString(),
        owner: buyerWallet,
        eventId: eventData.eventId,
        signature,
        metadata,
        contentAccess: contentAccess.map(ca => ca.contentId),
        timestamp: new Date().toISOString()
      };

      logger.info('Ticket minted successfully', result);
      return result;

    } catch (error) {
      logger.error('Failed to mint ticket', {
        error: error.message,
        eventId: eventData?.eventId,
        buyerWallet,
        stack: error.stack
      });
      throw new AppError(`Failed to mint ticket: ${error.message}`, 500);
    }
  }

  /**
   * Verify ticket ownership
   * @param {string} ticketId - Ticket mint address
   * @param {string} walletAddress - Wallet address to verify
   * @returns {Object} Ownership verification result
   */
  async verifyOwnership(ticketId, walletAddress) {
    try {
      logger.info('Verifying ticket ownership', {
        ticketId,
        walletAddress
      });

      this.validateWalletAddress(walletAddress);
      const ticketMint = new PublicKey(ticketId);
      const wallet = new PublicKey(walletAddress);

      // Get ticket data
      const [ticketData] = PublicKey.findProgramAddressSync(
        [Buffer.from('ticket_data'), ticketMint.toBuffer()],
        this.programId
      );

      const ticketAccount = await this.program.account.ticketData.fetch(ticketData);

      // Get token account
      const tokenAccount = await getAssociatedTokenAddress(ticketMint, wallet);
      
      let tokenAccountInfo;
      try {
        tokenAccountInfo = await getAccount(
          solanaConnection.getConnection(this.cluster),
          tokenAccount
        );
      } catch (error) {
        logger.warn('Token account not found', {
          ticketId,
          walletAddress,
          tokenAccount: tokenAccount.toString()
        });
        return {
          isOwner: false,
          reason: 'Token account not found',
          ticketId,
          walletAddress
        };
      }

      // Verify ownership
      const isOwner = ticketAccount.owner.equals(wallet) && 
                     tokenAccountInfo.amount === BigInt(1);

      const result = {
        isOwner,
        ticketId,
        walletAddress,
        currentOwner: ticketAccount.owner.toString(),
        isUsed: ticketAccount.isUsed,
        isListed: ticketAccount.isListed,
        transferCount: ticketAccount.transferCount,
        mintTimestamp: ticketAccount.mintTimestamp.toNumber(),
        usageTimestamp: ticketAccount.usageTimestamp?.toNumber() || null,
        eventId: ticketAccount.eventId,
        metadata: {
          name: ticketAccount.metadata.name,
          description: ticketAccount.metadata.description,
          venue: ticketAccount.metadata.venue,
          eventDatetime: ticketAccount.metadata.eventDatetime.toNumber()
        }
      };

      logger.debug('Ownership verification completed', result);
      return result;

    } catch (error) {
      logger.error('Failed to verify ownership', {
        error: error.message,
        ticketId,
        walletAddress,
        stack: error.stack
      });
      throw new AppError(`Failed to verify ownership: ${error.message}`, 500);
    }
  }

  /**
   * Transfer ticket from one wallet to another
   * @param {string} fromWallet - Current owner's wallet address
   * @param {string} toWallet - New owner's wallet address
   * @param {string} ticketId - Ticket mint address
   * @param {string} transferType - Type of transfer (Direct, Gift, etc.)
   * @returns {Object} Transfer result
   */
  async transferTicket(fromWallet, toWallet, ticketId, transferType = 'Direct') {
    try {
      logger.info('Starting ticket transfer', {
        ticketId,
        fromWallet,
        toWallet,
        transferType
      });

      this.validateWalletAddress(fromWallet);
      this.validateWalletAddress(toWallet);

      const ticketMint = new PublicKey(ticketId);
      const currentOwner = new PublicKey(fromWallet);
      const newOwner = new PublicKey(toWallet);

      // Verify current ownership first
      const ownershipCheck = await this.verifyOwnership(ticketId, fromWallet);
      if (!ownershipCheck.isOwner) {
        throw new AppError('Sender does not own this ticket', 403);
      }

      // Derive PDAs
      const [programState] = PublicKey.findProgramAddressSync(
        [Buffer.from('program_state')],
        this.programId
      );

      const [ticketData] = PublicKey.findProgramAddressSync(
        [Buffer.from('ticket_data'), ticketMint.toBuffer()],
        this.programId
      );

      // Get token accounts
      const currentOwnerTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        currentOwner
      );

      const newOwnerTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        newOwner
      );

      // Check if new owner needs token account created
      const instructions = [];
      try {
        await getAccount(
          solanaConnection.getConnection(this.cluster),
          newOwnerTokenAccount
        );
      } catch (error) {
        // Create associated token account for new owner
        instructions.push(
          createAssociatedTokenAccountInstruction(
            this.provider.wallet.publicKey,
            newOwnerTokenAccount,
            newOwner,
            ticketMint
          )
        );
      }

      // Create transfer instruction
      const transferInstruction = await this.program.methods
        .transferTicket(this.mapTransferType(transferType))
        .accounts({
          programState,
          ticketData,
          currentOwnerTokenAccount,
          newOwnerTokenAccount,
          currentOwner,
          newOwner,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      instructions.push(transferInstruction);

      // Create transaction
      const transaction = new Transaction().add(...instructions);

      // Note: In production, this would require the current owner's signature
      // For now, assuming the service has permission or using a different flow
      const signature = await solanaConnection.sendAndConfirmTransaction(
        transaction,
        [],
        this.cluster
      );

      const result = {
        success: true,
        ticketId,
        fromWallet,
        toWallet,
        transferType,
        signature,
        timestamp: new Date().toISOString()
      };

      logger.info('Ticket transferred successfully', result);
      return result;

    } catch (error) {
      logger.error('Failed to transfer ticket', {
        error: error.message,
        ticketId,
        fromWallet,
        toWallet,
        transferType,
        stack: error.stack
      });
      throw new AppError(`Failed to transfer ticket: ${error.message}`, 500);
    }
  }

  /**
   * Get ticket metadata and details
   * @param {string} ticketId - Ticket mint address
   * @returns {Object} Ticket metadata and information
   */
  async getTicketMetadata(ticketId) {
    try {
      logger.info('Retrieving ticket metadata', { ticketId });

      const ticketMint = new PublicKey(ticketId);

      // Get ticket data
      const [ticketData] = PublicKey.findProgramAddressSync(
        [Buffer.from('ticket_data'), ticketMint.toBuffer()],
        this.programId
      );

      const ticketAccount = await this.program.account.ticketData.fetch(ticketData);

      const metadata = {
        ticketId,
        mintAddress: ticketAccount.mint.toString(),
        owner: ticketAccount.owner.toString(),
        originalOwner: ticketAccount.originalOwner.toString(),
        eventId: ticketAccount.eventId,
        ticketType: this.unmapTicketType(ticketAccount.ticketType),
        metadata: {
          name: ticketAccount.metadata.name,
          description: ticketAccount.metadata.description,
          imageUri: ticketAccount.metadata.imageUri,
          externalUri: ticketAccount.metadata.externalUri,
          venue: ticketAccount.metadata.venue,
          eventDatetime: new Date(ticketAccount.metadata.eventDatetime.toNumber() * 1000),
          seatInfo: ticketAccount.metadata.seatInfo ? {
            section: ticketAccount.metadata.seatInfo.section,
            row: ticketAccount.metadata.seatInfo.row,
            seatNumber: ticketAccount.metadata.seatInfo.seatNumber
          } : null,
          attributes: ticketAccount.metadata.attributes.map(attr => ({
            traitType: attr.traitType,
            value: attr.value
          }))
        },
        transferRestrictions: {
          transferType: this.unmapTransferType(ticketAccount.transferRestrictions.transferType),
          maxTransfers: ticketAccount.transferRestrictions.maxTransfers,
          transferFeeBps: ticketAccount.transferRestrictions.transferFeeBps,
          originalOwnerRoyalty: ticketAccount.transferRestrictions.originalOwnerRoyalty
        },
        contentAccess: ticketAccount.contentAccess.map(access => ({
          contentId: access.contentId,
          accessLevel: this.unmapAccessLevel(access.accessLevel),
          expiryTimestamp: access.expiryTimestamp ? 
            new Date(access.expiryTimestamp.toNumber() * 1000) : null,
          isActive: access.isActive
        })),
        royaltyRecipients: ticketAccount.royaltyRecipients.map(recipient => ({
          recipient: recipient.recipient.toString(),
          percentageBps: recipient.percentageBps,
          role: recipient.role
        })),
        status: {
          isUsed: ticketAccount.isUsed,
          isListed: ticketAccount.isListed,
          transferCount: ticketAccount.transferCount,
          mintTimestamp: new Date(ticketAccount.mintTimestamp.toNumber() * 1000),
          usageTimestamp: ticketAccount.usageTimestamp ? 
            new Date(ticketAccount.usageTimestamp.toNumber() * 1000) : null
        }
      };

      logger.debug('Ticket metadata retrieved', {
        ticketId,
        eventId: metadata.eventId,
        owner: metadata.owner
      });

      return metadata;

    } catch (error) {
      logger.error('Failed to get ticket metadata', {
        error: error.message,
        ticketId,
        stack: error.stack
      });
      throw new AppError(`Failed to get ticket metadata: ${error.message}`, 500);
    }
  }

  /**
   * Grant content access to a ticket holder
   * @param {string} ticketId - Ticket mint address
   * @param {Array<string>} contentIds - Array of content IDs to grant access to
   * @param {string} accessLevel - Access level to grant
   * @returns {Object} Content access grant result
   */
  async grantContentAccess(ticketId, contentIds, accessLevel = 'Basic') {
    try {
      logger.info('Granting content access', {
        ticketId,
        contentIds,
        accessLevel
      });

      const ticketMint = new PublicKey(ticketId);

      // Get ticket data
      const ticketMetadata = await this.getTicketMetadata(ticketId);
      const owner = new PublicKey(ticketMetadata.owner);

      // Derive PDAs
      const [programState] = PublicKey.findProgramAddressSync(
        [Buffer.from('program_state')],
        this.programId
      );

      const [ticketData] = PublicKey.findProgramAddressSync(
        [Buffer.from('ticket_data'), ticketMint.toBuffer()],
        this.programId
      );

      // Get owner's token account
      const ownerTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        owner
      );

      const results = [];

      // Grant access for each content ID
      for (const contentId of contentIds) {
        try {
          const grantInstruction = await this.program.methods
            .grantContentAccess(
              contentId,
              this.mapAccessLevel(accessLevel)
            )
            .accounts({
              programState,
              ticketData,
              ownerTokenAccount,
              authority: this.provider.wallet.publicKey,
            })
            .instruction();

          const transaction = new Transaction().add(grantInstruction);

          const signature = await solanaConnection.sendAndConfirmTransaction(
            transaction,
            [],
            this.cluster
          );

          results.push({
            contentId,
            success: true,
            signature,
            accessLevel
          });

          logger.debug('Content access granted', {
            ticketId,
            contentId,
            accessLevel,
            signature
          });

        } catch (error) {
          logger.warn('Failed to grant access to content', {
            ticketId,
            contentId,
            error: error.message
          });

          results.push({
            contentId,
            success: false,
            error: error.message
          });
        }
      }

      const result = {
        ticketId,
        accessLevel,
        results,
        successCount: results.filter(r => r.success).length,
        totalCount: contentIds.length,
        timestamp: new Date().toISOString()
      };

      logger.info('Content access grant completed', result);
      return result;

    } catch (error) {
      logger.error('Failed to grant content access', {
        error: error.message,
        ticketId,
        contentIds,
        accessLevel,
        stack: error.stack
      });
      throw new AppError(`Failed to grant content access: ${error.message}`, 500);
    }
  }

  /**
   * Check if a wallet has access to specific content
   * @param {string} walletAddress - Wallet address to check
   * @param {string} contentId - Content ID to check access for
   * @returns {Object} Content access verification result
   */
  async checkContentAccess(walletAddress, contentId) {
    try {
      logger.info('Checking content access', {
        walletAddress,
        contentId
      });

      this.validateWalletAddress(walletAddress);
      const wallet = new PublicKey(walletAddress);

      // Get all tickets owned by the wallet
      const programAccounts = await solanaConnection.getProgramAccounts(
        this.programId,
        [
          {
            memcmp: {
              offset: 8 + 32, // Skip discriminator + mint
              bytes: wallet.toBase58()
            }
          }
        ],
        this.cluster
      );

      const accessibleContent = [];

      // Check each ticket for content access
      for (const accountInfo of programAccounts) {
        try {
          const ticketData = this.program.coder.accounts.decode(
            'ticketData',
            accountInfo.account.data
          );

          // Check if ticket is valid (not used, not expired)
          if (ticketData.isUsed) {
            continue;
          }

          // Find content access for this content ID
          const contentAccess = ticketData.contentAccess.find(
            access => access.contentId === contentId && access.isActive
          );

          if (contentAccess) {
            // Check if access has expired
            if (contentAccess.expiryTimestamp) {
              const currentTime = Math.floor(Date.now() / 1000);
              if (contentAccess.expiryTimestamp.toNumber() < currentTime) {
                continue;
              }
            }

            accessibleContent.push({
              ticketId: ticketData.mint.toString(),
              contentId,
              accessLevel: this.unmapAccessLevel(contentAccess.accessLevel),
              expiryTimestamp: contentAccess.expiryTimestamp ? 
                new Date(contentAccess.expiryTimestamp.toNumber() * 1000) : null,
              eventId: ticketData.eventId,
              ticketType: this.unmapTicketType(ticketData.ticketType)
            });
          }
        } catch (error) {
          logger.warn('Failed to decode ticket data', {
            error: error.message,
            accountPubkey: accountInfo.pubkey.toString()
          });
        }
      }

      const hasAccess = accessibleContent.length > 0;
      const result = {
        walletAddress,
        contentId,
        hasAccess,
        accessDetails: accessibleContent,
        ticketCount: accessibleContent.length,
        timestamp: new Date().toISOString()
      };

      logger.debug('Content access check completed', result);
      return result;

    } catch (error) {
      logger.error('Failed to check content access', {
        error: error.message,
        walletAddress,
        contentId,
        stack: error.stack
      });
      throw new AppError(`Failed to check content access: ${error.message}`, 500);
    }
  }

  /**
   * Use a ticket for event entry
   * @param {string} ticketId - Ticket mint address
   * @param {string} walletAddress - Ticket owner's wallet
   * @param {string} verificationCode - Event verification code
   * @returns {Object} Ticket usage result
   */
  async useTicket(ticketId, walletAddress, verificationCode) {
    try {
      logger.info('Using ticket for event entry', {
        ticketId,
        walletAddress,
        verificationCode: verificationCode.substring(0, 8) + '...'
      });

      this.validateWalletAddress(walletAddress);
      const ticketMint = new PublicKey(ticketId);
      const owner = new PublicKey(walletAddress);

      // Verify ownership first
      const ownershipCheck = await this.verifyOwnership(ticketId, walletAddress);
      if (!ownershipCheck.isOwner) {
        throw new AppError('Wallet does not own this ticket', 403);
      }

      if (ownershipCheck.isUsed) {
        throw new AppError('Ticket has already been used', 400);
      }

      // Derive PDAs
      const [programState] = PublicKey.findProgramAddressSync(
        [Buffer.from('program_state')],
        this.programId
      );

      const [ticketData] = PublicKey.findProgramAddressSync(
        [Buffer.from('ticket_data'), ticketMint.toBuffer()],
        this.programId
      );

      // Get owner's token account
      const ownerTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        owner
      );

      // Create use ticket instruction
      const useInstruction = await this.program.methods
        .useTicket(verificationCode)
        .accounts({
          programState,
          ticketData,
          ownerTokenAccount,
          owner,
          verifier: this.provider.wallet.publicKey, // Event verifier
        })
        .instruction();

      const transaction = new Transaction().add(useInstruction);

      const signature = await solanaConnection.sendAndConfirmTransaction(
        transaction,
        [],
        this.cluster
      );

      const result = {
        success: true,
        ticketId,
        walletAddress,
        signature,
        usageTimestamp: new Date().toISOString(),
        eventId: ownershipCheck.eventId
      };

      logger.info('Ticket used successfully', result);
      return result;

    } catch (error) {
      logger.error('Failed to use ticket', {
        error: error.message,
        ticketId,
        walletAddress,
        stack: error.stack
      });
      throw new AppError(`Failed to use ticket: ${error.message}`, 500);
    }
  }

  /**
   * Get all tickets owned by a wallet
   * @param {string} walletAddress - Wallet address
   * @returns {Array} Array of ticket information
   */
  async getWalletTickets(walletAddress) {
    try {
      logger.info('Getting wallet tickets', { walletAddress });

      this.validateWalletAddress(walletAddress);
      const wallet = new PublicKey(walletAddress);

      // Get all ticket data accounts owned by the wallet
      const programAccounts = await solanaConnection.getProgramAccounts(
        this.programId,
        [
          {
            memcmp: {
              offset: 8 + 32, // Skip discriminator + mint
              bytes: wallet.toBase58()
            }
          }
        ],
        this.cluster
      );

      const tickets = [];

      for (const accountInfo of programAccounts) {
        try {
          const ticketData = this.program.coder.accounts.decode(
            'ticketData',
            accountInfo.account.data
          );

          tickets.push({
            ticketId: ticketData.mint.toString(),
            eventId: ticketData.eventId,
            name: ticketData.metadata.name,
            venue: ticketData.metadata.venue,
            eventDatetime: new Date(ticketData.metadata.eventDatetime.toNumber() * 1000),
            ticketType: this.unmapTicketType(ticketData.ticketType),
            isUsed: ticketData.isUsed,
            isListed: ticketData.isListed,
            mintTimestamp: new Date(ticketData.mintTimestamp.toNumber() * 1000),
            transferCount: ticketData.transferCount
          });
        } catch (error) {
          logger.warn('Failed to decode ticket data', {
            error: error.message,
            accountPubkey: accountInfo.pubkey.toString()
          });
        }
      }

      logger.debug('Wallet tickets retrieved', {
        walletAddress,
        ticketCount: tickets.length
      });

      return tickets;

    } catch (error) {
      logger.error('Failed to get wallet tickets', {
        error: error.message,
        walletAddress,
        stack: error.stack
      });
      throw new AppError(`Failed to get wallet tickets: ${error.message}`, 500);
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Validate event data
   * @param {Object} eventData - Event data to validate
   */
  validateEventData(eventData) {
    const required = ['eventId', 'name', 'description', 'venue', 'eventDatetime'];
    for (const field of required) {
      if (!eventData[field]) {
        throw new AppError(`Missing required field: ${field}`, 400);
      }
    }

    if (new Date(eventData.eventDatetime) < new Date()) {
      throw new AppError('Event datetime cannot be in the past', 400);
    }
  }

  /**
   * Validate wallet address
   * @param {string} walletAddress - Wallet address to validate
   */
  validateWalletAddress(walletAddress) {
    try {
      new PublicKey(walletAddress);
    } catch (error) {
      throw new AppError('Invalid wallet address format', 400);
    }
  }

  /**
   * Format ticket metadata for program
   * @param {Object} eventData - Event data
   * @returns {Object} Formatted metadata
   */
  formatTicketMetadata(eventData) {
    return {
      name: eventData.name.substring(0, 32),
      description: eventData.description.substring(0, 256),
      imageUri: eventData.imageUri || '',
      externalUri: eventData.externalUri || null,
      seatInfo: eventData.seatInfo ? {
        section: eventData.seatInfo.section.substring(0, 16),
        row: eventData.seatInfo.row.substring(0, 8),
        seatNumber: eventData.seatInfo.seatNumber.substring(0, 8)
      } : null,
      eventDatetime: new BN(Math.floor(new Date(eventData.eventDatetime).getTime() / 1000)),
      venue: eventData.venue.substring(0, 64),
      attributes: (eventData.attributes || []).map(attr => ({
        traitType: attr.traitType.substring(0, 32),
        value: attr.value.substring(0, 32)
      }))
    };
  }

  /**
   * Format transfer restrictions
   * @param {Object} eventData - Event data
   * @returns {Object} Transfer restrictions
   */
  formatTransferRestrictions(eventData) {
    return {
      transferType: this.mapTransferType(eventData.transferType || 'FreeTransfer'),
      maxTransfers: eventData.maxTransfers || null,
      allowedRecipients: eventData.allowedRecipients ? 
        eventData.allowedRecipients.map(addr => new PublicKey(addr)) : null,
      transferFeeBps: eventData.transferFeeBps || 0,
      originalOwnerRoyalty: eventData.originalOwnerRoyalty || false
    };
  }

  /**
   * Format content access array
   * @param {Object} eventData - Event data
   * @returns {Array} Content access array
   */
  formatContentAccess(eventData) {
    return (eventData.contentAccess || []).map(access => ({
      contentId: access.contentId,
      accessLevel: this.mapAccessLevel(access.accessLevel || 'Basic'),
      expiryTimestamp: access.expiryTimestamp ? 
        new BN(Math.floor(new Date(access.expiryTimestamp).getTime() / 1000)) : null,
      isActive: true
    }));
  }

  /**
   * Format royalty recipients
   * @param {Object} eventData - Event data
   * @returns {Array} Royalty recipients array
   */
  formatRoyaltyRecipients(eventData) {
    const recipients = eventData.royaltyRecipients || [];
    
    // Ensure percentages sum to 100%
    const totalPercentage = recipients.reduce((sum, r) => sum + r.percentageBps, 0);
    if (recipients.length > 0 && totalPercentage !== 10000) {
      throw new AppError('Royalty percentages must sum to 100% (10000 basis points)', 400);
    }

    return recipients.map(recipient => ({
      recipient: new PublicKey(recipient.recipient),
      percentageBps: recipient.percentageBps,
      role: recipient.role.substring(0, 32)
    }));
  }

  /**
   * Map ticket type to program enum
   * @param {string} ticketType - Ticket type string
   * @returns {Object} Program ticket type
   */
  mapTicketType(ticketType) {
    const typeMap = {
      'general': { generalAdmission: {} },
      'reserved': { reservedSeating: {} },
      'vip': { vip: {} },
      'backstage': { backstagePass: {} },
      'press': { press: {} },
      'artist': { artist: {} },
      'staff': { staff: {} },
      'season': { seasonPass: {} }
    };

    return typeMap[ticketType.toLowerCase()] || { custom: ticketType };
  }

  /**
   * Unmap ticket type from program enum
   * @param {Object} ticketType - Program ticket type
   * @returns {string} Ticket type string
   */
  unmapTicketType(ticketType) {
    if (ticketType.generalAdmission) return 'general';
    if (ticketType.reservedSeating) return 'reserved';
    if (ticketType.vip) return 'vip';
    if (ticketType.backstagePass) return 'backstage';
    if (ticketType.press) return 'press';
    if (ticketType.artist) return 'artist';
    if (ticketType.staff) return 'staff';
    if (ticketType.seasonPass) return 'season';
    if (ticketType.custom) return ticketType.custom;
    return 'unknown';
  }

  /**
   * Map transfer type to program enum
   * @param {string} transferType - Transfer type string
   * @returns {Object} Program transfer type
   */
  mapTransferType(transferType) {
    const typeMap = {
      'NoTransfer': { noTransfer: {} },
      'OwnerOnly': { ownerOnly: {} },
      'FreeTransfer': { freeTransfer: {} },
      'RestrictedTransfer': { restrictedTransfer: {} },
      'Direct': { direct: {} },
      'MarketplaceSale': { marketplaceSale: {} },
      'Gift': { gift: {} },
      'EventEntry': { eventEntry: {} }
    };

    return typeMap[transferType] || { freeTransfer: {} };
  }

  /**
   * Unmap transfer type from program enum
   * @param {Object} transferType - Program transfer type
   * @returns {string} Transfer type string
   */
  unmapTransferType(transferType) {
    if (transferType.noTransfer) return 'NoTransfer';
    if (transferType.ownerOnly) return 'OwnerOnly';
    if (transferType.freeTransfer) return 'FreeTransfer';
    if (transferType.restrictedTransfer) return 'RestrictedTransfer';
    if (transferType.direct) return 'Direct';
    if (transferType.marketplaceSale) return 'MarketplaceSale';
    if (transferType.gift) return 'Gift';
    if (transferType.eventEntry) return 'EventEntry';
    return 'unknown';
  }

  /**
   * Map access level to program enum
   * @param {string} accessLevel - Access level string
   * @returns {Object} Program access level
   */
  mapAccessLevel(accessLevel) {
    const levelMap = {
      'Basic': { basic: {} },
      'Premium': { premium: {} },
      'VIP': { vip: {} },
      'Exclusive': { exclusive: {} },
      'Backstage': { backstage: {} }
    };

    return levelMap[accessLevel] || { basic: {} };
  }

  /**
   * Unmap access level from program enum
   * @param {Object} accessLevel - Program access level
   * @returns {string} Access level string
   */
  unmapAccessLevel(accessLevel) {
    if (accessLevel.basic) return 'Basic';
    if (accessLevel.premium) return 'Premium';
    if (accessLevel.vip) return 'VIP';
    if (accessLevel.exclusive) return 'Exclusive';
    if (accessLevel.backstage) return 'Backstage';
    return 'Basic';
  }

  /**
   * Generate verification code for ticket usage
   * @param {string} eventId - Event ID
   * @param {string} ticketId - Ticket ID
   * @returns {string} Verification code
   */
  generateVerificationCode(eventId, ticketId) {
    return `${eventId}_${ticketId.substring(0, 8)}`;
  }

  /**
   * Get service status and statistics
   * @returns {Object} Service status
   */
  async getServiceStatus() {
    try {
      const connectionHealth = await solanaConnection.testConnection(this.cluster);
      
      return {
        service: 'NFTService',
        status: 'operational',
        cluster: this.cluster,
        programId: this.programId.toString(),
        provider: {
          wallet: this.provider?.wallet.publicKey.toString(),
          cluster: this.cluster
        },
        connection: connectionHealth,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        service: 'NFTService',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Batch mint tickets for bulk operations
   * @param {Array} ticketDataArray - Array of ticket data
   * @returns {Array} Array of minting results
   */
  async batchMintTickets(ticketDataArray) {
    try {
      logger.info('Starting batch ticket mint', {
        count: ticketDataArray.length
      });

      const results = [];
      const batchSize = 5; // Process in batches to avoid overwhelming

      for (let i = 0; i < ticketDataArray.length; i += batchSize) {
        const batch = ticketDataArray.slice(i, i + batchSize);
        const batchPromises = batch.map(async (ticketData, index) => {
          try {
            const result = await this.mintTicket(ticketData.eventData, ticketData.buyerWallet);
            return { index: i + index, success: true, ...result };
          } catch (error) {
            logger.error('Batch mint failed for ticket', {
              index: i + index,
              error: error.message,
              eventId: ticketData.eventData?.eventId
            });
            return { 
              index: i + index, 
              success: false, 
              error: error.message,
              eventId: ticketData.eventData?.eventId 
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Small delay between batches
        if (i + batchSize < ticketDataArray.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const summary = {
        total: ticketDataArray.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
        timestamp: new Date().toISOString()
      };

      logger.info('Batch ticket mint completed', summary);
      return summary;

    } catch (error) {
      logger.error('Batch mint operation failed', {
        error: error.message,
        count: ticketDataArray.length
      });
      throw new AppError(`Batch mint failed: ${error.message}`, 500);
    }
  }

  /**
   * Get event tickets statistics
   * @param {string} eventId - Event ID
   * @returns {Object} Event ticket statistics
   */
  async getEventTicketStats(eventId) {
    try {
      logger.info('Getting event ticket statistics', { eventId });

      // Get all tickets for the event
      const programAccounts = await solanaConnection.getProgramAccounts(
        this.programId,
        [],
        this.cluster
      );

      const eventTickets = [];
      let totalMinted = 0;
      let totalUsed = 0;
      let totalListed = 0;
      let totalTransferred = 0;

      for (const accountInfo of programAccounts) {
        try {
          const ticketData = this.program.coder.accounts.decode(
            'ticketData',
            accountInfo.account.data
          );

          if (ticketData.eventId === eventId) {
            totalMinted++;
            if (ticketData.isUsed) totalUsed++;
            if (ticketData.isListed) totalListed++;
            totalTransferred += ticketData.transferCount;

            eventTickets.push({
              ticketId: ticketData.mint.toString(),
              owner: ticketData.owner.toString(),
              ticketType: this.unmapTicketType(ticketData.ticketType),
              isUsed: ticketData.isUsed,
              isListed: ticketData.isListed,
              transferCount: ticketData.transferCount,
              mintTimestamp: new Date(ticketData.mintTimestamp.toNumber() * 1000)
            });
          }
        } catch (error) {
          // Skip accounts that can't be decoded
          continue;
        }
      }

      const stats = {
        eventId,
        totalMinted,
        totalUsed,
        totalListed,
        totalActive: totalMinted - totalUsed,
        totalTransferred,
        averageTransfersPerTicket: totalMinted > 0 ? totalTransferred / totalMinted : 0,
        usageRate: totalMinted > 0 ? (totalUsed / totalMinted) * 100 : 0,
        listingRate: totalMinted > 0 ? (totalListed / totalMinted) * 100 : 0,
        tickets: eventTickets,
        timestamp: new Date().toISOString()
      };

      logger.debug('Event ticket statistics retrieved', {
        eventId,
        totalMinted,
        totalUsed,
        totalListed
      });

      return stats;

    } catch (error) {
      logger.error('Failed to get event ticket statistics', {
        error: error.message,
        eventId,
        stack: error.stack
      });
      throw new AppError(`Failed to get event ticket statistics: ${error.message}`, 500);
    }
  }
}

// Create singleton instance
const nftService = new NFTService();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down NFT Service...');
});

process.on('SIGINT', async () => {
  logger.info('Shutting down NFT Service...');
});

module.exports = nftService;
