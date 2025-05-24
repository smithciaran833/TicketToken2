import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { TicketMinter } from '../target/types/ticket_minter';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { assert } from 'chai';

// Performance test configuration
const NUM_EVENTS = 3;
const TICKETS_PER_EVENT = 10;
const TICKET_TYPES_PER_EVENT = 2;

describe('ticket-minter-performance', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TicketMinter as Program<TicketMinter>;
  
  // Test accounts
  const eventOrganizer = Keypair.generate();
  const buyer = provider.wallet;
  const validator = Keypair.generate();
  
  // Events data
  const events: { 
    eventId: string, 
    eventPda: PublicKey, 
    ticketTypes: { 
      typeId: string, 
      typePda: PublicKey,
      tickets: { 
        mint: Keypair, 
        ticketPda: PublicKey 
      }[] 
    }[] 
  }[] = [];
  
  // Token metadata program ID
  const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  
  // Track performance metrics
  const metrics = {
    createEvent: [] as number[],
    createTicketType: [] as number[],
    mintTicket: [] as number[],
    verifyTicket: [] as number[],
    transferTicket: [] as number[],
  };
  
  before(async () => {
    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(
      eventOrganizer.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    await provider.connection.requestAirdrop(
      validator.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for confirmations
    await new Promise((resolve) => setTimeout(resolve, 3000));
    
    console.log('Setting up performance test with:');
    console.log(`- ${NUM_EVENTS} events`);
    console.log(`- ${TICKET_TYPES_PER_EVENT} ticket types per event`);
    console.log(`- ${TICKETS_PER_EVENT} tickets per event`);
    console.log(`Total tickets to be minted: ${NUM_EVENTS * TICKETS_PER_EVENT}`);
  });
  
  it('Creates multiple events', async () => {
    // Current timestamp
    const now = Math.floor(Date.now() / 1000);
    
    for (let i = 0; i < NUM_EVENTS; i++) {
      const eventId = `perf-event-${i}`;
      const eventName = `Performance Test Event ${i}`;
      const startDate = now + 86400; // 1 day from now
      const endDate = now + 172800;  // 2 days from now
      
      // Find event PDA
      const [eventPda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('event'), 
          eventOrganizer.publicKey.toBuffer(), 
          Buffer.from(eventId)
        ],
        program.programId
      );
      
      // Create event with timing
      const startTime = performance.now();
      
      await program.methods
        .createEvent(
          eventId,
          eventName,
          'PERF',
          `Event ${i} for performance testing`,
          `Venue ${i}`,
          new anchor.BN(startDate),
          new anchor.BN(endDate),
          100, // max tickets
          500  // 5% royalties
        )
        .accounts({
          event: eventPda,
          organizer: eventOrganizer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();
      
      const endTime = performance.now();
      metrics.createEvent.push(endTime - startTime);
      
      // Add to events array
      events.push({
        eventId,
        eventPda,
        ticketTypes: []
      });
      
      // Add validator
      await program.methods
        .addValidator(validator.publicKey)
        .accounts({
          event: eventPda,
          organizer: eventOrganizer.publicKey,
        })
        .signers([eventOrganizer])
        .rpc();
    }
    
    // Verify events were created
    assert.equal(events.length, NUM_EVENTS);
    
    // Log average creation time
    const avgTime = metrics.createEvent.reduce((a, b) => a + b, 0) / metrics.createEvent.length;
    console.log(`Average event creation time: ${avgTime.toFixed(2)}ms`);
  });
  
  it('Creates multiple ticket types for each event', async () => {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      for (let j = 0; j < TICKET_TYPES_PER_EVENT; j++) {
        const ticketTypeId = `perf-ticket-type-${i}-${j}`;
        const ticketTypeName = `Ticket Type ${j} for Event ${i}`;
        
        // Find ticket type PDA
        const [ticketTypePda] = await PublicKey.findProgramAddress(
          [
            Buffer.from('ticket_type'), 
            event.eventPda.toBuffer(), 
            Buffer.from(ticketTypeId)
          ],
          program.programId
        );
        
        // Create ticket type with timing
        const startTime = performance.now();
        
        await program.methods
          .createTicketType(
            ticketTypeId,
            ticketTypeName,
            `Description for ${ticketTypeName}`,
            new anchor.BN((j + 1) * 500000000), // 0.5 SOL * (j+1)
            50, // quantity
            [] // No attributes for now
          )
          .accounts({
            event: event.eventPda,
            ticketType: ticketTypePda,
            organizer: eventOrganizer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        const endTime = performance.now();
        metrics.createTicketType.push(endTime - startTime);
        
        // Add to ticket types array
        event.ticketTypes.push({
          typeId: ticketTypeId,
          typePda: ticketTypePda,
          tickets: []
        });
      }
    }
    
    // Verify ticket types were created
    let totalTicketTypes = 0;
    for (const event of events) {
      totalTicketTypes += event.ticketTypes.length;
    }
    assert.equal(totalTicketTypes, NUM_EVENTS * TICKET_TYPES_PER_EVENT);
    
    // Log average creation time
    const avgTime = metrics.createTicketType.reduce((a, b) => a + b, 0) / metrics.createTicketType.length;
    console.log(`Average ticket type creation time: ${avgTime.toFixed(2)}ms`);
  });
  
  it('Mints multiple tickets for each event', async () => {
    // Distribute tickets across events and ticket types
    const ticketsPerType = Math.ceil(TICKETS_PER_EVENT / TICKET_TYPES_PER_EVENT);
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      for (let j = 0; j < event.ticketTypes.length; j++) {
        const ticketType = event.ticketTypes[j];
        const ticketsToMint = Math.min(ticketsPerType, TICKETS_PER_EVENT - (j * ticketsPerType));
        
        for (let k = 0; k < ticketsToMint; k++) {
          // Create a new keypair for the NFT mint
          const mintKeypair = Keypair.generate();
          
          // Find ticket mint authority PDA
          const [mintAuthority] = await PublicKey.findProgramAddress(
            [Buffer.from('ticket_authority'), mintKeypair.publicKey.toBuffer()],
            program.programId
          );
          
          // Find ticket PDA
          const [ticketPda] = await PublicKey.findProgramAddress(
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
          
          // Sample metadata URI
          const metadataUri = `https://tickettoken.app/metadata/perf-event-${i}-type-${j}-ticket-${k}.json`;
          
          // Mint ticket with timing
          const startTime = performance.now();
          
          await program.methods
            .mintTicket(metadataUri, null)
            .accounts({
              event: event.eventPda,
              ticketType: ticketType.typePda,
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
          
          const endTime = performance.now();
          metrics.mintTicket.push(endTime - startTime);
          
          // Add to tickets array
          ticketType.tickets.push({
            mint: mintKeypair,
            ticketPda
          });
        }
      }
    }
    
    // Verify tickets were minted
    let totalTickets = 0;
    for (const event of events) {
      for (const ticketType of event.ticketTypes) {
        totalTickets += ticketType.tickets.length;
      }
    }
    
    // The total might be slightly less than NUM_EVENTS * TICKETS_PER_EVENT
    // due to the distribution algorithm, but should be close
    assert.isAtLeast(totalTickets, NUM_EVENTS * TICKETS_PER_EVENT * 0.9);
    
    // Log average minting time
    const avgTime = metrics.mintTicket.reduce((a, b) => a + b, 0) / metrics.mintTicket.length;
    console.log(`Average ticket minting time: ${avgTime.toFixed(2)}ms`);
    console.log(`Total tickets minted: ${totalTickets}`);
  });
  
  it('Verifies multiple tickets', async () => {
    // Get a subset of tickets to verify (20% of total)
    const ticketsToVerify = [];
    for (const event of events) {
      for (const ticketType of event.ticketTypes) {
        for (let i = 0; i < ticketType.tickets.length; i += 5) { // Every 5th ticket
          if (i < ticketType.tickets.length) {
            ticketsToVerify.push({
              eventPda: event.eventPda,
              ticketPda: ticketType.tickets[i].ticketPda
            });
          }
        }
      }
    }
    
    // Verify tickets
    for (const ticket of ticketsToVerify) {
      const startTime = performance.now();
      
      await program.methods
        .verifyTicketForEntry()
        .accounts({
          event: ticket.eventPda,
          ticket: ticket.ticketPda,
          ticketOwner: buyer.publicKey,
          validator: validator.publicKey,
        })
        .signers([validator])
        .rpc();
      
      const endTime = performance.now();
      metrics.verifyTicket.push(endTime - startTime);
    }
    
    // Log average verification time
    const avgTime = metrics.verifyTicket.reduce((a, b) => a + b, 0) / metrics.verifyTicket.length;
    console.log(`Average ticket verification time: ${avgTime.toFixed(2)}ms`);
    console.log(`Total tickets verified: ${ticketsToVerify.length}`);
  });
  
  it('Summarizes performance metrics', () => {
    console.log('\nPerformance Test Summary:');
    console.log('========================');
    console.log(`Events created: ${events.length}`);
    
    let totalTicketTypes = 0;
    let totalTickets = 0;
    for (const event of events) {
      totalTicketTypes += event.ticketTypes.length;
      for (const ticketType of event.ticketTypes) {
        totalTickets += ticketType.tickets.length;
      }
    }
    
    console.log(`Ticket types created: ${totalTicketTypes}`);
    console.log(`Tickets minted: ${totalTickets}`);
    console.log(`Tickets verified: ${metrics.verifyTicket.length}`);
    
    console.log('\nAverage Execution Times:');
    console.log('----------------------');
    console.log(`Create Event: ${(metrics.createEvent.reduce((a, b) => a + b, 0) / metrics.createEvent.length).toFixed(2)}ms`);
    console.log(`Create Ticket Type: ${(metrics.createTicketType.reduce((a, b) => a + b, 0) / metrics.createTicketType.length).toFixed(2)}ms`);
    console.log(`Mint Ticket: ${(metrics.mintTicket.reduce((a, b) => a + b, 0) / metrics.mintTicket.length).toFixed(2)}ms`);
    console.log(`Verify Ticket: ${(metrics.verifyTicket.reduce((a, b) => a + b, 0) / metrics.verifyTicket.length).toFixed(2)}ms`);
    
    console.log('\nMaximum Execution Times:');
    console.log('----------------------');
    console.log(`Create Event: ${Math.max(...metrics.createEvent).toFixed(2)}ms`);
    console.log(`Create Ticket Type: ${Math.max(...metrics.createTicketType).toFixed(2)}ms`);
    console.log(`Mint Ticket: ${Math.max(...metrics.mintTicket).toFixed(2)}ms`);
    console.log(`Verify Ticket: ${Math.max(...metrics.verifyTicket).toFixed(2)}ms`);
    
    console.log('\nMinimum Execution Times:');
    console.log('----------------------');
    console.log(`Create Event: ${Math.min(...metrics.createEvent).toFixed(2)}ms`);
    console.log(`Create Ticket Type: ${Math.min(...metrics.createTicketType).toFixed(2)}ms`);
    console.log(`Mint Ticket: ${Math.min(...metrics.mintTicket).toFixed(2)}ms`);
    console.log(`Verify Ticket: ${Math.min(...metrics.verifyTicket).toFixed(2)}ms`);
  });
});
