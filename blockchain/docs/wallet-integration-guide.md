# TicketToken Wallet Connection Guide

This document explains how to integrate Solana wallets into the TicketToken platform.

## Overview

TicketToken requires wallet integration for:
- User authentication
- Ticket purchases
- Ticket transfers
- Secondary market transactions
- Event creation (for organizers)

## Supported Wallets

TicketToken supports the following Solana wallets:

- **Phantom**: Most popular Solana wallet
- **Solflare**: Feature-rich Solana wallet
- **Slope**: Mobile-focused wallet (partial support)
- **Sollet**: Web-based wallet (basic support)

Additional wallets can be added by extending the `WalletAdapter` class.

## Integration Components

The wallet integration consists of:

1. **Wallet Adapter**: A unified interface for interacting with different wallet providers
2. **Wallet Utilities**: Helper functions for address formatting, balance checking, etc.
3. **Connection Manager**: Manages connections to Solana networks

## Integration Process

### 1. Wallet Connection

Users can connect their wallets to TicketToken using:

```javascript
// Create wallet adapter
const walletAdapter = new WalletAdapter({
  network: 'mainnet',
  onStatusChange: (status, error) => {
    console.log(`Wallet status: ${status}`);
    if (error) console.error(error);
  }
});

// Connect to wallet
async function connectWallet() {
  try {
    // Auto-detect and connect to first available wallet
    const connected = await walletAdapter.autoDetectAndConnect();
    
    // Or connect to a specific wallet type
    // const connected = await walletAdapter.connect(WALLET_TYPES.PHANTOM);
    
    if (connected) {
      const publicKey = walletAdapter.getPublicKeyString();
      console.log(`Connected to wallet: ${publicKey}`);
    } else {
      console.error('Failed to connect wallet');
    }
  } catch (error) {
    console.error('Connection error:', error);
  }
}
```

### 2. Authentication

Once connected, you can authenticate users by asking them to sign a message:

```javascript
// Import utilities
const { createSignMessage } = require('./wallet/wallet-utils');

// Generate a unique nonce for this authentication request
const nonce = generateRandomNonce();

// Create message to sign
const message = createSignMessage('Authentication', nonce);

// Request user to sign the message
async function authenticateUser() {
  try {
    const signature = await walletAdapter.signMessage(message);
    
    // Send signature, public key, and nonce to backend for verification
    const result = await fetch('/api/users/wallet-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: walletAdapter.getPublicKeyString(),
        signature: Array.from(signature),
        message,
        nonce
      })
    });
    
    const response = await result.json();
    
    if (response.token) {
      // Authentication successful
      localStorage.setItem('authToken', response.token);
      return true;
    } else {
      console.error('Authentication failed:', response.message);
      return false;
    }
  } catch (error) {
    console.error('Authentication error:', error);
    return false;
  }
}
```

### 3. Transaction Signing

For purchasing tickets or other blockchain transactions:

```javascript
// Import transaction building utilities
const { Transaction, SystemProgram } = require('@solana/web3.js');

// Build and sign a transaction
async function purchaseTicket(ticketPrice) {
  try {
    // Create a transaction
    const transaction = new Transaction();
    
    // Add instructions to the transaction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: walletAdapter.publicKey,
        toPubkey: TICKET_TREASURY_ADDRESS,
        lamports: ticketPrice * 1000000000 // Convert SOL to lamports
      })
    );
    
    // Add recent blockhash
    const { blockhash } = await connection.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletAdapter.publicKey;
    
    // Sign and send transaction
    const signature = await walletAdapter.signAndSendTransaction(transaction);
    
    console.log('Transaction sent:', signature);
    
    // Confirm transaction
    const confirmation = await connection.confirmTransaction(signature);
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }
    
    console.log('Transaction confirmed!');
    return signature;
  } catch (error) {
    console.error('Transaction error:', error);
    throw error;
  }
}
```

## Wallet Status Management

The wallet adapter provides status updates through the `onStatusChange` callback:

```javascript
const walletAdapter = new WalletAdapter({
  network: 'devnet',
  onStatusChange: (status, error) => {
    switch (status) {
      case CONNECTION_STATUS.DISCONNECTED:
        // Update UI to show disconnected state
        break;
      case CONNECTION_STATUS.CONNECTING:
        // Show connecting spinner/indicator
        break;
      case CONNECTION_STATUS.CONNECTED:
        // Update UI to show connected state
        break;
      case CONNECTION_STATUS.ERROR:
        // Show error message
        console.error('Wallet error:', error);
        break;
    }
  }
});
```

## Mobile App Integration

For mobile applications (iOS and Android), wallet integration requires:

1. **Deep Linking**: Set up URL schemes for wallet apps
2. **Universal Links**: Handle wallet callbacks
3. **Mobile Adapters**: Use platform-specific SDKs

### Android Implementation

For Android, use the Solana Mobile Wallet Adapter:

```kotlin
// Kotlin implementation details will be added in the mobile app phase
```

### iOS Implementation

For iOS, use deep linking and universal links:

```swift
// Swift implementation details will be added in the mobile app phase
```

## Testing Wallet Connection

A test HTML page is provided at `blockchain/tests/wallet-connection-test.html` to verify wallet integration.

To run the test:
1. Serve the project directory using a web server
2. Open the test HTML page in a browser
3. Connect your wallet and test the functions

## Security Considerations

1. **Never request private keys**: Wallets will never expose private keys
2. **Verify signatures**: Always verify signatures on the server
3. **Use nonces**: Prevent replay attacks with unique nonces
4. **Secure endpoints**: Protect authentication endpoints
5. **Test extensively**: Verify security with thorough testing

## Troubleshooting

Common wallet connection issues:

1. **Wallet not detected**: Ensure wallet extension is installed
2. **Connection rejected**: User declined the connection request
3. **Signing failed**: User rejected the signature request
4. **Transaction error**: Insufficient funds or other issues
5. **Network mismatch**: Wallet and app on different networks

## Resources

- [Phantom Developer Docs](https://docs.phantom.app/)
- [Solflare Developer Docs](https://docs.solflare.com/)
- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Solana Mobile Documentation](https://docs.solanamobile.com/)
