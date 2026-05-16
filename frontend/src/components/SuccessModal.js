import React from 'react';
import { Check, ArrowSquareOut, Copy, X } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';

const SuccessModal = ({ data, onClose }) => {
  if (!data) return null;

  const { mint, ata, signature, explorerUrl, totalSupply, verified, imageUri } = data;

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  const truncate = (str) => str ? `${str.slice(0, 6)}...${str.slice(-6)}` : '';

  const explorerTxUrl = `https://explorer.solana.com/tx/${signature}`;
  const explorerMintUrl = `https://explorer.solana.com/address/${mint}`;
  const solscanUrl = `https://solscan.io/token/${mint}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="success-modal-overlay"
      onClick={onClose}
    >
      <div
        className="bg-white border border-zinc-300 w-full max-w-lg mx-4 relative"
        onClick={(e) => e.stopPropagation()}
        data-testid="success-modal"
      >
        {/* Header */}
        <div className="bg-black text-white px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white flex items-center justify-center">
              <Check size={24} weight="bold" className="text-black" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Token Created</h2>
              <p className="text-xs text-zinc-400">Transaction finalized on-chain</p>
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="close-success-modal"
            className="p-1 hover:bg-zinc-800 transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-5">
          {/* Image preview */}
          {imageUri && (
            <div className="flex justify-center">
              <img
                src={imageUri.startsWith('ipfs://') ? `https://gateway.pinata.cloud/ipfs/${imageUri.replace('ipfs://', '')}` : imageUri}
                alt="Token"
                className="w-20 h-20 border border-zinc-300 object-cover"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
          )}

          {/* Mint Address */}
          <div>
            <p className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-1">Mint Address</p>
            <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2">
              <code className="text-xs font-mono flex-1 truncate">{mint}</code>
              <button onClick={() => copyToClipboard(mint, 'Mint address')} className="p-1 hover:bg-zinc-200">
                <Copy size={16} weight="bold" className="text-zinc-500" />
              </button>
            </div>
          </div>

          {/* ATA */}
          {ata && (
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-1">Your Token Account</p>
              <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2">
                <code className="text-xs font-mono flex-1 truncate">{ata}</code>
                <button onClick={() => copyToClipboard(ata, 'ATA')} className="p-1 hover:bg-zinc-200">
                  <Copy size={16} weight="bold" className="text-zinc-500" />
                </button>
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-50 border border-zinc-200 p-3">
              <p className="text-xs text-zinc-500 mb-1">Total Supply</p>
              <p className="font-bold text-sm">
                {totalSupply ? Number(totalSupply).toLocaleString() : '1,000,000,000'}
              </p>
            </div>
            <div className="bg-zinc-50 border border-zinc-200 p-3">
              <p className="text-xs text-zinc-500 mb-1">Status</p>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${verified ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <p className="font-bold text-sm">{verified ? 'Verified' : 'Confirming'}</p>
              </div>
            </div>
          </div>

          {/* Explorer Links */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider font-semibold text-zinc-500">Explorer Links</p>
            <div className="flex flex-col gap-2">
              <a
                href={explorerMintUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="explorer-mint-link"
                className="flex items-center justify-between px-3 py-2 border border-zinc-200 hover:bg-black hover:text-white hover:border-black transition-all text-sm font-medium"
              >
                <span>Solana Explorer</span>
                <ArrowSquareOut size={16} weight="bold" />
              </a>
              <a
                href={solscanUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="solscan-link"
                className="flex items-center justify-between px-3 py-2 border border-zinc-200 hover:bg-black hover:text-white hover:border-black transition-all text-sm font-medium"
              >
                <span>Solscan</span>
                <ArrowSquareOut size={16} weight="bold" />
              </a>
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="explorer-tx-link"
                className="flex items-center justify-between px-3 py-2 border border-zinc-200 hover:bg-black hover:text-white hover:border-black transition-all text-sm font-medium"
              >
                <span>Transaction</span>
                <ArrowSquareOut size={16} weight="bold" />
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-zinc-200">
          <Button
            onClick={onClose}
            data-testid="success-modal-done"
            className="w-full bg-black text-white hover:bg-zinc-800 rounded-none h-11 font-bold"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SuccessModal;
