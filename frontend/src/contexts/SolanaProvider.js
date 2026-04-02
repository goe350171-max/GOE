import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl, Connection } from '@solana/web3.js';

import '@solana/wallet-adapter-react-ui/styles.css';

export const SolanaProvider = ({ children }) => {
  const network = WalletAdapterNetwork.Mainnet;
  
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  
  const config = useMemo(
    () => ({
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
      wsEndpoint: undefined,
      httpHeaders: undefined,
      fetch: async (url, options) => {
        const response = await fetch(url, options);
        const cloned = response.clone();
        
        if (!response.ok) {
          let errorText;
          try {
            errorText = await cloned.text();
          } catch (e) {
            errorText = `HTTP ${response.status}`;
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

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
