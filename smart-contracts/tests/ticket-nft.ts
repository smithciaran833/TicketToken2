import * as anchor from "@coral-xyz/anchor";
import { Program, BN, Wallet } from "@coral-xyz/anchor";
import { 
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { 
  PROGRAM_ID as METADATA_PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
  createUpdateMetadataAccountV2Instruction,
} from "@metaplex-foundation/mpl-token-metadata";
import { expect } from "chai";
import { TicketNft } from "../target/types/ticket_nft";

describe("TicketNFT", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TicketNft as Program<TicketNft>;
  const connection = provider.connection;
  const wallet = provider.wallet as Wallet;

  // Test accounts
  let admin: Keypair;
  let eventOrganizer: Keypair;
  let buyer1: Keypair;
  let buyer2: Keypair;
  let royaltyReceiver: Keypair;
  let unauthorizedUser: Keypair;

  // Program accounts
  let configAccount: PublicKey;
  let eventAccount: PublicKey;
  let ticketMint: Keypair;
  let ticketMetadata: PublicKey;
  let ticketMasterEdition: PublicKey;
  let ticketTokenAccount: PublicKey;

  // Test data
  const eventData = {
    name: "Test Concert",
    description: "Amazing test concert experience",
    venue: "Test Arena",
    date: new BN(Date.now() / 1000 + 86400), // Tomorrow
    totalTickets: new BN(1000),
    ticketPrice: new BN(0.1 * LAMPORTS_PER_SOL), // 0.1 SOL
    royaltyBps: 500, // 5%
    transferable: false,
    uri: "https://example.com/metadata.json",
  };

  // Gas tracking
  let gasTracker: GasTracker;

  class GasTracker {
    private costs: Map<string, number> = new Map();
    
    async trackTransaction(name: string, signature: string): Promise<void> {
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      
      if (tx?.meta?.fee) {
        this.costs.set(name, tx.meta.fee);
        console.log(`💰 ${name}: ${tx.meta.fee} lamports`);
      }
    }
    
    getCost(name: string): number {
      return this.costs.get(name) || 0;
    }
    
    getTotalCosts(): number {
      return Array.from(this.costs.values()).reduce((sum, cost) => sum + cost, 0);
    }
    
    displaySummary(): void {
      console.log("\n💰 Gas Cost Summary:");
      console.log("━".repeat(50));
      for (const [name, cost] of this.costs) {
        console.log(`${name}: ${cost} lamports (${(cost / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
      }
      console.log(`Total: ${this.getTotalCosts()} lamports (${(this.getTotalCosts() / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
    }
  }

  before(async () => {
    console.log("🚀 Setting up TicketNFT test environment...");
    
    // Initialize gas tracker
    gasTracker = new GasTracker();
    
    // Generate test keypairs
    admin = Keypair.generate();
    eventOrganizer = Keypair.generate();
    buyer1 = Keypair.generate();
    buyer2 = Keypair.generate();
    royaltyReceiver = Keypair.generate();
    unauthorizedUser = Keypair.generate();
    ticketMint = Keypair.generate();

    // Fund test accounts
    const accounts = [admin, eventOrganizer, buyer1, buyer2, royaltyReceiver, unauthorizedUser];
    for (const account of accounts) {
      const signature = await connection.requestAirdrop(account.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature);
    }

    // Derive PDAs
    [configAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    [eventAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("event"),
        eventOrganizer.publicKey.toBuffer(),
        Buffer.from(eventData.name),
      ],
      program.programId
    );

    [ticketMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        ticketMint.publicKey.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    [ticketMasterEdition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        ticketMint.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      METADATA_PROGRAM_ID
    );

    console.log("✅ Test environment setup complete");
    console.log(`Admin: ${admin.publicKey.toBase58()}`);
    console.log(`Event Organizer: ${eventOrganizer.publicKey.toBase58()}`);
    console.log(`Config Account: ${configAccount.toBase58()}`);
    console.log(`Event Account: ${eventAccount.toBase58()}`);
  });

  after(() => {
    gasTracker.displaySummary();
  });

  describe("Initialization", () => {
    it("Should initialize program config", async () => {
      const signature = await program.methods
        .initialize(royaltyReceiver.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      await gasTracker.trackTransaction("initialize", signature);

      const config = await program.account.config.fetch(configAccount);
      expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());
      expect(config.royaltyReceiver.toBase58()).to.equal(royaltyReceiver.publicKey.toBase58());
      expect(config.paused).to.be.false;
    });

    it("Should fail to initialize twice", async () => {
      try {
        await program.methods
          .initialize(royaltyReceiver.publicKey)
          .accounts({
            admin: admin.publicKey,
            config: configAccount,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("already in use");
      }
    });

    it("Should fail initialization with unauthorized signer", async () => {
      const [unauthorizedConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("config2")],
        program.programId
      );

      try {
        await program.methods
          .initialize(royaltyReceiver.publicKey)
          .accounts({
            admin: unauthorizedUser.publicKey,
            config: unauthorizedConfig,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe("Event Creation", () => {
    it("Should create an event successfully", async () => {
      const signature = await program.methods
        .createEvent(
          eventData.name,
          eventData.description,
          eventData.venue,
          eventData.date,
          eventData.totalTickets,
          eventData.ticketPrice,
          eventData.royaltyBps,
          eventData.transferable,
          eventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: eventAccount,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      await gasTracker.trackTransaction("createEvent", signature);

      const event = await program.account.event.fetch(eventAccount);
      expect(event.name).to.equal(eventData.name);
      expect(event.organizer.toBase58()).to.equal(eventOrganizer.publicKey.toBase58());
      expect(event.totalTickets.toNumber()).to.equal(eventData.totalTickets.toNumber());
      expect(event.ticketsSold.toNumber()).to.equal(0);
      expect(event.ticketPrice.toNumber()).to.equal(eventData.ticketPrice.toNumber());
      expect(event.active).to.be.true;
    });

    it("Should fail to create duplicate event", async () => {
      try {
        await program.methods
          .createEvent(
            eventData.name, // Same name
            "Different description",
            "Different venue",
            eventData.date,
            eventData.totalTickets,
            eventData.ticketPrice,
            eventData.royaltyBps,
            eventData.transferable,
            eventData.uri
          )
          .accounts({
            organizer: eventOrganizer.publicKey,
            event: eventAccount,
            config: configAccount,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.message).to.include("already in use");
      }
    });

    it("Should fail with invalid royalty BPS", async () => {
      const [invalidEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from("Invalid Event"),
        ],
        program.programId
      );

      try {
        await program.methods
          .createEvent(
            "Invalid Event",
            eventData.description,
            eventData.venue,
            eventData.date,
            eventData.totalTickets,
            eventData.ticketPrice,
            10001, // > 10000 BPS (100%)
            eventData.transferable,
            eventData.uri
          )
          .accounts({
            organizer: eventOrganizer.publicKey,
            event: invalidEvent,
            config: configAccount,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("Should fail with past date", async () => {
      const [pastEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from("Past Event"),
        ],
        program.programId
      );

      try {
        await program.methods
          .createEvent(
            "Past Event",
            eventData.description,
            eventData.venue,
            new BN(Date.now() / 1000 - 86400), // Yesterday
            eventData.totalTickets,
            eventData.ticketPrice,
            eventData.royaltyBps,
            eventData.transferable,
            eventData.uri
          )
          .accounts({
            organizer: eventOrganizer.publicKey,
            event: pastEvent,
            config: configAccount,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe("Ticket Minting", () => {
    beforeEach(async () => {
      // Get associated token account for buyer
      ticketTokenAccount = await getAssociatedTokenAddress(
        ticketMint.publicKey,
        buyer1.publicKey
      );
    });

    it("Should mint ticket successfully", async () => {
      const buyer1BalanceBefore = await connection.getBalance(buyer1.publicKey);
      const organizerBalanceBefore = await connection.getBalance(eventOrganizer.publicKey);

      const signature = await program.methods
        .mintTicket()
        .accounts({
          buyer: buyer1.publicKey,
          organizer: eventOrganizer.publicKey,
          event: eventAccount,
          config: configAccount,
          mint: ticketMint.publicKey,
          tokenAccount: ticketTokenAccount,
          metadata: ticketMetadata,
          masterEdition: ticketMasterEdition,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer1, ticketMint])
        .rpc();

      await gasTracker.trackTransaction("mintTicket", signature);

      // Check balances
      const buyer1BalanceAfter = await connection.getBalance(buyer1.publicKey);
      const organizerBalanceAfter = await connection.getBalance(eventOrganizer.publicKey);

      expect(buyer1BalanceAfter).to.be.lessThan(buyer1BalanceBefore);
      expect(organizerBalanceAfter).to.be.greaterThan(organizerBalanceBefore);

      // Check token account
      const tokenAccountInfo = await getAccount(connection, ticketTokenAccount);
      expect(tokenAccountInfo.amount.toString()).to.equal("1");
      expect(tokenAccountInfo.owner.toBase58()).to.equal(buyer1.publicKey.toBase58());

      // Check event updated
      const event = await program.account.event.fetch(eventAccount);
      expect(event.ticketsSold.toNumber()).to.equal(1);

      // Check NFT metadata exists
      const metadataAccountInfo = await connection.getAccountInfo(ticketMetadata);
      expect(metadataAccountInfo).to.not.be.null;
    });

    it("Should fail when event is sold out", async () => {
      // Create a small event
      const smallEventData = {
        ...eventData,
        name: "Small Event",
        totalTickets: new BN(1),
      };

      const [smallEventAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(smallEventData.name),
        ],
        program.programId
      );

      // Create the small event
      await program.methods
        .createEvent(
          smallEventData.name,
          smallEventData.description,
          smallEventData.venue,
          smallEventData.date,
          smallEventData.totalTickets,
          smallEventData.ticketPrice,
          smallEventData.royaltyBps,
          smallEventData.transferable,
          smallEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: smallEventAccount,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      // Mint the only ticket
      const ticket1Mint = Keypair.generate();
      const ticket1TokenAccount = await getAssociatedTokenAddress(
        ticket1Mint.publicKey,
        buyer1.publicKey
      );

      await program.methods
        .mintTicket()
        .accounts({
          buyer: buyer1.publicKey,
          organizer: eventOrganizer.publicKey,
          event: smallEventAccount,
          config: configAccount,
          mint: ticket1Mint.publicKey,
          tokenAccount: ticket1TokenAccount,
          metadata: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), ticket1Mint.publicKey.toBuffer()],
            METADATA_PROGRAM_ID
          )[0],
          masterEdition: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), ticket1Mint.publicKey.toBuffer(), Buffer.from("edition")],
            METADATA_PROGRAM_ID
          )[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer1, ticket1Mint])
        .rpc();

      // Try to mint another ticket (should fail)
      const ticket2Mint = Keypair.generate();
      const ticket2TokenAccount = await getAssociatedTokenAddress(
        ticket2Mint.publicKey,
        buyer2.publicKey
      );

      try {
        await program.methods
          .mintTicket()
          .accounts({
            buyer: buyer2.publicKey,
            organizer: eventOrganizer.publicKey,
            event: smallEventAccount,
            config: configAccount,
            mint: ticket2Mint.publicKey,
            tokenAccount: ticket2TokenAccount,
            metadata: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), ticket2Mint.publicKey.toBuffer()],
              METADATA_PROGRAM_ID
            )[0],
            masterEdition: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), ticket2Mint.publicKey.toBuffer(), Buffer.from("edition")],
              METADATA_PROGRAM_ID
            )[0],
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            metadataProgram: METADATA_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer2, ticket2Mint])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("Should fail with insufficient funds", async () => {
      // Create a new buyer with minimal funds
      const poorBuyer = Keypair.generate();
      const signature = await connection.requestAirdrop(poorBuyer.publicKey, 1000); // Very small amount
      await connection.confirmTransaction(signature);

      const poorBuyerTicketMint = Keypair.generate();
      const poorBuyerTokenAccount = await getAssociatedTokenAddress(
        poorBuyerTicketMint.publicKey,
        poorBuyer.publicKey
      );

      try {
        await program.methods
          .mintTicket()
          .accounts({
            buyer: poorBuyer.publicKey,
            organizer: eventOrganizer.publicKey,
            event: eventAccount,
            config: configAccount,
            mint: poorBuyerTicketMint.publicKey,
            tokenAccount: poorBuyerTokenAccount,
            metadata: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), poorBuyerTicketMint.publicKey.toBuffer()],
              METADATA_PROGRAM_ID
            )[0],
            masterEdition: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), poorBuyerTicketMint.publicKey.toBuffer(), Buffer.from("edition")],
              METADATA_PROGRAM_ID
            )[0],
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            metadataProgram: METADATA_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([poorBuyer, poorBuyerTicketMint])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe("Transfer Restrictions", () => {
    let transferableEventAccount: PublicKey;
    let transferableTicketMint: Keypair;
    let transferableTokenAccount: PublicKey;

    before(async () => {
      // Create transferable event
      const transferableEventData = {
        ...eventData,
        name: "Transferable Event",
        transferable: true,
      };

      [transferableEventAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(transferableEventData.name),
        ],
        program.programId
      );

      await program.methods
        .createEvent(
          transferableEventData.name,
          transferableEventData.description,
          transferableEventData.venue,
          transferableEventData.date,
          transferableEventData.totalTickets,
          transferableEventData.ticketPrice,
          transferableEventData.royaltyBps,
          transferableEventData.transferable,
          transferableEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: transferableEventAccount,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      // Mint a transferable ticket
      transferableTicketMint = Keypair.generate();
      transferableTokenAccount = await getAssociatedTokenAddress(
        transferableTicketMint.publicKey,
        buyer1.publicKey
      );

      await program.methods
        .mintTicket()
        .accounts({
          buyer: buyer1.publicKey,
          organizer: eventOrganizer.publicKey,
          event: transferableEventAccount,
          config: configAccount,
          mint: transferableTicketMint.publicKey,
          tokenAccount: transferableTokenAccount,
          metadata: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), transferableTicketMint.publicKey.toBuffer()],
            METADATA_PROGRAM_ID
          )[0],
          masterEdition: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), transferableTicketMint.publicKey.toBuffer(), Buffer.from("edition")],
            METADATA_PROGRAM_ID
          )[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer1, transferableTicketMint])
        .rpc();
    });

    it("Should allow transfer of transferable tickets", async () => {
      const buyer2TokenAccount = await getAssociatedTokenAddress(
        transferableTicketMint.publicKey,
        buyer2.publicKey
      );

      const signature = await program.methods
        .transferTicket()
        .accounts({
          from: buyer1.publicKey,
          to: buyer2.publicKey,
          mint: transferableTicketMint.publicKey,
          fromTokenAccount: transferableTokenAccount,
          toTokenAccount: buyer2TokenAccount,
          event: transferableEventAccount,
          royaltyReceiver: royaltyReceiver.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer1])
        .rpc();

      await gasTracker.trackTransaction("transferTicket", signature);

      // Check token accounts
      const fromTokenAccountInfo = await getAccount(connection, transferableTokenAccount);
      const toTokenAccountInfo = await getAccount(connection, buyer2TokenAccount);

      expect(fromTokenAccountInfo.amount.toString()).to.equal("0");
      expect(toTokenAccountInfo.amount.toString()).to.equal("1");
      expect(toTokenAccountInfo.owner.toBase58()).to.equal(buyer2.publicKey.toBase58());
    });

    it("Should fail to transfer non-transferable tickets", async () => {
      // Try to transfer the non-transferable ticket minted earlier
      const buyer2NonTransferableTokenAccount = await getAssociatedTokenAddress(
        ticketMint.publicKey,
        buyer2.publicKey
      );

      try {
        await program.methods
          .transferTicket()
          .accounts({
            from: buyer1.publicKey,
            to: buyer2.publicKey,
            mint: ticketMint.publicKey,
            fromTokenAccount: ticketTokenAccount,
            toTokenAccount: buyer2NonTransferableTokenAccount,
            event: eventAccount,
            royaltyReceiver: royaltyReceiver.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([buyer1])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("Should fail transfer without proper authorization", async () => {
      // Try to transfer someone else's ticket
      try {
        await program.methods
          .transferTicket()
          .accounts({
            from: buyer2.publicKey, // Wrong signer
            to: buyer1.publicKey,
            mint: transferableTicketMint.publicKey,
            fromTokenAccount: await getAssociatedTokenAddress(transferableTicketMint.publicKey, buyer2.publicKey),
            toTokenAccount: transferableTokenAccount,
            event: transferableEventAccount,
            royaltyReceiver: royaltyReceiver.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([buyer1]) // Wrong signer
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe("Royalty Calculations", () => {
    let royaltyEvent: PublicKey;
    let royaltyTicketMint: Keypair;
    let royaltyTicketAccount: PublicKey;

    before(async () => {
      // Create event with higher royalty
      const royaltyEventData = {
        ...eventData,
        name: "High Royalty Event",
        royaltyBps: 1000, // 10%
        transferable: true,
        ticketPrice: new BN(1 * LAMPORTS_PER_SOL), // 1 SOL for easier calculation
      };

      [royaltyEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(royaltyEventData.name),
        ],
        program.programId
      );

      await program.methods
        .createEvent(
          royaltyEventData.name,
          royaltyEventData.description,
          royaltyEventData.venue,
          royaltyEventData.date,
          royaltyEventData.totalTickets,
          royaltyEventData.ticketPrice,
          royaltyEventData.royaltyBps,
          royaltyEventData.transferable,
          royaltyEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: royaltyEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      // Mint ticket
      royaltyTicketMint = Keypair.generate();
      royaltyTicketAccount = await getAssociatedTokenAddress(
        royaltyTicketMint.publicKey,
        buyer1.publicKey
      );

      await program.methods
        .mintTicket()
        .accounts({
          buyer: buyer1.publicKey,
          organizer: eventOrganizer.publicKey,
          event: royaltyEvent,
          config: configAccount,
          mint: royaltyTicketMint.publicKey,
          tokenAccount: royaltyTicketAccount,
          metadata: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), royaltyTicketMint.publicKey.toBuffer()],
            METADATA_PROGRAM_ID
          )[0],
          masterEdition: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), royaltyTicketMint.publicKey.toBuffer(), Buffer.from("edition")],
            METADATA_PROGRAM_ID
          )[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer1, royaltyTicketMint])
        .rpc();
    });

    it("Should calculate and distribute royalties correctly", async () => {
      const buyer2TokenAccount = await getAssociatedTokenAddress(
        royaltyTicketMint.publicKey,
        buyer2.publicKey
      );

      const royaltyReceiverBalanceBefore = await connection.getBalance(royaltyReceiver.publicKey);
      const buyer1BalanceBefore = await connection.getBalance(buyer1.publicKey);

       // Transfer with royalty payment (simulate secondary sale)
      const transferPrice = new BN(1.5 * LAMPORTS_PER_SOL); // 1.5 SOL
      const expectedRoyalty = transferPrice.muln(1000).divn(10000); // 10% of 1.5 SOL = 0.15 SOL

      const signature = await program.methods
        .transferTicketWithRoyalty(transferPrice)
        .accounts({
          from: buyer1.publicKey,
          to: buyer2.publicKey,
          mint: royaltyTicketMint.publicKey,
          fromTokenAccount: royaltyTicketAccount,
          toTokenAccount: buyer2TokenAccount,
          event: royaltyEvent,
          royaltyReceiver: royaltyReceiver.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer1])
        .rpc();

      await gasTracker.trackTransaction("transferTicketWithRoyalty", signature);

      const royaltyReceiverBalanceAfter = await connection.getBalance(royaltyReceiver.publicKey);
      const buyer1BalanceAfter = await connection.getBalance(buyer1.publicKey);

      // Check royalty payment
      const royaltyPaid = royaltyReceiverBalanceAfter - royaltyReceiverBalanceBefore;
      expect(royaltyPaid).to.be.closeTo(expectedRoyalty.toNumber(), 1000); // Allow for small gas differences

      // Check seller received payment minus royalty and gas
      const sellerReceived = buyer1BalanceAfter - buyer1BalanceBefore;
      const expectedSellerAmount = transferPrice.sub(expectedRoyalty).toNumber();
      expect(sellerReceived).to.be.lessThan(expectedSellerAmount); // Less due to gas costs
      expect(sellerReceived).to.be.greaterThan(expectedSellerAmount - 0.01 * LAMPORTS_PER_SOL); // Within reasonable gas range
    });

    it("Should handle zero royalty correctly", async () => {
      // Create event with zero royalty
      const zeroRoyaltyEventData = {
        ...eventData,
        name: "Zero Royalty Event",
        royaltyBps: 0,
        transferable: true,
      };

      const [zeroRoyaltyEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(zeroRoyaltyEventData.name),
        ],
        program.programId
      );

      await program.methods
        .createEvent(
          zeroRoyaltyEventData.name,
          zeroRoyaltyEventData.description,
          zeroRoyaltyEventData.venue,
          zeroRoyaltyEventData.date,
          zeroRoyaltyEventData.totalTickets,
          zeroRoyaltyEventData.ticketPrice,
          zeroRoyaltyEventData.royaltyBps,
          zeroRoyaltyEventData.transferable,
          zeroRoyaltyEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: zeroRoyaltyEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      // Mint and transfer ticket
      const zeroRoyaltyMint = Keypair.generate();
      const zeroRoyaltyTokenAccount = await getAssociatedTokenAddress(
        zeroRoyaltyMint.publicKey,
        buyer1.publicKey
      );

      await program.methods
        .mintTicket()
        .accounts({
          buyer: buyer1.publicKey,
          organizer: eventOrganizer.publicKey,
          event: zeroRoyaltyEvent,
          config: configAccount,
          mint: zeroRoyaltyMint.publicKey,
          tokenAccount: zeroRoyaltyTokenAccount,
          metadata: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), zeroRoyaltyMint.publicKey.toBuffer()],
            METADATA_PROGRAM_ID
          )[0],
          masterEdition: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), zeroRoyaltyMint.publicKey.toBuffer(), Buffer.from("edition")],
            METADATA_PROGRAM_ID
          )[0],
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer1, zeroRoyaltyMint])
        .rpc();

      const buyer2ZeroRoyaltyAccount = await getAssociatedTokenAddress(
        zeroRoyaltyMint.publicKey,
        buyer2.publicKey
      );

      const royaltyReceiverBalanceBefore = await connection.getBalance(royaltyReceiver.publicKey);

      await program.methods
        .transferTicketWithRoyalty(new BN(1 * LAMPORTS_PER_SOL))
        .accounts({
          from: buyer1.publicKey,
          to: buyer2.publicKey,
          mint: zeroRoyaltyMint.publicKey,
          fromTokenAccount: zeroRoyaltyTokenAccount,
          toTokenAccount: buyer2ZeroRoyaltyAccount,
          event: zeroRoyaltyEvent,
          royaltyReceiver: royaltyReceiver.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer1])
        .rpc();

      const royaltyReceiverBalanceAfter = await connection.getBalance(royaltyReceiver.publicKey);
      
      // No royalty should be paid
      expect(royaltyReceiverBalanceAfter).to.equal(royaltyReceiverBalanceBefore);
    });
  });

  describe("Metadata Management", () => {
    it("Should retrieve ticket metadata correctly", async () => {
      const metadataAccountInfo = await connection.getAccountInfo(ticketMetadata);
      expect(metadataAccountInfo).to.not.be.null;
      expect(metadataAccountInfo!.data.length).to.be.greaterThan(0);

      // Verify metadata program ownership
      expect(metadataAccountInfo!.owner.toBase58()).to.equal(METADATA_PROGRAM_ID.toBase58());
    });

    it("Should update event metadata (organizer only)", async () => {
      const newUri = "https://example.com/updated-metadata.json";
      
      const signature = await program.methods
        .updateEventMetadata(newUri)
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: eventAccount,
        })
        .signers([eventOrganizer])
        .rpc();

      await gasTracker.trackTransaction("updateEventMetadata", signature);

      const event = await program.account.event.fetch(eventAccount);
      expect(event.uri).to.equal(newUri);
    });

    it("Should fail metadata update by non-organizer", async () => {
      try {
        await program.methods
          .updateEventMetadata("https://malicious.com/metadata.json")
          .accounts({
            organizer: unauthorizedUser.publicKey,
            event: eventAccount,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("Should validate metadata URI format", async () => {
      try {
        await program.methods
          .updateEventMetadata("invalid-uri")
          .accounts({
            organizer: eventOrganizer.publicKey,
            event: eventAccount,
          })
          .signers([eventOrganizer])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe("Emergency Controls", () => {
    it("Should pause contract (admin only)", async () => {
      const signature = await program.methods
        .pauseContract()
        .accounts({
          admin: admin.publicKey,
          config: configAccount,
        })
        .signers([admin])
        .rpc();

      await gasTracker.trackTransaction("pauseContract", signature);

      const config = await program.account.config.fetch(configAccount);
      expect(config.paused).to.be.true;
    });

    it("Should fail operations when paused", async () => {
      const pausedEventData = {
        ...eventData,
        name: "Paused Event",
      };

      const [pausedEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(pausedEventData.name),
        ],
        program.programId
      );

      try {
        await program.methods
          .createEvent(
            pausedEventData.name,
            pausedEventData.description,
            pausedEventData.venue,
            pausedEventData.date,
            pausedEventData.totalTickets,
            pausedEventData.ticketPrice,
            pausedEventData.royaltyBps,
            pausedEventData.transferable,
            pausedEventData.uri
          )
          .accounts({
            organizer: eventOrganizer.publicKey,
            event: pausedEvent,
            config: configAccount,
            systemProgram: SystemProgram.programId,
          })
          .signers([eventOrganizer])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("Should unpause contract (admin only)", async () => {
      const signature = await program.methods
        .unpauseContract()
        .accounts({
          admin: admin.publicKey,
          config: configAccount,
        })
        .signers([admin])
        .rpc();

      await gasTracker.trackTransaction("unpauseContract", signature);

      const config = await program.account.config.fetch(configAccount);
      expect(config.paused).to.be.false;
    });

    it("Should fail pause/unpause by non-admin", async () => {
      try {
        await program.methods
          .pauseContract()
          .accounts({
            admin: unauthorizedUser.publicKey,
            config: configAccount,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("Should update admin (admin only)", async () => {
      const newAdmin = Keypair.generate();
      
      const signature = await program.methods
        .updateAdmin(newAdmin.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configAccount,
        })
        .signers([admin])
        .rpc();

      await gasTracker.trackTransaction("updateAdmin", signature);

      const config = await program.account.config.fetch(configAccount);
      expect(config.admin.toBase58()).to.equal(newAdmin.publicKey.toBase58());

      // Restore original admin for other tests
      await program.methods
        .updateAdmin(admin.publicKey)
        .accounts({
          admin: newAdmin.publicKey,
          config: configAccount,
        })
        .signers([newAdmin])
        .rpc();
    });

    it("Should emergency close event (admin only)", async () => {
      const emergencyEventData = {
        ...eventData,
        name: "Emergency Event",
      };

      const [emergencyEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(emergencyEventData.name),
        ],
        program.programId
      );

      // Create event
      await program.methods
        .createEvent(
          emergencyEventData.name,
          emergencyEventData.description,
          emergencyEventData.venue,
          emergencyEventData.date,
          emergencyEventData.totalTickets,
          emergencyEventData.ticketPrice,
          emergencyEventData.royaltyBps,
          emergencyEventData.transferable,
          emergencyEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: emergencyEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      // Emergency close
      const signature = await program.methods
        .emergencyCloseEvent()
        .accounts({
          admin: admin.publicKey,
          event: emergencyEvent,
          config: configAccount,
        })
        .signers([admin])
        .rpc();

      await gasTracker.trackTransaction("emergencyCloseEvent", signature);

      const event = await program.account.event.fetch(emergencyEvent);
      expect(event.active).to.be.false;
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    it("Should handle maximum ticket supply", async () => {
      const maxEventData = {
        ...eventData,
        name: "Max Supply Event",
        totalTickets: new BN(4294967295), // Max u32
      };

      const [maxEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(maxEventData.name),
        ],
        program.programId
      );

      const signature = await program.methods
        .createEvent(
          maxEventData.name,
          maxEventData.description,
          maxEventData.venue,
          maxEventData.date,
          maxEventData.totalTickets,
          maxEventData.ticketPrice,
          maxEventData.royaltyBps,
          maxEventData.transferable,
          maxEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: maxEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      await gasTracker.trackTransaction("createMaxSupplyEvent", signature);

      const event = await program.account.event.fetch(maxEvent);
      expect(event.totalTickets.toNumber()).to.equal(4294967295);
    });

    it("Should handle minimum ticket price", async () => {
      const minPriceEventData = {
        ...eventData,
        name: "Min Price Event",
        ticketPrice: new BN(1), // 1 lamport
      };

      const [minPriceEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(minPriceEventData.name),
        ],
        program.programId
      );

      await program.methods
        .createEvent(
          minPriceEventData.name,
          minPriceEventData.description,
          minPriceEventData.venue,
          minPriceEventData.date,
          minPriceEventData.totalTickets,
          minPriceEventData.ticketPrice,
          minPriceEventData.royaltyBps,
          minPriceEventData.transferable,
          minPriceEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: minPriceEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      const event = await program.account.event.fetch(minPriceEvent);
      expect(event.ticketPrice.toNumber()).to.equal(1);
    });

    it("Should handle long event names", async () => {
      const longName = "A".repeat(64); // Maximum reasonable length
      const longEventData = {
        ...eventData,
        name: longName,
      };

      const [longNameEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(longEventData.name),
        ],
        program.programId
      );

      await program.methods
        .createEvent(
          longEventData.name,
          longEventData.description,
          longEventData.venue,
          longEventData.date,
          longEventData.totalTickets,
          longEventData.ticketPrice,
          longEventData.royaltyBps,
          longEventData.transferable,
          longEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: longNameEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      const event = await program.account.event.fetch(longNameEvent);
      expect(event.name).to.equal(longName);
    });

    it("Should fail with extremely long URIs", async () => {
      const extremelyLongUri = "https://example.com/" + "a".repeat(1000);
      
      try {
        await program.methods
          .updateEventMetadata(extremelyLongUri)
          .accounts({
            organizer: eventOrganizer.publicKey,
            event: eventAccount,
          })
          .signers([eventOrganizer])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("Should handle concurrent minting attempts", async () => {
      const concurrentEventData = {
        ...eventData,
        name: "Concurrent Event",
        totalTickets: new BN(2), // Small supply for race condition
      };

      const [concurrentEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(concurrentEventData.name),
        ],
        program.programId
      );

      await program.methods
        .createEvent(
          concurrentEventData.name,
          concurrentEventData.description,
          concurrentEventData.venue,
          concurrentEventData.date,
          concurrentEventData.totalTickets,
          concurrentEventData.ticketPrice,
          concurrentEventData.royaltyBps,
          concurrentEventData.transferable,
          concurrentEventData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: concurrentEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      // Simulate concurrent minting
      const mint1 = Keypair.generate();
      const mint2 = Keypair.generate();
      const tokenAccount1 = await getAssociatedTokenAddress(mint1.publicKey, buyer1.publicKey);
      const tokenAccount2 = await getAssociatedTokenAddress(mint2.publicKey, buyer2.publicKey);

      const promises = [
        program.methods
          .mintTicket()
          .accounts({
            buyer: buyer1.publicKey,
            organizer: eventOrganizer.publicKey,
            event: concurrentEvent,
            config: configAccount,
            mint: mint1.publicKey,
            tokenAccount: tokenAccount1,
            metadata: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint1.publicKey.toBuffer()],
              METADATA_PROGRAM_ID
            )[0],
            masterEdition: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint1.publicKey.toBuffer(), Buffer.from("edition")],
              METADATA_PROGRAM_ID
            )[0],
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            metadataProgram: METADATA_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer1, mint1])
          .rpc(),
        
        program.methods
          .mintTicket()
          .accounts({
            buyer: buyer2.publicKey,
            organizer: eventOrganizer.publicKey,
            event: concurrentEvent,
            config: configAccount,
            mint: mint2.publicKey,
            tokenAccount: tokenAccount2,
            metadata: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint2.publicKey.toBuffer()],
              METADATA_PROGRAM_ID
            )[0],
            masterEdition: PublicKey.findProgramAddressSync(
              [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint2.publicKey.toBuffer(), Buffer.from("edition")],
              METADATA_PROGRAM_ID
            )[0],
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            metadataProgram: METADATA_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer2, mint2])
          .rpc(),
      ];

      const results = await Promise.allSettled(promises);
      
      // At least one should succeed
      const successCount = results.filter(r => r.status === "fulfilled").length;
      expect(successCount).to.be.greaterThan(0);
      expect(successCount).to.be.lessThanOrEqual(2);

      // Check final event state
      const event = await program.account.event.fetch(concurrentEvent);
      expect(event.ticketsSold.toNumber()).to.equal(successCount);
    });
  });

  describe("SOL Cost Analysis", () => {
    it("Should track and optimize gas costs", async () => {
      console.log("\n💰 SOL Cost Analysis:");
      console.log("━".repeat(50));
      
      const costs = {
        initialize: gasTracker.getCost("initialize"),
        createEvent: gasTracker.getCost("createEvent"),
        mintTicket: gasTracker.getCost("mintTicket"),
        transferTicket: gasTracker.getCost("transferTicket"),
        transferTicketWithRoyalty: gasTracker.getCost("transferTicketWithRoyalty"),
        updateEventMetadata: gasTracker.getCost("updateEventMetadata"),
        pauseContract: gasTracker.getCost("pauseContract"),
        unpauseContract: gasTracker.getCost("unpauseContract"),
        updateAdmin: gasTracker.getCost("updateAdmin"),
        emergencyCloseEvent: gasTracker.getCost("emergencyCloseEvent"),
      };

      // Verify reasonable gas costs
      expect(costs.initialize).to.be.lessThan(0.01 * LAMPORTS_PER_SOL);
      expect(costs.createEvent).to.be.lessThan(0.01 * LAMPORTS_PER_SOL);
      expect(costs.mintTicket).to.be.lessThan(0.02 * LAMPORTS_PER_SOL); // Higher due to metadata creation
      expect(costs.transferTicket).to.be.lessThan(0.01 * LAMPORTS_PER_SOL);

      console.log(`Most expensive operation: mintTicket (${(costs.mintTicket / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
      console.log(`Cheapest operation: pauseContract (${(costs.pauseContract / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
    });

    it("Should calculate total deployment cost", async () => {
      const totalCost = gasTracker.getTotalCosts();
      console.log(`\n📊 Total test execution cost: ${(totalCost / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      
      // Should be reasonable for a comprehensive test suite
      expect(totalCost).to.be.lessThan(0.5 * LAMPORTS_PER_SOL);
    });
  });

  describe("Integration Tests", () => {
    it("Should integrate with token program correctly", async () => {
      // Verify token account structure
      const tokenAccountInfo = await getAccount(connection, ticketTokenAccount);
      
      expect(tokenAccountInfo.mint.toBase58()).to.equal(ticketMint.publicKey.toBase58());
      expect(tokenAccountInfo.owner.toBase58()).to.equal(buyer1.publicKey.toBase58());
      expect(tokenAccountInfo.amount.toString()).to.equal("1");
      expect(tokenAccountInfo.delegate).to.be.null;
      expect(tokenAccountInfo.isFrozen).to.be.false;
    });

    it("Should integrate with metadata program correctly", async () => {
      const metadataAccountInfo = await connection.getAccountInfo(ticketMetadata);
      
      expect(metadataAccountInfo).to.not.be.null;
      expect(metadataAccountInfo!.owner.toBase58()).to.equal(METADATA_PROGRAM_ID.toBase58());
      expect(metadataAccountInfo!.data.length).to.be.greaterThan(0);
    });

    it("Should handle cross-program invocations safely", async () => {
      // Test that CPI calls work correctly and don't allow unauthorized access
      const event = await program.account.event.fetch(eventAccount);
      expect(event.ticketsSold.toNumber()).to.be.greaterThan(0);
      
      // Verify that only our program can modify our accounts
      const configInfo = await connection.getAccountInfo(configAccount);
      expect(configInfo!.owner.toBase58()).to.equal(program.programId.toBase58());
    });
  });

  describe("Performance and Limits", () => {
    it("Should handle maximum account data efficiently", async () => {
      // Test with maximum length strings
      const maxData = {
        name: "X".repeat(32),
        description: "D".repeat(200),
        venue: "V".repeat(100),
        uri: "https://example.com/" + "u".repeat(150),
      };

      const [maxDataEvent] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          eventOrganizer.publicKey.toBuffer(),
          Buffer.from(maxData.name),
        ],
        program.programId
      );

      const startTime = Date.now();
      
      await program.methods
        .createEvent(
          maxData.name,
          maxData.description,
          maxData.venue,
          eventData.date,
          eventData.totalTickets,
          eventData.ticketPrice,
          eventData.royaltyBps,
          eventData.transferable,
          maxData.uri
        )
        .accounts({
          organizer: eventOrganizer.publicKey,
          event: maxDataEvent,
          config: configAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([eventOrganizer])
        .rpc();

      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      console.log(`Max data event creation time: ${executionTime}ms`);
      expect(executionTime).to.be.lessThan(5000); // Should complete within 5 seconds
    });

    it("Should verify account size limits", async () => {
      const eventAccountInfo = await connection.getAccountInfo(eventAccount);
      const configAccountInfo = await connection.getAccountInfo(configAccount);
      
      console.log(`Event account size: ${eventAccountInfo!.data.length} bytes`);
      console.log(`Config account size: ${configAccountInfo!.data.length} bytes`);
      
      // Verify accounts are within reasonable size limits
      expect(eventAccountInfo!.data.length).to.be.lessThan(1024); // 1KB limit
      expect(configAccountInfo!.data.length).to.be.lessThan(256); // 256B limit
    });
  });
});
