// components/wallet/WalletConnectionModal.tsx - Wallet connection modal

import React, { useState } from 'react';
import { X, Wallet, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletAuth } from '@/contexts/WalletContext';
import { useAuth } from '@/contexts/AuthContext';

interface WalletConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'auth' | 'link';
  title?: string;
}

export default function WalletConnectionModal({
  isOpen,
  onClose,
  mode,
  title
}: WalletConnectionModalProps) {
  const { wallets, select, connect, disconnect, connecting, connected, publicKey, wallet } = useWallet();
  const { user } = useAuth();
  const {
    authenticateWithWallet,
    linkCurrentWallet,
    isAuthenticating,
    isLinking,
    isWalletLinked,
    formatAddress
  } = useWalletAuth();

  const [displayName, setDisplayName] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [step, setStep] = useState<'select' | 'connect' | 'action' | 'success'>('select');
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes
  React.useEffect(() => {
    if (isOpen) {
      setStep('select');
      setError(null);
      setDisplayName('');
      setIsPrimary(false);
    }
  }, [isOpen]);

  // Handle wallet selection
  const handleWalletSelect = async (walletName: string) => {
    try {
      setError(null);
      select(walletName);
      setStep('connect');
      
      if (!connected) {
        await connect();
      }
      
      if (connected) {
        handleWalletConnected();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet');
      setStep('select');
    }
  };

  // Handle wallet connected
  const handleWalletConnected = () => {
    if (!publicKey) return;
    
    const address = publicKey.toString();
    
    if (mode === 'link' && isWalletLinked(address)) {
      setError('This wallet is already linked to your account');
      return;
    }
    
    setStep('action');
  };

  // Handle authentication
  const handleAuthenticate = async () => {
    try {
      setError(null);
      const success = await authenticateWithWallet(displayName || undefined);
      
      if (success) {
        setStep('success');
        setTimeout(() => onClose(), 2000);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  };

  // Handle wallet linking
  const handleLinkWallet = async () => {
    try {
      setError(null);
      const success = await linkCurrentWallet(isPrimary);
      
      if (success) {
        setStep('success');
        setTimeout(() => onClose(), 2000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to link wallet');
    }
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    try {
      await disconnect();
      setStep('select');
      setError(null);
    } catch (err: any) {
      console.error('Disconnect error:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">
            {title || (mode === 'auth' ? 'Connect Wallet' : 'Link Wallet')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 mr-2 flex-shrink-0" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          {/* Step 1: Select Wallet */}
          {step === 'select' && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                {mode === 'auth'
                  ? 'Choose a wallet to sign in with'
                  : 'Choose a wallet to link to your account'
                }
              </p>
              
              <div className="space-y-2">
                {wallets.length > 0 ? (
                  wallets.map((walletOption) => (
                    <button
                      key={walletOption.adapter.name}
                      onClick={() => handleWalletSelect(walletOption.adapter.name)}
                      disabled={connecting}
                      className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 flex items-center transition-colors"
                    >
                      <img
                        src={walletOption.adapter.icon}
                        alt={walletOption.adapter.name}
                        className="w-8 h-8 mr-3"
                      />
                      <div>
                        <div className="font-medium">{walletOption.adapter.name}</div>
                        <div className="text-sm text-gray-500">
                          {walletOption.adapter.connected ? 'Connected' : 'Click to connect'}
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <Wallet className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No Solana wallets detected</p>
                    <p className="text-sm text-gray-400 mt-2">
                      Please install Phantom, Solflare, or another Solana wallet
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Connecting */}
          {step === 'connect' && (
            <div className="text-center py-8">
              <Loader className="w-12 h-12 text-primary-600 mx-auto mb-4 animate-spin" />
              <p className="text-lg font-medium">Connecting to {wallet?.adapter.name}</p>
              <p className="text-sm text-gray-500 mt-2">
                Check your wallet for connection approval
              </p>
            </div>
          )}

          {/* Step 3: Action (Auth or Link) */}
          {step === 'action' && connected && publicKey && (
            <div>
              <div className="text-center mb-6">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <p className="text-lg font-medium">Wallet Connected</p>
                <p className="text-sm text-gray-500 font-mono">
                  {formatAddress(publicKey.toString(), 6, 6)}
                </p>
              </div>

              {mode === 'auth' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Display Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter your display name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  
                  <button
                    onClick={handleAuthenticate}
                    disabled={isAuthenticating}
                    className="w-full bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {isAuthenticating && <Loader className="w-4 h-4 mr-2 animate-spin" />}
                    Sign In with Wallet
                  </button>
                </div>
              )}

              {mode === 'link' && user && (
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50 rounded-md">
                    <p className="text-sm text-blue-800">
                      This will link the wallet to your account: <strong>{user.displayName}</strong>
                    </p>
                  </div>
                  
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="isPrimary"
                      checked={isPrimary}
                      onChange={(e) => setIsPrimary(e.target.checked)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <label htmlFor="isPrimary" className="ml-2 text-sm text-gray-700">
                      Set as primary wallet
                    </label>
                  </div>
                  
                  <button
                    onClick={handleLinkWallet}
                    disabled={isLinking}
                    className="w-full bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {isLinking && <Loader className="w-4 h-4 mr-2 animate-spin" />}
                    Link Wallet
                  </button>
                </div>
              )}

              <button
                onClick={handleDisconnect}
                className="w-full mt-3 text-gray-600 hover:text-gray-800 text-sm"
              >
                Disconnect and choose different wallet
              </button>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <div className="text-center py-8">
              <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
              <p className="text-lg font-medium text-green-600">
                {mode === 'auth' ? 'Authentication Successful!' : 'Wallet Linked Successfully!'}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                {mode === 'auth' ? 'Redirecting to dashboard...' : 'You can now manage this wallet in your profile.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
