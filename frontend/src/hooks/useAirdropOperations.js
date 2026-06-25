import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import axios from 'axios';
import { useState, useCallback } from 'react';
import { useNetwork } from '../contexts/NetworkContext';
import { simulateTxCost, TX_ACTIONS } from '../utils/txSafety';
import { extractErrorMessage } from '../utils/errors';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * Sign + send + confirm one prebuilt airdrop batch transaction.
 * NO auto-retry on mainnet. Returns { success, signature, error }.
 */
async function signSendAndConfirm(connection, signTransaction, transaction, isMainnet) {
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;

    const signedTx = await signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: isMainnet ? 0 : 3,
    });

    const confirm = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    if (confirm?.value?.err) {
      return { success: false, signature, error: `On-chain error: ${JSON.stringify(confirm.value.err)}` };
    }
    return { success: true, signature };
  } catch (e) {
    return { success: false, signature: null, error: e?.message || String(e) };
  }
}

export function useAirdropOperations() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { isMainnet, testMode, recordSignedTransaction } = useNetwork();
  const [running, setRunning] = useState(false);

  const fetchMintInfo = useCallback(async (mint) => {
    const res = await axios.get(`${API}/airdrop/mint-info/${mint}`);
    return res.data;
  }, []);

  const fetchBalance = useCallback(async (mint, owner) => {
    const res = await axios.get(`${API}/airdrop/balance`, { params: { mint, owner } });
    return res.data;
  }, []);

  const buildBatch = useCallback(async ({
  mint,
  decimals,
  recipients,
  feeSignature,
}) => {
  const res = await axios.post(`${API}/airdrop/build-batch`, {
    mint,
    payer: publicKey.toBase58(),
    decimals,
    recipients,
    fee_signature: feeSignature,
  });

  return res.data;
}, [publicKey]);

  /**
   * Simulate the FIRST batch (representative) and project total cost.
   * Called from the UI BEFORE confirmation modal opens.
   */
  const previewAirdrop = useCallback(async ({
    mint,
    decimals,
    batches,
    feeSignature,
  }) => {
    if (!publicKey) throw new Error('Wallet not connected');
    if (!batches?.length) throw new Error('No batches to preview');

    const built = await buildBatch({
      mint,
      decimals,
      recipients: batches[0],
      feeSignature,
    });
    const txBuffer = Buffer.from(built.transaction, 'base64');
    const transaction = Transaction.from(txBuffer);

    // Advisory simulation — never blocks the airdrop. If it fails (Helius
    // sometimes rejects simulation of unsigned account creation), fall back
    // to a per-recipient rent estimate so the safety modal still shows
    // a sensible cost figure.
    let sim;
    try {
      sim = await simulateTxCost(connection, transaction, publicKey.toBase58());
    } catch (e) {
      sim = { ok: false, soft: true, error: e?.message || 'simulation threw', logs: [] };
    }

    const SAFE_PER_BATCH_LAMPORTS = 10_000 + 2_039_280; // base fee + 1 ATA rent
    if (!sim.ok) {
      const totalLamports = SAFE_PER_BATCH_LAMPORTS * batches.length;
      return {
        ok: true,
        simulation: {
          ok: true,
          soft: true,
          advisoryError: sim.error,
          lamports: totalLamports,
          sol: totalLamports / 1_000_000_000,
          baseFeeLamports: 10_000 * batches.length,
          rentLamports: 2_039_280 * batches.length,
          computeUnits: 0,
          logs: [],
          preBalanceLamports: 0,
          postBalanceLamports: 0,
        },
        perBatchLamports: SAFE_PER_BATCH_LAMPORTS,
        totalLamports,
      };
    }

    const perBatchLamports = sim.lamports || SAFE_PER_BATCH_LAMPORTS;
    const totalLamports = perBatchLamports * batches.length;

    return {
      ok: true,
      simulation: {
        ...sim,
        lamports: totalLamports,
        sol: totalLamports / 1_000_000_000,
      },
      perBatchLamports,
      totalLamports,
    };
  }, [publicKey, buildBatch, connection]);

  /**
   * Execute the airdrop. Each batch is re-built fresh (different recipients),
   * simulated, and signed. NO auto-retry on mainnet.
   * Caller MUST have shown a confirmation modal with `previewAirdrop` results first.
   */
  const executeAirdrop = useCallback(async ({
    mint,
    decimals,
    batches,
    feeSignature,
    onProgress = () => {},
  }) => {
    if (!publicKey || !signTransaction) {
      return { aborted: true, error: 'Wallet not connected' };
    }
    if (testMode) {
      return { aborted: true, error: 'TEST_MODE_BLOCKED' };
    }

   
    setRunning(true);
    const results = [];
    // On mainnet → no retries. On devnet → 1 retry per batch.
    const maxBatchRetries = isMainnet ? 0 : 1;

    try {
      for (let i = 0; i < batches.length; i += 1) {
        const recipients = batches[i];
        let attempt = 0;
        let lastError = null;
        let result = null;

        while (attempt <= maxBatchRetries) {
          attempt += 1;
          onProgress({
            batchIndex: i, totalBatches: batches.length, attempt,
            phase: 'building', recipientsInBatch: recipients.length,
          });

          try {
            const built = await buildBatch({
              mint,
              decimals,
              recipients,
              feeSignature,
            });
            const txBuffer = Buffer.from(built.transaction, 'base64');
            const transaction = Transaction.from(txBuffer);

            // Per-batch advisory simulation. Failures do NOT block signing.
            onProgress({ batchIndex: i, totalBatches: batches.length, attempt, phase: 'simulating' });
            let sim;
            try {
              sim = await simulateTxCost(connection, transaction, publicKey.toBase58());
            } catch (e) {
              sim = { ok: false, soft: true, error: e?.message || 'simulation threw' };
            }
            onProgress({ batchIndex: i, totalBatches: batches.length, attempt, phase: 'signing' });
            result = await signSendAndConfirm(connection, signTransaction, transaction, isMainnet);
            if (result.success) {
              recordSignedTransaction({
                action: TX_ACTIONS.AIRDROP_BATCH,
                mint,
                wallet: publicKey.toBase58(),
                signature: result.signature,
                lamports: sim.ok ? sim.lamports : 10_000 + 2_039_280,
                sol: (sim.ok ? sim.lamports : (10_000 + 2_039_280)) / 1_000_000_000,
                details: { batchIndex: i, recipients: recipients.length, simulationOk: !!sim.ok },
              });
            }
          } catch (e) {
            result = { success: false, signature: null, error: extractErrorMessage(e) };
          }

          if (result?.success) {
            onProgress({
              batchIndex: i, totalBatches: batches.length,
              phase: 'confirmed', signature: result.signature,
            });
            break;
          }
          lastError = result?.error;
          // Stop on user rejection — never re-prompt without explicit user action
          if (/user rejected|rejected the request/i.test(lastError || '')) break;
          if (attempt <= maxBatchRetries) {
            onProgress({
              batchIndex: i, totalBatches: batches.length, attempt,
              phase: 'retrying', error: lastError,
            });
            await new Promise((r) => setTimeout(r, 1500));
          }
        }

        results.push({
          batchIndex: i,
          recipients,
          ...result,
          error: result?.error || lastError,
        });

        if (!result?.success && /user rejected|rejected the request/i.test(result?.error || '')) {
          break;
        }
      }
    } finally {
      setRunning(false);
    }

    return { results };
  }, [publicKey, signTransaction, connection, isMainnet, testMode, buildBatch, recordSignedTransaction]);

  return {
    fetchMintInfo,
    fetchBalance,
    previewAirdrop,
    executeAirdrop,
    running,
  };
}
