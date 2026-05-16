import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { useNetwork } from './NetworkContext';

import '@solana/wallet-adapter-react-ui/styles.css';

const DEVNET_RPC = 'https://api.devnet.solana.com';

export const SolanaProvider = ({ children }) => {
  const { network } = useNetwork();

  // Default = DEVNET (safe). Mainnet is opt-in via NetworkSwitcher.
  const endpoint = useMemo(() => {
    if (network === 'mainnet') {
      return process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    }
    return process.env.REACT_APP_SOLANA_DEVNET_RPC_URL || DEVNET_RPC;
  }, [network]);

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
          } catch (e) { /* Keep default error message */ }
          throw new Error(errorText);
        }
        return response;
      },
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

  // eslint-disable-next-line no-console
  console.info(
    '[Solana] network=',
    network,
    'endpoint=',
    endpoint.split('api-key=')[0] + (endpoint.includes('api-key=') ? 'api-key=***' : ''),
  );

  // key on network so ConnectionProvider remounts cleanly when the user toggles
  return (
    <ConnectionProvider key={network} endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
