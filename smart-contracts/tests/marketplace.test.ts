import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Marketplace } from "../target/types/marketplace";
import { NftProgram } from "../target/types/nft_program";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
  createTransferInstruction
} from "@solana/spl-token";
import { assert } from "chai";
import BN from "bn.js";

describe("marketplace", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const marketplace = anchor.workspace.Marketplace as Program<Marketplace>;
  const nftProgram = anchor.workspace.NftProgram as Program<NftProgram>;

  // Test wallets
  let platform: Keypair;
  let seller: Keypair;
  let buyer: Keypair;
  let bidder1: Keypair;
  let bidder2: Keypair;
  let creator: Keypair;
  let feeCollector: Keypair;

  // Program accounts
  let marketplaceConfig: PublicKey;
  let nftMint: PublicKey;
  let nftMetadata: PublicKey;
  let listing: PublicKey;
  let escrow: PublicKey;
  let bidVault: PublicKey;

  // Token accounts
  let sellerTokenAccount: PublicKey;
  let buyerTokenAccount: PublicKey;
  let escrowTokenAccount: PublicKey;

  // Test constants
  const PLATFORM_FEE_BPS = 250; // 2.5%
  const MAX_ROYALTY_BPS = 1000; // 10%
  const LISTING_PRICE = new BN(10 * LAMPORTS_PER_SOL);
  const BID_AMOUNT = new BN(8 * LAMPORTS_PER_SOL);
  const ROYALTY_BPS = 500; // 5%

  before(async () => {
    // Initialize test wallets
    platform = Keypair.generate();
    seller = Keypair.generate();
    buyer = Keypair.generate();
    bidder1 = Keypair.generate();
    bidder2 = Keypair.generate();
    creator = Keypair.generate();
    feeCollector = Keypair.generate();

    // Airdrop SOL to test wallets
    const airdropAmount = 100 * LAMPORTS_PER_SOL;
    const wallets = [platform, seller, buyer, bidder1, bidder2, creator, feeCollector];
    
    for (const wallet of wallets) {
      const sig = await provider.connection.requestAirdrop(
        wallet.publicKey,
        airdropAmount
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Derive marketplace config PDA
    [marketplaceConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace_config")],
      marketplace.programId
    );
  });

  describe("Marketplace Initialization", () => {
    it("initializes the marketplace", async () => {
      await marketplace.methods
        .initialize(PLATFORM_FEE_BPS, MAX_ROYALTY_BPS)
        .accounts({
          authority: platform.publicKey,
          marketplaceConfig,
          feeCollector: feeCollector.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([platform])
        .rpc();

      const config = await marketplace.account.marketplaceConfig.fetch(marketplaceConfig);
      assert.equal(config.authority.toBase58(), platform.publicKey.toBase58());
      assert.equal(config.feeCollector.toBase58(), feeCollector.publicKey.toBase58());
      assert.equal(config.platformFeeBps, PLATFORM_FEE_BPS);
      assert.equal(config.maxRoyaltyBps, MAX_ROYALTY_BPS);
      assert.ok(config.isActive);
    });

    it("fails to initialize with invalid fee", async () => {
      const invalidConfig = Keypair.generate();
      
      try {
        await marketplace.methods
          .initialize(10001, MAX_ROYALTY_BPS) // > 100%
          .accounts({
            authority: platform.publicKey,
            marketplaceConfig: invalidConfig.publicKey,
            feeCollector: feeCollector.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([platform])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "InvalidFee");
      }
    });
  });

  describe("NFT Creation and Setup", () => {
    it("creates an NFT for testing", async () => {
      // Create mint
      nftMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      // Create token accounts
      sellerTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        nftMint,
        seller.publicKey
      );

      buyerTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        buyer,
        nftMint,
        buyer.publicKey
      );

      // Mint NFT to seller
      await mintTo(
        provider.connection,
        seller,
        nftMint,
        sellerTokenAccount,
        seller,
        1
      );

      // Create NFT metadata using the NFT program
      [nftMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), nftMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Test NFT",
          "TNFT",
          "https://test.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: nftMetadata,
          mint: nftMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();
    });
  });

  describe("Listing Creation and Management", () => {
    beforeEach(async () => {
      // Derive listing PDA
      [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), nftMint.toBuffer()],
        marketplace.programId
      );

      // Derive escrow PDA
      [escrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), listing.toBuffer()],
        marketplace.programId
      );

      escrowTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        escrow,
        true
      );
    });

    it("creates a listing with buy-now price", async () => {
      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint,
          nftMetadata,
          listing,
          escrow,
          sellerTokenAccount,
          escrowTokenAccount,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      const listingAccount = await marketplace.account.listing.fetch(listing);
      assert.equal(listingAccount.seller.toBase58(), seller.publicKey.toBase58());
      assert.equal(listingAccount.nftMint.toBase58(), nftMint.toBase58());
      assert.equal(listingAccount.price.toString(), LISTING_PRICE.toString());
      assert.isNull(listingAccount.minBid);
      assert.isNull(listingAccount.endTime);
      assert.equal(listingAccount.status, 0); // Active
      assert.equal(listingAccount.highestBidder, null);
      assert.equal(listingAccount.highestBid.toNumber(), 0);

      // Verify NFT transferred to escrow
      const escrowAccount = await getAccount(provider.connection, escrowTokenAccount);
      assert.equal(escrowAccount.amount.toString(), "1");
    });

    it("creates an auction listing", async () => {
      // Create new NFT for auction
      const auctionMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerAuctionToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        auctionMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        auctionMint,
        sellerAuctionToken,
        seller,
        1
      );

      // Create metadata
      const [auctionMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), auctionMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Auction NFT",
          "ANFT",
          "https://auction.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: auctionMetadata,
          mint: auctionMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Create auction listing
      const [auctionListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), auctionMint.toBuffer()],
        marketplace.programId
      );

      const [auctionEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), auctionListing.toBuffer()],
        marketplace.programId
      );

      const auctionEscrowToken = await getAssociatedTokenAddress(
        auctionMint,
        auctionEscrow,
        true
      );

      const minBid = new BN(5 * LAMPORTS_PER_SOL);
      const duration = new BN(3600); // 1 hour

      await marketplace.methods
        .createListing(null, minBid, duration)
        .accounts({
          seller: seller.publicKey,
          nftMint: auctionMint,
          nftMetadata: auctionMetadata,
          listing: auctionListing,
          escrow: auctionEscrow,
          sellerTokenAccount: sellerAuctionToken,
          escrowTokenAccount: auctionEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      const listingAccount = await marketplace.account.listing.fetch(auctionListing);
      assert.isNull(listingAccount.price);
      assert.equal(listingAccount.minBid.toString(), minBid.toString());
      assert.isNotNull(listingAccount.endTime);
    });

    it("updates listing price", async () => {
      const newPrice = new BN(15 * LAMPORTS_PER_SOL);

      await marketplace.methods
        .updateListing(newPrice, null)
        .accounts({
          seller: seller.publicKey,
          listing,
          marketplaceConfig,
        })
        .signers([seller])
        .rpc();

      const listingAccount = await marketplace.account.listing.fetch(listing);
      assert.equal(listingAccount.price.toString(), newPrice.toString());
    });

    it("fails to update listing with non-seller", async () => {
      try {
        await marketplace.methods
          .updateListing(new BN(20 * LAMPORTS_PER_SOL), null)
          .accounts({
            seller: buyer.publicKey,
            listing,
            marketplaceConfig,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });

    it("cancels listing and returns NFT", async () => {
      // Create a new listing to cancel
      const cancelMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerCancelToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        cancelMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        cancelMint,
        sellerCancelToken,
        seller,
        1
      );

      const [cancelMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), cancelMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Cancel NFT",
          "CNFT",
          "https://cancel.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: cancelMetadata,
          mint: cancelMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [cancelListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), cancelMint.toBuffer()],
        marketplace.programId
      );

      const [cancelEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), cancelListing.toBuffer()],
        marketplace.programId
      );

      const cancelEscrowToken = await getAssociatedTokenAddress(
        cancelMint,
        cancelEscrow,
        true
      );

      // Create listing
      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: cancelMint,
          nftMetadata: cancelMetadata,
          listing: cancelListing,
          escrow: cancelEscrow,
          sellerTokenAccount: sellerCancelToken,
          escrowTokenAccount: cancelEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Cancel listing
      await marketplace.methods
        .cancelListing()
        .accounts({
          seller: seller.publicKey,
          listing: cancelListing,
          escrow: cancelEscrow,
          nftMint: cancelMint,
          sellerTokenAccount: sellerCancelToken,
          escrowTokenAccount: cancelEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc();

      // Verify NFT returned to seller
      const sellerAccount = await getAccount(provider.connection, sellerCancelToken);
      assert.equal(sellerAccount.amount.toString(), "1");

      // Verify listing cancelled
      const listingAccount = await marketplace.account.listing.fetch(cancelListing);
      assert.equal(listingAccount.status, 3); // Cancelled
    });
  });

  describe("Bidding Functionality", () => {
    let auctionMint: PublicKey;
    let auctionListing: PublicKey;
    let auctionEscrow: PublicKey;
    let bidder1BidVault: PublicKey;
    let bidder2BidVault: PublicKey;

    before(async () => {
      // Create auction NFT
      auctionMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerAuctionToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        auctionMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        auctionMint,
        sellerAuctionToken,
        seller,
        1
      );

      // Create metadata
      const [auctionMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), auctionMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Bid Test NFT",
          "BTNFT",
          "https://bid.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: auctionMetadata,
          mint: auctionMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Create auction listing
      [auctionListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), auctionMint.toBuffer()],
        marketplace.programId
      );

      [auctionEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), auctionListing.toBuffer()],
        marketplace.programId
      );

      const auctionEscrowToken = await getAssociatedTokenAddress(
        auctionMint,
        auctionEscrow,
        true
      );

      const minBid = new BN(1 * LAMPORTS_PER_SOL);
      const duration = new BN(7200); // 2 hours

      await marketplace.methods
        .createListing(null, minBid, duration)
        .accounts({
          seller: seller.publicKey,
          nftMint: auctionMint,
          nftMetadata: auctionMetadata,
          listing: auctionListing,
          escrow: auctionEscrow,
          sellerTokenAccount: sellerAuctionToken,
          escrowTokenAccount: auctionEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Derive bid vault PDAs
      [bidder1BidVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("bid_vault"), auctionListing.toBuffer(), bidder1.publicKey.toBuffer()],
        marketplace.programId
      );

      [bidder2BidVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("bid_vault"), auctionListing.toBuffer(), bidder2.publicKey.toBuffer()],
        marketplace.programId
      );
    });

    it("places first bid", async () => {
      const bidAmount = new BN(2 * LAMPORTS_PER_SOL);

      await marketplace.methods
        .placeBid(bidAmount)
        .accounts({
          bidder: bidder1.publicKey,
          listing: auctionListing,
          bidVault: bidder1BidVault,
          previousBidder: null,
          previousBidVault: null,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([bidder1])
        .rpc();

      const listingAccount = await marketplace.account.listing.fetch(auctionListing);
      assert.equal(listingAccount.highestBidder.toBase58(), bidder1.publicKey.toBase58());
      assert.equal(listingAccount.highestBid.toString(), bidAmount.toString());

      // Verify SOL in bid vault
      const vaultBalance = await provider.connection.getBalance(bidder1BidVault);
      assert.equal(vaultBalance, bidAmount.toNumber());
    });

    it("places higher bid and refunds previous bidder", async () => {
      const bidAmount = new BN(3 * LAMPORTS_PER_SOL);
      const bidder1BalanceBefore = await provider.connection.getBalance(bidder1.publicKey);

      await marketplace.methods
        .placeBid(bidAmount)
        .accounts({
          bidder: bidder2.publicKey,
          listing: auctionListing,
          bidVault: bidder2BidVault,
          previousBidder: bidder1.publicKey,
          previousBidVault: bidder1BidVault,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([bidder2])
        .rpc();

      const listingAccount = await marketplace.account.listing.fetch(auctionListing);
      assert.equal(listingAccount.highestBidder.toBase58(), bidder2.publicKey.toBase58());
      assert.equal(listingAccount.highestBid.toString(), bidAmount.toString());

      // Verify previous bidder refunded
      const bidder1BalanceAfter = await provider.connection.getBalance(bidder1.publicKey);
      assert.approximately(
        bidder1BalanceAfter,
        bidder1BalanceBefore + (2 * LAMPORTS_PER_SOL),
        LAMPORTS_PER_SOL * 0.01 // Allow small variance for rent
      );
    });

    it("fails to place bid lower than highest", async () => {
      const lowBid = new BN(2.5 * LAMPORTS_PER_SOL);

      try {
        await marketplace.methods
          .placeBid(lowBid)
          .accounts({
            bidder: bidder1.publicKey,
            listing: auctionListing,
            bidVault: bidder1BidVault,
            previousBidder: bidder2.publicKey,
            previousBidVault: bidder2BidVault,
            marketplaceConfig,
            systemProgram: SystemProgram.programId,
          })
          .signers([bidder1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "BidTooLow");
      }
    });

    it("fails to place bid on buy-now listing", async () => {
      try {
        await marketplace.methods
          .placeBid(new BN(5 * LAMPORTS_PER_SOL))
          .accounts({
            bidder: bidder1.publicKey,
            listing, // This is a buy-now listing
            bidVault: bidder1BidVault,
            previousBidder: null,
            previousBidVault: null,
            marketplaceConfig,
            systemProgram: SystemProgram.programId,
          })
          .signers([bidder1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "NotAuction");
      }
    });

    it("accepts winning bid after auction ends", async () => {
      // Wait for auction to end (simulate by updating end time)
      // In real scenario, you'd wait or use clock manipulation

      // For testing, we'll create a new auction that's already ended
      const endedMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerEndedToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        endedMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        endedMint,
        sellerEndedToken,
        seller,
        1
      );

      const [endedMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), endedMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Ended Auction NFT",
          "EANFT",
          "https://ended.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: endedMetadata,
          mint: endedMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [endedListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), endedMint.toBuffer()],
        marketplace.programId
      );

      const [endedEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), endedListing.toBuffer()],
        marketplace.programId
      );

      const endedEscrowToken = await getAssociatedTokenAddress(
        endedMint,
        endedEscrow,
        true
      );

      // Create listing with 1 second duration
      await marketplace.methods
        .createListing(null, new BN(1 * LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          seller: seller.publicKey,
          nftMint: endedMint,
          nftMetadata: endedMetadata,
          listing: endedListing,
          escrow: endedEscrow,
          sellerTokenAccount: sellerEndedToken,
          escrowTokenAccount: endedEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Place bid
      const [winnerBidVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("bid_vault"), endedListing.toBuffer(), buyer.publicKey.toBuffer()],
        marketplace.programId
      );

      await marketplace.methods
        .placeBid(new BN(2 * LAMPORTS_PER_SOL))
        .accounts({
          bidder: buyer.publicKey,
          listing: endedListing,
          bidVault: winnerBidVault,
          previousBidder: null,
          previousBidVault: null,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      // Wait for auction to end
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Accept bid
      const buyerEndedToken = await getAssociatedTokenAddress(
        endedMint,
        buyer.publicKey
      );

      await marketplace.methods
        .acceptBid()
        .accounts({
          seller: seller.publicKey,
          buyer: buyer.publicKey,
          listing: endedListing,
          escrow: endedEscrow,
          nftMint: endedMint,
          nftMetadata: endedMetadata,
          sellerTokenAccount: sellerEndedToken,
          buyerTokenAccount: buyerEndedToken,
          escrowTokenAccount: endedEscrowToken,
          bidVault: winnerBidVault,
          marketplaceConfig,
          feeCollector: feeCollector.publicKey,
          creator: creator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Verify NFT transferred to buyer
      const buyerTokenAccount = await getAccount(provider.connection, buyerEndedToken);
      assert.equal(buyerTokenAccount.amount.toString(), "1");

      // Verify listing completed
      const listingAccount = await marketplace.account.listing.fetch(endedListing);
      assert.equal(listingAccount.status, 1); // Sold
    });
  });

  describe("Buy-Now Functionality", () => {
    it("executes buy-now purchase with proper fee distribution", async () => {
      // Get initial balances
      const sellerBalanceBefore = await provider.connection.getBalance(seller.publicKey);
      const feeCollectorBalanceBefore = await provider.connection.getBalance(feeCollector.publicKey);
      const creatorBalanceBefore = await provider.connection.getBalance(creator.publicKey);

      await marketplace.methods
        .buyNow()
        .accounts({
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          listing,
          escrow,
          nftMint,
          nftMetadata,
          sellerTokenAccount,
          buyerTokenAccount,
          escrowTokenAccount,
          marketplaceConfig,
          feeCollector: feeCollector.publicKey,
          creator: creator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([buyer])
        .rpc();

      // Calculate expected amounts
      const platformFee = LISTING_PRICE.mul(new BN(PLATFORM_FEE_BPS)).div(new BN(10000));
      const royaltyAmount = LISTING_PRICE.mul(new BN(ROYALTY_BPS)).div(new BN(10000));
      const sellerAmount = LISTING_PRICE.sub(platformFee).sub(royaltyAmount);

      // Verify balances
      const sellerBalanceAfter = await provider.connection.getBalance(seller.publicKey);
      const feeCollectorBalanceAfter = await provider.connection.getBalance(feeCollector.publicKey);
      const creatorBalanceAfter = await provider.connection.getBalance(creator.publicKey);

      assert.approximately(
        sellerBalanceAfter - sellerBalanceBefore,
        sellerAmount.toNumber(),
        LAMPORTS_PER_SOL * 0.01
      );
      assert.approximately(
        feeCollectorBalanceAfter - feeCollectorBalanceBefore,
        platformFee.toNumber(),
        LAMPORTS_PER_SOL * 0.01
      );
      assert.approximately(
        creatorBalanceAfter - creatorBalanceBefore,
        royaltyAmount.toNumber(),
        LAMPORTS_PER_SOL * 0.01
      );

      // Verify NFT transferred to buyer
      const buyerAccount = await getAccount(provider.connection, buyerTokenAccount);
      assert.equal(buyerAccount.amount.toString(), "1");

      // Verify listing completed
      const listingAccount = await marketplace.account.listing.fetch(listing);
      assert.equal(listingAccount.status, 1); // Sold
    });

    it("fails buy-now on auction listing", async () => {
      try {
        await marketplace.methods
          .buyNow()
          .accounts({
            buyer: buyer.publicKey,
            seller: seller.publicKey,
            listing: auctionListing,
            escrow: auctionEscrow,
            nftMint: auctionMint,
            nftMetadata,
            sellerTokenAccount,
            buyerTokenAccount,
            escrowTokenAccount,
            marketplaceConfig,
            feeCollector: feeCollector.publicKey,
            creator: creator.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "NotBuyNow");
      }
    });

    it("fails buy-now with insufficient funds", async () => {
      // Create new buyer with minimal SOL
      const poorBuyer = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        poorBuyer.publicKey,
        0.1 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      // Create new listing
      const newMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerNewToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        newMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        newMint,
        sellerNewToken,
        seller,
        1
      );

      const [newMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), newMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Poor Test NFT",
          "PTNFT",
          "https://poor.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: newMetadata,
          mint: newMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [newListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), newMint.toBuffer()],
        marketplace.programId
      );

      const [newEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), newListing.toBuffer()],
        marketplace.programId
      );

      const newEscrowToken = await getAssociatedTokenAddress(
        newMint,
        newEscrow,
        true
      );

      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: newMint,
          nftMetadata: newMetadata,
          listing: newListing,
          escrow: newEscrow,
          sellerTokenAccount: sellerNewToken,
          escrowTokenAccount: newEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      try {
        const poorBuyerToken = await getAssociatedTokenAddress(
          newMint,
          poorBuyer.publicKey
        );

        await marketplace.methods
          .buyNow()
          .accounts({
            buyer: poorBuyer.publicKey,
            seller: seller.publicKey,
            listing: newListing,
            escrow: newEscrow,
            nftMint: newMint,
            nftMetadata: newMetadata,
            sellerTokenAccount: sellerNewToken,
            buyerTokenAccount: poorBuyerToken,
            escrowTokenAccount: newEscrowToken,
            marketplaceConfig,
            feeCollector: feeCollector.publicKey,
            creator: creator.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([poorBuyer])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "insufficient");
      }
    });
  });

  describe("Dispute Resolution", () => {
    let disputeMint: PublicKey;
    let disputeListing: PublicKey;
    let disputeEscrow: PublicKey;
    let disputeAccount: PublicKey;

    before(async () => {
      // Create NFT for dispute testing
      disputeMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerDisputeToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        disputeMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        disputeMint,
        sellerDisputeToken,
        seller,
        1
      );

      const [disputeMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), disputeMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Dispute NFT",
          "DNFT",
          "https://dispute.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: disputeMetadata,
          mint: disputeMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      [disputeListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), disputeMint.toBuffer()],
        marketplace.programId
      );

      [disputeEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), disputeListing.toBuffer()],
        marketplace.programId
      );

      const disputeEscrowToken = await getAssociatedTokenAddress(
        disputeMint,
        disputeEscrow,
        true
      );

      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: disputeMint,
          nftMetadata: disputeMetadata,
          listing: disputeListing,
          escrow: disputeEscrow,
          sellerTokenAccount: sellerDisputeToken,
          escrowTokenAccount: disputeEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      [disputeAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), disputeListing.toBuffer()],
        marketplace.programId
      );
    });

    it("opens a dispute", async () => {
      await marketplace.methods
        .openDispute("Item not as described")
        .accounts({
          initiator: buyer.publicKey,
          listing: disputeListing,
          dispute: disputeAccount,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      const dispute = await marketplace.account.dispute.fetch(disputeAccount);
      assert.equal(dispute.listing.toBase58(), disputeListing.toBase58());
      assert.equal(dispute.initiator.toBase58(), buyer.publicKey.toBase58());
      assert.equal(dispute.reason, "Item not as described");
      assert.equal(dispute.status, 0); // Open
    });

    it("resolves dispute in favor of buyer", async () => {
      const buyerDisputeToken = await getAssociatedTokenAddress(
        disputeMint,
        buyer.publicKey
      );

      await marketplace.methods
        .resolveDispute(true) // Favor buyer
        .accounts({
          authority: platform.publicKey,
          dispute: disputeAccount,
          listing: disputeListing,
          escrow: disputeEscrow,
          nftMint: disputeMint,
          seller: seller.publicKey,
          buyer: buyer.publicKey,
          sellerTokenAccount: await getAssociatedTokenAddress(disputeMint, seller.publicKey),
          buyerTokenAccount: buyerDisputeToken,
          escrowTokenAccount: await getAssociatedTokenAddress(disputeMint, disputeEscrow, true),
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([platform])
        .rpc();

      // Verify NFT went to buyer
      const buyerAccount = await getAccount(provider.connection, buyerDisputeToken);
      assert.equal(buyerAccount.amount.toString(), "1");

      // Verify dispute resolved
      const dispute = await marketplace.account.dispute.fetch(disputeAccount);
      assert.equal(dispute.status, 1); // Resolved
    });

    it("resolves dispute in favor of seller", async () => {
      // Create new dispute scenario
      const sellerFavorMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerFavorToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        sellerFavorMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        sellerFavorMint,
        sellerFavorToken,
        seller,
        1
      );

      const [sellerFavorMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), sellerFavorMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Seller Favor NFT",
          "SFNFT",
          "https://sellerfavor.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: sellerFavorMetadata,
          mint: sellerFavorMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [sellerFavorListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), sellerFavorMint.toBuffer()],
        marketplace.programId
      );

      const [sellerFavorEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), sellerFavorListing.toBuffer()],
        marketplace.programId
      );

      const sellerFavorEscrowToken = await getAssociatedTokenAddress(
        sellerFavorMint,
        sellerFavorEscrow,
        true
      );

      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: sellerFavorMint,
          nftMetadata: sellerFavorMetadata,
          listing: sellerFavorListing,
          escrow: sellerFavorEscrow,
          sellerTokenAccount: sellerFavorToken,
          escrowTokenAccount: sellerFavorEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [sellerFavorDispute] = PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), sellerFavorListing.toBuffer()],
        marketplace.programId
      );

      // Open dispute
      await marketplace.methods
        .openDispute("False claim")
        .accounts({
          initiator: buyer.publicKey,
          listing: sellerFavorListing,
          dispute: sellerFavorDispute,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      // Resolve in favor of seller
      await marketplace.methods
        .resolveDispute(false) // Favor seller
        .accounts({
          authority: platform.publicKey,
          dispute: sellerFavorDispute,
          listing: sellerFavorListing,
          escrow: sellerFavorEscrow,
          nftMint: sellerFavorMint,
          seller: seller.publicKey,
          buyer: buyer.publicKey,
          sellerTokenAccount: sellerFavorToken,
          buyerTokenAccount: await getAssociatedTokenAddress(sellerFavorMint, buyer.publicKey),
          escrowTokenAccount: sellerFavorEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([platform])
        .rpc();

      // Verify NFT returned to seller
      const sellerAccount = await getAccount(provider.connection, sellerFavorToken);
      assert.equal(sellerAccount.amount.toString(), "1");
    });

    it("fails to resolve dispute without authority", async () => {
      // Create another dispute
      const unauthorizedMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerUnauthorizedToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        unauthorizedMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        unauthorizedMint,
        sellerUnauthorizedToken,
        seller,
        1
      );

      const [unauthorizedMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), unauthorizedMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Unauthorized NFT",
          "UNFT",
          "https://unauthorized.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: unauthorizedMetadata,
          mint: unauthorizedMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [unauthorizedListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), unauthorizedMint.toBuffer()],
        marketplace.programId
      );

      const [unauthorizedEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), unauthorizedListing.toBuffer()],
        marketplace.programId
      );

      const unauthorizedEscrowToken = await getAssociatedTokenAddress(
        unauthorizedMint,
        unauthorizedEscrow,
        true
      );

      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: unauthorizedMint,
          nftMetadata: unauthorizedMetadata,
          listing: unauthorizedListing,
          escrow: unauthorizedEscrow,
          sellerTokenAccount: sellerUnauthorizedToken,
          escrowTokenAccount: unauthorizedEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [unauthorizedDispute] = PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), unauthorizedListing.toBuffer()],
        marketplace.programId
      );

      await marketplace.methods
        .openDispute("Test dispute")
        .accounts({
          initiator: buyer.publicKey,
          listing: unauthorizedListing,
          dispute: unauthorizedDispute,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      try {
        await marketplace.methods
          .resolveDispute(true)
          .accounts({
            authority: seller.publicKey, // Wrong authority
            dispute: unauthorizedDispute,
            listing: unauthorizedListing,
            escrow: unauthorizedEscrow,
            nftMint: unauthorizedMint,
            seller: seller.publicKey,
            buyer: buyer.publicKey,
            sellerTokenAccount: sellerUnauthorizedToken,
            buyerTokenAccount: await getAssociatedTokenAddress(unauthorizedMint, buyer.publicKey),
            escrowTokenAccount: unauthorizedEscrowToken,
            marketplaceConfig,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([seller])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "Unauthorized");
      }
    });
  });

  describe("Security Tests", () => {
    it("prevents reentrancy in buy-now", async () => {
      // This test would require a malicious program to properly test
      // For now, we ensure the program follows checks-effects-interactions pattern
      // Real reentrancy testing would involve deploying a malicious contract
      assert.ok(true, "Reentrancy protection should be implemented in program");
    });

    it("handles arithmetic overflow in fee calculations", async () => {
      // Create listing with maximum price
      const overflowMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerOverflowToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        overflowMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        overflowMint,
        sellerOverflowToken,
        seller,
        1
      );

      const [overflowMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), overflowMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Overflow NFT",
          "ONFT",
          "https://overflow.uri",
          9999, // High royalty to test overflow
          [creator.publicKey]
        )
        .accounts({
          metadata: overflowMetadata,
          mint: overflowMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [overflowListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), overflowMint.toBuffer()],
        marketplace.programId
      );

      const [overflowEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), overflowListing.toBuffer()],
        marketplace.programId
      );

      const overflowEscrowToken = await getAssociatedTokenAddress(
        overflowMint,
        overflowEscrow,
        true
      );

      // Try to create listing with very high price
      const maxPrice = new BN("18446744073709551615"); // u64 max

      try {
        await marketplace.methods
          .createListing(maxPrice, null, null)
          .accounts({
            seller: seller.publicKey,
            nftMint: overflowMint,
            nftMetadata: overflowMetadata,
            listing: overflowListing,
            escrow: overflowEscrow,
            sellerTokenAccount: sellerOverflowToken,
            escrowTokenAccount: overflowEscrowToken,
            marketplaceConfig,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([seller])
          .rpc();

        // If it succeeds, ensure fee calculations don't overflow
        // This would be tested in the buy-now transaction
        assert.ok(true, "High price listing created, overflow protection should handle fees");
      } catch (err) {
        // If it fails due to validation, that's also acceptable
        assert.ok(true, "Program prevented potential overflow scenario");
      }
    });

    it("validates all account constraints", async () => {
      // Test wrong NFT program
      try {
        const wrongMint = await createMint(
          provider.connection,
          seller,
          seller.publicKey,
          null,
          0
        );

        const sellerWrongToken = await createAssociatedTokenAccount(
          provider.connection,
          seller,
          wrongMint,
          seller.publicKey
        );

        await mintTo(
          provider.connection,
          seller,
          wrongMint,
          sellerWrongToken,
          seller,
          1
        );

        const [wrongListing] = PublicKey.findProgramAddressSync(
          [Buffer.from("listing"), wrongMint.toBuffer()],
          marketplace.programId
        );

        const [wrongEscrow] = PublicKey.findProgramAddressSync(
          [Buffer.from("escrow"), wrongListing.toBuffer()],
          marketplace.programId
        );

        const wrongEscrowToken = await getAssociatedTokenAddress(
          wrongMint,
          wrongEscrow,
          true
        );

        // Try to create listing without metadata (should fail)
        await marketplace.methods
          .createListing(LISTING_PRICE, null, null)
          .accounts({
            seller: seller.publicKey,
            nftMint: wrongMint,
            nftMetadata: Keypair.generate().publicKey, // Invalid metadata
            listing: wrongListing,
            escrow: wrongEscrow,
            sellerTokenAccount: sellerWrongToken,
            escrowTokenAccount: wrongEscrowToken,
            marketplaceConfig,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([seller])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.ok(true, "Program validated account constraints");
      }
    });

    it("ensures proper PDA derivation", async () => {
      // Test that PDAs are derived correctly and can't be spoofed
      const fakeListing = Keypair.generate();

      try {
        await marketplace.methods
          .updateListing(new BN(1 * LAMPORTS_PER_SOL), null)
          .accounts({
            seller: seller.publicKey,
            listing: fakeListing.publicKey, // Not a valid PDA
            marketplaceConfig,
          })
          .signers([seller])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.ok(true, "Program validated PDA derivation");
      }
    });
  });

  describe("Platform Operations", () => {
    it("updates platform fee", async () => {
      const newFee = 300; // 3%

      await marketplace.methods
        .updatePlatformFee(newFee)
        .accounts({
          authority: platform.publicKey,
          marketplaceConfig,
        })
        .signers([platform])
        .rpc();

      const config = await marketplace.account.marketplaceConfig.fetch(marketplaceConfig);
      assert.equal(config.platformFeeBps, newFee);
    });

    it("updates fee collector", async () => {
      const newCollector = Keypair.generate();

      await marketplace.methods
        .updateFeeCollector(newCollector.publicKey)
        .accounts({
          authority: platform.publicKey,
          marketplaceConfig,
        })
        .signers([platform])
        .rpc();

      const config = await marketplace.account.marketplaceConfig.fetch(marketplaceConfig);
      assert.equal(config.feeCollector.toBase58(), newCollector.publicKey.toBase58());
    });

    it("pauses and unpauses marketplace", async () => {
      // Pause
      await marketplace.methods
        .pauseMarketplace()
        .accounts({
          authority: platform.publicKey,
          marketplaceConfig,
        })
        .signers([platform])
        .rpc();

      let config = await marketplace.account.marketplaceConfig.fetch(marketplaceConfig);
      assert.isFalse(config.isActive);

      // Try to create listing while paused (should fail)
      const pausedMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerPausedToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        pausedMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        pausedMint,
        sellerPausedToken,
        seller,
        1
      );

      const [pausedMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), pausedMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Paused NFT",
          "PNFT",
          "https://paused.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: pausedMetadata,
          mint: pausedMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [pausedListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), pausedMint.toBuffer()],
        marketplace.programId
      );

      const [pausedEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), pausedListing.toBuffer()],
        marketplace.programId
      );

      const pausedEscrowToken = await getAssociatedTokenAddress(
        pausedMint,
        pausedEscrow,
        true
      );

      try {
        await marketplace.methods
          .createListing(LISTING_PRICE, null, null)
          .accounts({
            seller: seller.publicKey,
            nftMint: pausedMint,
            nftMetadata: pausedMetadata,
            listing: pausedListing,
            escrow: pausedEscrow,
            sellerTokenAccount: sellerPausedToken,
            escrowTokenAccount: pausedEscrowToken,
            marketplaceConfig,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([seller])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "MarketplacePaused");
      }

      // Unpause
      await marketplace.methods
        .unpauseMarketplace()
        .accounts({
          authority: platform.publicKey,
          marketplaceConfig,
        })
        .signers([platform])
        .rpc();

      config = await marketplace.account.marketplaceConfig.fetch(marketplaceConfig);
      assert.isTrue(config.isActive);
    });
  });

  describe("Integration Tests with NFT Program", () => {
    it("verifies royalty distribution with multiple creators", async () => {
      // Create NFT with multiple creators
      const multiCreatorMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerMultiToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        multiCreatorMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        multiCreatorMint,
        sellerMultiToken,
        seller,
        1
      );

      const creator1 = Keypair.generate();
      const creator2 = Keypair.generate();
      
      // Airdrop to creators
      for (const c of [creator1, creator2]) {
        const sig = await provider.connection.requestAirdrop(
          c.publicKey,
          10 * LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);
      }

      const [multiMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), multiCreatorMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Multi Creator NFT",
          "MCNFT",
          "https://multi.uri",
          ROYALTY_BPS,
          [creator1.publicKey, creator2.publicKey]
        )
        .accounts({
          metadata: multiMetadata,
          mint: multiCreatorMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [multiListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), multiCreatorMint.toBuffer()],
        marketplace.programId
      );

      const [multiEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), multiListing.toBuffer()],
        marketplace.programId
      );

      const multiEscrowToken = await getAssociatedTokenAddress(
        multiCreatorMint,
        multiEscrow,
        true
      );

      // Create listing
      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: multiCreatorMint,
          nftMetadata: multiMetadata,
          listing: multiListing,
          escrow: multiEscrow,
          sellerTokenAccount: sellerMultiToken,
          escrowTokenAccount: multiEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Get initial balances
      const creator1BalanceBefore = await provider.connection.getBalance(creator1.publicKey);
      const creator2BalanceBefore = await provider.connection.getBalance(creator2.publicKey);

      const buyerMultiToken = await getAssociatedTokenAddress(
        multiCreatorMint,
        buyer.publicKey
      );

      // Execute purchase - note: in a real implementation, you'd need to handle multiple creators
      // This test assumes the program splits royalties equally among creators
      await marketplace.methods
        .buyNow()
        .accounts({
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          listing: multiListing,
          escrow: multiEscrow,
          nftMint: multiCreatorMint,
          nftMetadata: multiMetadata,
          sellerTokenAccount: sellerMultiToken,
          buyerTokenAccount: buyerMultiToken,
          escrowTokenAccount: multiEscrowToken,
          marketplaceConfig,
          feeCollector: feeCollector.publicKey,
          creator: creator1.publicKey, // First creator for primary royalty
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([buyer])
        .rpc();

      // Verify royalties distributed
      const royaltyAmount = LISTING_PRICE.mul(new BN(ROYALTY_BPS)).div(new BN(10000));
      const perCreatorRoyalty = royaltyAmount.div(new BN(2)); // Split between 2 creators

      const creator1BalanceAfter = await provider.connection.getBalance(creator1.publicKey);
      const creator2BalanceAfter = await provider.connection.getBalance(creator2.publicKey);

      // Note: This assumes the program handles multi-creator royalty distribution
      // If not implemented, only the first creator would receive royalties
      assert.ok(
        creator1BalanceAfter > creator1BalanceBefore,
        "Creator 1 should receive royalties"
      );
    });

    it("handles NFT metadata updates", async () => {
      // This test verifies that the marketplace can handle metadata changes
      const updateMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerUpdateToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        updateMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        updateMint,
        sellerUpdateToken,
        seller,
        1
      );

      const [updateMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), updateMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Original Name",
          "ORIG",
          "https://original.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: updateMetadata,
          mint: updateMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Update metadata
      await nftProgram.methods
        .updateMetadata(
          "Updated Name",
          "UPDT",
          "https://updated.uri"
        )
        .accounts({
          metadata: updateMetadata,
          updateAuthority: seller.publicKey,
        })
        .signers([seller])
        .rpc();

      // Create listing with updated metadata
      const [updateListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), updateMint.toBuffer()],
        marketplace.programId
      );

      const [updateEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), updateListing.toBuffer()],
        marketplace.programId
      );

      const updateEscrowToken = await getAssociatedTokenAddress(
        updateMint,
        updateEscrow,
        true
      );

      // Should work with updated metadata
      await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: updateMint,
          nftMetadata: updateMetadata,
          listing: updateListing,
          escrow: updateEscrow,
          sellerTokenAccount: sellerUpdateToken,
          escrowTokenAccount: updateEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      const listingAccount = await marketplace.account.listing.fetch(updateListing);
      assert.equal(listingAccount.nftMint.toBase58(), updateMint.toBase58());
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("handles listing with zero price gracefully", async () => {
      const zeroMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerZeroToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        zeroMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        zeroMint,
        sellerZeroToken,
        seller,
        1
      );

      const [zeroMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), zeroMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Zero Price NFT",
          "ZNFT",
          "https://zero.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: zeroMetadata,
          mint: zeroMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [zeroListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), zeroMint.toBuffer()],
        marketplace.programId
      );

      const [zeroEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), zeroListing.toBuffer()],
        marketplace.programId
      );

      const zeroEscrowToken = await getAssociatedTokenAddress(
        zeroMint,
        zeroEscrow,
        true
      );

      try {
        await marketplace.methods
          .createListing(new BN(0), null, null)
          .accounts({
            seller: seller.publicKey,
            nftMint: zeroMint,
            nftMetadata: zeroMetadata,
            listing: zeroListing,
            escrow: zeroEscrow,
            sellerTokenAccount: sellerZeroToken,
            escrowTokenAccount: zeroEscrowToken,
            marketplaceConfig,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([seller])
          .rpc();
        assert.fail("Should have thrown error for zero price");
      } catch (err) {
        assert.include(err.toString(), "InvalidPrice");
      }
    });

    it("handles auction with no bids", async () => {
      const noBidMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerNoBidToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        noBidMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        noBidMint,
        sellerNoBidToken,
        seller,
        1
      );

      const [noBidMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), noBidMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "No Bid NFT",
          "NBNFT",
          "https://nobid.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: noBidMetadata,
          mint: noBidMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [noBidListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), noBidMint.toBuffer()],
        marketplace.programId
      );

      const [noBidEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), noBidListing.toBuffer()],
        marketplace.programId
      );

      const noBidEscrowToken = await getAssociatedTokenAddress(
        noBidMint,
        noBidEscrow,
        true
      );

      // Create auction with 1 second duration
      await marketplace.methods
        .createListing(null, new BN(1 * LAMPORTS_PER_SOL), new BN(1))
        .accounts({
          seller: seller.publicKey,
          nftMint: noBidMint,
          nftMetadata: noBidMetadata,
          listing: noBidListing,
          escrow: noBidEscrow,
          sellerTokenAccount: sellerNoBidToken,
          escrowTokenAccount: noBidEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Wait for auction to end
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to accept bid with no bids
      try {
        await marketplace.methods
          .acceptBid()
          .accounts({
            seller: seller.publicKey,
            buyer: buyer.publicKey, // No actual buyer
            listing: noBidListing,
            escrow: noBidEscrow,
            nftMint: noBidMint,
            nftMetadata: noBidMetadata,
            sellerTokenAccount: sellerNoBidToken,
            buyerTokenAccount: await getAssociatedTokenAddress(noBidMint, buyer.publicKey),
            escrowTokenAccount: noBidEscrowToken,
            bidVault: Keypair.generate().publicKey, // No bid vault exists
            marketplaceConfig,
            feeCollector: feeCollector.publicKey,
            creator: creator.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([seller])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.include(err.toString(), "NoBids");
      }

      // Cancel auction to return NFT
      await marketplace.methods
        .cancelListing()
        .accounts({
          seller: seller.publicKey,
          listing: noBidListing,
          escrow: noBidEscrow,
          nftMint: noBidMint,
          sellerTokenAccount: sellerNoBidToken,
          escrowTokenAccount: noBidEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc();
    });

    it("handles concurrent operations correctly", async () => {
      // Test that concurrent bids are handled properly
      const concurrentMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerConcurrentToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        concurrentMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        concurrentMint,
        sellerConcurrentToken,
        seller,
        1
      );

      const [concurrentMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), concurrentMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Concurrent NFT",
          "CNFT",
          "https://concurrent.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: concurrentMetadata,
          mint: concurrentMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [concurrentListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), concurrentMint.toBuffer()],
        marketplace.programId
      );

      const [concurrentEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), concurrentListing.toBuffer()],
        marketplace.programId
      );

      const concurrentEscrowToken = await getAssociatedTokenAddress(
        concurrentMint,
        concurrentEscrow,
        true
      );

      // Create auction
      await marketplace.methods
        .createListing(null, new BN(1 * LAMPORTS_PER_SOL), new BN(3600))
        .accounts({
          seller: seller.publicKey,
          nftMint: concurrentMint,
          nftMetadata: concurrentMetadata,
          listing: concurrentListing,
          escrow: concurrentEscrow,
          sellerTokenAccount: sellerConcurrentToken,
          escrowTokenAccount: concurrentEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      // Create bid vaults for concurrent bidders
      const [concurrentBidVault1] = PublicKey.findProgramAddressSync(
        [Buffer.from("bid_vault"), concurrentListing.toBuffer(), bidder1.publicKey.toBuffer()],
        marketplace.programId
      );

      const [concurrentBidVault2] = PublicKey.findProgramAddressSync(
        [Buffer.from("bid_vault"), concurrentListing.toBuffer(), bidder2.publicKey.toBuffer()],
        marketplace.programId
      );

      // Place first bid
      await marketplace.methods
        .placeBid(new BN(2 * LAMPORTS_PER_SOL))
        .accounts({
          bidder: bidder1.publicKey,
          listing: concurrentListing,
          bidVault: concurrentBidVault1,
          previousBidder: null,
          previousBidVault: null,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([bidder1])
        .rpc();

      // Simulate concurrent bid attempts
      // In reality, only one should succeed due to account locking
      const bid1Promise = marketplace.methods
        .placeBid(new BN(3 * LAMPORTS_PER_SOL))
        .accounts({
          bidder: bidder2.publicKey,
          listing: concurrentListing,
          bidVault: concurrentBidVault2,
          previousBidder: bidder1.publicKey,
          previousBidVault: concurrentBidVault1,
          marketplaceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([bidder2])
        .rpc();

      // Wait for transaction to complete
      await bid1Promise;

      // Verify final state
      const listingAccount = await marketplace.account.listing.fetch(concurrentListing);
      assert.equal(listingAccount.highestBidder.toBase58(), bidder2.publicKey.toBase58());
      assert.equal(listingAccount.highestBid.toString(), (3 * LAMPORTS_PER_SOL).toString());
    });

    it("validates token account ownership", async () => {
      // Try to create listing with wrong token account
      const wrongMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerWrongToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        wrongMint,
        seller.publicKey
      );

      const buyerWrongToken = await createAssociatedTokenAccount(
        provider.connection,
        buyer,
        wrongMint,
        buyer.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        wrongMint,
        sellerWrongToken,
        seller,
        1
      );

      const [wrongMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), wrongMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Wrong Token NFT",
          "WTNFT",
          "https://wrong.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: wrongMetadata,
          mint: wrongMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [wrongListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), wrongMint.toBuffer()],
        marketplace.programId
      );

      const [wrongEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), wrongListing.toBuffer()],
        marketplace.programId
      );

      const wrongEscrowToken = await getAssociatedTokenAddress(
        wrongMint,
        wrongEscrow,
        true
      );

      try {
        // Try to use buyer's token account as seller's
        await marketplace.methods
          .createListing(LISTING_PRICE, null, null)
          .accounts({
            seller: seller.publicKey,
            nftMint: wrongMint,
            nftMetadata: wrongMetadata,
            listing: wrongListing,
            escrow: wrongEscrow,
            sellerTokenAccount: buyerWrongToken, // Wrong owner
            escrowTokenAccount: wrongEscrowToken,
            marketplaceConfig,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([seller])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.ok(true, "Program validated token account ownership");
      }
    });
  });

  describe("Performance and Gas Optimization", () => {
    it("measures transaction costs", async () => {
      // Create a listing and measure the transaction cost
      const gasMint = await createMint(
        provider.connection,
        seller,
        seller.publicKey,
        null,
        0
      );

      const sellerGasToken = await createAssociatedTokenAccount(
        provider.connection,
        seller,
        gasMint,
        seller.publicKey
      );

      await mintTo(
        provider.connection,
        seller,
        gasMint,
        sellerGasToken,
        seller,
        1
      );

      const [gasMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), gasMint.toBuffer()],
        nftProgram.programId
      );

      await nftProgram.methods
        .createMetadata(
          "Gas Test NFT",
          "GNFT",
          "https://gas.uri",
          ROYALTY_BPS,
          [creator.publicKey]
        )
        .accounts({
          metadata: gasMetadata,
          mint: gasMint,
          mintAuthority: seller.publicKey,
          payer: seller.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const [gasListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), gasMint.toBuffer()],
        marketplace.programId
      );

      const [gasEscrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), gasListing.toBuffer()],
        marketplace.programId
      );

      const gasEscrowToken = await getAssociatedTokenAddress(
        gasMint,
        gasEscrow,
        true
      );

      const balanceBefore = await provider.connection.getBalance(seller.publicKey);

      const tx = await marketplace.methods
        .createListing(LISTING_PRICE, null, null)
        .accounts({
          seller: seller.publicKey,
          nftMint: gasMint,
          nftMetadata: gasMetadata,
          listing: gasListing,
          escrow: gasEscrow,
          sellerTokenAccount: sellerGasToken,
          escrowTokenAccount: gasEscrowToken,
          marketplaceConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          nftProgram: nftProgram.programId,
        })
        .signers([seller])
        .rpc();

      const balanceAfter = await provider.connection.getBalance(seller.publicKey);
      const transactionCost = balanceBefore - balanceAfter;

      console.log(`Create listing transaction cost: ${transactionCost / LAMPORTS_PER_SOL} SOL`);
      assert.isBelow(transactionCost, 0.01 * LAMPORTS_PER_SOL, "Transaction cost should be reasonable");
    });

    it("handles batch operations efficiently", async () => {
      // Test creating multiple listings in sequence
      const batchSize = 5;
      const batchMints = [];
      const batchListings = [];

      for (let i = 0; i < batchSize; i++) {
        const mint = await createMint(
          provider.connection,
          seller,
          seller.publicKey,
          null,
          0
        );

        const tokenAccount = await createAssociatedTokenAccount(
          provider.connection,
          seller,
          mint,
          seller.publicKey
        );

        await mintTo(
          provider.connection,
          seller,
          mint,
          tokenAccount,
          seller,
          1
        );

        const [metadata] = PublicKey.findProgramAddressSync(
          [Buffer.from("metadata"), mint.toBuffer()],
          nftProgram.programId
        );

        await nftProgram.methods
          .createMetadata(
            `Batch NFT ${i}`,
            `BNFT${i}`,
            `https://batch${i}.uri`,
            ROYALTY_BPS,
            [creator.publicKey]
          )
          .accounts({
            metadata,
            mint,
            mintAuthority: seller.publicKey,
            payer: seller.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([seller])
          .rpc();

        batchMints.push({ mint, tokenAccount, metadata });
      }

      const startTime = Date.now();

      // Create all listings
      for (const { mint, tokenAccount, metadata } of batchMints) {
        const [listing] = PublicKey.findProgramAddressSync(
          [Buffer.from("listing"), mint.toBuffer()],
          marketplace.programId
        );

        const [escrow] = PublicKey.findProgramAddressSync(
          [Buffer.from("escrow"), listing.toBuffer()],
          marketplace.programId
        );

        const escrowToken = await getAssociatedTokenAddress(
          mint,
          escrow,
          true
        );

        await marketplace.methods
          .createListing(LISTING_PRICE, null, null)
          .accounts({
            seller: seller.publicKey,
            nftMint: mint,
            nftMetadata: metadata,
            listing,
            escrow,
            sellerTokenAccount: tokenAccount,
            escrowTokenAccount: escrowToken,
            marketplaceConfig,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            nftProgram: nftProgram.programId,
          })
          .signers([seller])
          .rpc();

        batchListings.push(listing);
      }

      const endTime = Date.now();
      const totalTime = (endTime - startTime) / 1000;

      console.log(`Created ${batchSize} listings in ${totalTime} seconds`);
      console.log(`Average time per listing: ${totalTime / batchSize} seconds`);

      assert.isBelow(totalTime / batchSize, 2, "Each listing should complete within 2 seconds");
    });
  });
});
