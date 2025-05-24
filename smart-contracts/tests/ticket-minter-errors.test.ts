import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { TicketMinter } from '../target/types/ticket_minter';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { assert } from 'chai';

describe('ticket-minter-error-cases', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TicketMinter as Program<TicketMinter>;
  
  // Test accounts
  const eventOrganizer = Keypair.generate();
  const buyer = provider.wallet;
  const validator = Keypair.generate();
  const unauthorizedUser = Keypair.generate();
  
  // Test data
  const eventId = 'error-test-event';
  const eventName = 'Error Test Event';
  const eventSymbol = 'ERR';
  const eventDescription = 'An event for testing error conditions';
  const eventVenue = 'Error Test Venue';
  
  // Get current timestamp and add time
  const now = Math.floor(Date.now() / 1000);
  const startDate = now + 86400; // 1 day from now
  const endDate = now + 172800;  // 2 days from now
  
  // Past dates for testing
  const pastStartDate = now - 172800; // 2 days ago
  const pastEndDate = now - 86400;    // 1 day ago
  
  // Future dates with start after end (invalid)
  const invalidStartDate = now + 172800; // 2 days from now
  const invalidEndDate = now + 86400;    // 1 day from now
  
  // Ticket details
  const ticketTypeId = 'error-test-ticket';
  const ticketTypeName = 'Error Test Ticket';
  const ticketTypeDescription = 'A ticket for testing error conditions';
  const ticketPrice = new anchor.BN(1000000000); // 1 SOL in lamports
  const ticketQuantity = 5; // Small quantity for testing capacity errors
  
  // PDAs
  let eventPda: PublicKey;
  let pastEventPda: PublicKey;
  let ticketTypePda: PublicKey;
  let ticketPda: PublicKey;
  let mintKeypair: Keypair;
  
  // Token metadata program ID
  const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  
  before(async () => {
    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(
      eventOrganizer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await provider.connection.requestAirdrop(
      validator.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await provider.connection.requestAirdrop(
      unauthorizedUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for confirmations
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Create a valid event for testing
    const [eventAddress] = await PublicKey.findProgramAddress(
      [
        Buffer.from('event'), 
        eventOrganizer.publicKey.toBuffer(), 
        Buffer.from(eventId)
      ],
      program.programId
    );
    eventPda = eventAddress;
    
    await program.methods
      .createEvent(
        eventId,
        eventName,
        eventSymbol,
        eventDescription,
        eventVenue,
        new anchor.BN(startDate),
        new anchor.BN(endDate),
        ticketQuantity,
        500 // 5% royalties
      )
      .accounts({
        event: eventPda,
        organizer: eventOrganizer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([eventOrganizer])
      .rpc();
    
    // Create a valid ticket type for testing
    const [ticketTypeAddress] = await PublicKey.findProgramAddress(
      [
        Buffer.from('ticket_type'), 
        eventPda.toBuffer(), 
        Buffer.from(ticketTypeId)
      ],
      program.programId
    );
    ticketTypePda = ticketTypeAddress;
    
    await program.methods
      .createTicketType(
        ticketTypeId,
        ticketTypeName,
        ticketTypeDescription,
        ticketPrice,
        ticketQuantity,
        [] // No attributes for now
      )
      .accounts({
        event: eventPda,
        ticketType: ticketTypePda,
        organizer: eventOrganizer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([eventOrganizer])
      .rpc();
    
    // Add validator
    await program.methods
      .addValidator(validator.publicKey)
      .accounts({
        event: eventPda,
        organizer: eventOrganizer.publicKey,
      })
      .signers([eventOrganizer])
      .rpc();
  });
  
  describe('Event Creation Errors', () => {
    it('Fails to create event with invalid dates (end before start)', async () => {
      const invalidEventId = 'invalid-dates-event';
      
      // Find event PDA
      const [invalidEventPda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('event'), 
          eventOrganizer.publicKey.toBuffer(), 
          Buffer.from(invalidEventId)
        ],
        program.programId
      );
      
      try {
        await program.methods
          .createEvent(
            invalidEventId,
            'Invalid Dates Event',
            'INV',
            'Event with invalid dates',
            'Invalid Venue',
            new anchor.BN(invalidStartDate), // Start date is after end date
            new anchor.BN(invalidEndDate),
            100,
            500
          )
          .accounts({
            event: invalidEventPda,
            organizer: eventOrganizer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        assert.fail('Should have failed with invalid dates');
      } catch (error) {
        assert.include(error.message, 'End date must be after start date');
      }
    });
    
    it('Fails to create event with same ID (duplicate)', async () => {
      try {
        await program.methods
          .createEvent(
            eventId, // Same event ID as before
            eventName,
            eventSymbol,
            eventDescription,
            eventVenue,
            new anchor.BN(startDate),
            new anchor.BN(endDate),
            ticketQuantity,
            500
          )
          .accounts({
            event: eventPda,
            organizer: eventOrganizer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        assert.fail('Should have failed with duplicate event ID');
      } catch (error) {
        // This should be an Anchor Error about the account already existing
        assert.include(error.message, 'Error Code:');
        assert.include(error.message, 'Allocate: account already exists');
      }
    });
    
    it('Creates a past event for testing', async () => {
      const pastEventId = 'past-event';
      
      // Find event PDA
      const [pastEventAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('event'), 
          eventOrganizer.publicKey.toBuffer(), 
          Buffer.from(pastEventId)
        ],
        program.programId
      );
      pastEventPda = pastEventAddress;
      
      await program.methods
        .createEvent(
          pastEventId,
          'Past Event',
          'PAST',
          'An event that has already ended',
          'Past Venue',
          new anchor.BN(pastStartDate),
          new anchor.BN(pastEndDate),
          ticketQuantity,
          500
        )
        .accounts({
          event: pastEventPda,
          organizer: eventOrganizer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();
      
      // Create a ticket type for the past event
      const [pastTicketTypePda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('ticket_type'), 
          pastEventPda.toBuffer(), 
          Buffer.from(ticketTypeId)
        ],
        program.programId
      );
      
      await program.methods
        .createTicketType(
          ticketTypeId,
          ticketTypeName,
          ticketTypeDescription,
          ticketPrice,
          ticketQuantity,
          []
        )
        .accounts({
          event: pastEventPda,
          ticketType: pastTicketTypePda,
          organizer: eventOrganizer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();
    });
  });
  
  describe('Ticket Type Creation Errors', () => {
    it('Fails when unauthorized user tries to create ticket type', async () => {
      const unauthorizedTicketTypeId = 'unauthorized-ticket';
      
      // Find ticket type PDA
      const [unauthorizedTicketTypePda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('ticket_type'), 
          eventPda.toBuffer(), 
          Buffer.from(unauthorizedTicketTypeId)
        ],
        program.programId
      );
      
      try {
        await program.methods
          .createTicketType(
            unauthorizedTicketTypeId,
            'Unauthorized Ticket',
            'A ticket created by unauthorized user',
            new anchor.BN(1000000000),
            10,
            []
          )
          .accounts({
            event: eventPda,
            ticketType: unauthorizedTicketTypePda,
            organizer: unauthorizedUser.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        assert.fail('Should have failed with unauthorized user');
      } catch (error) {
        assert.include(error.message, 'constraint has been violated');
      }
    });
    
    it('Fails to create ticket type with excessive quantity', async () => {
      const excessiveTicketTypeId = 'excessive-ticket';
      
      // Find ticket type PDA
      const [excessiveTicketTypePda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('ticket_type'), 
          eventPda.toBuffer(), 
          Buffer.from(excessiveTicketTypeId)
        ],
        program.programId
      );
      
      try {
        await program.methods
          .createTicketType(
            excessiveTicketTypeId,
            'Excessive Ticket',
            'A ticket type with excessive quantity',
            new anchor.BN(1000000000),
            ticketQuantity + 1, // Exceeds max tickets
            []
          )
          .accounts({
            event: eventPda,
            ticketType: excessiveTicketTypePda,
            organizer: eventOrganizer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        assert.fail('Should have failed with excessive quantity');
      } catch (error) {
        assert.include(error.message, 'Event has reached maximum ticket capacity');
      }
    });
  });
  
  describe('Ticket Minting Errors', () => {
    it('Successfully mints a valid ticket first', async () => {
      // Create a new keypair for the NFT mint
      mintKeypair = Keypair.generate();
      
      // Find ticket mint authority PDA
      const [mintAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket_authority'), mintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Find ticket PDA
      const [ticketAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), mintKeypair.publicKey.toBuffer()],
        program.programId
      );
      ticketPda = ticketAddress;
      
      // Get token account address
      const tokenAccount = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        buyer.publicKey
      );
      
      // Find metadata account address (Metaplex)
      const [metadataAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintKeypair.publicKey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      // Find master edition account address (Metaplex)
      const [masterEditionAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintKeypair.publicKey.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      // Sample metadata URI
      const metadataUri = 'https://tickettoken.app/metadata/error-test-ticket.json';
      
      // Mint ticket
      await program.methods
        .mintTicket(metadataUri, null)
        .accounts({
          event: eventPda,
          ticketType: ticketTypePda,
          mint: mintKeypair.publicKey,
          ticketMintAuthority: mintAuthority,
          tokenAccount,
          metadataAccount: metadataAddress,
          masterEdition: masterEditionAddress,
          ticket: ticketPda,
          buyer: buyer.publicKey,
          organizer: eventOrganizer.publicKey,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKeypair])
        .rpc();
      
      // Verify minting was successful
      const ticketAccount = await program.account.ticket.fetch(ticketPda);
      assert.equal(ticketAccount.owner.toString(), buyer.publicKey.toString());
    });
    
    it('Fails to mint ticket for ended event', async () => {
      // Create a new keypair for the NFT mint
      const pastEventMintKeypair = Keypair.generate();
      
      // Find ticket mint authority PDA
      const [mintAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket_authority'), pastEventMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Find ticket PDA
      const [ticketAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), pastEventMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Get token account address
      const tokenAccount = await getAssociatedTokenAddress(
        pastEventMintKeypair.publicKey,
        buyer.publicKey
      );
      
      // Find metadata account address (Metaplex)
      const [metadataAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          pastEventMintKeypair.publicKey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      // Find master edition account address (Metaplex)
      const [masterEditionAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          pastEventMintKeypair.publicKey.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      // Find past event ticket type
      const [pastTicketTypePda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('ticket_type'), 
          pastEventPda.toBuffer(), 
          Buffer.from(ticketTypeId)
        ],
        program.programId
      );
      
      // Sample metadata URI
      const metadataUri = 'https://tickettoken.app/metadata/past-event-ticket.json';
      
      try {
        // Mint ticket for past event
        await program.methods
          .mintTicket(metadataUri, null)
          .accounts({
            event: pastEventPda,
            ticketType: pastTicketTypePda,
            mint: pastEventMintKeypair.publicKey,
            ticketMintAuthority: mintAuthority,
            tokenAccount,
            metadataAccount: metadataAddress,
            masterEdition: masterEditionAddress,
            ticket: ticketAddress,
            buyer: buyer.publicKey,
            organizer: eventOrganizer.publicKey,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([pastEventMintKeypair])
          .rpc();
        
        assert.fail('Should have failed to mint ticket for ended event');
      } catch (error) {
        assert.include(error.message, 'Event has already ended');
      }
    });
    
    it('Fails to mint ticket when ticket type is sold out', async () => {
      // Mint all remaining tickets first
      for (let i = 0; i < ticketQuantity - 1; i++) {
        const mintKeypair = Keypair.generate();
        
        // Find ticket mint authority PDA
        const [mintAuthority] = await PublicKey.findProgramAddress(
          [Buffer.from('ticket_authority'), mintKeypair.publicKey.toBuffer()],
          program.programId
        );
        
        // Find ticket PDA
        const [ticketAddress] = await PublicKey.findProgramAddress(
          [Buffer.from('ticket'), mintKeypair.publicKey.toBuffer()],
          program.programId
        );
        
        // Get token account address
        const tokenAccount = await getAssociatedTokenAddress(
          mintKeypair.publicKey,
          buyer.publicKey
        );
        
        // Find metadata account address (Metaplex)
        const [metadataAddress] = await PublicKey.findProgramAddress(
          [
            Buffer.from('metadata'),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mintKeypair.publicKey.toBuffer(),
          ],
          TOKEN_METADATA_PROGRAM_ID
        );
        
        // Find master edition account address (Metaplex)
        const [masterEditionAddress] = await PublicKey.findProgramAddress(
          [
            Buffer.from('metadata'),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mintKeypair.publicKey.toBuffer(),
            Buffer.from('edition'),
          ],
          TOKEN_METADATA_PROGRAM_ID
        );
        
        // Mint ticket
        await program.methods
          .mintTicket('https://tickettoken.app/metadata/ticket-' + i + '.json', null)
          .accounts({
            event: eventPda,
            ticketType: ticketTypePda,
            mint: mintKeypair.publicKey,
            ticketMintAuthority: mintAuthority,
            tokenAccount,
            metadataAccount: metadataAddress,
            masterEdition: masterEditionAddress,
            ticket: ticketAddress,
            buyer: buyer.publicKey,
            organizer: eventOrganizer.publicKey,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([mintKeypair])
          .rpc();
      }
      
      // Try to mint one more ticket (should fail because ticket type is sold out)
      const soldOutMintKeypair = Keypair.generate();
      
      // Find ticket mint authority PDA
      const [mintAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket_authority'), soldOutMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Find ticket PDA
      const [ticketAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), soldOutMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Get token account address
      const tokenAccount = await getAssociatedTokenAddress(
        soldOutMintKeypair.publicKey,
        buyer.publicKey
      );
      
      // Find metadata account address (Metaplex)
      const [metadataAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          soldOutMintKeypair.publicKey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      // Find master edition account address (Metaplex)
      const [masterEditionAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          soldOutMintKeypair.publicKey.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      try {
        // Try to mint one more ticket
        await program.methods
          .mintTicket('https://tickettoken.app/metadata/sold-out-ticket.json', null)
          .accounts({
            event: eventPda,
            ticketType: ticketTypePda,
            mint: soldOutMintKeypair.publicKey,
            ticketMintAuthority: mintAuthority,
            tokenAccount,
            metadataAccount: metadataAddress,
            masterEdition: masterEditionAddress,
            ticket: ticketAddress,
            buyer: buyer.publicKey,
            organizer: eventOrganizer.publicKey,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([soldOutMintKeypair])
          .rpc();
        
        assert.fail('Should have failed to mint ticket when sold out');
      } catch (error) {
        assert.include(error.message, 'Ticket type has sold out');
      }
    });
  });
  
  describe('Verification Errors', () => {
    it('Fails when unauthorized validator tries to verify ticket', async () => {
      try {
        await program.methods
          .verifyTicketForEntry()
          .accounts({
            event: eventPda,
            ticket: ticketPda,
            ticketOwner: buyer.publicKey,
            validator: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        assert.fail('Should have failed with unauthorized validator');
      } catch (error) {
        assert.include(error.message, 'constraint has been violated');
      }
    });
    
    it('Fails when verifying with wrong ticket owner', async () => {
      try {
        await program.methods
          .verifyTicketForEntry()
          .accounts({
            event: eventPda,
            ticket: ticketPda,
            ticketOwner: unauthorizedUser.publicKey, // Wrong owner
            validator: validator.publicKey,
          })
          .signers([validator, unauthorizedUser])
          .rpc();
        
        assert.fail('Should have failed with wrong ticket owner');
      } catch (error) {
        assert.include(error.message, 'Ticket is not owned by the specified account');
      }
    });
  });
  
  describe('Transferability Errors', () => {
    it('Fails when unauthorized user tries to set transferability', async () => {
      try {
        await program.methods
          .setTicketTransferability(false)
          .accounts({
            event: eventPda,
            ticket: ticketPda,
            organizer: unauthorizedUser.publicKey, // Not the organizer
          })
          .signers([unauthorizedUser])
          .rpc();
        
        assert.fail('Should have failed with unauthorized user');
      } catch (error) {
        assert.include(error.message, 'constraint has been violated');
      }
    });
    
    it('Sets ticket to non-transferable', async () => {
      await program.methods
        .setTicketTransferability(false)
        .accounts({
          event: eventPda,
          ticket: ticketPda,
          organizer: eventOrganizer.publicKey,
        })
        .signers([eventOrganizer])
        .rpc();
      
      const ticketAccount = await program.account.ticket.fetch(ticketPda);
      assert.equal(ticketAccount.transferable, false);
    });
    
    it('Fails to transfer non-transferable ticket', async () => {
      // Get token accounts
      const fromTokenAccount = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        buyer.publicKey
      );
      
      const toTokenAccount = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        unauthorizedUser.publicKey
      );
      
      // Create destination token account if it doesn't exist
      const toTokenAccountInfo = await provider.connection.getAccountInfo(toTokenAccount);
      
      const transaction = new Transaction();
      
      if (!toTokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            buyer.publicKey,
            toTokenAccount,
            unauthorizedUser.publicKey,
            mintKeypair.publicKey
          )
        );
      }
      
      // Add transfer instruction
      const transferIx = await program.methods
        .transferTicket()
        .accounts({
          ticket: ticketPda,
          mint: mintKeypair.publicKey,
          fromTokenAccount,
          toTokenAccount,
          from: buyer.publicKey,
          to: unauthorizedUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          paymentAmount: 0,
        })
        .instruction();
      
      transaction.add(transferIx);
      
      try {
        // Send transaction
        await sendAndConfirmTransaction(
          provider.connection,
          transaction,
          [buyer.payer]
        );
        
        assert.fail('Should have failed to transfer non-transferable ticket');
      } catch (error) {
        assert.include(error.message, 'Ticket is not transferable');
      }
    });
  });
  
  describe('Transfer Listing Errors', () => {
    it('Sets ticket back to transferable', async () => {
      await program.methods
        .setTicketTransferability(true)
        .accounts({
          event: eventPda,
          ticket: ticketPda,
          organizer: eventOrganizer.publicKey,
        })
        .signers([eventOrganizer])
        .rpc();
      
      const ticketAccount = await program.account.ticket.fetch(ticketPda);
      assert.equal(ticketAccount.transferable, true);
    });
    
    it('Creates a transfer listing', async () => {
      // Find listing PDA
      const [listingPda] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_listing'), ticketPda.toBuffer()],
        program.programId
      );
      
      await program.methods
        .createTransferListing(
          new anchor.BN(2000000000), // 2 SOL
          true // Allow direct transfer
        )
        .accounts({
          ticket: ticketPda,
          listing: listingPda,
          owner: buyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      const listingAccount = await program.account.transferListing.fetch(listingPda);
      assert.equal(listingAccount.price.toString(), '2000000000');
    });
    
    it('Fails when unauthorized user tries to cancel listing', async () => {
      // Find listing PDA
      const [listingPda] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_listing'), ticketPda.toBuffer()],
        program.programId
      );
      
      try {
        await program.methods
          .cancelTransferListing()
          .accounts({
            ticket: ticketPda,
            listing: listingPda,
            owner: unauthorizedUser.publicKey, // Not the owner
          })
          .signers([unauthorizedUser])
          .rpc();
        
        assert.fail('Should have failed with unauthorized user');
      } catch (error) {
        assert.include(error.message, 'constraint has been violated');
      }
    });
    
    it('Successfully cancels listing by the owner', async () => {
      // Find listing PDA
      const [listingPda] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_listing'), ticketPda.toBuffer()],
        program.programId
      );
      
      await program.methods
        .cancelTransferListing()
        .accounts({
          ticket: ticketPda,
          listing: listingPda,
          owner: buyer.publicKey,
        })
        .rpc();
      
      const listingAccount = await program.account.transferListing.fetch(listingPda);
      assert.equal(listingAccount.active, false);
    });
  });
});
