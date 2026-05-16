import React from 'react';
import { useNetwork } from '../contexts/NetworkContext';
import { Warning, Flask } from '@phosphor-icons/react';

/**
 * Always-visible banner shown when the user has explicitly switched to mainnet
 * OR when Test Mode is active. Provides a constant safety signal at the top of
 * the app.
 */
const MainnetWarningBanner = () => {
  const { isMainnet, testMode } = useNetwork();

  if (!isMainnet && !testMode) return null;

  return (
    <div className="flex flex-col">
      {isMainnet && (
        <div
          data-testid="mainnet-warning-banner"
          className="bg-red-600 text-white px-4 py-2 text-center text-xs sm:text-sm font-semibold tracking-wide flex items-center justify-center gap-2"
          role="alert"
        >
          <Warning size={16} weight="fill" />
          <span>
            MAINNET ACTIVE — transactions spend real SOL. Each action requires explicit confirmation.
          </span>
        </div>
      )}
      {testMode && (
        <div
          data-testid="test-mode-banner"
          className="bg-yellow-400 text-black px-4 py-1.5 text-center text-xs font-semibold tracking-wide flex items-center justify-center gap-2"
          role="status"
        >
          <Flask size={14} weight="fill" />
          <span>TEST MODE ON — wallet signing is blocked. Simulation only.</span>
        </div>
      )}
    </div>
  );
};

export default MainnetWarningBanner;
