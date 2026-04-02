import React from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Link, useLocation } from 'react-router-dom';
import { Rocket } from '@phosphor-icons/react';

const Header = () => {
  const { connected } = useWallet();
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-zinc-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <Rocket size={32} weight="bold" className="text-foreground" />
              <h1 className="text-xl font-black tracking-tighter">SOLAUNCH</h1>
            </Link>
            
            <nav className="hidden md:flex items-center gap-1">
              <Link
                to="/"
                data-testid="nav-launchpad"
                className={`px-4 py-2 text-sm font-medium tracking-normal transition-all duration-200 ${
                  isActive('/')
                    ? 'bg-black text-white'
                    : 'text-foreground hover:bg-zinc-100'
                }`}
              >
                Launchpad
              </Link>
              <Link
                to="/explorer"
                data-testid="nav-explorer"
                className={`px-4 py-2 text-sm font-medium tracking-normal transition-all duration-200 ${
                  isActive('/explorer')
                    ? 'bg-black text-white'
                    : 'text-foreground hover:bg-zinc-100'
                }`}
              >
                Explorer
              </Link>
              <Link
                to="/airdrop"
                data-testid="nav-airdrop"
                className={`px-4 py-2 text-sm font-medium tracking-normal transition-all duration-200 ${
                  isActive('/airdrop')
                    ? 'bg-black text-white'
                    : 'text-foreground hover:bg-zinc-100'
                }`}
              >
                Airdrop
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-zinc-100 border border-zinc-300">
              <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
              <span className="text-xs font-semibold uppercase tracking-wider">Mainnet</span>
            </div>
            
            <WalletMultiButton data-testid="connect-wallet-btn" />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
