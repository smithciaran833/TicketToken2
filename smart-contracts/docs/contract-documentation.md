# TicketToken Minting Contract Documentation

This document provides an in-depth explanation of the TicketToken NFT minting contract for developer reference.

## Overview

The TicketToken minting contract is a Solana program that enables the creation, minting, and management of NFT tickets for events. It is built using the Anchor framework and integrates with the Metaplex NFT standard.

## Contract Architecture

The contract follows a modular design with the following components:

1. **State Definitions** - Define the data structures for events, ticket types, and tickets
2. **Instruction Handlers** - Process user instructions for various operations
3. **Account Constraints** - Ensure security and proper access control
4. **Client SDK** - TypeScript library for interacting with the contract

## Core Entities

### Event

An event represents a real-world event for which tickets can be issued. Each event has:

- Unique identifier
- Name, symbol, and description
- Venue and date information
- Maximum ticket capacity
- Royalty settings for secondary sales
- Validators approved to check tickets

### Ticket Type

A ticket type represents a category of tickets for an event (e.g., VIP, General Admission). Each ticket type has:

- Reference to its parent event
- Name and description
- Price in SOL
- Quantity available and sold
- Customizable attributes

### Ticket

A ticket represents an individual NFT ticket owned by a user. Each ticket has:

- NFT mint address
- References to event and ticket type
- Current owner
- Serial number
- Status (Valid, Used, Revoked, Expired)
- Transferability flag
- Custom attributes

## Program Instructions

### Event Management

- `createEvent` - Creates a new event with specified details
- `updateEvent` - Updates an existing event's information
- `addValidator` - Adds a validator allowed to check tickets
- `removeValidator` - Removes a validator from the approved list

### Ticket Type Management

- `createTicketType` - Creates a new ticket type for an event
- `updateTicketType` - Updates an existing ticket type
- `addTicketTypeAttributes` - Adds or updates attributes for a ticket type

### Ticket Operations

- `mintTicket` - Mints a new NFT ticket for a buyer
- `updateTicketStatus` - Updates a ticket's status (e.g., mark as used)
- `transferTicket` - Transfers a ticket to a new owner
- `revokeTicket` - Revokes a ticket, making it invalid
- `setTicketTransferability` - Sets whether a ticket can be transferred

## Account Structure

### PDAs (Program Derived Addresses)

The program uses PDAs to derive deterministic addresses for various accounts:

1. **Event Account** - `['event', organizer_pubkey, event_id]`
   - Stores event details and configuration
   - Owned by the program

2. **Ticket Type Account** - `['ticket_type', event_pubkey, ticket_type_id]`
   - Stores ticket type information
   - Owned by the program

3. **Ticket Account** - `['ticket', mint_pubkey]`
   - Stores ticket metadata and status
   - Owned by the program

4. **Ticket Mint Authority** - `['ticket_authority', mint_pubkey]`
   - Controls the NFT mint
   - Used to sign mint operations

### Metadata Accounts

The program also creates Metaplex accounts for NFT functionality:

1. **Metadata Account** - Stores NFT metadata (name, symbol, URI)
2. **Master Edition Account** - Makes the token a non-fungible (limited supply) token

## Security Measures

### Access Control

- Only event organizers can create and update events or ticket types
- Only validators and organizers can update ticket status
- Only the ticket owner can transfer the ticket (if transferable)
- Only the program can mint tickets through PDAs

### Validation Checks

- Ensure events don't exceed maximum tickets
- Verify ticket types don't exceed event capacity
- Validate ticket status transitions (e.g., can't go from Used to Valid)
- Check ticket transferability before transfers
- Verify payment amounts match ticket prices

## NFT Implementation

The contract uses the Metaplex Token Metadata program to create standard-compliant NFTs:

1. **Metadata Standards** - Follows Metaplex metadata standards for compatibility
2. **Royalties** - Configurable royalty settings for secondary market sales
3. **Creators** - Sets the event organizer as a creator for royalty distribution
4. **Master Edition** - Creates non-fungible tokens with limited supply

## Minting Process

The ticket minting process follows these steps:

1. Buyer initiates purchase of a specific ticket type
2. Contract creates a new mint account
3. Contract creates a token account for the buyer
4. Contract mints one token to the buyer's account
5. Contract creates metadata and master edition accounts
6. Contract creates a ticket account with additional information
7. Payment is transferred from buyer to organizer

## Client SDK Usage

The TypeScript client SDK provides a convenient way to interact with the contract:

```typescript
// Initialize client
const connection = new Connection('https://api.devnet.solana.com');
const wallet = new anchor.Wallet(keypair);
const client = new TicketTokenClient(connection, wallet);

// Create an event
const eventPda = await client.createEvent({
  eventId: 'my-event-2025',
  name: 'My Amazing Event',
  symbol: 'EVENT',
  description: 'An awesome event with great tickets',
  venue: 'Virtual Arena',
  startDate: Math.floor(Date.now() / 1000) + 86400,
  endDate: Math.floor(Date.now() / 1000) + 172800,
  maxTickets: 1000,
  royaltyBasisPoints: 500, // 5%
  organizer: organizerKeypair,
});

// Create a ticket type
const ticketTypePda = await client.createTicketType({
  eventPda,
  ticketTypeId: 'vip-ticket',
  name: 'VIP Access',
  description: 'VIP access with special perks',
  price: new anchor.BN(1000000000), // 1 SOL
  quantity: 100,
  attributes: [
    { trait_type: 'tier', value: 'VIP' },
    { trait_type: 'benefits', value: 'Backstage access' },
  ],
  organizer: organizerKeypair,
});

// Mint a ticket
const { ticketPda, mintPubkey } = await client.mintTicket({
  eventPda,
  ticketTypePda,
  metadataUri: 'https://tickettoken.app/metadata/my-event-vip-1.json',
  buyer: buyerPublicKey,
  organizer: organizerPublicKey,
});
```

## Error Handling

The contract defines custom errors that provide clear feedback for failures:

- `EventAtCapacity` - Event has reached maximum ticket capacity
- `TicketTypeSoldOut` - Ticket type has sold out
- `InvalidTicket` - Ticket is not valid for entry
- `EventEnded` - Event has already ended
- `NotTransferable` - Ticket is not transferable
- `Unauthorized` - Caller is not authorized for this action
- `IncorrectPaymentAmount` - Incorrect payment amount for ticket purchase
- `InvalidEventDates` - End date must be after start date

## Testing

The contract includes comprehensive tests to verify functionality:

1. **Unit Tests** - Test individual functions in isolation
2. **Integration Tests** - Test complete workflows from event creation to ticket validation
3. **Edge Cases** - Test error handling and boundary conditions

## Deployment

To deploy the contract:

1. Build with `anchor build`
2. Generate the program keypair with `solana-keygen new -o target/deploy/ticket_minter-keypair.json`
3. Update the program ID in `Anchor.toml` and `lib.rs`
4. Deploy with `anchor deploy`

## Gas Optimization

The contract is optimized for gas efficiency:

1. **Account Sizing** - Properly sizes accounts to minimize rent costs
2. **Instruction Batching** - Batches related operations in single instructions
3. **Data Validation** - Validates data on the client side when possible

## Limitations and Future Improvements

- **Bulk Operations** - Currently no support for batch minting of tickets
- **Resale Marketplace** - Future addition of direct marketplace functionality
- **Dynamic Tickets** - Potential for updating ticket visuals and attributes
- **Token Gating** - Using tickets for access to other Web3 experiences

## Additional Resources

- [Solana Documentation](https://docs.solana.com/)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
- [Metaplex NFT Standard](https://docs.metaplex.com/)
