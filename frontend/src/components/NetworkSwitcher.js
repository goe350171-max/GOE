import React, { useState } from 'react';
import { useNetwork } from '../contexts/NetworkContext';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Warning, Flask, ShieldCheck } from '@phosphor-icons/react';

/**
 * Header control: shows current network + Test Mode toggle.
 * Switching DEVNET → MAINNET requires explicit confirmation in a warning modal.
 */
const NetworkSwitcher = () => {
  const { network, setNetwork, isMainnet, testMode, setTestMode } = useNetwork();
  const [showMainnetWarning, setShowMainnetWarning] = useState(false);

  const handleToggle = () => {
    if (isMainnet) {
      // Switching mainnet → devnet is always safe
      setNetwork('devnet');
    } else {
      // Switching devnet → mainnet requires explicit confirmation
      setShowMainnetWarning(true);
    }
  };

  const confirmMainnet = () => {
    setNetwork('mainnet');
    setShowMainnetWarning(false);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggle}
        data-testid="network-switcher-btn"
        className={`hidden sm:flex items-center gap-2 px-3 py-1.5 border transition-colors text-xs font-semibold uppercase tracking-wider ${
          isMainnet
            ? 'bg-red-600 text-white border-red-700 hover:bg-red-700'
            : 'bg-green-50 text-green-900 border-green-300 hover:bg-green-100'
        }`}
        title={isMainnet ? 'Click to switch to safe Devnet' : 'Click to switch to Mainnet (real SOL)'}
      >
        <div className={`w-2 h-2 rounded-full ${isMainnet ? 'bg-white animate-pulse' : 'bg-green-600'}`} />
        <span data-testid="current-network-label">{network}</span>
      </button>

      <button
        type="button"
        onClick={() => setTestMode(!testMode)}
        data-testid="test-mode-toggle-btn"
        title={testMode ? 'Test Mode is ON — signing blocked' : 'Enable Test Mode (no signing)'}
        className={`hidden md:flex items-center gap-1.5 px-2 py-1.5 border text-xs font-semibold uppercase tracking-wider transition-colors ${
          testMode
            ? 'bg-yellow-400 text-black border-yellow-500'
            : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100'
        }`}
      >
        <Flask size={12} weight="bold" />
        <span>Test {testMode ? 'ON' : 'OFF'}</span>
      </button>

      {/* Mainnet activation confirmation */}
      <Dialog open={showMainnetWarning} onOpenChange={setShowMainnetWarning}>
        <DialogContent
          data-testid="mainnet-warning-dialog"
          className="rounded-none border-2 border-red-500 max-w-md"
        >
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <Warning size={28} weight="fill" className="text-red-600 flex-shrink-0" />
              <DialogTitle className="text-2xl font-black tracking-tighter text-red-700">
                Switch to MAINNET?
              </DialogTitle>
            </div>
            <DialogDescription className="text-sm text-zinc-700 leading-relaxed pt-2">
              You're about to enable <span className="font-bold text-red-700">live mainnet</span>.
              All transactions will spend <span className="font-bold">real SOL</span> and create real on-chain accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-red-50 border border-red-300 p-4 text-sm space-y-2">
            <div className="flex items-start gap-2">
              <ShieldCheck size={16} weight="bold" className="text-red-700 mt-0.5" />
              <p>Every signing action will require a separate confirmation modal showing the cost.</p>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck size={16} weight="bold" className="text-red-700 mt-0.5" />
              <p>Auto-retry is disabled on mainnet — failed transactions will not silently re-sign.</p>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck size={16} weight="bold" className="text-red-700 mt-0.5" />
              <p>You can switch back to Devnet at any time.</p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowMainnetWarning(false)}
              data-testid="mainnet-cancel-btn"
              className="rounded-none"
            >
              Stay on Devnet
            </Button>
            <Button
              type="button"
              onClick={confirmMainnet}
              data-testid="mainnet-confirm-btn"
              className="rounded-none bg-red-600 text-white hover:bg-red-700"
            >
              I understand — enable Mainnet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NetworkSwitcher;
