import React from 'react';
import { useNetwork } from '../contexts/NetworkContext';
import { Receipt, Info } from '@phosphor-icons/react';

/**
 * Live cost preview chip for the Launchpad sidebar.
 *
 * Shows an "Estimated" SOL cost from KNOWN Solana rent-exempt minimums
 * and base network fees. No RPC calls, no backend calls, no signing, no
 * automatic transactions — pure UX preview. The accurate cost is computed
 * fresh by SafetyConfirmModal right before the user signs.
 *
 *   mint account rent  : 1,461,600 lamports  (82-byte mint)
 *   metadata PDA rent  : 5,616,720 lamports  (~679-byte Metaplex)
 *   ATA rent           : 2,039,280 lamports  (165-byte token account)
 *   network fee        : 5,000 × N signatures
 *
 * For a token-create tx we have 2 required signers (payer + mint keypair),
 * so 10,000 lamports of fee. Revoke-authority instructions don't add signers.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

const COST = {
  mintRent: 1_461_600,
  metadataRent: 5_616_720,
  ataRent: 2_039_280,
  networkFee: 10_000, // 2 signatures × 5000
};
const TOTAL_LAMPORTS = COST.mintRent + COST.metadataRent + COST.ataRent + COST.networkFee;

const fmtSol = (lamports) => (lamports / LAMPORTS_PER_SOL).toFixed(6);

const CostPreviewChip = ({ valid }) => {
  const { isMainnet, testMode } = useNetwork();

  return (
    <div
      data-testid="cost-preview-chip"
      className={`border p-4 ${isMainnet ? 'bg-red-50 border-red-200' : 'bg-zinc-50 border-zinc-200'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Receipt size={16} weight="bold" className="text-zinc-700" />
          <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
            Estimated network cost
          </span>
        </div>
        <span
          data-testid="cost-preview-network-tag"
          className={`text-[10px] uppercase font-bold px-1.5 py-0.5 ${
            isMainnet ? 'bg-red-600 text-white' : 'bg-green-100 text-green-800 border border-green-300'
          }`}
        >
          {isMainnet ? 'mainnet' : 'devnet'}
        </span>
      </div>

      <p
        data-testid="cost-preview-total"
        className={`text-2xl font-black tracking-tighter ${isMainnet ? 'text-red-700' : 'text-zinc-900'}`}
      >
        ~{fmtSol(TOTAL_LAMPORTS)} SOL
      </p>

      <ul className="mt-3 text-[11px] text-zinc-600 space-y-1" data-testid="cost-preview-breakdown">
        <Row label="Mint account rent" value={fmtSol(COST.mintRent)} />
        <Row label="Metadata PDA rent" value={fmtSol(COST.metadataRent)} />
        <Row label="Your ATA rent" value={fmtSol(COST.ataRent)} />
        <Row label="Network fee (2 sigs)" value={fmtSol(COST.networkFee)} />
      </ul>

      <div className="mt-3 pt-3 border-t border-zinc-200 flex items-start gap-1.5 text-[10px] text-zinc-500 leading-snug">
        <Info size={12} weight="bold" className="mt-0.5 flex-shrink-0" />
        <span>
          {valid
            ? 'Final cost is recomputed via on-chain simulation and shown again before you sign.'
            : 'Fill in the required fields. Final cost is shown again before you sign.'}
          {testMode && ' Test Mode is ON — no real signing.'}
        </span>
      </div>
    </div>
  );
};

const Row = ({ label, value }) => (
  <li className="flex items-center justify-between">
    <span>{label}</span>
    <span className="font-mono text-zinc-800">{value} SOL</span>
  </li>
);

export default CostPreviewChip;
