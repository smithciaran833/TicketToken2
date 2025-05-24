import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

// Import program types
import { TicketMinter } from '../target/types/ticket_minter';
import { IDL } from '../target/types/ticket_minter';

// Metaplex imports
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * TicketToken client for interacting with the minting contract
 */
export class TicketTokenClient {
  private program: Program<TicketMinter>;
  private connection: Connection;
  
  /**
   * Create a new TicketToken client
   * 
   * @param connection - Solana connection
   * @param wallet - Anchor wallet
   * @param programId - Program ID (optional, defaults to IDL's ID)
   */
  constructor(
    connection: Connection,
    private wallet: anchor.Wallet,
    programId?: PublicKey
  ) {
    this.connection = connection;
    
    // Set up provider
    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      { commitment: 'confirmed' }
    );
    
    // Initialize program
    this.program = new anchor.Program<TicketMinter>(
      IDL,
      programId || IDL.metadata.address,
      provider
    );
  }
  
  /**
   * Create a new event
   * 
   * @param params - Event parameters
   * @returns Event public key
   */
  async createEvent(params: {
    eventId: string;
    name: string;
    symbol: string;
    description: string;
    venue: string;
    startDate: number;
    endDate: number;
    maxTickets: number;
    royaltyBasisPoints: number;
    organizer: Keypair;
  }): Promise<PublicKey> {
    const {
      eventId,
      name,
      symbol,
      description,
      venue,
      startDate,
      endDate,
      maxTickets,
      royaltyBasisPoints,
      organizer,
    } = params;
    
    // Find event PDA
    const [eventPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from('event'),
        organizer.publicKey.toBuffer(),
        Buffer.from(eventId),
      ],
      this.program.programId
    );
    
    // Create event
    await this.program.methods
      .createEvent(
        eventId,
        name,
        symbol,
        description,
        venue,
        new anchor.BN(startDate),
        new anchor.BN(endDate),
        maxTickets,
        royaltyBasisPoints
      )
      .accounts({
        event: eventPda,
        organizer: organizer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([organizer])
      .rpc();
    
    return eventPda;
  }
  
  /**
   * Create a new ticket type for an event
   * 
   * @param params - Ticket type parameters
   * @returns Ticket type public key
   */
  async createTicketType(params: {
    eventPda: PublicKey;
    ticketTypeId: string;
    name: string;
    description: string;
    price: anchor.BN;
    quantity: number;
    attributes: { trait_type: string; value: string }[];
    organizer: Keypair;
  }): Promise<PublicKey> {
    const {
      eventPda,
      ticketTypeId,
      name,
      description,
      price,
      quantity,
      attributes,
      organizer,
    } = params;
    
    // Find ticket type PDA
    const [ticketTypePda] = await PublicKey.findProgramAddress(
      [
        Buffer.from('ticket_type'),
        eventPda.toBuffer(),
        Buffer.from(ticketTypeId),
      ],
      this.program.programId
    );
    
    // Create ticket type
    await this.program.methods
      .createTicketType(
        ticketTypeId,
        name,
        description,
        price,
        quantity,
        attributes
      )
      .accounts({
        event: eventPda,
        ticketType: ticketTypePda,
        organizer: organizer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([organizer])
      .rpc();
    
    return ticketTypePda;
  }
  
  /**
   * Mint a new ticket NFT
   * 
   * @param params - Minting parameters
   * @returns Ticket public key and mint public key
   */
  async mintTicket(params: {
    eventPda: PublicKey;
    ticketTypePda: PublicKey;
    metadataUri: string;
    customAttributes?: { trait_type: string; value: string }[];
    buyer: PublicKey;
    organizer: PublicKey;
  }): Promise<{ ticketPda: PublicKey; mintPubkey: PublicKey }> {
    const {
      eventPda,
      ticketTypePda,
      metadataUri,
      customAttributes,
      buyer,
      organizer,
    } = params;
    
    // Create a new keypair for the NFT mint
    const mintKeypair = Keypair.generate();
    
    // Find ticket mint authority PDA
    const [ticketMintAuthority] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket_authority'), mintKeypair.publicKey.toBuffer()],
      this.program.programId
    );
    
    // Find ticket PDA
    const [ticketPda] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket'), mintKeypair.publicKey.toBuffer()],
      this.program.programId
    );
    
    // Get token account address
    const tokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      buyer
    );
    
    // Find metadata account address (Metaplex)
    const [metadataAccount] = await PublicKey.findProgramAddress(
      [
        Buffer.from('metadata'),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    
    // Find master edition account address (Metaplex)
    const [masterEdition] = await PublicKey.findProgramAddress(
      [
        Buffer.from('metadata'),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
        Buffer.from('edition'),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    
    // Mint ticket
    await this.program.methods
      .mintTicket(metadataUri, customAttributes || null)
      .accounts({
        event: eventPda,
        ticketType: ticketTypePda,
        mint: mintKeypair.publicKey,
        ticketMintAuthority,
        tokenAccount,
        metadataAccount,
        masterEdition,
        ticket: ticketPda,
        buyer,
        organizer,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();
    
    return {
      ticketPda,
      mintPubkey: mintKeypair.publicKey,
    };
  }
  
  /**
   * Update a ticket's status
   * 
   * @param params - Update parameters
   */
  async updateTicketStatus(params: {
    eventPda: PublicKey;
    ticketPda: PublicKey;
    newStatus: number; // 0=Valid, 1=Used, 2=Revoked, 3=Expired
    validator: Keypair;
  }): Promise<void> {
    const {
      eventPda,
      ticketPda,
      newStatus,
      validator,
    } = params;
    
    // Update ticket status
    await this.program.methods
      .updateTicketStatus(newStatus)
      .accounts({
        event: eventPda,
        ticket: ticketPda,
        validator: validator.publicKey,
      })
      .signers([validator])
      .rpc();
  }
  
  /**
   * Add a validator to an event
   * 
   * @param params - Validator parameters
   */
  async addValidator(params: {
    eventPda: PublicKey;
    validator: PublicKey;
    organizer: Keypair;
  }): Promise<void> {
    const {
      eventPda,
      validator,
      organizer,
    } = params;
    
    // Add validator
    await this.program.methods
      .addValidator(validator)
      .accounts({
        event: eventPda,
        organizer: organizer.publicKey,
      })
      .signers([organizer])
      .rpc();
  }
  
  /**
   * Transfer a ticket to a new owner
   * 
   * @param params - Transfer parameters
   */
  async transferTicket(params: {
    ticketPda: PublicKey;
    mint: PublicKey;
    from: Keypair;
    to: PublicKey;
  }): Promise<void> {
    const {
      ticketPda,
      mint,
      from,
      to,
    } = params;
    
    // Get token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(mint, from.publicKey);
    const toTokenAccount = await getAssociatedTokenAddress(mint, to);
    
    // Check if destination token account exists
    const toTokenAccountInfo = await this.connection.getAccountInfo(toTokenAccount);
    
    // Create destination token account if it doesn't exist
    let transaction = new Transaction();
    if (!toTokenAccountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          from.publicKey,
          toTokenAccount,
          to,
          mint
        )
      );
    }
    
    // Add transfer instruction
    const transferIx = await this.program.methods
      .transferTicket()
      .accounts({
        ticket: ticketPda,
        mint,
        fromTokenAccount,
        toTokenAccount,
        from: from.publicKey,
        to,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    
    transaction.add(transferIx);
    
    // Send and confirm transaction
    await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [from]
    );
  }
  
  /**
   * Fetch all events created by an organizer
   * 
   * @param organizer - Organizer public key
   * @returns Array of event accounts
   */
  async getOrganizerEvents(organizer: PublicKey) {
    // Filter for events with the organizer as the organizer
    const events = await this.program.account.event.all([
      {
        memcmp: {
          offset: 8 + 4 + 100 + 4 + 10 + 4 + 500 + 4 + 200 + 8 + 8, // Discriminator + eventId (string) + name (string) + symbol (string) + description (string) + venue (string) + startDate + endDate
          bytes: organizer.toBase58(),
        }
      }
    ]);
    
    return events;
  }
  
  /**
   * Fetch all ticket types for an event
   * 
   * @param eventPda - Event public key
   * @returns Array of ticket type accounts
   */
  async getEventTicketTypes(eventPda: PublicKey) {
    // Filter for ticket types with the event as the event
    const ticketTypes = await this.program.account.ticketType.all([
      {
        memcmp: {
          offset: 8, // Discriminator
          bytes: eventPda.toBase58(),
        }
      }
    ]);
    
    return ticketTypes;
  }
  
  /**
   * Fetch a user's tickets
   * 
   * @param owner - Owner public key
   * @returns Array of ticket accounts
   */
  async getUserTickets(owner: PublicKey) {
    // Filter for tickets with the owner as the owner
    const tickets = await this.program.account.ticket.all([
      {
        memcmp: {
          offset: 8 + 32 + 32 + 32, // Discriminator + mint + event + ticketType
          bytes: owner.toBase58(),
        }
      }
    ]);
    
    return tickets;
  }
  
  /**
   * Fetch all tickets for an event
   * 
   * @param eventPda - Event public key
   * @returns Array of ticket accounts
   */
  async getEventTickets(eventPda: PublicKey) {
    // Filter for tickets with the event as the event
    const tickets = await this.program.account.ticket.all([
      {
        memcmp: {
          offset: 8 + 32, // Discriminator + mint
          bytes: eventPda.toBase58(),
        }
      }
    ]);
    
    return tickets;
  }
}
