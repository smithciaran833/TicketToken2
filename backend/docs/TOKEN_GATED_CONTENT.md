# Token-Gated Content System

This document provides comprehensive documentation for the token-gated content access control mechanisms implemented in the TicketToken project.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Authentication & Authorization](#authentication--authorization)
6. [Token Verification Process](#token-verification-process)
7. [Access Control Types](#access-control-types)
8. [Caching Strategy](#caching-strategy)
9. [Integration Guide](#integration-guide)
10. [Security Considerations](#security-considerations)
11. [Performance Optimization](#performance-optimization)

## Overview

The token-gated content system provides a mechanism for restricting access to content based on ownership of specific blockchain tokens. This feature allows content creators to share exclusive content with token holders.

Key features include:
- Multiple access control types (any token, all tokens, specific token)
- Support for various token standards (ERC721, ERC1155, ERC20)
- Token ownership verification
- Caching to improve performance
- Content expiration support

## Architecture

The token-gated content system consists of the following components:

1. **Models**: Database schemas for token-gated content
2. **Middleware**: Authentication and token verification middleware
3. **Controllers**: Business logic for content management
4. **Routes**: API endpoints for accessing the system
5. **Services**: Token verification and blockchain interaction
6. **Configuration**: Redis setup for caching

The system flow works as follows:
1. User authenticates with JWT token
2. User requests access to token-gated content
3. System verifies token ownership through blockchain interactions
4. If verification succeeds, content is provided to the user

## Database Schema

The token-gated content is stored in MongoDB using the following schema:

```javascript
const tokenGatedContentSchema = new mongoose.Schema({
  title: String,               // Content title
  description: String,         // Content description
  contentType: String,         // Type of content (text, image, video, etc.)
  content: String,             // The actual content
  requiredTokens: [{           // Array of required tokens
    contractAddress: String,   // Token contract address
    tokenId: String,           // Specific token ID (optional)
    minAmount: Number          // Minimum amount required
  }],
  accessControl: String,       // Type of access control (anyToken, allTokens, specificToken)
  createdBy: ObjectId,         // Content creator reference
  isActive: Boolean,           // Whether the content is active
  expiresAt: Date,             // Expiration date (optional)
  metadata: Object             // Additional metadata
}, { timestamps: true });
```

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/token-gated-content` | Create new token-gated content | Authenticated |
| GET | `/api/token-gated-content` | Get all token-gated content (metadata only) | Authenticated |
| GET | `/api/token-gated-content/:id` | Get token-gated content by ID | Authenticated + Token Ownership |
| GET | `/api/token-gated-content/:id/check-access` | Check if user has access to content | Authenticated |
| PUT | `/api/token-gated-content/:id` | Update token-gated content | Authenticated (Creator only) |
| DELETE | `/api/token-gated-content/:id` | Delete token-gated content | Authenticated (Creator only) |

## Authentication & Authorization

The system uses JWT-based authentication. Each request to the token-gated content API must include a valid JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

There are two levels of authorization:
1. **Authentication**: Verifies the user identity using JWT
2. **Token Ownership**: Verifies that the user owns the required tokens through blockchain verification

The middleware `tokenAuth.js` handles both these authorization steps.

## Token Verification Process

The system verifies token ownership through the following process:

1. Extract user's wallet addresses from their profile
2. Detect the token standard (ERC721, ERC1155, ERC20) of the required token
3. Check token ownership based on the token standard:
   - For ERC721: Check if the user is the owner of the specific token or has a sufficient balance
   - For ERC1155: Check if the user has sufficient balance of the specific token
   - For ERC20: Check if the user has sufficient balance
4. Cache the result to improve performance

The verification process uses direct blockchain interaction through JSON-RPC providers.

## Access Control Types

The system supports three types of access control:

1. **anyToken**: User needs to own at least one of any required tokens
   - This is useful when providing access to holders of any token in a collection

2. **allTokens**: User needs to own all required tokens
   - This is useful when requiring multiple different tokens for access

3. **specificToken**: User needs to own the specific token(s)
   - This is useful when access is tied to ownership of a specific token ID

## Caching Strategy

To improve performance and reduce blockchain API calls, the system implements a caching strategy using Redis:

1. **Token Standard Caching**: Caches the detected token standard for 24 hours
2. **Token Ownership Caching**: Caches token ownership verification results:
   - Positive results (ownership verified): 5 minutes
   - Negative results (ownership not verified): 1 minute

This caching strategy significantly reduces the number of blockchain API calls and improves response times.

## Integration Guide

To integrate the token-gated content system into your frontend:

1. **Create Content**:
   ```javascript
   const contentData = {
     title: "Exclusive Content",
     description: "This content is only for token holders",
     contentType: "text",
     content: "This is the exclusive content",
     requiredTokens: [
       {
         contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
         tokenId: null, // Any token from the collection
         minAmount: 1
       }
     ],
     accessControl: "anyToken"
   };
   
   const result = await tokenGatedContentService.createContent(contentData, token);
   ```

2. **Check Access**:
   ```javascript
   const accessInfo = await tokenGatedContentService.checkContentAccess(contentId, token);
   
   if (accessInfo.hasAccess) {
     // User has access, fetch the content
     const content = await tokenGatedContentService.getContentById(contentId, token);
     // Display content
   } else {
     // User doesn't have access, show required tokens
     showRequiredTokens(accessInfo.requiredTokens);
   }
   ```

3. **Display Content**:
   ```javascript
   const renderContent = (content) => {
     switch (content.contentType) {
       case 'text':
         return <div className="content-text">{content.content}</div>;
       case 'image':
         return <img src={content.content} alt={content.title} />;
       case 'video':
         return <video src={content.content} controls />;
       // Add more content types as needed
     }
   };
   ```

## Security Considerations

1. **JWT Token Security**: Ensure JWT tokens are securely stored and transmitted
2. **Wallet Address Privacy**: Be cautious about exposing user wallet addresses
3. **RPC Provider Security**: Use secure and reliable RPC providers
4. **Rate Limiting**: Implement rate limiting to prevent abuse of the API
5. **Input Validation**: Validate all input data to prevent injection attacks
6. **Error Handling**: Implement proper error handling to prevent information leakage

## Performance Optimization

1. **Caching**: Utilize Redis caching to reduce blockchain API calls
2. **Batch Requests**: Use batch requests when checking multiple tokens
3. **Pagination**: Implement pagination for content listings
4. **Content Size Limits**: Set limits on content size to prevent performance issues
5. **Webhook Integration**: Consider using webhooks for long-running verification processes

---

This token-gated content system is designed to be extensible and adaptable to various use cases. It can be further enhanced with additional features such as:

- Support for more complex access rules
- Integration with additional token standards
- Analytics for content access
- Royalty distribution for content creators
- Time-based access controls

For any questions or support, please contact the development team.
