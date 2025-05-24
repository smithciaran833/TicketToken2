# TicketToken Transfer Mechanisms Guide

This document explains the transfer mechanisms available in the TicketToken platform for NFT tickets.

## Overview

TicketToken provides secure and flexible mechanisms for transferring tickets between users, enabling both primary and secondary markets while maintaining control over transfers when necessary. The platform supports:

1. **Direct Transfers**: Peer-to-peer transfers between wallets
2. **Marketplace Listings**: Public listings for selling tickets
3. **Controlled Transfers**: Transfers with organizer-defined restrictions
4. **Royalty Distribution**: Automatic royalty payments on secondary sales

## Transfer Mechanisms

### Direct Transfers

Direct transfers allow ticket holders to send their tickets to another user's wallet. This mechanism is suitable for:

- Gifting tickets to friends or family
- Distributing tickets to group members
- Simple peer-to-peer transfers without payment

#### Implementation

Direct transfers use the `transfer_ticket` instruction in the smart contract, which:

1. Verifies the ticket is transferable
2. Checks the ticket status is valid
3. Transfers the NFT from sender to recipient
4. Updates the ticket's owner field
5. Records the transfer in the transfer history

#### Example Code

```typescript
// Using the TransferClient
const result = await transferClient.transferTicket({
  ticketMint: new PublicKey(ticketMintAddress),
  toAddress: new PublicKey(recipientAddress),
});
```

### Marketplace Listings

Marketplace listings allow users to list their tickets for sale on a public marketplace. This mechanism is suitable for:

- Secondary market sales
- Setting specific prices for tickets
- Reaching a broader audience of potential buyers

#### Listing Flow

1. **Create Listing**: Ticket owner creates a listing with a price
2. **View Listings**: Potential buyers browse available listings
3. **Purchase**: Buyer purchases the ticket, triggering automatic transfer
4. **Royalty Payment**: Portion of the sale goes to the event organizer
5. **Record Transfer**: The transaction is recorded in the transfer history

#### Implementation

The marketplace uses several instructions:

- `create_transfer_listing`: Creates a new listing for a ticket
- `cancel_transfer_listing`: Cancels an existing listing
- `accept_transfer_listing`: Accepts a listing and completes the purchase

#### Example Code

```typescript
// Create a listing
const listingAddress = await transferClient.createListing({
  ticketMint: new PublicKey(ticketMintAddress),
  price: 1.5 * LAMPORTS_PER_SOL, // 1.5 SOL
});

// Accept a listing (purchase)
const result = await transferClient.acceptListing({
  listingAddress: new PublicKey(listingAddress),
  ticketMint: new PublicKey(ticketMintAddress),
  seller: new PublicKey(sellerAddress),
});
```

### Controlled Transfers

Controlled transfers allow event organizers to set restrictions on when and how tickets can be transferred. This mechanism is suitable for:

- Preventing ticket scalping
- Implementing transfer deadlines
- Setting price caps for secondary sales
- Disabling transfers entirely

#### Transfer Controls

1. **Transferability Flag**: Each ticket has a boolean flag indicating if it can be transferred
2. **Transfer Deadline**: Organizers can set deadlines after which transfers are blocked
3. **Price Caps**: Maximum resale prices can be enforced
4. **Approval Required**: Transfers can require organizer approval

#### Implementation

The smart contract includes:

- `set_ticket_transferability`: Sets whether a ticket can be transferred
- Validation checks in transfer instructions to enforce restrictions

#### Example Code

```typescript
// Set transferability
const signature = await transferClient.setTicketTransferability({
  ticketMint: new PublicKey(ticketMintAddress),
  eventId: new PublicKey(eventId),
  transferable: false, // Disable transfers
});
```

### Royalty Distribution

Royalty distribution ensures that event organizers receive a portion of secondary sales. This mechanism is suitable for:

- Providing ongoing revenue to organizers and artists
- Incentivizing the use of official resale channels
- Supporting platform sustainability

#### Royalty Flow

1. **Royalty Configuration**: Event is created with royalty settings (e.g., 5%)
2. **Secondary Sale**: Ticket is sold on the secondary market
3. **Automatic Split**: Payment is automatically split between seller and royalty recipients
4. **Distribution**: Royalties go to organizers and platform

#### Implementation

Royalties are implemented in the `accept_transfer_listing` instruction, which:

1. Calculates the royalty amount based on the price and royalty percentage
2. Transfers the main payment to the seller
3. Transfers the royalty portion to the organizer's account

## Transfer History

All transfers are recorded in a dedicated transfer history account associated with each ticket. This provides:

- Complete provenance of the ticket
- Audit trail for compliance
- Price history for market analysis

### History Data

Each transfer record includes:
- Previous owner
- New owner
- Price (if applicable)
- Timestamp
- Transfer type (Mint, Gift, Sale, Distribution)

### Example Code

```typescript
// Get transfer history
const history = await transferClient.getTicketTransferHistory(
  new PublicKey(ticketMintAddress)
);

// Display history
history.forEach(entry => {
  console.log(`${entry.from} → ${entry.to} | ${entry.price} SOL | ${entry.timestamp}`);
});
```

## Technical Implementation

### Smart Contract Accounts

The transfer mechanisms use several account types:

1. **Ticket Account**: Stores ticket data including owner and transferability
2. **TransferListing Account**: Stores listing data for marketplace
3. **TransferRecord Account**: Stores transfer history
4. **Token Accounts**: Standard SPL token accounts for the NFT

### PDAs (Program Derived Addresses)

PDAs are used to derive deterministic addresses for various accounts:

- Ticket PDA: `['ticket', mint_pubkey]`
- Transfer Listing PDA: `['transfer_listing', ticket_pubkey]`
- Transfer Record PDA: `['transfer_record', ticket_pubkey]`

### Events

The smart contract emits events for important transfer actions:

- `TicketTransferEvent`: Emitted when a ticket is transferred
- `TransferListingCreatedEvent`: Emitted when a listing is created
- `TransferListingCancelledEvent`: Emitted when a listing is cancelled
- `TicketTransferabilityEvent`: Emitted when transferability changes

## Security Considerations

### Transfer Validation

All transfers include validation checks:

- Verify the sender owns the ticket
- Check the ticket is transferable
- Confirm the ticket status is valid
- Validate payment amounts match listing prices

### Preventing Common Attacks

The contract includes protections against:

- **Reentrancy**: Instructions use a check-effects-interactions pattern
- **Frontrunning**: Transfer listings use unique PDAs tied to tickets
- **Double Spending**: SPL token transfers prevent duplicate transfers
- **Price Manipulation**: Prices are fixed in listings and verified during purchase

## Frontend Integration

The `TransferClient` and React components provide ready-to-use interfaces for transfers:

1. **TransferClient**: TypeScript client for transfer-related operations
2. **Marketplace Component**: React component for buying and selling tickets

### Marketplace Integration

To add the marketplace to your application:

```tsx
import { Marketplace } from './contracts/sdk/react/Marketplace';

function App() {
  return (
    <div>
      <h1>TicketToken</h1>
      <Marketplace 
        eventId="your-event-id"
        mode="both"
        onTransferComplete={handleTransferComplete}
      />
    </div>
  );
}
```

## API Integration

For server-side integration, the following endpoints are recommended:

- `GET /api/listings/event/:eventId` - Get listings for an event
- `GET /api/listings/user/:userId` - Get listings by a user
- `GET /api/tickets/transfers/:ticketId` - Get transfer history
- `POST /api/tickets/verify-transferability` - Check if a ticket can be transferred

## Best Practices

### For Event Organizers

1. **Set Clear Transfer Policies**: Clearly communicate to users whether tickets are transferable
2. **Consider Deadlines**: Set transfer deadlines that make sense for your event
3. **Balance Control and Flexibility**: Overly restrictive policies may frustrate legitimate users
4. **Monitor Secondary Market**: Watch for unusual activity in the secondary market
5. **Set Reasonable Royalties**: 5-10% is standard for secondary market royalties

### For Developers

1. **Handle Rejection Gracefully**: Provide clear messages when transfers are rejected
2. **Implement Retry Logic**: Network issues can occur during transfers
3. **Verify Status Changes**: Always check the updated ticket status after transfers
4. **Cache Listings Carefully**: Use short cache times for marketplace listings
5. **Implement Rate Limiting**: Prevent abuse of transfer mechanisms

## Conclusion

TicketToken's transfer mechanisms provide a robust foundation for both primary and secondary markets while maintaining appropriate controls for event organizers. By combining direct transfers, marketplace listings, controlled transfers, and royalty distribution, the platform balances the needs of all stakeholders in the ticketing ecosystem.
