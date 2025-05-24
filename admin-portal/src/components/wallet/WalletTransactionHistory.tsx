// components/wallet/WalletTransactionHistory.tsx - Display wallet transaction history

import React, { useState, useEffect } from 'react';
import { ExternalLink, ArrowUpRight, ArrowDownLeft, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletAuth } from '@/contexts/WalletContext';

interface Transaction {
  signature: string;
  slot: number;
  blockTime: number;
  fee: number;
  status: 'success' | 'failed' | 'pending';
  type: 'send' | 'receive' | 'program' | 'unknown';
  amount?: number;
  from?: string;
  to?: string;
  program?: string;
}

interface WalletTransactionHistoryProps {
  walletAddress?: string;
  limit?: number;
  className?: string;
}

export default function WalletTransactionHistory({
  walletAddress,
  limit = 10,
  className = ''
}: WalletTransactionHistoryProps) {
  const { publicKey } = useWallet();
  const { formatAddress } = useWalletAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const address = walletAddress || publicKey?.toString();

  // Fetch transaction history
  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }

    fetchTransactions();
  }, [address, limit]);

  const fetchTransactions = async () => {
    if (!address) return;

    setLoading(true);
    setError(null);

    try {
      // In a real implementation, you would fetch from Solana RPC
      // For now, we'll mock some transaction data
      const mockTransactions: Transaction[] = [
        {
          signature: '5j7j2JkqV4xKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzK',
          slot: 123456789,
          blockTime: Date.now() / 1000 - 3600,
          fee: 0.000005,
          status: 'success',
          type: 'receive',
          amount: 1.5,
          from: '11111111111111111111111111111112'
        },
        {
          signature: '4k6k1JkqV4xKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzK',
          slot: 123456788,
          blockTime: Date.now() / 1000 - 7200,
          fee: 0.000005,
          status: 'success',
          type: 'send',
          amount: 0.5,
          to: '11111111111111111111111111111113'
        },
        {
          signature: '3j5j0JkqV4xKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzKzK',
          slot: 123456787,
          blockTime: Date.now() / 1000 - 10800,
          fee: 0.000005,
          status: 'failed',
          type: 'program',
          program: 'Token Program'
        }
      ];

      setTransactions(mockTransactions.slice(0, limit));
    } catch (err) {
      setError('Failed to fetch transaction history');
      console.error('Transaction fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else {
      return 'Recent';
    }
  };

  // Open transaction in explorer
  const viewTransaction = (signature: string) => {
    const explorerUrl = `https://explorer.solana.com/tx/${signature}`;
    window.open(explorerUrl, '_blank');
  };

  // Get transaction icon
  const getTransactionIcon = (type: string, status: string) => {
    if (status === 'pending') {
      return <Clock className="w-4 h-4 text-yellow-500" />;
    }
    if (status === 'failed') {
      return <XCircle className="w-4 h-4 text-red-500" />;
    }
    
    switch (type) {
      case 'send':
        return <ArrowUpRight className="w-4 h-4 text-red-500" />;
      case 'receive':
        return <ArrowDownLeft className="w-4 h-4 text-green-500" />;
      default:
        return <CheckCircle className="w-4 h-4 text-blue-500" />;
    }
  };

  // Get transaction type label
  const getTypeLabel = (transaction: Transaction) => {
    if (transaction.type === 'program') {
      return transaction.program || 'Program Interaction';
    }
    return transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1);
  };

  if (!address) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p>No wallet connected</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="flex items-center p-4 bg-gray-50 rounded-lg">
              <div className="w-8 h-8 bg-gray-200 rounded-full mr-4"></div>
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
              <div className="w-20 h-4 bg-gray-200 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-600 font-medium">Error loading transactions</p>
        <p className="text-sm text-gray-500 mt-1">{error}</p>
        <button
          onClick={fetchTransactions}
          className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className={`text-center py-8 text-gray-500 ${className}`}>
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-lg font-medium">No transactions found</p>
        <p className="text-sm mt-1">Transaction history will appear here</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-2">
        {transactions.map((transaction, index) => (
          <div
            key={transaction.signature + index}
            className="flex items-center p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {/* Transaction icon */}
            <div className="mr-4">
              {getTransactionIcon(transaction.type, transaction.status)}
            </div>

            {/* Transaction details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">
                  {getTypeLabel(transaction)}
                </p>
                <p className="text-sm text-gray-500">
                  {formatTime(transaction.blockTime)}
                </p>
              </div>

              <div className="mt-1 flex items-center text-xs text-gray-500">
                <span className="font-mono">
                  {formatAddress(transaction.signature, 8, 8)}
                </span>
                <button
                  onClick={() => viewTransaction(transaction.signature)}
                  className="ml-2 text-primary-600 hover:text-primary-700"
                  title="View on Solana Explorer"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Transaction amount */}
              {transaction.amount !== undefined && (
                <div className="mt-1">
                  <span className={`text-sm font-medium ${
                    transaction.type === 'receive' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {transaction.type === 'receive' ? '+' : '-'}{transaction.amount} SOL
                  </span>
                </div>
              )}

              {/* Transaction details */}
              {(transaction.from || transaction.to) && (
                <div className="mt-1 text-xs text-gray-500">
                  {transaction.type === 'receive' && transaction.from && (
                    <span>From: {formatAddress(transaction.from)}</span>
                  )}
                  {transaction.type === 'send' && transaction.to && (
                    <span>To: {formatAddress(transaction.to)}</span>
                  )}
                </div>
              )}
            </div>

            {/* Transaction status */}
            <div className="ml-4">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                transaction.status === 'success'
                  ? 'bg-green-100 text-green-800'
                  : transaction.status === 'failed'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}>
                {transaction.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Load more button */}
      {transactions.length >= limit && (
        <div className="mt-6 text-center">
          <button
            onClick={() => fetchTransactions()}
            className="px-4 py-2 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors"
          >
            Load more transactions
          </button>
        </div>
      )}
    </div>
  );
}

// Compact transaction history for smaller spaces
export function CompactTransactionHistory({
  walletAddress,
  limit = 5,
  className = ''
}: WalletTransactionHistoryProps) {
  return (
    <div className={className}>
      <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Transactions</h3>
      <WalletTransactionHistory
        walletAddress={walletAddress}
        limit={limit}
        className="space-y-2"
      />
    </div>
  );
}
