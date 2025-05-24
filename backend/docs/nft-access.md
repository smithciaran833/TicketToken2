# NFT-Based Access Control System

This document explains how the NFT-based access control system works in the TicketToken platform.

## Overview

The NFT access control system provides a secure way to gate access to exclusive content based on NFT ownership. This allows artists and event organizers to create exclusive content that's only accessible to users who own specific NFTs.

## Key Components

### 1. NFT Ownership Verification

- **On-chain verification**: Verifies NFT ownership directly on the Solana blockchain
- **Off-chain database**: Caches verification results for better performance
- **Signature verification**: Allows wallet owners to prove ownership by signing messages

### 2. Content Access Rules

- Define which NFTs grant access to which content
- Set access levels (view, download, stream, edit, admin)
- Create time-limited access windows
- Support for complex combinations of NFTs for access

### 3. Access Grants

- Generate time-limited access tokens
- Track content usage and access patterns
- Support revocation for security

## Architecture

The system is built with the following components:

1. **Database Models**:
   - `NFTAccess` - Defines access rules linking NFTs to content
   - `NFTOwnership` - Tracks NFT ownership data
   - `AccessGrant` - Manages access tokens and usage

2. **Services**:
   - `nftVerificationService` - Verifies NFT ownership on-chain
   - `nftAccessService` - Handles access control logic

3. **Controllers & Routes**:
   - Endpoints for checking access, generating tokens, and managing rules
   - Integration with content management system

4. **Middleware**:
   - Authorization middleware for protecting routes
   - Token verification middleware

## Usage Flow

### Setting Up Access Rules

1. Artist creates exclusive content
2. Artist defines which NFTs grant access to the content
3. System stores these rules in the database

### User Access

1. User attempts to access exclusive content
2. System checks if user owns any of the required NFTs
   - Checks database cache first
   - Verifies on-chain if necessary
3. If ownership is verified:
   - Generates an access token
   - Grants access to the content
4. If not:
   - Returns information about which NFTs are required

## API Endpoints

### NFT Access

- `POST /api/nft-access/check` - Check if a user has access to a resource
- `POST /api/nft-access/token` - Generate an access token
- `GET /api/nft-access/verify` - Verify an access token
- `POST /api/nft-access/rules` - Define access rules for a resource
- `GET /api/nft-access/rules/:resourceType/:resourceId` - Get access rules
- `POST /api/nft-access/sync` - Sync user's NFTs
- `GET /api/nft-access/nfts` - Get user's NFTs
- `GET /api/nft-access/resources` - Get resources accessible with user's NFTs
- `GET /api/nft-access/grants` - Get user's access grants
- `DELETE /api/nft-access/grants/:token` - Revoke an access grant

### Content with NFT Access

- `GET /api/content/:id` - Get content (checks NFT access)
- `GET /api/content/nft-accessible` - Get all content accessible via NFTs
- `GET /api/content/:id/check-access` - Check access to specific content

## Security Considerations

1. **Token Security**:
   - Access tokens are cryptographically secure
   - Short expiration times (1 hour by default)
   - IP and device tracking

2. **On-chain Verification**:
   - True source of truth for NFT ownership
   - Protection against database tampering

3. **Rate Limiting**:
   - Prevents abuse of verification endpoints
   - Limits token generation

4. **Revocation**:
   - Access can be revoked at any time
   - Expired grants are automatically cleaned up

## Example: Creating Content with NFT Access Rules

```javascript
// Create new content
const content = await ExclusiveContent.create({
  title: "Exclusive Behind the Scenes",
  description: "NFT holders only content",
  contentType: "video",
  accessControl: {
    type: "nft-based",
    defaultAccessLevel: "view"
  },
  // ...other fields
});

// Define NFT access rules
await nftAccessService.defineAccessRules(
  content._id,
  'ExclusiveContent',
  [
    {
      nftAddress: "NFT1Address...",
      accessLevel: "view"
    },
    {
      nftAddress: "NFT2Address...",
      accessLevel: "download",
      temporaryAccess: true,
      expiresAt: new Date("2023-12-31")
    }
  ],
  creatorId
);
```

## Example: Checking Access

```javascript
// Check if user has access to content
const accessResult = await nftAccessService.checkAccess(
  userId,
  contentId,
  'ExclusiveContent',
  'view'
);

if (accessResult.hasAccess) {
  // Generate an access token
  const grant = await nftAccessService.generateAccessGrant(
    userId,
    resourceInfo,
    nftInfo,
    'view'
  );
  
  // Return content with access token
  return {
    content: content,
    accessToken: grant.token,
    expiresAt: grant.expiresAt
  };
} else {
  // Return access denied with required NFTs
  return {
    accessDenied: true,
    requiredNFTs: accessResult.missingNFTs
  };
}
```

## Future Enhancements

1. **Multi-chain Support**:
   - Add support for Ethereum, Polygon, and other blockchains
   - Unified API for cross-chain NFT verification

2. **Advanced Access Rules**:
   - Combination of multiple NFTs (e.g., "NFT1 AND NFT2")
   - Metadata-based rules (e.g., "NFTs with rarity attribute = 'legendary'")
   - Quantity-based rules (e.g., "Own at least 3 NFTs from collection")

3. **Dynamic Content**:
   - Content that adapts based on the specific NFTs owned
   - Personalized experiences based on NFT metadata

4. **Marketplace Integration**:
   - Direct purchase of required NFTs
   - Temporary access rental marketplace
