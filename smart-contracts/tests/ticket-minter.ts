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
  getAccount,
} from '@solana/spl-token';
import { assert } from 'chai';

describe('ticket-minter', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TicketMinter as Program<TicketMinter>;
  
  // Test accounts
  const eventOrganizer = Keypair.generate();
  const buyer = provider.wallet;
  const validator = Keypair.generate();
  const secondBuyer = Keypair.generate();
  
  // Test data
  const eventId = 'test-event-001';
  const eventName = 'Test Concert';
  const eventSymbol = 'TCON';
  const eventDescription = 'A test concert for the TicketToken platform';
  const eventVenue = 'Virtual Arena';
  
  // Get current timestamp and add time
  const now = Math.floor(Date.now() / 1000);
  const startDate = now + 86400; // 1 day from now
  const endDate = now + 172800;  // 2 days from now
  
  // Ticket details
  const ticketTypeId = 'vip-ticket';
  const ticketTypeName = 'VIP Ticket';
  const ticketTypeDescription = 'Access to VIP areas and backstage';
  const ticketPrice = new anchor.BN(1000000000); // 1 SOL in lamports
  const ticketQuantity = 100;
  
  // PDAs
  let eventPda: PublicKey;
  let ticketTypePda: PublicKey;
  let ticketPda: PublicKey;
  let transferListingPda: PublicKey;
  let transferRecordPda: PublicKey;
  let ticketMintAuthority: PublicKey;
  let metadataAccount: PublicKey;
  let masterEditionAccount: PublicKey;
  let mintKeypair: Keypair;
  let secondMintKeypair: Keypair;
  
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
      secondBuyer.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for confirmations
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });
  
  describe('Event Management', () => {
    it('Creates an event', async () => {
      // Find event PDA
      const [eventAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('event'), 
          eventOrganizer.publicKey.toBuffer(), 
          Buffer.from(eventId)
        ],
        program.programId
      );
      eventPda = eventAddress;
      
      // Create event
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
      
      // Fetch event account and verify data
      const eventAccount = await program.account.event.fetch(eventPda);
      
      assert.equal(eventAccount.eventId, eventId);
      assert.equal(eventAccount.name, eventName);
      assert.equal(eventAccount.organizer.toString(), eventOrganizer.publicKey.toString());
      assert.equal(eventAccount.maxTickets, ticketQuantity);
      assert.equal(eventAccount.ticketsIssued, 0);
    });
    
    it('Updates an event', async () => {
      const updatedVenue = 'New Venue Location';
      
      await program.methods
        .updateEvent(
          null, // Keep name
          null, // Keep description
          updatedVenue, // Update venue
          null, // Keep start date
          null // Keep end date
        )
        .accounts({
          event: eventPda,
          organizer: eventOrganizer.publicKey,
        })
        .signers([eventOrganizer])
        .rpc();
      
      // Fetch event account and verify updated data
      const eventAccount = await program.account.event.fetch(eventPda);
      
      assert.equal(eventAccount.venue, updatedVenue);
      assert.equal(eventAccount.name, eventName); // Should be unchanged
    });
    
    it('Adds a validator', async () => {
      await program.methods
        .addValidator(validator.publicKey)
        .accounts({
          event: eventPda,
          organizer: eventOrganizer.publicKey,
        })
        .signers([eventOrganizer])
        .rpc();
      
      // Fetch event account and verify validator was added
      const eventAccount = await program.account.event.fetch(eventPda);
      
      assert.equal(eventAccount.validators.length, 1);
      assert.equal(
        eventAccount.validators[0].toString(), 
        validator.publicKey.toString()
      );
    });
  });
  
  describe('Ticket Type Management', () => {
    it('Creates a ticket type', async () => {
      // Find ticket type PDA
      const [ticketTypeAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('ticket_type'), 
          eventPda.toBuffer(), 
          Buffer.from(ticketTypeId)
        ],
        program.programId
      );
      ticketTypePda = ticketTypeAddress;
      
      // Create ticket type
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
      
      // Fetch ticket type account and verify data
      const ticketTypeAccount = await program.account.ticketType.fetch(ticketTypePda);
      
      assert.equal(ticketTypeAccount.ticketTypeId, ticketTypeId);
      assert.equal(ticketTypeAccount.name, ticketTypeName);
      assert.equal(ticketTypeAccount.price.toString(), ticketPrice.toString());
      assert.equal(ticketTypeAccount.quantity, ticketQuantity);
      assert.equal(ticketTypeAccount.sold, 0);
    });
  });
  
  describe('Ticket Minting', () => {
    it('Mints a ticket NFT', async () => {
      // Create a new keypair for the NFT mint
      mintKeypair = Keypair.generate();
      
      // Find ticket mint authority PDA
      const [mintAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket_authority'), mintKeypair.publicKey.toBuffer()],
        program.programId
      );
      ticketMintAuthority = mintAuthority;
      
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
      metadataAccount = metadataAddress;
      
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
      masterEditionAccount = masterEditionAddress;
      
      // Find transfer record PDA
      const [recordAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_record'), ticketPda.toBuffer()],
        program.programId
      );
      transferRecordPda = recordAddress;
      
      // Sample metadata URI
      const metadataUri = 'https://tickettoken.app/metadata/test-ticket-001.json';
      
      // Mint ticket
      await program.methods
        .mintTicket(metadataUri, null)
        .accounts({
          event: eventPda,
          ticketType: ticketTypePda,
          mint: mintKeypair.publicKey,
          ticketMintAuthority,
          tokenAccount,
          metadataAccount,
          masterEdition: masterEditionAccount,
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
      
      // Fetch ticket account and verify data
      const ticketAccount = await program.account.ticket.fetch(ticketPda);
      
      assert.equal(ticketAccount.owner.toString(), buyer.publicKey.toString());
      assert.equal(ticketAccount.mint.toString(), mintKeypair.publicKey.toString());
      assert.equal(ticketAccount.event.toString(), eventPda.toString());
      assert.equal(ticketAccount.ticketType.toString(), ticketTypePda.toString());
      assert.deepEqual(ticketAccount.status, { valid: {} }); // Valid status
      assert.equal(ticketAccount.transferable, true);
      
      // Verify token account ownership
      const tokenAccountInfo = await getAccount(
        provider.connection,
        tokenAccount
      );
      
      assert.equal(tokenAccountInfo.amount.toString(), '1');
      assert.equal(tokenAccountInfo.owner.toString(), buyer.publicKey.toString());
      
      // Verify ticket type sold count was incremented
      const ticketTypeAccount = await program.account.ticketType.fetch(ticketTypePda);
      assert.equal(ticketTypeAccount.sold, 1);
    });
    
    it('Mints a second ticket for transfer testing', async () => {
      // Create a new keypair for the second NFT mint
      secondMintKeypair = Keypair.generate();
      
      // Find ticket mint authority PDA
      const [mintAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket_authority'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Find ticket PDA
      const [ticketAddress] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Get token account address
      const tokenAccount = await getAssociatedTokenAddress(
        secondMintKeypair.publicKey,
        buyer.publicKey
      );
      
      // Find metadata account address (Metaplex)
      const [metadataAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          secondMintKeypair.publicKey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      // Find master edition account address (Metaplex)
      const [masterEditionAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          secondMintKeypair.publicKey.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );
      
      // Sample metadata URI
      const metadataUri = 'https://tickettoken.app/metadata/test-ticket-002.json';
      
      // Mint ticket
      await program.methods
        .mintTicket(metadataUri, null)
        .accounts({
          event: eventPda,
          ticketType: ticketTypePda,
          mint: secondMintKeypair.publicKey,
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
        .signers([secondMintKeypair])
        .rpc();
      
      // Fetch ticket account and verify data
      const ticketAccount = await program.account.ticket.fetch(ticketAddress);
      
      assert.equal(ticketAccount.owner.toString(), buyer.publicKey.toString());
      assert.equal(ticketAccount.mint.toString(), secondMintKeypair.publicKey.toString());
      
      // Verify ticket type sold count was incremented
      const ticketTypeAccount = await program.account.ticketType.fetch(ticketTypePda);
      assert.equal(ticketTypeAccount.sold, 2);
    });
  });
  
  describe('Ticket Verification', () => {
    it('Verifies a ticket for entry', async () => {
      await program.methods
        .verifyTicketForEntry()
        .accounts({
          event: eventPda,
          ticket: ticketPda,
          ticketOwner: buyer.publicKey,
          validator: validator.publicKey,
        })
        .signers([validator])
        .rpc();
      
      // No state change, so if it didn't throw an error, it passed
    });
    
    it('Verifies and marks a ticket as used', async () => {
      await program.methods
        .verifyAndMarkUsed()
        .accounts({
          event: eventPda,
          ticket: ticketPda,
          ticketOwner: buyer.publicKey,
          validator: validator.publicKey,
        })
        .signers([validator])
        .rpc();
      
      // Fetch ticket account and verify status
      const ticketAccount = await program.account.ticket.fetch(ticketPda);
      
      assert.deepEqual(ticketAccount.status, { used: {} }); // Used status
      assert.isNotNull(ticketAccount.usedAt);
    });
    
    it('Cannot verify a used ticket', async () => {
      try {
        await program.methods
          .verifyTicketForEntry()
          .accounts({
            event: eventPda,
            ticket: ticketPda,
            ticketOwner: buyer.publicKey,
            validator: validator.publicKey,
          })
          .signers([validator])
          .rpc();
        
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.include(error.message, 'Ticket is not valid for entry');
      }
    });
  });
  
  describe('Ticket Transfer', () => {
    it('Creates a transfer listing', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Find listing PDA
      const [listingPda] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_listing'), secondTicketPda.toBuffer()],
        program.programId
      );
      transferListingPda = listingPda;
      
      // Create listing
      await program.methods
        .createTransferListing(
          new anchor.BN(2000000000), // 2 SOL
          true // Allow direct transfer
        )
        .accounts({
          ticket: secondTicketPda,
          listing: transferListingPda,
          owner: buyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      // Fetch listing account and verify data
      const listingAccount = await program.account.transferListing.fetch(transferListingPda);
      
      assert.equal(listingAccount.ticket.toString(), secondTicketPda.toString());
      assert.equal(listingAccount.owner.toString(), buyer.publicKey.toString());
      assert.equal(listingAccount.price.toString(), '2000000000');
      assert.equal(listingAccount.active, true);
    });
    
    it('Cancels a transfer listing', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Cancel listing
      await program.methods
        .cancelTransferListing()
        .accounts({
          ticket: secondTicketPda,
          listing: transferListingPda,
          owner: buyer.publicKey,
        })
        .rpc();
      
      // Fetch listing account and verify data
      const listingAccount = await program.account.transferListing.fetch(transferListingPda);
      
      assert.equal(listingAccount.active, false);
    });
    
    it('Transfers a ticket to a new owner', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Get token accounts
      const fromTokenAccount = await getAssociatedTokenAddress(
        secondMintKeypair.publicKey,
        buyer.publicKey
      );
      
      const toTokenAccount = await getAssociatedTokenAddress(
        secondMintKeypair.publicKey,
        secondBuyer.publicKey
      );
      
      // Create destination token account if it doesn't exist
      const toTokenAccountInfo = await provider.connection.getAccountInfo(toTokenAccount);
      
      const transaction = new Transaction();
      
      if (!toTokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            buyer.publicKey,
            toTokenAccount,
            secondBuyer.publicKey,
            secondMintKeypair.publicKey
          )
        );
      }
      
      // Add transfer instruction
      const transferIx = await program.methods
        .transferTicket()
        .accounts({
          ticket: secondTicketPda,
          mint: secondMintKeypair.publicKey,
          fromTokenAccount,
          toTokenAccount,
          from: buyer.publicKey,
          to: secondBuyer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          paymentAmount: 0,
        })
        .instruction();
      
      transaction.add(transferIx);
      
      // Send transaction
      await sendAndConfirmTransaction(
        provider.connection,
        transaction,
        [buyer.payer]
      );
      
      // Fetch ticket account and verify data
      const ticketAccount = await program.account.ticket.fetch(secondTicketPda);
      
      assert.equal(ticketAccount.owner.toString(), secondBuyer.publicKey.toString());
      
      // Verify token account ownership
      const tokenAccountInfo = await getAccount(
        provider.connection,
        toTokenAccount
      );
      
      assert.equal(tokenAccountInfo.amount.toString(), '1');
      assert.equal(tokenAccountInfo.owner.toString(), secondBuyer.publicKey.toString());
    });
    
    it('Creates a new transfer listing for a transferred ticket', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Find listing PDA
      const [listingPda] = await PublicKey.findProgramAddress(
        [Buffer.from('transfer_listing'), secondTicketPda.toBuffer()],
        program.programId
      );
      
      // Create second buyer token account if needed
      const secondBuyerATA = await getAssociatedTokenAddress(
        secondMintKeypair.publicKey,
        secondBuyer.publicKey
      );
      
      const secondBuyerATAInfo = await provider.connection.getAccountInfo(secondBuyerATA);
      
      if (!secondBuyerATAInfo) {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            secondBuyer.publicKey,
            secondBuyerATA,
            secondBuyer.publicKey,
            secondMintKeypair.publicKey
          )
        );
        
        await sendAndConfirmTransaction(
          provider.connection,
          tx,
          [secondBuyer]
        );
      }
      
      // Fund second buyer if needed
      const secondBuyerInfo = await provider.connection.getAccountInfo(secondBuyer.publicKey);
      if (!secondBuyerInfo || secondBuyerInfo.lamports < anchor.web3.LAMPORTS_PER_SOL) {
        await provider.connection.requestAirdrop(
          secondBuyer.publicKey,
          5 * anchor.web3.LAMPORTS_PER_SOL
        );
        
        // Wait for confirmation
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      
      // Create listing
      await program.methods
        .createTransferListing(
          new anchor.BN(1500000000), // 1.5 SOL
          true // Allow direct transfer
        )
        .accounts({
          ticket: secondTicketPda,
          listing: listingPda,
          owner: secondBuyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([secondBuyer])
        .rpc();
      
      // Fetch listing account and verify data
      const listingAccount = await program.account.transferListing.fetch(listingPda);
      
      assert.equal(listingAccount.ticket.toString(), secondTicketPda.toString());
      assert.equal(listingAccount.owner.toString(), secondBuyer.publicKey.toString());
      assert.equal(listingAccount.price.toString(), '1500000000');
      assert.equal(listingAccount.active, true);
    });
  });
  
  describe('Transferability Control', () => {
    it('Sets a ticket as non-transferable', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Set transferability
      await program.methods
        .setTicketTransferability(false)
        .accounts({
          event: eventPda,
          ticket: secondTicketPda,
          organizer: eventOrganizer.publicKey,
        })
        .signers([eventOrganizer])
        .rpc();
      
      // Fetch ticket account and verify data
      const ticketAccount = await program.account.ticket.fetch(secondTicketPda);
      
      assert.equal(ticketAccount.transferable, false);
    });
    
    it('Cannot transfer a non-transferable ticket', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Get token accounts
      const fromTokenAccount = await getAssociatedTokenAddress(
        secondMintKeypair.publicKey,
        secondBuyer.publicKey
      );
      
      const toTokenAccount = await getAssociatedTokenAddress(
        secondMintKeypair.publicKey,
        buyer.publicKey
      );
      
      // Create destination token account if it doesn't exist
      const toTokenAccountInfo = await provider.connection.getAccountInfo(toTokenAccount);
      
      const transaction = new Transaction();
      
      if (!toTokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            secondBuyer.publicKey,
            toTokenAccount,
            buyer.publicKey,
            secondMintKeypair.publicKey
          )
        );
      }
      
      // Add transfer instruction
      const transferIx = await program.methods
        .transferTicket()
        .accounts({
          ticket: secondTicketPda,
          mint: secondMintKeypair.publicKey,
          fromTokenAccount,
          toTokenAccount,
          from: secondBuyer.publicKey,
          to: buyer.publicKey,
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
          [secondBuyer]
        );
        
        assert.fail('Should have thrown an error');
      } catch (error) {
        // Expected error
        assert.include(error.message, 'Ticket is not transferable');
      }
    });
    
    it('Sets a ticket back to transferable', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Set transferability
      await program.methods
        .setTicketTransferability(true)
        .accounts({
          event: eventPda,
          ticket: secondTicketPda,
          organizer: eventOrganizer.publicKey,
        })
        .signers([eventOrganizer])
        .rpc();
      
      // Fetch ticket account and verify data
      const ticketAccount = await program.account.ticket.fetch(secondTicketPda);
      
      assert.equal(ticketAccount.transferable, true);
    });
  });
  
  describe('Advanced Verification Tests', () => {
    it('Verifies user has ticket for event', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      await program.methods
        .verifyUserHasTicketForEvent()
        .accounts({
          event: eventPda,
          ticket: secondTicketPda,
          user: secondBuyer.publicKey,
        })
        .signers([secondBuyer])
        .rpc();
      
      // No state change, so if it didn't throw an error, it passed
    });
    
    it('Generates a verification challenge', async () => {
      // Get second ticket PDA
      const [secondTicketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), secondMintKeypair.publicKey.toBuffer()],
        program.programId
      );
      
      // Create a nonce
      const nonce = new anchor.BN(Date.now());
      
      // Find verification challenge PDA
      const [challengePda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('verification'),
          secondMintKeypair.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, 'le', 8)
        ],
        program.programId
      );
      
      // Generate challenge
      await program.methods
        .generateVerificationChallenge(nonce)
        .accounts({
          event: eventPda,
          ticket: secondTicketPda,
          ticketOwner: secondBuyer.publicKey,
          validator: validator.publicKey,
          verificationAccount: challengePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([validator, secondBuyer])
        .rpc();
      
      // Fetch challenge account and verify data
      const challengeAccount = await program.account.verificationChallenge.fetch(challengePda);
      
      assert.equal(challengeAccount.ticket.toString(), secondTicketPda.toString());
      assert.equal(challengeAccount.owner.toString(), secondBuyer.publicKey.toString());
      assert.isNotEmpty(challengeAccount.challengeData);
    });
  });
});
