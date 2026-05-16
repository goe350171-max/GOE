import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import axios from 'axios';
import { toast } from 'sonner';
import {
  PaperPlaneTilt, Warning, UploadSimple, CheckCircle, XCircle,
  ArrowSquareOut, Spinner, CircleNotch,
} from '@phosphor-icons/react';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import { useAirdropOperations } from '../hooks/useAirdropOperations';
import { parseAirdropInput, chunkRecipients, parseCsvText } from '../utils/airdrop';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const BATCH_SIZE = 5; // Recipients per tx (safe under 1232-byte cap)
const FEE_PER_BATCH_SOL = 0.000005; // Rough estimate (5000 lamports base fee)

const Airdrop = () => {
  const { connected, publicKey } = useWallet();
  const { fetchMintInfo, fetchBalance, executeAirdrop, running } = useAirdropOperations();
  const csvInputRef = useRef(null);

  // Token source
  const [sourceMode, setSourceMode] = useState('launchpad'); // 'launchpad' | 'manual'
  const [launchpadTokens, setLaunchpadTokens] = useState([]);
  const [selectedMint, setSelectedMint] = useState('');
  const [manualMint, setManualMint] = useState('');

  // Mint info (on-chain)
  const [mintInfo, setMintInfo] = useState(null);
  const [mintInfoLoading, setMintInfoLoading] = useState(false);
  const [payerBalance, setPayerBalance] = useState(null);
  const [payerBalanceLoading, setPayerBalanceLoading] = useState(false);

  // Recipients input
  const [recipientsText, setRecipientsText] = useState('');
  const [csvName, setCsvName] = useState('');

  // Execution state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState(null);
  const [batchResults, setBatchResults] = useState([]); // [{ batchIndex, success, signature, error, recipients }]

  // Resolve effective mint based on source mode
  const effectiveMint = sourceMode === 'launchpad' ? selectedMint : manualMint.trim();

  // Load launchpad tokens
  useEffect(() => {
    axios.get(`${API}/tokens`)
      .then((res) => setLaunchpadTokens(res.data || []))
      .catch(() => setLaunchpadTokens([]));
  }, []);

  // Fetch on-chain mint info whenever effectiveMint changes (debounced)
  useEffect(() => {
    setMintInfo(null);
    setPayerBalance(null);
    if (!effectiveMint) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setMintInfoLoading(true);
      try {
        const info = await fetchMintInfo(effectiveMint);
        if (!cancelled) setMintInfo(info);
      } catch (e) {
        if (!cancelled) {
          setMintInfo({ error: e?.response?.data?.detail || e.message });
        }
      } finally {
        if (!cancelled) setMintInfoLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [effectiveMint, fetchMintInfo]);

  // Fetch payer balance once we have mintInfo + wallet
  useEffect(() => {
    if (!mintInfo || mintInfo.error || !publicKey) {
      setPayerBalance(null);
      return;
    }
    let cancelled = false;
    setPayerBalanceLoading(true);
    fetchBalance(effectiveMint, publicKey.toBase58())
      .then((bal) => { if (!cancelled) setPayerBalance(bal); })
      .catch(() => { if (!cancelled) setPayerBalance(null); })
      .finally(() => { if (!cancelled) setPayerBalanceLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveMint, mintInfo, publicKey, fetchBalance]);

  // Parse recipients
  const parsed = useMemo(() => parseAirdropInput(recipientsText), [recipientsText]);
  const totalAmount = parsed.valid.reduce((s, r) => s + r.amount, 0);
  const batches = useMemo(() => chunkRecipients(parsed.valid, BATCH_SIZE), [parsed.valid]);

  // Validation: insufficient balance?
  const decimals = mintInfo?.decimals ?? 0;
  const requiredRaw = BigInt(Math.round(totalAmount * (10 ** decimals)));
  const payerRaw = payerBalance?.balance ? BigInt(payerBalance.balance) : 0n;
  const insufficient = !!mintInfo && !mintInfo.error && payerBalance && requiredRaw > payerRaw;

  const estimatedFeeSol = (batches.length * FEE_PER_BATCH_SOL).toFixed(6);

  const handleCsvFile = async (file) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error('CSV file too large (max 1MB)');
      return;
    }
    const text = await file.text();
    const cleaned = parseCsvText(text);
    setRecipientsText(cleaned);
    setCsvName(file.name);
    toast.success(`Loaded ${cleaned.split('\n').filter(Boolean).length} rows from ${file.name}`);
  };

  const canExecute =
    connected &&
    !!effectiveMint &&
    !!mintInfo &&
    !mintInfo.error &&
    parsed.valid.length > 0 &&
    parsed.errors.length === 0 &&
    !insufficient &&
    !running;

  const handlePreview = () => {
    if (!canExecute) {
      if (!connected) return toast.error('Connect your wallet first');
      if (parsed.errors.length > 0) return toast.error('Fix validation errors before continuing');
      if (parsed.valid.length === 0) return toast.error('Add at least one recipient');
      if (!mintInfo || mintInfo.error) return toast.error('Pick a valid token first');
      if (insufficient) return toast.error('Insufficient token balance');
    }
    setBatchResults([]);
    setProgress(null);
    setConfirmOpen(true);
  };

  const handleExecute = async () => {
    setConfirmOpen(false);
    setBatchResults([]);
    toast.loading(`Starting airdrop: ${batches.length} batch${batches.length > 1 ? 'es' : ''}…`, { id: 'airdrop-run' });

    const { results } = await executeAirdrop({
      mint: effectiveMint,
      decimals: mintInfo.decimals,
      batches,
      onProgress: (p) => setProgress(p),
      maxRetries: 1,
    });

    setBatchResults(results || []);
    toast.dismiss('airdrop-run');

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;
    if (failed === 0) {
      toast.success(`Airdrop complete: ${successful}/${batches.length} batches confirmed`);
    } else if (successful === 0) {
      toast.error(`Airdrop failed: ${failed}/${batches.length} batches errored`);
    } else {
      toast.warning(`Partial airdrop: ${successful} sent · ${failed} failed`);
    }
    setProgress(null);

    // Refresh balance
    if (publicKey) {
      try {
        const bal = await fetchBalance(effectiveMint, publicKey.toBase58());
        setPayerBalance(bal);
      } catch (_) { /* ignore */ }
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="airdrop-page">
      <div className="mb-8">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mb-3">Token Airdrop</h1>
        <p className="text-base sm:text-lg text-zinc-700">
          Distribute SPL tokens to many wallets. Batched, validated, signed in your wallet — no private keys ever leave your device.
        </p>
      </div>

      <div className="space-y-6">
        {/* 1. Token selection */}
        <section className="bg-white border border-zinc-300 p-6 sm:p-8" data-testid="airdrop-token-section">
          <div className="flex items-center gap-3 mb-6">
            <PaperPlaneTilt size={22} weight="bold" />
            <h2 className="text-xl sm:text-2xl font-bold tracking-tighter">1. Pick token</h2>
          </div>

          <Tabs value={sourceMode} onValueChange={setSourceMode}>
            <TabsList className="grid grid-cols-2 w-full max-w-md rounded-none bg-zinc-100">
              <TabsTrigger value="launchpad" data-testid="tab-launchpad" className="rounded-none">From Launchpad</TabsTrigger>
              <TabsTrigger value="manual" data-testid="tab-manual-mint" className="rounded-none">Any SPL Mint</TabsTrigger>
            </TabsList>

            <TabsContent value="launchpad" className="pt-5">
              {launchpadTokens.length === 0 ? (
                <p className="text-sm text-zinc-600">
                  No tokens created via this launchpad yet. Switch to "Any SPL Mint" or create one first.
                </p>
              ) : (
                <Select value={selectedMint} onValueChange={setSelectedMint}>
                  <SelectTrigger data-testid="launchpad-token-select" className="rounded-none border-zinc-300 max-w-2xl">
                    <SelectValue placeholder="Choose a launchpad token…" />
                  </SelectTrigger>
                  <SelectContent>
                    {launchpadTokens.map((t) => (
                      <SelectItem key={t.mint} value={t.mint}>
                        <span className="font-semibold">{t.name}</span>
                        <span className="text-zinc-500 ml-2">({t.symbol})</span>
                        <span className="text-zinc-400 ml-2 font-mono text-xs">
                          {t.mint.slice(0, 6)}…{t.mint.slice(-6)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </TabsContent>

            <TabsContent value="manual" className="pt-5">
              <Label className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                SPL Mint Address
              </Label>
              <Input
                data-testid="manual-mint-input"
                value={manualMint}
                onChange={(e) => setManualMint(e.target.value)}
                placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black font-mono text-sm max-w-2xl"
              />
              <p className="text-xs text-zinc-500 mt-2">
                Decimals will be fetched on-chain — supports any SPL token (USDC, BONK, your own, etc.).
              </p>
            </TabsContent>
          </Tabs>

          {effectiveMint && (
            <div className="mt-5 border-t border-zinc-200 pt-5" data-testid="mint-info-panel">
              {mintInfoLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-600">
                  <CircleNotch size={16} className="animate-spin" weight="bold" /> Fetching on-chain info…
                </div>
              ) : mintInfo?.error ? (
                <div className="flex items-center gap-2 text-sm text-red-700">
                  <Warning size={16} weight="bold" /> {mintInfo.error}
                </div>
              ) : mintInfo ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <Stat label="Decimals" value={mintInfo.decimals} testid="mint-decimals" />
                  <Stat
                    label="On-chain Supply"
                    value={(Number(mintInfo.supply) / 10 ** mintInfo.decimals).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    testid="mint-supply"
                  />
                  <Stat
                    label="Mint Auth"
                    value={mintInfo.mintAuthority ? 'Active' : 'Revoked'}
                    testid="mint-authority"
                  />
                  <Stat
                    label="Your Balance"
                    value={payerBalanceLoading ? '…' : payerBalance?.uiAmount?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? '0'}
                    testid="payer-balance"
                  />
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* 2. Recipients */}
        <section className="bg-white border border-zinc-300 p-6 sm:p-8" data-testid="airdrop-recipients-section">
          <div className="flex items-center gap-3 mb-6">
            <UploadSimple size={22} weight="bold" />
            <h2 className="text-xl sm:text-2xl font-bold tracking-tighter">2. Recipients</h2>
          </div>

          <Tabs defaultValue="paste">
            <TabsList className="grid grid-cols-2 w-full max-w-md rounded-none bg-zinc-100">
              <TabsTrigger value="paste" data-testid="tab-paste" className="rounded-none">Paste</TabsTrigger>
              <TabsTrigger value="csv" data-testid="tab-csv" className="rounded-none">CSV Upload</TabsTrigger>
            </TabsList>

            <TabsContent value="paste" className="pt-5 space-y-2">
              <p className="text-xs text-zinc-600">
                One per line: <code className="bg-zinc-100 px-1 py-0.5">wallet,amount</code>
              </p>
              <Textarea
                data-testid="recipients-textarea"
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                rows={8}
                placeholder={"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU, 100\nD9Dqk1xXGkXwZ6gWE8FqYvJ2qJRdMnS6YZwN9yQqYcVm, 250"}
                className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black font-mono text-sm resize-y"
              />
            </TabsContent>

            <TabsContent value="csv" className="pt-5 space-y-3">
              <p className="text-xs text-zinc-600">
                Two columns: <code className="bg-zinc-100 px-1 py-0.5">address,amount</code>. Optional header row.
              </p>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  data-testid="csv-pick-btn"
                  onClick={() => csvInputRef.current?.click()}
                  className="rounded-none bg-black text-white hover:bg-zinc-800"
                >
                  <UploadSimple size={16} weight="bold" className="mr-2" /> Choose CSV
                </Button>
                {csvName && <span className="text-xs text-zinc-600 font-mono truncate">{csvName}</span>}
              </div>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => handleCsvFile(e.target.files?.[0])}
                className="hidden"
                data-testid="csv-file-input"
              />
              {recipientsText && (
                <Textarea
                  data-testid="csv-preview-textarea"
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  rows={6}
                  className="rounded-none border-zinc-300 font-mono text-xs resize-y"
                />
              )}
            </TabsContent>
          </Tabs>

          {/* Validation summary */}
          {(parsed.valid.length > 0 || parsed.errors.length > 0) && (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="validation-summary">
              <Stat label="Valid" value={parsed.valid.length} testid="valid-count" tone="ok" />
              <Stat label="Errors" value={parsed.errors.length} testid="error-count" tone={parsed.errors.length ? 'err' : 'ok'} />
              <Stat
                label="Batches"
                value={`${batches.length} × ≤${BATCH_SIZE}`}
                testid="batch-count"
              />
            </div>
          )}

          {parsed.errors.length > 0 && (
            <div className="mt-4 max-h-40 overflow-auto border border-red-300 bg-red-50" data-testid="error-list">
              {parsed.errors.slice(0, 50).map((err) => (
                <div key={`${err.line}-${err.reason}`} className="px-3 py-1.5 text-xs text-red-900 border-b border-red-200 last:border-b-0">
                  <span className="font-semibold">Line {err.line}:</span> {err.reason}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Summary & Execute */}
        {parsed.valid.length > 0 && mintInfo && !mintInfo.error && (
          <section className="bg-white border border-zinc-300 p-6 sm:p-8" data-testid="airdrop-summary-section">
            <div className="flex items-center gap-3 mb-6">
              <CheckCircle size={22} weight="bold" />
              <h2 className="text-xl sm:text-2xl font-bold tracking-tighter">3. Review &amp; send</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <Stat label="Recipients" value={parsed.valid.length} testid="dry-recipients" />
              <Stat label="Total tokens" value={totalAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} testid="dry-total" />
              <Stat label="Batches" value={batches.length} testid="dry-batches" />
              <Stat label="Est. SOL fee" value={`~${estimatedFeeSol}`} testid="dry-fee" />
            </div>

            {insufficient && (
              <div className="border border-red-300 bg-red-50 p-4 mb-4 flex items-start gap-3" data-testid="insufficient-warning">
                <Warning size={20} weight="bold" className="text-red-700 mt-0.5" />
                <div className="text-sm text-red-900">
                  <p className="font-semibold mb-1">Insufficient balance</p>
                  <p>
                    You need <span className="font-mono">{totalAmount.toLocaleString()}</span> tokens but only hold{' '}
                    <span className="font-mono">{payerBalance?.uiAmount?.toLocaleString() ?? '0'}</span>.
                  </p>
                </div>
              </div>
            )}

            <Button
              type="button"
              data-testid="airdrop-preview-btn"
              onClick={handlePreview}
              disabled={!canExecute}
              className="w-full bg-black text-white hover:bg-zinc-800 rounded-none h-12 font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? 'Running…' : connected ? `Preview & confirm (${batches.length} tx)` : 'Connect wallet to continue'}
            </Button>

            {!connected && (
              <div className="mt-4">
                <WalletMultiButton data-testid="airdrop-connect-wallet" />
              </div>
            )}
          </section>
        )}

        {/* 4. Execution progress / results */}
        {(progress || batchResults.length > 0) && (
          <section className="bg-white border border-zinc-300 p-6 sm:p-8" data-testid="airdrop-results-section">
            <div className="flex items-center gap-3 mb-5">
              <Spinner size={22} weight="bold" className={running ? 'animate-spin' : ''} />
              <h2 className="text-xl sm:text-2xl font-bold tracking-tighter">Execution status</h2>
            </div>

            {progress && (
              <div className="mb-4 bg-zinc-50 border border-zinc-200 p-4 text-sm font-mono" data-testid="airdrop-progress">
                Batch {progress.batchIndex + 1}/{progress.totalBatches} — {progress.phase}
                {progress.attempt > 1 ? ` (attempt ${progress.attempt})` : ''}
                {progress.signature ? ` — ${progress.signature.slice(0, 12)}…` : ''}
                {progress.error ? ` — ${progress.error}` : ''}
              </div>
            )}

            {batchResults.length > 0 && (
              <div className="border border-zinc-200 divide-y divide-zinc-200" data-testid="batch-results">
                {batchResults.map((r) => (
                  <div key={r.batchIndex} className="px-4 py-3 flex items-center gap-3 text-sm">
                    {r.success ? (
                      <CheckCircle size={20} weight="fill" className="text-green-600 flex-shrink-0" />
                    ) : (
                      <XCircle size={20} weight="fill" className="text-red-600 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">
                        Batch {r.batchIndex + 1} · {r.recipients.length} recipient{r.recipients.length > 1 ? 's' : ''}
                      </p>
                      {r.error && <p className="text-xs text-red-700 truncate">{r.error}</p>}
                    </div>
                    {r.signature && (
                      <a
                        href={`https://explorer.solana.com/tx/${r.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`batch-explorer-${r.batchIndex}`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-zinc-300 hover:bg-black hover:text-white hover:border-black transition-colors"
                      >
                        Explorer <ArrowSquareOut size={12} weight="bold" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Confirmation modal */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="airdrop-confirm-dialog" className="rounded-none border-zinc-300">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black tracking-tighter">Confirm airdrop</DialogTitle>
            <DialogDescription>
              You're about to sign {batches.length} transaction{batches.length > 1 ? 's' : ''} with your wallet.
              Each batch must be signed individually.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 text-sm border-y border-zinc-200 py-4">
            <Stat label="Token" value={mintInfo ? `${mintInfo.decimals}d` : '—'} testid="confirm-token" />
            <Stat label="Recipients" value={parsed.valid.length} testid="confirm-recipients" />
            <Stat label="Total tokens" value={totalAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} testid="confirm-total" />
            <Stat label="Est. fee" value={`~${estimatedFeeSol} SOL`} testid="confirm-fee" />
          </div>
          <p className="text-xs text-zinc-600">
            New recipient ATAs (if any) will be created automatically. Your wallet signs each batch — private keys never leave Phantom/Solflare.
          </p>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="confirm-cancel-btn"
              onClick={() => setConfirmOpen(false)}
              className="rounded-none"
            >
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="confirm-execute-btn"
              onClick={handleExecute}
              className="rounded-none bg-black text-white hover:bg-zinc-800"
            >
              Sign &amp; send {batches.length} tx
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Stat = ({ label, value, testid, tone }) => {
  const toneClass =
    tone === 'ok' ? 'text-green-700' :
    tone === 'err' ? 'text-red-700' : 'text-zinc-900';
  return (
    <div data-testid={testid}>
      <p className="text-xs uppercase tracking-wider text-zinc-500 mb-1">{label}</p>
      <p className={`text-base sm:text-lg font-bold ${toneClass}`}>{value}</p>
    </div>
  );
};

export default Airdrop;
