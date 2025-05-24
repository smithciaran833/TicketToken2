/**
 * TicketToken Transfer Client
 * 
 * This module provides functions for transferring NFT tickets and
 * managing the secondary marketplace.
 */

import {
  PublicKey,
  Connection,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
  TransactionInstruction,
  Signer,
} from '@solana/web3.js';

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

import { BorshCoder, Program } from '@project-serum/anchor';
import { TicketMinter } from '../target/types/ticket_minter';
import { IDL } from '../target/types/ticket_minter';

/**
 * Transfer listing information
 */
export interface TransferListing {
  listingAddress: PublicKey;
  ticketMint: PublicKey;
  owner: PublicKey;
  price: number;
  createdAt: Date;
  expiry?: Date;
  isActive: boolean;
  eventName?: string;
  eventId?: string;
  ticketType?: string;
}

/**
 * Transfer result information
 */
export interface TransferResult {
  success: boolean;
  signature?: string;
  ticketMint?: string;
  from?: string;
  to?: string;
  price?: number;
  error?: string;
}

/**
 * TicketToken transfer client for managing ticket transfers
 */
export class TransferClient {
  private program: Program<TicketMinter>;
  private connection: Connection;
  
  /**
   * Creates a new transfer client
   * 
   * @param connection - Solana connection
   * @param wallet - Anchor wallet
   * @param programId - Program ID (optional, defaults to IDL's ID)
   */
  constructor(
    connection: Connection,
    private wallet: any,
    programId?: PublicKey
  ) {
    this.connection = connection;
    
    // Initialize program
    this.program = new Program<TicketMinter>(
      IDL,
      programId || new PublicKey(IDL.metadata.address),
      { connection, wallet }
    );
  }
  
  /**
   * Transfers a ticket to a new owner
   * 
   * @param params - Transfer parameters
   * @returns Transfer result
   */
  async transferTicket(params: {
    ticketMint: PublicKey;
    toAddress: PublicKey;
    price?: number;
  }): Promise<TransferResult> {
    try {
      const { ticketMint, toAddress, price = 0 } = params;
      
      // Find ticket PDA
      const [ticketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), ticketMint.toBuffer()],
        this.program.programId
      );
      
      // Get token accounts
      const fromTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        this.wallet.publicKey
      );
      
      const toTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        toAddress
      );
      
      // Check if destination token account exists
      const toTokenAccountInfo = await this.connection.getAccountInfo(toTokenAccount);
      
      // Create transaction
      const transaction = new Transaction();
      
      // If destination token account doesn't exist, create it
      if (!toTokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.wallet.publicKey,
            toTokenAccount,
            toAddress,
            ticketMint
          )
        );
      }
      
      // Add transfer instruction
      const transferIx = await this.program.methods
        .transferTicket()
        .accounts({
          ticket: ticketPda,
          mint: ticketMint,
          fromTokenAccount,
          toTokenAccount,
          from: this.wallet.publicKey,
          to: toAddress,
          tokenProgram: TOKEN_PROGRAM_ID,
          paymentAmount: price,
        })
        .instruction();
      
      transaction.add(transferIx);
      
      // Send transaction
      const signature = await this.wallet.sendTransaction(transaction, this.connection);
      await this.connection.confirmTransaction(signature, 'confirmed');
      
      return {
        success: true,
        signature,
        ticketMint: ticketMint.toString(),
        from: this.wallet.publicKey.toString(),
        to: toAddress.toString(),
        price,
      };
    } catch (error) {
      console.error('Error transferring ticket:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Creates a transfer listing
   * 
   * @param params - Listing parameters
   * @returns Listing public key
   */
  async createListing(params: {
    ticketMint: PublicKey;
    price: number;
    allowDirectTransfer?: boolean;
  }): Promise<PublicKey> {
    const { ticketMint, price, allowDirectTransfer = true } = params;
    
    // Find ticket PDA
    const [ticketPda] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket'), ticketMint.toBuffer()],
      this.program.programId
    );
    
    // Find listing PDA
    const [listingPda] = await PublicKey.findProgramAddress(
      [Buffer.from('transfer_listing'), ticketPda.toBuffer()],
      this.program.programId
    );
    
    // Create listing
    await this.program.methods
      .createTransferListing(
        new anchor.BN(price),
        allowDirectTransfer
      )
      .accounts({
        ticket: ticketPda,
        listing: listingPda,
        owner: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    return listingPda;
  }
  
  /**
   * Cancels a transfer listing
   * 
   * @param params - Cancellation parameters
   * @returns Transaction signature
   */
  async cancelListing(params: {
    ticketMint: PublicKey;
  }): Promise<string> {
    const { ticketMint } = params;
    
    // Find ticket PDA
    const [ticketPda] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket'), ticketMint.toBuffer()],
      this.program.programId
    );
    
    // Find listing PDA
    const [listingPda] = await PublicKey.findProgramAddress(
      [Buffer.from('transfer_listing'), ticketPda.toBuffer()],
      this.program.programId
    );
    
    // Cancel listing
    const signature = await this.program.methods
      .cancelTransferListing()
      .accounts({
        ticket: ticketPda,
        listing: listingPda,
        owner: this.wallet.publicKey,
      })
      .rpc();
    
    return signature;
  }
  
  /**
   * Accepts a transfer listing (buys a ticket)
   * 
   * @param params - Purchase parameters
   * @returns Transfer result
   */
  async acceptListing(params: {
    listingAddress: PublicKey;
    ticketMint: PublicKey;
    seller: PublicKey;
    paymentTokenMint?: PublicKey;
  }): Promise<TransferResult> {
    try {
      const { 
        listingAddress, 
        ticketMint, 
        seller,
        paymentTokenMint 
      } = params;
      
      // Find ticket PDA
      const [ticketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), ticketMint.toBuffer()],
        this.program.programId
      );
      
      // Get token accounts for NFT
      const fromTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        seller
      );
      
      const toTokenAccount = await getAssociatedTokenAddress(
        ticketMint,
        this.wallet.publicKey
      );
      
      // Check if destination token account exists
      const toTokenAccountInfo = await this.connection.getAccountInfo(toTokenAccount);
      
      // Get payment token accounts
      // Default to SOL if not specified
      const paymentMint = paymentTokenMint || new PublicKey('So11111111111111111111111111111111111111112');
      
      const paymentFromAccount = await getAssociatedTokenAddress(
        paymentMint,
        this.wallet.publicKey
      );
      
      const paymentToAccount = await getAssociatedTokenAddress(
        paymentMint,
        seller
      );
      
      // Create transaction
      const transaction = new Transaction();
      
      // If destination token account doesn't exist, create it
      if (!toTokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.wallet.publicKey,
            toTokenAccount,
            this.wallet.publicKey,
            ticketMint
          )
        );
      }
      
      // Add accept listing instruction
      const acceptIx = await this.program.methods
        .acceptTransferListing()
        .accounts({
          ticket: ticketPda,
          listing: listingAddress,
          mint: ticketMint,
          fromTokenAccount,
          toTokenAccount,
          seller,
          buyer: this.wallet.publicKey,
          paymentFromAccount,
          paymentToAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .instruction();
      
      transaction.add(acceptIx);
      
      // Send transaction
      const signature = await this.wallet.sendTransaction(transaction, this.connection);
      await this.connection.confirmTransaction(signature, 'confirmed');
      
      // Get listing data for price info
      const listingData = await this.program.account.transferListing.fetch(listingAddress);
      
      return {
        success: true,
        signature,
        ticketMint: ticketMint.toString(),
        from: seller.toString(),
        to: this.wallet.publicKey.toString(),
        price: listingData.price.toNumber(),
      };
    } catch (error) {
      console.error('Error accepting listing:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Sets a ticket's transferability
   * 
   * @param params - Transferability parameters
   * @returns Transaction signature
   */
  async setTicketTransferability(params: {
    ticketMint: PublicKey;
    eventId: PublicKey;
    transferable: boolean;
  }): Promise<string> {
    const { ticketMint, eventId, transferable } = params;
    
    // Find ticket PDA
    const [ticketPda] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket'), ticketMint.toBuffer()],
      this.program.programId
    );
    
    // Set transferability
    const signature = await this.program.methods
      .setTicketTransferability(transferable)
      .accounts({
        event: eventId,
        ticket: ticketPda,
        organizer: this.wallet.publicKey,
      })
      .rpc();
    
    return signature;
  }
  
  /**
   * Gets all listings for an event
   * 
   * @param eventId - Event public key
   * @returns Array of transfer listings
   */
  async getEventListings(eventId: PublicKey): Promise<TransferListing[]> {
    // Get all listings that reference this event
    const listings = await this.program.account.transferListing.all([
      {
        memcmp: {
          offset: 8 + 32 + 32, // discriminator + ticket + owner
          bytes: eventId.toBase58(),
        }
      }
    ]);
    
    // Format listings
    return listings.map(listing => ({
      listingAddress: listing.publicKey,
      ticketMint: listing.account.ticket,
      owner: listing.account.owner,
      price: listing.account.price.toNumber(),
      createdAt: new Date(listing.account.createdAt.toNumber() * 1000),
      expiry: listing.account.expiry ? new Date(listing.account.expiry.toNumber() * 1000) : undefined,
      isActive: listing.account.active,
    }));
  }
  
  /**
   * Gets all listings from a specific seller
   * 
   * @param seller - Seller public key
   * @returns Array of transfer listings
   */
  async getSellerListings(seller: PublicKey): Promise<TransferListing[]> {
    // Get all listings from this seller
    const listings = await this.program.account.transferListing.all([
      {
        memcmp: {
          offset: 8 + 32, // discriminator + ticket
          bytes: seller.toBase58(),
        }
      }
    ]);
    
    // Format listings
    return listings.map(listing => ({
      listingAddress: listing.publicKey,
      ticketMint: listing.account.ticket,
      owner: listing.account.owner,
      price: listing.account.price.toNumber(),
      createdAt: new Date(listing.account.createdAt.toNumber() * 1000),
      expiry: listing.account.expiry ? new Date(listing.account.expiry.toNumber() * 1000) : undefined,
      isActive: listing.account.active,
    }));
  }
  
  /**
   * Gets the listing for a specific ticket
   * 
   * @param ticketMint - Ticket mint address
   * @returns Transfer listing or null if not found
   */
  async getTicketListing(ticketMint: PublicKey): Promise<TransferListing | null> {
    try {
      // Find ticket PDA
      const [ticketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), ticketMint.toBuffer()],
        this.program.programId
      );
      
      // Find listing PDA
      const [listingPda] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_listing'), ticketPda.toBuffer()],
        this.program.programId
      );
      
      // Get listing data
      const listingData = await this.program.account.transferListing.fetch(listingPda);
      
      // Check if listing is active
      if (!listingData.active) {
        return null;
      }
      
      // Format listing
      return {
        listingAddress: listingPda,
        ticketMint,
        owner: listingData.owner,
        price: listingData.price.toNumber(),
        createdAt: new Date(listingData.createdAt.toNumber() * 1000),
        expiry: listingData.expiry ? new Date(listingData.expiry.toNumber() * 1000) : undefined,
        isActive: listingData.active,
      };
    } catch (error) {
      // Listing doesn't exist
      return null;
    }
  }
  
  /**
   * Gets the transfer history for a ticket
   * 
   * @param ticketMint - Ticket mint address
   * @returns Array of transfer details
   */
  async getTicketTransferHistory(ticketMint: PublicKey): Promise<any[]> {
    try {
      // Find ticket PDA
      const [ticketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), ticketMint.toBuffer()],
        this.program.programId
      );
      
      // Find transfer record PDA
      const [recordPda] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_record'), ticketPda.toBuffer()],
        this.program.programId
      );
      
      // Get record data
      const recordData = await this.program.account.transferRecord.fetch(recordPda);
      
      // Format history
      return recordData.history.map(entry => ({
        from: entry.from.toString(),
        to: entry.to.toString(),
        price: entry.price.toNumber(),
        timestamp: new Date(entry.timestamp.toNumber() * 1000),
        type: getTransferTypeString(entry.transferType),
      }));
    } catch (error) {
      // Record doesn't exist or another error
      return [];
    }
  }
}

/**
 * Helper function to convert transfer type to string
 */
function getTransferTypeString(transferType: any): string {
  if (transferType.mint) return 'Mint';
  if (transferType.gift) return 'Gift';
  if (transferType.sale) return 'Sale';
  if (transferType.distribution) return 'Distribution';
  return 'Unknown';
}
