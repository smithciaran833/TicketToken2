// services/walletService.ts - Frontend wallet service

import { apiService } from './apiService';

export interface WalletAuthData {
  walletAddress: string;
  signature: string;
  message: string;
  nonce: string;
  displayName?: string;
}

export interface WalletLinkData {
  walletAddress: string;
  signature: string;
  message: string;
  isPrimary?: boolean;
}

export interface WalletInfo {
  address: string;
  isPrimary: boolean;
  addedAt: string;
  verified: boolean;
}

export interface WalletListResponse {
  wallets: WalletInfo[];
  primaryWallet: string | null;
  totalWallets: number;
}

export interface NonceResponse {
  nonce: string;
}

export interface AuthMessageResponse {
  message: string;
  walletAddress: string;
  nonce: string;
}

export interface WalletAuthResponse {
  user: any;
  token: string;
  isNewUser: boolean;
}

export interface WalletVerificationResponse {
  isValid: boolean;
  walletAddress: string;
}

export interface WalletAvailabilityResponse {
  walletAddress: string;
  available: boolean;
}

class WalletService {
  /**
   * Generate nonce for wallet authentication
   */
  async generateNonce(): Promise<NonceResponse> {
    try {
      const response = await apiService.get<NonceResponse>('/wallet/nonce');
      return response.data;
    } catch (error) {
      console.error('Generate nonce error:', error);
      throw new Error('Failed to generate nonce');
    }
  }

  /**
   * Generate authentication message for wallet signing
   */
  async generateAuthMessage(walletAddress: string, nonce: string): Promise<AuthMessageResponse> {
    try {
      const response = await apiService.post<AuthMessageResponse>('/wallet/auth-message', {
        walletAddress,
        nonce
      });
      return response.data;
    } catch (error) {
      console.error('Generate auth message error:', error);
      throw new Error('Failed to generate authentication message');
    }
  }

  /**
   * Authenticate user with wallet signature
   */
  async authenticateWithWallet(authData: WalletAuthData): Promise<WalletAuthResponse> {
    try {
      const response = await apiService.post<WalletAuthResponse>('/wallet/authenticate', authData);
      
      // Store the auth token
      if (response.token) {
        apiService.setAuthToken(response.token);
      }
      
      return response.data;
    } catch (error) {
      console.error('Wallet authentication error:', error);
      throw error;
    }
  }

  /**
   * Link wallet to existing user account
   */
  async linkWallet(linkData: WalletLinkData): Promise<WalletListResponse> {
    try {
      const response = await apiService.post<WalletListResponse>('/wallet/link', linkData);
      return response.data;
    } catch (error) {
      console.error('Link wallet error:', error);
      throw error;
    }
  }

  /**
   * Unlink wallet from user account
   */
  async unlinkWallet(walletAddress: string): Promise<WalletListResponse> {
    try {
      const response = await apiService.delete<WalletListResponse>(`/wallet/unlink/${walletAddress}`);
      return response.data;
    } catch (error) {
      console.error('Unlink wallet error:', error);
      throw error;
    }
  }

  /**
   * Set primary wallet
   */
  async setPrimaryWallet(walletAddress: string): Promise<WalletListResponse> {
    try {
      const response = await apiService.put<WalletListResponse>(`/wallet/primary/${walletAddress}`);
      return response.data;
    } catch (error) {
      console.error('Set primary wallet error:', error);
      throw error;
    }
  }

  /**
   * Get user's wallet list
   */
  async getUserWallets(): Promise<WalletListResponse> {
    try {
      const response = await apiService.get<WalletListResponse>('/wallet/list');
      return response.data;
    } catch (error) {
      console.error('Get user wallets error:', error);
      throw error;
    }
  }

  /**
   * Check wallet availability
   */
  async checkWalletAvailability(walletAddress: string): Promise<WalletAvailabilityResponse> {
    try {
      const response = await apiService.post<WalletAvailabilityResponse>('/wallet/check-availability', {
        walletAddress
      });
      return response.data;
    } catch (error) {
      console.error('Check wallet availability error:', error);
      throw error;
    }
  }

  /**
   * Verify wallet signature
   */
  async verifyWalletSignature(
    walletAddress: string,
    signature: string,
    message: string
  ): Promise<WalletVerificationResponse> {
    try {
      const response = await apiService.post<WalletVerificationResponse>('/wallet/verify', {
        walletAddress,
        signature,
        message
      });
      return response.data;
    } catch (error) {
      console.error('Verify wallet signature error:', error);
      throw error;
    }
  }

  /**
   * Get wallet balance (if implemented)
   */
  async getWalletBalance(walletAddress: string): Promise<any> {
    try {
      const response = await apiService.get(`/wallet/balance/${walletAddress}`);
      return response.data;
    } catch (error) {
      console.error('Get wallet balance error:', error);
      throw error;
    }
  }

  /**
   * Prepare wallet authentication flow
   * Generates nonce and message for signing
   */
  async prepareWalletAuth(walletAddress: string): Promise<{ message: string; nonce: string }> {
    try {
      // Generate nonce
      const { nonce } = await this.generateNonce();
      
      // Generate message
      const { message } = await this.generateAuthMessage(walletAddress, nonce);
      
      return { message, nonce };
    } catch (error) {
      console.error('Prepare wallet auth error:', error);
      throw new Error('Failed to prepare wallet authentication');
    }
  }

  /**
   * Complete wallet authentication flow
   * Signs message and authenticates with backend
   */
  async completeWalletAuth(
    walletAddress: string,
    signMessage: (message: string) => Promise<Uint8Array>,
    displayName?: string
  ): Promise<WalletAuthResponse> {
    try {
      // Prepare authentication
      const { message, nonce } = await this.prepareWalletAuth(walletAddress);
      
      // Sign message
      const signature = await signMessage(message);
      
      // Convert signature to array for API
      const signatureArray = Array.from(signature);
      
      // Authenticate
      return await this.authenticateWithWallet({
        walletAddress,
        signature: signatureArray,
        message,
        nonce,
        displayName
      });
    } catch (error) {
      console.error('Complete wallet auth error:', error);
      throw error;
    }
  }

  /**
   * Complete wallet linking flow
   * Signs message and links wallet to account
   */
  async completeWalletLink(
    walletAddress: string,
    signMessage: (message: string) => Promise<Uint8Array>,
    isPrimary?: boolean
  ): Promise<WalletListResponse> {
    try {
      // Generate nonce and message for linking
      const { nonce } = await this.generateNonce();
      const linkMessage = `Link wallet ${walletAddress} to your TicketToken account.\n\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
      
      // Sign message
      const signature = await signMessage(linkMessage);
      
      // Convert signature to array for API
      const signatureArray = Array.from(signature);
      
      // Link wallet
      return await this.linkWallet({
        walletAddress,
        signature: signatureArray,
        message: linkMessage,
        isPrimary
      });
    } catch (error) {
      console.error('Complete wallet link error:', error);
      throw error;
    }
  }

  /**
   * Format wallet address for display
   */
  formatAddress(address: string, prefixLength: number = 4, suffixLength: number = 4): string {
    if (!address) return '';
    
    if (address.length <= prefixLength + suffixLength) {
      return address;
    }
    
    return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
  }

  /**
   * Validate Solana wallet address format
   */
  isValidSolanaAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    
    // Basic validation for Solana address format
    // Solana addresses are base58 encoded and typically 32-44 characters
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return solanaAddressRegex.test(address);
  }

  /**
   * Get wallet provider name from address (if detectable)
   */
  detectWalletProvider(publicKey: any): string {
    // This is a basic implementation
    // In practice, you might check window.solana, window.solflare, etc.
    if (window.solana?.isPhantom) return 'Phantom';
    if (window.solflare?.isSolflare) return 'Solflare';
    return 'Unknown';
  }
}

export const walletService = new WalletService();
