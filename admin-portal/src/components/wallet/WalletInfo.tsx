// components/wallet/WalletInfo.tsx - Display wallet information

import React from 'react';
import { Copy, ExternalLink, Star, Trash2, CheckCircle } from 'lucide-react';
import { useWalletAuth } from '@/contexts/WalletContext';
import toast from 'react-hot-toast';

interface WalletInfoProps {
  address: string;
  isPrimary: boolean;
  addedAt: string;
  verified: boolean;
  showActions?: boolean;
  compact?: boolean;
  className?: string;
}

export default function WalletInfo({
  address,
  isPrimary,
  addedAt,
  verified,
  showActions = true,
  compact = false,
  className = ''
}: WalletInfoProps) {
  const { formatAddress, setPrimaryWallet, unlinkWallet } = useWalletAuth();

  // Copy address to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success('Address copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy address');
    }
  };

  // Open address in Solana explorer
  const handleExplore = () => {
    const explorerUrl = `https://explorer.solana.com/address/${address}`;
    window.open(explorerUrl, '_blank');
  };

  // Set as primary wallet
  const handleSetPrimary = async () => {
    try {
      await setPrimaryWallet(address);
    } catch (error) {
      // Error handling is done in the context
    }
  };

  // Unlink wallet
  const handleUnlink = async () => {
    if (window.confirm('Are you sure you want to unlink this wallet?')) {
      try {
        await unlinkWallet(address);
      } catch (error) {
        // Error handling is done in the context
      }
    }
  };

  if (compact) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <span className="font-mono text-sm">{formatAddress(address)}</span>
        {isPrimary && (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
            <Star className="w-3 h-3 mr-1" />
            Primary
          </span>
        )}
        {verified && <CheckCircle className="w-4 h-4 text-green-600" />}
        <button
          onClick={handleCopy}
          className="text-gray-400 hover:text-gray-600"
          title="Copy address"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Address */}
          <div className="flex items-center space-x-3 mb-2">
            <span className="font-mono text-sm font-medium">
              {formatAddress(address, 8, 8)}
            </span>
            {isPrimary && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                <Star className="w-3 h-3 mr-1" />
                Primary
              </span>
            )}
            {verified && (
              <span className="inline-flex items-center text-green-600" title="Verified">
                <CheckCircle className="w-4 h-4" />
              </span>
            )}
          </div>

          {/* Added date */}
          <p className="text-sm text-gray-500">
            Added {new Date(addedAt).toLocaleDateString()}
          </p>

          {/* Full address (expandable) */}
          <details className="mt-3">
            <summary className="text-sm text-primary-600 cursor-pointer hover:text-primary-700">
              View full address
            </summary>
            <div className="mt-2 p-2 bg-gray-50 rounded text-xs font-mono break-all">
              {address}
            </div>
          </details>
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex items-center space-x-2 ml-4">
            <button
              onClick={handleCopy}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md"
              title="Copy address"
            >
              <Copy className="w-4 h-4" />
            </button>
            
            <button
              onClick={handleExplore}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md"
              title="View on Solana Explorer"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            
            {!isPrimary && (
              <button
                onClick={handleSetPrimary}
                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                title="Set as primary"
              >
                <Star className="w-4 h-4" />
              </button>
            )}
            
            <button
              onClick={handleUnlink}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md"
              title="Unlink wallet"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Wallet list component for displaying multiple wallets
export function WalletList({ className = '' }: { className?: string }) {
  const { userWallets, primaryWallet } = useWalletAuth();

  if (userWallets.length === 0) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Copy className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-lg font-medium">No wallets linked</p>
        <p className="text-sm mt-1">Add a wallet to get started</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {userWallets.map((wallet) => (
        <WalletInfo
          key={wallet.address}
          address={wallet.address}
          isPrimary={wallet.isPrimary}
          addedAt={wallet.addedAt}
          verified={wallet.verified}
        />
      ))}
    </div>
  );
}

// Simple wallet badge component
export function WalletBadge({ 
  address, 
  isPrimary, 
  size = 'md',
  className = '' 
}: { 
  address: string;
  isPrimary: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { formatAddress } = useWalletAuth();

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base'
  };

  return (
    <span className={`
      inline-flex items-center rounded-full font-mono font-medium
      ${isPrimary ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}
      ${sizeClasses[size]}
      ${className}
    `}>
      {formatAddress(address)}
      {isPrimary && <Star className="w-3 h-3 ml-1.5" />}
    </span>
  );
}
