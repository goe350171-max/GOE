import React from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Link } from 'react-router-dom';
import { Rocket } from '@phosphor-icons/react';
import NetworkSwitcher from './NetworkSwitcher';

const Header = () => {
  
  

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-zinc-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <Rocket size={32} weight="bold" className="text-foreground" />
              <h1 className="text-xl font-black tracking-tighter">SOLAUNCH</h1>
            </Link>

            
          </div>

          <div className="flex items-center gap-3">
            <NetworkSwitcher />
            <WalletMultiButton data-testid="connect-wallet-btn" />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
