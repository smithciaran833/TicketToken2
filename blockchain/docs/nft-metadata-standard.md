# TicketToken NFT Metadata Standard

This document outlines the metadata standard for NFT tickets in the TicketToken platform.

## Overview

The TicketToken metadata standard extends the Metaplex NFT standard to include ticket-specific attributes while ensuring compatibility with Solana wallets and marketplaces.

## Metadata Structure

Each NFT ticket follows this metadata structure:

```json
{
  "name": "Event Name - Ticket Type",
  "symbol": "TKTTKN",
  "description": "Official ticket for [Event Name] at [Venue] on [Date]",
  "seller_fee_basis_points": 500,
  "image": "https://...",
  "animation_url": "https://...",
  "external_url": "https://tickettoken.app/event/...",
  "attributes": [
    {
      "trait_type": "eventName",
      "value": "Summer Music Festival"
    },
    {
      "trait_type": "eventDate",
      "value": "2025-07-15T19:00:00Z"
    },
    ...
  ],
  "properties": {
    "files": [
      {
        "uri": "https://...",
        "type": "image/png"
      }
    ],
    "category": "ticket",
    "creators": [
      {
        "address": "AKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeJ",
        "share": 70,
        "verified": true
      },
      {
        "address": "3FZbgi6V7em5XGs6bxtXUaYJDDJCxBVh5nunQdwxGWAW",
        "share": 30,
        "verified": false
      }
    ]
  }
}
```

## Required Attributes

The following attributes are required for all TicketToken NFTs:

| Attribute    | Description                                      | Type     |
|--------------|--------------------------------------------------|----------|
| eventName    | Name of the event                                | string   |
| eventDate    | Date and time of the event (ISO format)          | date     |
| eventId      | Unique identifier for the event                  | string   |
| venue        | Name of the venue                                | string   |
| ticketType   | Type of ticket (e.g., VIP, General Admission)    | string   |
| serialNumber | Serial number of the ticket                      | number   |
| status       | Ticket status (Valid, Used, Revoked, etc.)       | string   |
| isTransferable | Whether the ticket can be transferred          | boolean  |
| organizer    | Name of the event organizer                      | string   |

## Optional Attributes

The following attributes are optional:

| Attribute      | Description                                    | Type     |
|----------------|------------------------------------------------|----------|
| venueAddress   | Address of the venue                           | string   |
| ticketClass    | Class or tier of ticket                        | string   |
| section        | Seating section                                | string   |
| row            | Seating row                                    | string   |
| seat           | Seat number                                    | string   |
| category       | Event category (Concert, Sports, etc.)         | string   |
| custom.*       | Custom attributes defined by event organizer   | various  |

## Status Values

The `status` attribute must be one of the following values:

- `Valid`: Ticket is valid and has not been used
- `Used`: Ticket has been used for entry
- `Revoked`: Ticket has been revoked by the organizer
- `Expired`: Event has passed and ticket is no longer valid
- `Transferred`: Ticket has been transferred to a new owner

## Custom Attributes

Event organizers can define custom attributes for their tickets. These are added to the attributes array with their own trait types.

Example custom attributes:
- `backstageAccess`: Whether the ticket includes backstage access
- `merchandiseIncluded`: Merchandise included with the ticket
- `specialInstructions`: Special instructions for the ticket holder

## On-Chain vs. Off-Chain Storage

- **On-Chain**: The core ticket metadata attributes are stored on-chain to ensure verification and authenticity
- **Off-Chain**: Large assets (images, animations) are stored off-chain using content-addressable storage (IPFS or Arweave)

## Visual Representation

Each ticket has:
1. A static image (`image`) that represents the ticket
2. An optional animation (`animation_url`) that provides dynamic visual elements

## Implementation

The metadata standard is implemented in `blockchain/nft/metadata.js`, which provides utilities for:
- Creating metadata for new tickets
- Validating metadata against the standard
- Generating example metadata for testing

## Secondary Market Compatibility

This metadata standard ensures compatibility with:
- Solana wallets (Phantom, Solflare)
- Secondary marketplaces (Magic Eden, Solanart)
- Token explorers (Solscan, Solana Explorer)

## Updating Metadata

Certain ticket attributes may need updates:
- `status`: When a ticket is used, revoked, or expires
- `isTransferable`: When transfer restrictions change

Updates to metadata are performed through the Metaplex protocol.
