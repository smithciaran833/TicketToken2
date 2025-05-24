/**
 * React component for Solana wallet connection
 * 
 * This component provides a wallet connection button and displays
 * wallet information when connected.
 */

import React, { useState, useEffect, createContext, useContext } from 'react';

// Import wallet adapter (adjust path as needed)
// In a real implementation, you would import from your project structure
// const { WalletAdapter, WALLET_TYPES, CONNECTION_STATUS } = require('../../blockchain/wallet/wallet-adapter');
// const { formatAddress } = require('../../blockchain/wallet/wallet-utils');

// Create a context for wallet information
const WalletContext = createContext(null);

/**
 * Custom hook to access wallet context
 * 
 * @returns {Object} Wallet context
 */
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

/**
 * Wallet provider component
 * 
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 * @param {string} props.network - Solana network to connect to
 * @returns {JSX.Element} Wallet provider component
 */
export function WalletProvider({ children, network = 'devnet' }) {
  const [adapter, setAdapter] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [publicKey, setPublicKey] = useState(null);
  const [walletType, setWalletType] = useState(null);
  const [error, setError] = useState(null);
  
  // Initialize wallet adapter
  useEffect(() => {
    // Create wallet adapter when component mounts
    const newAdapter = new WalletAdapter({
      network,
      onStatusChange: (status, statusError) => {
        switch (status) {
          case CONNECTION_STATUS.DISCONNECTED:
            setConnected(false);
            setConnecting(false);
            setPublicKey(null);
            setWalletType(null);
            break;
          case CONNECTION_STATUS.CONNECTING:
            setConnecting(true);
            setError(null);
            break;
          case CONNECTION_STATUS.CONNECTED:
            setConnected(true);
            setConnecting(false);
            setPublicKey(newAdapter.getPublicKeyString());
            setWalletType(newAdapter.walletType);
            setError(null);
            break;
          case CONNECTION_STATUS.ERROR:
            setConnecting(false);
            setError(statusError?.message || 'Unknown error');
            break;
        }
      }
    });
    
    setAdapter(newAdapter);
    
    // Cleanup adapter on unmount
    return () => {
      if (newAdapter && newAdapter.isConnected()) {
        newAdapter.disconnect();
      }
    };
  }, [network]);
  
  /**
   * Connects to a wallet
   * 
   * @param {string} walletType - Type of wallet to connect to (optional)
   * @returns {Promise<boolean>} True if connection successful
   */
  const connect = async (walletType) => {
    if (!adapter) return false;
    
    try {
      let success;
      
      if (walletType) {
        success = await adapter.connect(walletType);
      } else {
        success = await adapter.autoDetectAndConnect();
      }
      
      return success;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };
  
  /**
   * Disconnects from the wallet
   * 
   * @returns {Promise<boolean>} True if disconnection successful
   */
  const disconnect = async () => {
    if (!adapter) return false;
    
    try {
      return await adapter.disconnect();
    } catch (err) {
      setError(err.message);
      return false;
    }
  };
  
  /**
   * Signs a message with the connected wallet
   * 
   * @param {string|Uint8Array} message - Message to sign
   * @returns {Promise<Uint8Array>} Signature
   */
  const signMessage = async (message) => {
    if (!adapter || !connected) {
      throw new Error('Wallet not connected');
    }
    
    return adapter.signMessage(message);
  };
  
  /**
   * Signs and sends a transaction
   * 
   * @param {Transaction} transaction - Transaction to sign and send
   * @returns {Promise<string>} Transaction signature
   */
  const signAndSendTransaction = async (transaction) => {
    if (!adapter || !connected) {
      throw new Error('Wallet not connected');
    }
    
    return adapter.signAndSendTransaction(transaction);
  };
  
  // Context value
  const value = {
    connected,
    connecting,
    publicKey,
    walletType,
    error,
    adapter,
    connect,
    disconnect,
    signMessage,
    signAndSendTransaction
  };
  
  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

/**
 * Wallet connection button component
 * 
 * @param {Object} props - Component props
 * @returns {JSX.Element} Button component
 */
export function ConnectWalletButton({ className, style }) {
  const { connected, connecting, publicKey, connect, disconnect } = useWallet();
  const [showDropdown, setShowDropdown] = useState(false);
  const [availableWallets, setAvailableWallets] = useState([]);
  
  // Check for available wallets
  useEffect(() => {
    const wallets = [];
    
    try {
      if (window?.solana?.isPhantom) {
        wallets.push(WALLET_TYPES.PHANTOM);
      }
      
      if (window?.solflare?.isSolflare) {
        wallets.push(WALLET_TYPES.SOLFLARE);
      }
      
      // Check for other wallet types...
      
      setAvailableWallets(wallets);
    } catch (err) {
      console.error('Error checking wallets:', err);
    }
  }, []);
  
  // Handler for wallet connection
  const handleConnect = () => {
    if (connected) {
      disconnect();
    } else {
      if (availableWallets.length === 1) {
        // If only one wallet is available, connect directly
        connect(availableWallets[0]);
      } else {
        // Show dropdown to select wallet
        setShowDropdown(true);
      }
    }
  };
  
  // Handler for wallet selection
  const selectWallet = (walletType) => {
    setShowDropdown(false);
    connect(walletType);
  };
  
  return (
    <div className="wallet-connection" style={style}>
      <button 
        className={`connect-button ${className || ''} ${connected ? 'connected' : ''}`}
        onClick={handleConnect}
        disabled={connecting}
      >
        {connecting ? 'Connecting...' : 
         connected ? `Connected: ${formatAddress(publicKey)}` : 'Connect Wallet'}
      </button>
      
      {showDropdown && (
        <div className="wallet-dropdown">
          {availableWallets.length > 0 ? (
            availableWallets.map(wallet => (
              <button 
                key={wallet}
                className="wallet-option"
                onClick={() => selectWallet(wallet)}
              >
                {wallet}
              </button>
            ))
          ) : (
            <div className="no-wallets">
              No Solana wallets detected. Please install Phantom or Solflare.
            </div>
          )}
          <button 
            className="close-dropdown"
            onClick={() => setShowDropdown(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Wallet information display component
 * 
 * @param {Object} props - Component props
 * @returns {JSX.Element} Wallet info component
 */
export function WalletInfo({ className, style }) {
  const { connected, publicKey, walletType } = useWallet();
  
  if (!connected) {
    return null;
  }
  
  return (
    <div className={`wallet-info ${className || ''}`} style={style}>
      <div className="wallet-type">
        <strong>Wallet:</strong> {walletType}
      </div>
      <div className="wallet-address">
        <strong>Address:</strong> {formatAddress(publicKey, 6, 6)}
      </div>
    </div>
  );
}

/**
 * Example usage of wallet components
 * 
 * @returns {JSX.Element} Example component
 */
export function WalletExample() {
  return (
    <WalletProvider network="devnet">
      <div className="wallet-example">
        <h2>Wallet Connection</h2>
        <ConnectWalletButton />
        <WalletInfo />
        
        <WalletActions />
      </div>
    </WalletProvider>
  );
}

/**
 * Wallet actions component
 * 
 * @returns {JSX.Element} Wallet actions component
 */
function WalletActions() {
  const { connected, signMessage } = useWallet();
  const [signature, setSignature] = useState(null);
  
  const handleSignMessage = async () => {
    try {
      const message = 'Welcome to TicketToken!';
      const sig = await signMessage(message);
      
      // Convert signature to hex string
      const sigHex = Array.from(sig)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      setSignature(sigHex);
    } catch (err) {
      console.error('Signing error:', err);
    }
  };
  
  if (!connected) {
    return null;
  }
  
  return (
    <div className="wallet-actions">
      <h3>Actions</h3>
      <button onClick={handleSignMessage}>
        Sign Message
      </button>
      
      {signature && (
        <div className="signature">
          <strong>Signature:</strong>
          <div className="signature-value">{signature}</div>
        </div>
      )}
    </div>
  );
}

export default WalletProvider;
