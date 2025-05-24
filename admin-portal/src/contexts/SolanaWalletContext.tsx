import React, { createContext, useContext, ReactNode } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
  useWallet as useWalletAdapter,
} from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import {
  WalletModalProvider,
  WalletDisconnectButton,
  WalletMultiButton,
} from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Default styles that can be overridden by your app
require('@solana/wallet-adapter-react-ui/styles.css');

interface SolanaWalletContextType {
  wallet: ReturnType<typeof useWalletAdapter>;
  network: WalletAdapterNetwork;
  endpoint: string;
}

const SolanaWalletContext = createContext<SolanaWalletContextType | undefined>(undefined);

interface SolanaWalletProviderProps {
  children: ReactNode;
  network?: WalletAdapterNetwork;
}

export const SolanaWalletProvider: React.FC<SolanaWalletProviderProps> = ({
  children,
  network = WalletAdapterNetwork.Devnet,
}) => {
  // You can also provide a custom RPC endpoint
  const endpoint = process.env.REACT_APP_SOLANA_RPC_URL || clusterApiUrl(network);

  // Initialize wallet adapters
  const wallets = React.useMemo(
    () => [
      new PhantomWalletAdapter(),
      // Add more wallet adapters here as needed
    ],
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <InnerWalletProvider network={network} endpoint={endpoint}>
            {children}
          </InnerWalletProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

interface InnerWalletProviderProps {
  children: ReactNode;
  network: WalletAdapterNetwork;
  endpoint: string;
}

const InnerWalletProvider: React.FC<InnerWalletProviderProps> = ({
  children,
  network,
  endpoint,
}) => {
  const wallet = useWalletAdapter();

  const contextValue = React.useMemo(
    () => ({
      wallet,
      network,
      endpoint,
    }),
    [wallet, network, endpoint]
  );

  return (
    <SolanaWalletContext.Provider value={contextValue}>
      {children}
    </SolanaWalletContext.Provider>
  );
};

export const useSolanaWallet = (): SolanaWalletContextType => {
  const context = useContext(SolanaWalletContext);
  if (!context) {
    throw new Error('useSolanaWallet must be used within a SolanaWalletProvider');
  }
  return context;
};

// Re-export wallet components for easy use
export { WalletMultiButton, WalletDisconnectButton };
