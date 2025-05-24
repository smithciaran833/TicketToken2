# TicketToken Authentication System

This document explains how authentication works in the TicketToken platform.

## Authentication Methods

TicketToken supports multiple authentication methods:

1. **Email/Password Authentication**
   - Traditional username/password login
   - Secure password hashing with bcrypt
   - JWT token-based sessions

2. **Wallet Authentication**
   - Connect with Solana wallet (Phantom, Solflare)
   - Sign message to prove ownership
   - No password required

## API Endpoints

### Register a New User
- **URL**: `/api/users/register`
- **Method**: POST
- **Body**:
  ```json
  {
    "username": "example_user",
    "email": "user@example.com",
    "password": "securepassword",
    "walletAddress": "optional_solana_address"
  }
