// hooks/useWalletAuth.ts - Custom hook for wallet authentication

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '@/contexts/AuthContext';
import { walletService } from '@/services/walletService';
import toast from 'react-hot-toast';

export interface UseWalletAuthReturn {
  // State
  isAuthenticating: boolean;
  isLinking: boolean;
  authError: string | null;
  linkError: string | null;
  
  // Actions
  authenticateWithWallet: (displayName?: string) => Promise<boolean>;
  linkWalletToAccount: (isPrimary?: boolean) => Promise<boolean>;
  disconnectAndClear: () => Promise<void>;
  
  // Utilities
  canAuthenticate: boolean;
  canLink: boolean;
  isWalletConnected: boolean;
  connectedAddress: string | null;
}

export function useWalletAuth(): UseWalletAuthReturn {
  const { connected, publicKey, signMessage, disconnect } = useWallet();
  const { user, loginWithWallet } = useAuth();
  
  // State
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Computed values
  const isWalletConnected = connected && !!publicKey;
  const connectedAddress = publicKey?.toString() || null;
  const canAuthenticate = isWalletConnected && !!signMessage && !user;
  const canLink = isWalletConnected && !!signMessage && !!user;

  /**
   * Authenticate user with connected wallet
   */
  const authenticateWithWallet = useCallback(async (displayName?: string): Promise<boolean> => {
    if (!canAuthenticate) {
      const error = 'Wallet not connected or user already logged in';
      setAuthError(error);
      toast.error(error);
      return false;
    }

    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const walletAddress = publicKey!.toString();
      
      // Prepare authentication
      const { message, nonce } = await walletService.prepareWalletAuth(walletAddress);
      
      // Sign message with wallet
      const signature = await signMessage!(new TextEncoder().encode(message));
      
      // Authenticate with backend
      const authData = {
        walletAddress,
        signature: Array.from(signature),
        message,
        nonce,
        displayName
      };

      const response = await walletService.authenticateWithWallet(authData);
      
      // Update auth context with the response
      await loginWithWallet(walletAddress, Array.from(signature));
      
      if (response.isNewUser) {
        toast.success('Welcome to TicketToken! Your account has been created.');
      } else {
        toast.success('Successfully authenticated with wallet');
      }

      return true;
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message || 'Authentication failed';
      setAuthError(errorMessage);
      toast.error(errorMessage);
      console.error('Wallet authentication failed:', error);
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  }, [canAuthenticate, publicKey, signMessage, loginWithWallet]);

  /**
   * Link connected wallet to current user account
   */
  const linkWalletToAccount = useCallback(async (isPrimary: boolean = false): Promise<boolean> => {
    if (!canLink) {
      const error = 'Wallet not connected or no user logged in';
      setLinkError(error);
      toast.error(error);
      return false;
    }

    setIsLinking(true);
    setLinkError(null);

    try {
      const walletAddress = publicKey!.toString();
      
      // Check wallet availability first
      const availability = await walletService.checkWalletAvailability(walletAddress);
      if (!availability.available) {
        throw new Error('Wallet is already linked to another account');
      }
      
      // Generate linking message
      const { nonce } = await walletService.generateNonce();
      const linkMessage = `Link wallet ${walletAddress} to your TicketToken account.\n\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
      
      // Sign message with wallet
      const signature = await signMessage!(new TextEncoder().encode(linkMessage));
      
      // Link wallet with backend
      const linkData = {
        walletAddress,
        signature: Array.from(signature),
        message: linkMessage,
        isPrimary
      };

      await walletService.linkWallet(linkData);
      
      toast.success('Wallet linked successfully');
      return true;
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message || 'Failed to link wallet';
      setLinkError(errorMessage);
      toast.error(errorMessage);
      console.error('Wallet linking failed:', error);
      return false;
    } finally {
      setIsLinking(false);
    }
  }, [canLink, publicKey, signMessage]);

  /**
   * Disconnect wallet and clear errors
   */
  const disconnectAndClear = useCallback(async (): Promise<void> => {
    try {
      await disconnect();
      setAuthError(null);
      setLinkError(null);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }, [disconnect]);

  return {
    // State
    isAuthenticating,
    isLinking,
    authError,
    linkError,
    
    // Actions
    authenticateWithWallet,
    linkWalletToAccount,
    disconnectAndClear,
    
    // Utilities
    canAuthenticate,
    canLink,
    isWalletConnected,
    connectedAddress,
  };
}

export default useWalletAuth;
