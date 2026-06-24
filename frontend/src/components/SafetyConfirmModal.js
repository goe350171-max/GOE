import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { useNetwork } from '../contexts/NetworkContext';
import { formatSol } from '../utils/txSafety';
import { Warning, Flask, CircleNotch, CheckCircle, XCircle } from '@phosphor-icons/react';

/**
 * Reusable cost-preview / sign-confirmation modal.
 * Called BEFORE any wallet.signTransaction. The user must click "Confirm & Sign"
 * for the parent flow to proceed — no automation can trigger signing.
 *
 * Props:
 *   open: boolean
 *   onCancel: () => void
 *   onConfirm: () => void     // parent decides what to do after explicit click
 *   loadingSimulation: boolean
 *   simulation: result of simulateTxCost() | null
 *   actionLabel: string       // "Create Token", "Airdrop Batch 2/5", ...
 *   walletAddress: string
 *   breakdownLines: Array<{ label: string, value: string }>   // optional extra rows
 *   primaryActionText?: string
 */
const SafetyConfirmModal = ({
  open,
  onCancel,
  onConfirm,
  loadingSimulation,
  simulation,
  actionLabel,
  walletAddress,
  breakdownLines = [],
  primaryActionText = 'Confirm & Sign',
}) => {
  const { network, isMainnet, testMode } = useNetwork();

  const isSimError = simulation && !simulation.ok;
  const isSimSoft = simulation && simulation.ok && simulation.soft;
  const canConfirm =
    !!simulation && (simulation.ok) && !loadingSimulation && !testMode;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent
        data-testid="safety-confirm-modal"
        className={`rounded-none border-2 max-w-md ${isMainnet ? 'border-red-500' : 'border-zinc-300'}`}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tighter flex items-center gap-2">
            {isMainnet ? <Warning size={22} weight="fill" className="text-red-600" /> : null}
            Review &amp; Confirm
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-700">
            <span className="font-semibold">{actionLabel}</span>
            {' · '}
            <span
              data-testid="safety-network-label"
              className={`uppercase font-bold ${isMainnet ? 'text-red-700' : 'text-green-700'}`}
            >
              {network}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Wallet */}
        <div className="border-y border-zinc-200 py-3 text-xs font-mono break-all" data-testid="safety-wallet">
          <span className="text-zinc-500 uppercase tracking-wider not-italic font-sans font-semibold text-[10px] mr-2">Wallet</span>
          {walletAddress || '(not connected)'}
        </div>

        {/* Simulation */}
        <div className="space-y-2" data-testid="safety-simulation-block">
          {loadingSimulation && (
            <div className="flex items-center gap-2 text-sm text-zinc-600">
              <CircleNotch size={16} className="animate-spin" weight="bold" /> Simulating transaction…
            </div>
          )}

          {!loadingSimulation && isSimError && (
            <div className="border border-red-300 bg-red-50 p-3 text-sm" data-testid="safety-sim-error">
              <div className="flex items-center gap-2 text-red-700 font-semibold mb-1">
                <XCircle size={16} weight="fill" /> Simulation failed
              </div>
              <p className="text-xs text-red-900 font-mono whitespace-pre-wrap break-words">
                {simulation.error}
              </p>
              {simulation.logs?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-red-700">Show simulation logs</summary>
                  <pre className="text-[10px] text-zinc-700 mt-1 max-h-32 overflow-auto bg-white p-2 border border-zinc-200">
                    {simulation.logs.slice(-10).join('\n')}
                  </pre>
                </details>
              )}
            </div>
          )}

          {!loadingSimulation && simulation?.ok && (
            <>
              {isSimSoft ? (
                <div className="flex items-start gap-2 text-sm text-yellow-800 bg-yellow-50 border border-yellow-300 p-3" data-testid="safety-sim-soft">
                  <Warning size={16} weight="fill" className="text-yellow-700 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-1">Simulation unavailable — showing static estimate</p>
                    <p className="text-xs">
                      On-chain simulation didn't run successfully, so the figures below are a rent-based estimate.
                      The actual transaction will still go through your wallet for explicit signing.
                    </p>
                    {simulation.advisoryError && (
                      <p className="text-[10px] font-mono mt-1 text-yellow-700 break-all">
                        {String(simulation.advisoryError).slice(0, 240)}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-700 font-semibold">
                  <CheckCircle size={16} weight="fill" /> Simulation succeeded
                </div>
              )}
                
              <div className={`p-4 ${isMainnet ? 'bg-red-50 border border-red-300' : 'bg-zinc-50 border border-zinc-200'}`}>
                <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">You are about to spend</p>
                <p
                className={`text-3xl font-black tracking-tighter ${isMainnet ? 'text-red-700' : 'text-zinc-900'}`}
                data-testid="safety-total-sol"
              >
                ~{formatSol(simulation.lamports + 45_000_000)} SOL
              </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Wallet balance after: ~{formatSol(simulation.postBalanceLamports - 45_000_000)} SOL
                </p>
              </div>

             <div className="text-xs space-y-1.5 pt-1" data-testid="safety-breakdown">

              <BreakdownRow
                label="Platform fee"
                value={`${formatSol(45_000_000)} SOL`}
              />

              <BreakdownRow
                label="Network fee"
                value={`${formatSol(simulation.baseFeeLamports)} SOL`}
              />

              <BreakdownRow
                label="Rent / account creation"
                value={`${formatSol(simulation.rentLamports)} SOL`}
              />

              <BreakdownRow
                label="Compute units"
                value={simulation.computeUnits.toLocaleString()}
              />

              {breakdownLines.map((line) => (
                <BreakdownRow
                  key={line.label}
                  label={line.label}
                  value={line.value}
               />
             ))}

           </div>
            </>
          )}
        </div>

        {testMode && (
          <div className="border border-yellow-400 bg-yellow-50 p-3 text-xs flex items-start gap-2" data-testid="safety-testmode-block">
            <Flask size={14} weight="bold" className="text-yellow-700 mt-0.5" />
            <p className="text-yellow-900">
              <span className="font-bold">Test Mode is ON.</span> Signing is blocked. Disable Test Mode in the header to actually sign.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            data-testid="safety-cancel-btn"
            className="rounded-none"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="safety-confirm-btn"
            className={`rounded-none font-bold ${isMainnet ? 'bg-red-600 hover:bg-red-700' : 'bg-black hover:bg-zinc-800'} text-white disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {testMode ? 'Blocked (Test Mode)' : primaryActionText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const BreakdownRow = ({ label, value }) => (
  <div className="flex items-center justify-between text-zinc-700">
    <span className="text-zinc-500">{label}</span>
    <span className="font-mono">{value}</span>
  </div>
);

export default SafetyConfirmModal;
