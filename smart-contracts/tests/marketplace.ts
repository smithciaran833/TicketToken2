import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { assert } from 'chai';
import { Marketplace } from '../target/types/marketplace';

describe('marketplace', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Marketplace as Program<Marketplace>;
  
  // Generate keypairs for testing
  const seller = Keypair.generate();
  const buyer = Keypair.generate();
  const eventOrganizer = Keypair.generate();
  const marketplaceAuthority = Keypair.generate();
  
  // Mock NFT data
  let ticketMint: PublicKey;
  let sellerTokenAccount: PublicKey;
  let buyerTokenAccount: PublicKey;
  
  // PDA accounts
  let listingAddress: PublicKey;
  let listingBump: number;
  let escrowTokenAccount: PublicKey;
  let auctionAddress: PublicKey;
  let auctionBump: number;
  
  // Constants
  const PRICE = LAMPORTS_PER_SOL * 0.5; // 0.5 SOL
  const MARKETPLACE_FEE_BPS = 250; // 2.5%
  const ROYALTY_BPS = 500; // 5%
  
  before(async () => {
    // Fund accounts for testing
    await provider.connection.requestAirdrop(seller.publicKey, LAMPORTS_PER_SOL * 2);
    await provider.connection.requestAirdrop(buyer.publicKey, LAMPORTS_PER_SOL * 2);
    await provider.connection.requestAirdrop(eventOrganizer.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(marketplaceAuthority.publicKey, LAMPORTS_PER_SOL);
    
    // Create mock NFT
    ticketMint = await createMint(
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
      ticketMint,
      seller.publicKey
    );
    
    buyerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      buyer,
      ticketMint,
      buyer.publicKey
    );
    
    // Mint one token to seller
    await mintTo(
      provider.connection,
      seller,
      ticketMint,
      sellerTokenAccount,
      seller.publicKey,
      1
    );
    
    // Derive PDAs
    [listingAddress, listingBump] = await PublicKey.findProgramAddress(
      [Buffer.from('listing'), ticketMint.toBuffer()],
      program.programId
    );
    
    [auctionAddress, auctionBump] = await PublicKey.findProgramAddress(
      [Buffer.from('auction'), listingAddress.toBuffer()],
      program.programId
    );
    
    // Get associated token account for escrow
    escrowTokenAccount = await anchor.utils.token.associatedAddress({
      mint: ticketMint,
      owner: listingAddress
    });
  });
  
  it('Creates a fixed price listing', async () => {
    const ticketMetadata = {
      eventName: 'Test Concert',
      ticketType: 'VIP',
      seat: 'A1',
      transferable: true,
      eventStartTime: Date.now() / 1000 + 86400 * 30, // 30 days from now
    };
    
    await program.methods
      .createListing(
        new anchor.BN(PRICE),
        { fixedPrice: {} }, // Listing type
        null // No auction config for fixed price
      )
      .accounts({
        seller: seller.publicKey,
        ticketMint,
        sellerTicketAccount: sellerTokenAccount,
        escrowTokenAccount,
        listing: listingAddress,
        event: eventOrganizer.publicKey, // Mock event
        royaltyRecipient: eventOrganizer.publicKey,
        marketplaceAuthority: marketplaceAuthority.publicKey,
        auction: null, // No auction for fixed price
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([seller])
      .rpc();
      
    // Verify listing was created
    const listing = await program.account.listing.fetch(listingAddress);
    assert.equal(listing.seller.toString(), seller.publicKey.toString());
    assert.equal(listing.ticketMint.toString(), ticketMint.toString());
    assert.equal(listing.price.toNumber(), PRICE);
    assert.deepEqual(listing.listingType, { fixedPrice: {} });
    assert.deepEqual(listing.state, { active: {} });
  });
  
  it('Buys a ticket from a fixed price listing', async () => {
    await program.methods
      .buyTicket()
      .accounts({
        buyer: buyer.publicKey,
        listing: listingAddress,
        seller: seller.publicKey,
        marketplaceAuthority: marketplaceAuthority.publicKey,
        royaltyRecipient: eventOrganizer.publicKey,
        ticketMint,
        escrowTokenAccount,
        buyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc();
      
    // Verify listing was updated
    const listing = await program.account.listing.fetch(listingAddress);
    assert.deepEqual(listing.state, { sold: {} });
    
    // Verify buyer received the NFT
    const buyerTokenBalance = await provider.connection.getTokenAccountBalance(buyerTokenAccount);
    assert.equal(buyerTokenBalance.value.amount, '1');
  });
  
  it('Creates an auction listing', async () => {
    // Create a new NFT for this test
    const auctionTicketMint = await createMint(
      provider.connection,
      seller,
      seller.publicKey,
      null,
      0
    );
    
    const sellerAuctionTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      seller,
      auctionTicketMint,
      seller.publicKey
    );
    
    await mintTo(
      provider.connection,
      seller,
      auctionTicketMint,
      sellerAuctionTokenAccount,
      seller.publicKey,
      1
    );
    
    // Derive PDAs for this new NFT
    const [auctionListingAddress, auctionListingBump] = await PublicKey.findProgramAddress(
      [Buffer.from('listing'), auctionTicketMint.toBuffer()],
      program.programId
    );
    
    const [auctionAccountAddress, auctionAccountBump] = await PublicKey.findProgramAddress(
      [Buffer.from('auction'), auctionListingAddress.toBuffer()],
      program.programId
    );
    
    const auctionEscrowTokenAccount = await anchor.utils.token.associatedAddress({
      mint: auctionTicketMint,
      owner: auctionListingAddress
    });
    
    // Auction config
    const now = Math.floor(Date.now() / 1000);
    const auctionEndTime = now + 86400; // 1 day from now
    const minBidIncrement = LAMPORTS_PER_SOL * 0.05; // 0.05 SOL
    const extensionPeriod = 300; // 5 minutes
    
    await program.methods
      .createListing(
        new anchor.BN(PRICE), // Starting price
        { auction: {} }, // Listing type
        {
          endTime: new anchor.BN(auctionEndTime),
          minBidIncrement: new anchor.BN(minBidIncrement),
          extensionPeriod: new anchor.BN(extensionPeriod),
        }
      )
      .accounts({
        seller: seller.publicKey,
        ticketMint: auctionTicketMint,
        sellerTicketAccount: sellerAuctionTokenAccount,
        escrowTokenAccount: auctionEscrowTokenAccount,
        listing: auctionListingAddress,
        event: eventOrganizer.publicKey,
        royaltyRecipient: eventOrganizer.publicKey,
        marketplaceAuthority: marketplaceAuthority.publicKey,
        auction: auctionAccountAddress,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([seller])
      .rpc();
      
    // Verify auction was created
    const listing = await program.account.listing.fetch(auctionListingAddress);
    assert.equal(listing.seller.toString(), seller.publicKey.toString());
    assert.equal(listing.ticketMint.toString(), auctionTicketMint.toString());
    assert.deepEqual(listing.listingType, { auction: {} });
    
    const auction = await program.account.auction.fetch(auctionAccountAddress);
    assert.equal(auction.endTime.toNumber(), auctionEndTime);
    assert.equal(auction.minBidIncrement.toNumber(), minBidIncrement);
    assert.equal(auction.extensionPeriod.toNumber(), extensionPeriod);
    assert.equal(auction.highestBid.toNumber(), PRICE);
    assert.isNull(auction.highestBidder);
  });
});
