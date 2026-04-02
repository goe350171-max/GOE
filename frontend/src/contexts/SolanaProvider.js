import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

import '@solana/wallet-adapter-react-ui/styles.css';

export const SolanaProvider = ({ children }) => {
  // Use Helius mainnet RPC from environment variable
  const endpoint = useMemo(
    () => process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    []
  );
  
  const config = useMemo(
    () => ({
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
      wsEndpoint: undefined,
      httpHeaders: undefined,
      fetch: async (url, options) => {
        const response = await fetch(url, options);
        
        if (!response.ok) {
          let errorText = `HTTP ${response.status}`;
          try {
            errorText = await response.text();
          } catch (e) {
            // Keep default error message
          }
          throw new Error(errorText);
        }
        
        return response;
      }
    }),
    []
  );
  
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  // Log connection info (mask API key)
  console.info('Solana RPC:', endpoint.split('api-key=')[0] + (endpoint.includes('api-key=') ? 'api-key=***' : ''));

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
