import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { useState, useCallback } from 'react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * Sign + send + finalize one prebuilt airdrop batch transaction.
 * Returns { success, signature, error }. Never throws.
 */
async function sendBatch(connection, signTransaction, txBase64) {
  try {
    const txBuffer = Buffer.from(txBase64, 'base64');
    const transaction = Transaction.from(txBuffer);

    // Refresh blockhash to avoid `BlockhashNotFound` after long pauses
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;

    const signedTx = await signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    const confirm = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    if (confirm?.value?.err) {
      return {
        success: false,
        signature,
        error: `On-chain error: ${JSON.stringify(confirm.value.err)}`,
      };
    }
    return { success: true, signature };
  } catch (e) {
    return { success: false, signature: null, error: e?.message || String(e) };
  }
}

/**
 * Airdrop operations hook.
 *   - fetchMintInfo(mint): on-chain decimals/supply for any SPL mint
 *   - fetchBalance(mint, owner): on-chain token balance for an ATA
 *   - executeAirdrop({ mint, decimals, batches, onProgress, onBatchComplete })
 *       executes each batch sequentially. Wallet signs each. Reports progress.
 */
export function useAirdropOperations() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [running, setRunning] = useState(false);

  const fetchMintInfo = useCallback(async (mint) => {
    const res = await axios.get(`${API}/airdrop/mint-info/${mint}`);
    return res.data;
  }, []);

  const fetchBalance = useCallback(async (mint, owner) => {
    const res = await axios.get(`${API}/airdrop/balance`, {
      params: { mint, owner },
    });
    return res.data;
  }, []);

  const buildBatch = useCallback(async ({ mint, decimals, recipients }) => {
    const res = await axios.post(`${API}/airdrop/build-batch`, {
      mint,
      payer: publicKey.toBase58(),
      decimals,
      recipients,
    });
    return res.data;
  }, [publicKey]);

  const executeAirdrop = useCallback(async ({
    mint,
    decimals,
    batches,
    onProgress = () => {},
    maxRetries = 1,
  }) => {
    if (!publicKey || !signTransaction) {
      return { aborted: true, error: 'Wallet not connected' };
    }
    setRunning(true);
    const results = [];

    try {
      for (let i = 0; i < batches.length; i += 1) {
        const recipients = batches[i];
        let attempt = 0;
        let lastError = null;
        let result = null;

        while (attempt <= maxRetries) {
          attempt += 1;
          onProgress({
            batchIndex: i,
            totalBatches: batches.length,
            attempt,
            phase: 'building',
            recipientsInBatch: recipients.length,
          });

          try {
            const built = await buildBatch({ mint, decimals, recipients });
            onProgress({
              batchIndex: i,
              totalBatches: batches.length,
              attempt,
              phase: 'signing',
            });
            result = await sendBatch(connection, signTransaction, built.transaction);
          } catch (e) {
            result = { success: false, signature: null, error: e?.response?.data?.detail || e?.message || String(e) };
          }

          if (result.success) {
            onProgress({
              batchIndex: i,
              totalBatches: batches.length,
              phase: 'confirmed',
              signature: result.signature,
            });
            break;
          }
          lastError = result.error;
          // Stop retrying on user-rejected signing
          if (/user rejected|rejected the request/i.test(lastError || '')) {
            break;
          }
          if (attempt <= maxRetries) {
            onProgress({
              batchIndex: i,
              totalBatches: batches.length,
              attempt,
              phase: 'retrying',
              error: lastError,
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

        // Bail out on user rejection — they intentionally cancelled
        if (!result?.success && /user rejected|rejected the request/i.test(result?.error || '')) {
          break;
        }
      }
    } finally {
      setRunning(false);
    }

    return { results };
  }, [publicKey, signTransaction, connection, buildBatch]);

  return {
    fetchMintInfo,
    fetchBalance,
    executeAirdrop,
    running,
  };
}

export { sendBatch };
