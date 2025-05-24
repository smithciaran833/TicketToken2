// contexts/WalletContext.tsx - Enhanced wallet context

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { walletService, WalletInfo, WalletAuthResponse } from '@/services/walletService';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';

interface WalletContextType {
  // Solana wallet adapter state
  solanaWallet: ReturnType<typeof useSolanaWallet>;
  
  // User's linked wallets
  userWallets: WalletInfo[];
  primaryWallet: string | null;
  totalWallets: number;
  
  // Authentication state
  isAuthenticating: boolean;
  isLinking: boolean;
  
  // Actions
  authenticateWithWallet: (displayName?: string) => Promise<boolean>;
  linkCurrentWallet: (isPrimary?: boolean) => Promise<boolean>;
  unlinkWallet: (address: string) => Promise<boolean>;
  setPrimaryWallet: (address: string) => Promise<boolean>;
  refreshUserWallets: () => Promise<void>;
  
  // Utilities
  formatAddress: (address: string, prefixLength?: number, suffixLength?: number) => string;
  isWalletLinked: (address: string) => boolean;
  getCurrentWalletInfo: () => WalletInfo | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWalletAuth() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWalletAuth must be used within a WalletProvider');
  }
  return context;
}

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const solanaWallet = useSolanaWallet();
  const { user, refreshUser } = useAuth();
  
  // State
  const [userWallets, setUserWallets] = useState<WalletInfo[]>([]);
  const [primaryWallet, setPrimaryWalletState] = useState<string | null>(null);
  const [totalWallets, setTotalWallets] = useState(0);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  // Load user wallets when authenticated
  useEffect(() => {
    if (user) {
      refreshUserWallets();
    } else {
      setUserWallets([]);
      setPrimaryWalletState(null);
      setTotalWallets(0);
    }
  }, [user]);

  /**
   * Refresh user's wallet list from backend
   */
  const refreshUserWallets = async (): Promise<void> => {
    if (!user) return;

    try {
      const response = await walletService.getUserWallets();
      setUserWallets(response.wallets);
      setPrimaryWalletState(response.primaryWallet);
      setTotalWallets(response.totalWallets);
    } catch (error) {
      console.error('Failed to refresh user wallets:', error);
      toast.error('Failed to load wallets');
    }
  };

  /**
   * Authenticate user with connected wallet
   */
  const authenticateWithWallet = async (displayName?: string): Promise<boolean> => {
    if (!solanaWallet.connected || !solanaWallet.publicKey || !solanaWallet.signMessage) {
      toast.error('Please connect your wallet first');
      return false;
    }

    setIsAuthenticating(true);

    try {
      const walletAddress = solanaWallet.publicKey.toString();
      
      // Complete wallet authentication flow
      const authResponse: WalletAuthResponse = await walletService.completeWalletAuth(
        walletAddress,
        solanaWallet.signMessage,
        displayName
      );

      // Refresh user data
      await refreshUser();

      if (authResponse.isNewUser) {
        toast.success('Welcome to TicketToken! Your account has been created.');
      } else {
        toast.success('Successfully authenticated with wallet');
      }

      return true;
    } catch (error: any) {
      console.error('Wallet authentication failed:', error);
      const errorMessage = error?.response?.data?.message || error.message || 'Authentication failed';
      toast.error(errorMessage);
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  };

  /**
   * Link currently connected wallet to user account
   */
  const linkCurrentWallet = async (isPrimary: boolean = false): Promise<boolean> => {
    if (!solanaWallet.connected || !solanaWallet.publicKey || !solanaWallet.signMessage) {
      toast.error('Please connect your wallet first');
      return false;
    }

    if (!user) {
      toast.error('Please login first');
      return false;
    }

    setIsLinking(true);

    try {
      const walletAddress = solanaWallet.publicKey.toString();
      
      // Check if wallet is already linked
      if (isWalletLinked(walletAddress)) {
        toast.error('This wallet is already linked to your account');
        return false;
      }

      // Complete wallet linking flow
      const response = await walletService.completeWalletLink(
        walletAddress,
        solanaWallet.signMessage,
        isPrimary
      );

      // Update local state
      setUserWallets(response.wallets);
      setPrimaryWalletState(response.primaryWallet);
      setTotalWallets(response.totalWallets);

      toast.success('Wallet linked successfully');
      return true;
    } catch (error: any) {
      console.error('Wallet linking failed:', error);
      const errorMessage = error?.response?.data?.message || error.message || 'Failed to link wallet';
      toast.error(errorMessage);
      return false;
    } finally {
      setIsLinking(false);
    }
  };

  /**
   * Unlink wallet from user account
   */
  const unlinkWallet = async (address: string): Promise<boolean> => {
    if (!user) {
      toast.error('Please login first');
      return false;
    }

    try {
      const response = await walletService.unlinkWallet(address);
      
      // Update local state
      setUserWallets(response.wallets);
      setPrimaryWalletState(response.primaryWallet);
      setTotalWallets(response.totalWallets);

      toast.success('Wallet unlinked successfully');
      return true;
    } catch (error: any) {
      console.error('Wallet unlinking failed:', error);
      const errorMessage = error?.response?.data?.message || error.message || 'Failed to unlink wallet';
      toast.error(errorMessage);
      return false;
    }
  };

  /**
   * Set primary wallet
   */
  const setPrimaryWallet = async (address: string): Promise<boolean> => {
    if (!user) {
      toast.error('Please login first');
      return false;
    }

    try {
      const response = await walletService.setPrimaryWallet(address);
      
      // Update local state
      setUserWallets(response.wallets);
      setPrimaryWalletState(response.primaryWallet);

      toast.success('Primary wallet updated successfully');
      return true;
    } catch (error: any) {
      console.error('Set primary wallet failed:', error);
      const errorMessage = error?.response?.data?.message || error.message || 'Failed to set primary wallet';
      toast.error(errorMessage);
      return false;
    }
  };

  /**
   * Format wallet address for display
   */
  const formatAddress = (address: string, prefixLength: number = 4, suffixLength: number = 4): string => {
    return walletService.formatAddress(address, prefixLength, suffixLength);
  };

  /**
   * Check if wallet is linked to user account
   */
  const isWalletLinked = (address: string): boolean => {
    return userWallets.some(wallet => wallet.address === address);
  };

  /**
   * Get current wallet info if linked
   */
  const getCurrentWalletInfo = (): WalletInfo | null => {
    if (!solanaWallet.connected || !solanaWallet.publicKey) return null;
    
    const currentAddress = solanaWallet.publicKey.toString();
    return userWallets.find(wallet => wallet.address === currentAddress) || null;
  };

  const contextValue: WalletContextType = {
    solanaWallet,
    userWallets,
    primaryWallet,
    totalWallets,
    isAuthenticating,
    isLinking,
    authenticateWithWallet,
    linkCurrentWallet,
    unlinkWallet,
    setPrimaryWallet,
    refreshUserWallets,
    formatAddress,
    isWalletLinked,
    getCurrentWalletInfo,
  };

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
}

// Re-export the original Solana wallet hook for convenience
export { useSolanaWallet };
