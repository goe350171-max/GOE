import React, { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Check, ArrowSquareOut, Copy, X, ShareNetwork, Wallet, CircleNotch, Warning } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { copyText } from '../utils/clipboard';

const SuccessModal = ({ data, onClose }) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [walletDetected, setWalletDetected] = useState(null); // null|true|false
  const [pollAttempts, setPollAttempts] = useState(0);

  // Poll the creator's ATA periodically to detect indexing status
  useEffect(() => {
    if (!data || !data.mint || !publicKey || !connection) return;
    let cancelled = false;
    let attempt = 0;
    const MAX_ATTEMPTS = 8;
    const POLL_MS = 4000;

    const poll = async () => {
      if (cancelled) return;
      attempt += 1;
      setPollAttempts(attempt);
      try {
        const mintPk = new PublicKey(data.mint);
        const ataInfo = await connection.getParsedAccountInfo(
          data.ata ? new PublicKey(data.ata) : null,
        );
        const balance = ataInfo?.value?.data?.parsed?.info?.tokenAmount?.amount;
        if (balance && BigInt(balance) > 0n) {
          if (!cancelled) {
            setWalletDetected(true);
          }
          return;
        }
      } catch (_) { /* swallow */ }
      if (attempt >= MAX_ATTEMPTS) {
        if (!cancelled) setWalletDetected(false);
        return;
      }
      setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { cancelled = true; };
  }, [data, publicKey, connection]);

  if (!data) return null;

  const { mint, ata, signature, totalSupply, verified, imageUri, name, symbol } = data;

  const copyToClipboard = async (text, label) => {
    const ok = await copyText(text);
    if (ok) {
      toast.success(`${label} copied!`);
    } else {
      toast.error(`Copy failed. Please copy manually: ${text}`);
    }
  };

  const handleShareOnX = () => {
    const tokenName = name || 'my SPL token';
    const sym = symbol ? ` $${symbol}` : '';
    const tweet =
      `🚀 Just launched${sym} — ${tokenName} — on Solana mainnet!\n\n` +
      `Mint: ${mint}\n` +
      `https://solscan.io/token/${mint}\n\n` +
      `#Solana #SPL`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyShare = async () => {
    const tokenName = name || 'my SPL token';
    const sym = symbol ? ` $${symbol}` : '';
    const post =
      `🚀 Just launched${sym} — ${tokenName} — on Solana mainnet!\n\n` +
      `Mint: ${mint}\n` +
      `https://solscan.io/token/${mint}`;
    const ok = await copyText(post);
    if (ok) toast.success('Launch post copied!');
    else toast.error('Copy failed');
  };

  const handleImportToken = async () => {
    const ok = await copyText(mint);
    if (ok) {
      toast.success('Mint copied — paste into Phantom > Manage Tokens > Add Custom Token');
    } else {
      toast.error('Copy failed');
    }
  };

  const explorerTxUrl = `https://explorer.solana.com/tx/${signature}`;
  const explorerMintUrl = `https://explorer.solana.com/address/${mint}`;
  const solscanUrl = `https://solscan.io/token/${mint}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto py-8"
      data-testid="success-modal-overlay"
      onClick={onClose}
    >
      <div
        className="bg-white border border-zinc-300 w-full max-w-lg mx-4 relative my-auto"
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
              <code className="text-xs font-mono flex-1 truncate" data-testid="success-mint-value">{mint}</code>
              <button
                onClick={() => copyToClipboard(mint, 'Mint address')}
                data-testid="copy-mint-btn"
                className="p-1 hover:bg-zinc-200"
                aria-label="Copy mint address"
              >
                <Copy size={16} weight="bold" className="text-zinc-500" />
              </button>
            </div>
          </div>

          {ata && (
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-1">Your Token Account</p>
              <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-2">
                <code className="text-xs font-mono flex-1 truncate" data-testid="success-ata-value">{ata}</code>
                <button
                  onClick={() => copyToClipboard(ata, 'ATA')}
                  data-testid="copy-ata-btn"
                  className="p-1 hover:bg-zinc-200"
                  aria-label="Copy ATA"
                >
                  <Copy size={16} weight="bold" className="text-zinc-500" />
                </button>
              </div>
            </div>
          )}

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

          {/* Wallet visibility guidance */}
          <div className="border border-zinc-200 bg-zinc-50 p-4" data-testid="wallet-visibility-panel">
            <div className="flex items-start gap-3 mb-3">
              <Wallet size={18} weight="bold" className="text-zinc-700 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold mb-1">Wallet visibility</p>
                {walletDetected === true ? (
                  <p className="text-xs text-green-700 flex items-center gap-1">
                    <Check size={14} weight="bold" /> Token detected in your wallet
                  </p>
                ) : walletDetected === false ? (
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    <Warning size={12} weight="bold" className="inline mr-1 text-yellow-600" />
                    Phantom indexing can lag a few minutes. Try reopening Phantom or importing manually below.
                  </p>
                ) : (
                  <p className="text-xs text-zinc-600 flex items-center gap-1">
                    <CircleNotch size={14} weight="bold" className="animate-spin" />
                    Checking wallet… (attempt {pollAttempts}/8)
                  </p>
                )}
              </div>
            </div>
            <Button
              type="button"
              onClick={handleImportToken}
              data-testid="import-token-btn"
              variant="outline"
              className="w-full rounded-none h-9 text-xs font-semibold border-zinc-300 hover:bg-black hover:text-white hover:border-black"
            >
              Copy mint for Phantom import
            </Button>
            <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
              In Phantom: <span className="font-mono">Manage Tokens → Add Custom Token → paste mint</span>
            </p>
          </div>

          {/* Share Token */}
          <div className="border border-zinc-200 p-4" data-testid="share-token-panel">
            <div className="flex items-center gap-2 mb-3">
              <ShareNetwork size={18} weight="bold" className="text-zinc-700" />
              <p className="text-sm font-semibold">Share your launch</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleShareOnX}
                data-testid="share-on-x-btn"
                className="flex-1 rounded-none h-9 text-xs font-semibold bg-black text-white hover:bg-zinc-800"
              >
                Share on X / Twitter
              </Button>
              <Button
                type="button"
                onClick={handleCopyShare}
                data-testid="copy-share-text-btn"
                variant="outline"
                className="flex-1 rounded-none h-9 text-xs font-semibold border-zinc-300 hover:bg-zinc-100"
              >
                Copy post
              </Button>
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
