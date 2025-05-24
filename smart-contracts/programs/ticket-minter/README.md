# TicketToken Minting Contract

This directory contains the Solana program for minting NFT tickets in the TicketToken platform.

## Overview

The TicketToken minting contract enables:
- Creation of events and associated ticket types
- Minting NFT tickets for specific events
- Ownership verification of tickets
- Management of ticket metadata and attributes

## Program Structure

The program follows the Anchor framework structure:
- `lib.rs` - Main program file with instruction handlers
- `state.rs` - Program state definitions
- `instructions/` - Module containing instruction implementations
- `errors.rs` - Custom error definitions

## Development Setup

To build and test the program locally:

1. Install Rust and Solana development tools:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   sh -c "$(curl -sSfL https://release.solana.com/v1.10.32/install)"
   cargo install --git https://github.com/project-serum/anchor avm --locked
   avm install latest
   avm use latest
   ```

2. Build the program:
   ```bash
   anchor build
   ```

3. Run tests:
   ```bash
   anchor test
   ```

## Program Accounts

The program uses the following account structures:

1. **Event Account** - Stores information about an event
2. **TicketType Account** - Defines a type of ticket for an event
3. **Ticket Account** - Represents an individual NFT ticket
4. **EventAuthority Account** - Manages permissions for event creators

## NFT Implementation

The program uses Metaplex Token Metadata program to create NFT tickets with:
- Unique metadata for each ticket
- Verifiable attributes based on the TicketToken metadata standard
- Royalty settings for secondary sales
- Dynamic status updates for ticket verification
