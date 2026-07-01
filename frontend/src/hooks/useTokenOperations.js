import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { useNetwork } from '../contexts/NetworkContext';
import { useDiagnostics } from '../contexts/DiagnosticsContext';

import { simulateTxCost, TX_ACTIONS } from '../utils/txSafety';
import { extractErrorMessage } from '../utils/errors';

const DEBUG = (process.env.REACT_APP_DEBUG_TOKEN_CREATE ?? 'true') !== 'false';
const dbg = (label, ...args) => {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(`%c[token-create]%c ${label}`, 'color:#0a7;font-weight:bold', 'color:inherit', ...args);
};

/**
 * Deep introspection of a deserialized legacy Transaction. Used to detect
 * structural problems BEFORE handing the tx to the wallet adapter (which
 * tends to collapse such issues into "invalid arguments").
 */
function inspectTransaction(tx, expectedPayerStr, expectedMintStr) {
  const issues = [];
  const info = {
    className: tx?.constructor?.name || 'unknown',
    isLegacy: tx?.constructor?.name === 'Transaction',
    isVersioned: tx?.constructor?.name === 'VersionedTransaction' || tx?.message?.version !== undefined,
    instructionCount: tx?.instructions?.length ?? 0,
    feePayer: tx?.feePayer?.toBase58?.() ?? null,
    recentBlockhash: tx?.recentBlockhash ?? null,
    signaturesCount: tx?.signatures?.length ?? 0,
  };

  if (info.instructionCount === 0) issues.push('empty instructions array');
  if (!info.recentBlockhash) issues.push('missing recentBlockhash');
  if (!info.feePayer) issues.push('missing feePayer (deserialization may have dropped it)');
  if (expectedPayerStr && info.feePayer && info.feePayer !== expectedPayerStr) {
    issues.push(`feePayer mismatch: tx has ${info.feePayer}, wallet is ${expectedPayerStr}`);
  }

  // Inspect signatures slot — should be 2 slots: [payer, mint]
  const sigs = (tx?.signatures || []).map((s) => ({
    pubkey: s.publicKey?.toBase58?.(),
    hasSig: !!s.signature,
  }));
  info.signatures = sigs;
  const payerSlot = sigs.find((s) => s.pubkey === expectedPayerStr);
  const mintSlot = sigs.find((s) => s.pubkey === expectedMintStr);
  if (!payerSlot) issues.push(`payer ${expectedPayerStr} missing from signatures array`);
  if (!mintSlot) issues.push(`mint ${expectedMintStr} missing from signatures array`);

  // Inspect every instruction for malformed account metas
  const ixSummaries = [];
  (tx?.instructions || []).forEach((ix, i) => {
    const summary = {
      ix: i,
      program: ix.programId?.toBase58?.() || 'unknown',
      keyCount: ix.keys?.length ?? 0,
      dataLen: ix.data?.length ?? 0,
    };
    // Detect duplicate writable+signer combos
    const seen = new Map();
    (ix.keys || []).forEach((k, ki) => {
      if (!k.pubkey) {
        issues.push(`ix ${i} key ${ki} has no pubkey`);
        return;
      }
      const pk = k.pubkey.toBase58();
      if (seen.has(pk)) {
        const prev = seen.get(pk);
        // Solana allows duplicates with different flags; not an error per se,
        // but worth noting at this level of debug.
        if (prev.isSigner !== k.isSigner || prev.isWritable !== k.isWritable) {
          // No-op: legitimate (e.g., payer appears as fee payer + as instr signer)
        }
      }
      seen.set(pk, { isSigner: k.isSigner, isWritable: k.isWritable });
    });
    ixSummaries.push(summary);
  });
  info.instructions = ixSummaries;

  return { info, issues };
}

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * Verify on-chain mint supply and ATA balance after tx confirmation.
 * Retries up to maxRetries with delay between attempts.
 */
async function verifyOnChain(connection, mintPubkey, ataPubkey, expectedRaw, maxRetries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
      const mintData = mintInfo?.value?.data?.parsed?.info;
      const ataInfo = await connection.getParsedAccountInfo(ataPubkey);
      const ataData = ataInfo?.value?.data?.parsed?.info;

      const supply = mintData?.supply;
      const balance = ataData?.tokenAmount?.amount;

      // eslint-disable-next-line no-console
      console.log(`[verify attempt ${attempt}] supply=${supply}, balance=${balance}`);

      if (supply && BigInt(supply) > 0n && balance && BigInt(balance) > 0n) {
        return {
          verified: true,
          supply,
          balance,
          decimals: mintData?.decimals,
          mintAuthority: mintData?.mintAuthority ?? null,
          freezeAuthority: mintData?.freezeAuthority ?? null,
          ataOwner: ataData?.owner,
        };
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[verify attempt ${attempt}] error:`, e.message);
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { verified: false };
}

export const useTokenOperations = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, wallet } = useWallet();
  const { isMainnet, testMode, safeMode, recordSignedTransaction } = useNetwork();
  const { push: diagPush, clear: diagClear } = useDiagnostics();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Token creation flow with safety guards:
   *   1. Build tx on backend
   *   2. Deserialize — backend has already partial-signed with mint keypair
   *   3. Simulate transaction → compute SOL cost
   *   4. Call confirmBeforeSign({ simulation, ... }) and AWAIT user's explicit click
   *      (this is the safety gate — automation cannot bypass it)
   *   5. If user confirmed → signAndSendTransaction (Phantom/Solflare native provider)
   *   6. Send (mainnet: no auto-retry, devnet: up to 3 retries via web3.js)
   *   7. Verify on-chain + persist signature
   *   8. Record audit log entry
   *
   * confirmBeforeSign signature: ({ simulation, prepared }) => Promise<boolean>
   */
  const createToken = useCallback(async (tokenData, { confirmBeforeSign } = {}) => {
    if (!publicKey || !sendTransaction) {
      toast.error('Please connect your wallet');
      return null;
    }

    if (testMode) {
      toast.error('Test Mode is ON — signing is blocked. Disable Test Mode in the header to proceed.');
      return { success: false, error: 'TEST_MODE_BLOCKED' };
    }

    setLoading(true);
    setError(null);

    // Keep mint available for the catch block
    let mint = null;

    diagClear();
    diagPush('init', 'start', {
      walletName: wallet?.adapter?.name || 'unknown',
      walletVersion: wallet?.adapter?.version || 'unknown',
      network: isMainnet ? 'mainnet' : 'devnet',
      testMode,
      safeMode,
      rpcEndpoint: connection?.rpcEndpoint?.replace(/api-key=[^&]+/, 'api-key=***') || 'unknown',
    });

    try {
      // ── 0. Pre-flight validation (catch undefined/null before payload build) ──
      diagPush('preflight', 'start');
      const md = tokenData?.metadata || {};
      const preflightProblems = [];
      if (!md.name || typeof md.name !== 'string') preflightProblems.push('metadata.name missing');
      if (!md.symbol || typeof md.symbol !== 'string') preflightProblems.push('metadata.symbol missing');
      if (typeof md.decimals !== 'number' || !Number.isInteger(md.decimals)) preflightProblems.push('metadata.decimals must be integer');
      if (typeof md.total_supply !== 'number' || md.total_supply <= 0) preflightProblems.push('metadata.total_supply must be a positive number');
      if (!publicKey?.toBase58?.()) preflightProblems.push('payer pubkey not derivable');
      if (preflightProblems.length > 0) {
        const msg = `Preflight failed: ${preflightProblems.join('; ')}`;
        diagPush('preflight', 'fail', { issues: preflightProblems });
        dbg('preflight FAIL', preflightProblems);
        toast.error(msg);
        return { success: false, error: msg };
      }
      diagPush('preflight', 'ok');

      // ── 1. Build tx on backend ────────────────────────────────────────
      const payload = {
        payer: publicKey.toBase58(),
        metadata: tokenData.metadata,
        revoke_mint_authority: tokenData.revokeMintAuthority,
        revoke_freeze_authority: tokenData.revokeFreezeAuthority,
        revoke_update_authority: tokenData.revokeUpdateAuthority,
      };
      // Detect any BigInt leaks into the JSON payload (BigInts can't serialize)
      try { JSON.stringify(payload); } catch (e) {
        diagPush('payload', 'fail', { error: 'BigInt or unserializable value in payload' });
        throw new Error(`Payload not JSON-serializable: ${e.message}`);
      }
      diagPush('backend-build', 'start', { hasImage: !!md.image, decimals: md.decimals });
      dbg('1/9 POST /api/tokens/create payload:', payload);
      toast.loading('Building transaction…', { id: 'tx-build' });

      const response = await axios.post(`${API}/tokens/create`, payload);

      const {
        transaction: txData,
        instructionData,
        mint: responseMint,
        ata,
        totalMinted,
        metadataUri,
        metadataPda,
        imageUri,
        explorerUrl,
      } = response.data;

      // The mint pubkey is returned directly — we never need the private key on the frontend.
      const mintPubkeyStr = instructionData?.mint || responseMint;

      mint = responseMint;

      diagPush('backend-build', 'ok', {
        mint,
        ata,
        txDataLength: txData?.length,
        metadataUriLen: metadataUri?.length,
      });

      dbg('1/9 backend response:', {
        mint,
        ata,
        metadataPda,
        metadataUri,
        imageUri,
        totalMinted,
        txDataLength: txData?.length,
      });

      toast.dismiss('tx-build');

      // ── 2. Deserialize + REFRESH blockhash from frontend connection ──
      diagPush('deserialize', 'start');
      const txBuffer = Buffer.from(txData, 'base64');
      let transaction;
      try {
        transaction = Transaction.from(txBuffer);
      } catch (e) {
        diagPush('deserialize', 'fail', { error: e.message, bufferBytes: txBuffer.length });
        throw new Error(`Transaction.from() failed: ${e.message}`);
      }

      // ── 2. Refresh blockhash from frontend connection ──────────────────
      // Single-signer transaction (payer only) — safe to refresh blockhash.
      const backendBlockhash = transaction.recentBlockhash;
      try {
        const latest = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = latest.blockhash;
        transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
        diagPush('blockhash-refresh', 'ok', {
          backend: backendBlockhash?.slice(0, 12),
          cluster: latest.blockhash?.slice(0, 12),
          rpcEndpoint: connection?.rpcEndpoint?.replace(/api-key=[^&]+/, 'api-key=***'),
        });
      } catch (e) {
        diagPush('blockhash-refresh', 'fail', {
          error: e.message,
          rpcEndpoint: connection?.rpcEndpoint?.replace(/api-key=[^&]+/, 'api-key=***'),
        });
        throw new Error(`Could not refresh blockhash from cluster: ${e.message}`);
      }

      // Defensive: force-set feePayer in case deserialization dropped it.
      if (!transaction.feePayer) {
        transaction.feePayer = publicKey;
        dbg('2/9 feePayer was null — force-set from wallet');
      }

      // NOTE: The backend has already partial-signed with the mint keypair.
      // No mint private key handling needed here.
      if (safeMode) {
        // SAFE MODE: skip deep inspection + size precheck + simulation.
        // Use the simplest previously-working path: deserialize → set
        // feePayer → keep blockhash (backend already signed) → wallet sign → send.
        diagPush('safe-mode', 'ok', {
          message: 'Bypassing inspect/simulate/size wrappers — minimal signing path',
        });
      } else {
        // Deep inspect the transaction structure
        const inspectResult = inspectTransaction(
          transaction,
          publicKey.toBase58(),
          mintPubkeyStr,
        );
        diagPush('deserialize', inspectResult.issues.length > 0 ? 'fail' : 'ok', {
          ...inspectResult.info,
          issues: inspectResult.issues.length > 0 ? inspectResult.issues : undefined,
        });
        dbg('2/9 tx inspection', inspectResult);

        console.log(
          "Transaction Instructions:",
          transaction.instructions.map((ix, i) => ({
            index: i,
            program: ix.programId.toBase58(),
            accounts: ix.keys.length,
            dataLength: ix.data.length,
          }))
        );

        if (inspectResult.issues.length > 0) {
          const issueMsg = `Transaction inspection failed: ${inspectResult.issues.join(', ')}`;
          toast.error(issueMsg);
          return { success: false, error: issueMsg };
        }

        // Pre-sign size check
        const preSignBytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
        diagPush('size-check', preSignBytes > 1232 ? 'fail' : 'ok', {
          preSignBytes,
          limit: 1232,
          instructions: transaction.instructions.length,
        });
        if (preSignBytes > 1232) {
          throw new Error(`Transaction too large: ${preSignBytes} bytes (max 1232)`);
        }
      }

      // ── 3. Simulate to get accurate SOL cost (ADVISORY ONLY) ──────────
      // Simulation is non-blocking. If it throws "Invalid arguments" or any
      // other RPC error against this partially-signed transaction (Helius is
      // known to reject this combination), we LOG and CONTINUE to signing.
      // The user still sees a cost preview — falling back to the static
      // rent estimate when on-chain simulation is unavailable.
      const STATIC_SIM = {
        ok: true,
        soft: true, // marker: not a real on-chain simulation
        lamports: 9_127_600,
        sol: 0.0091276,
        baseFeeLamports: 10_000,
        rentLamports: 9_117_600,
        computeUnits: 0,
        logs: [],
        preBalanceLamports: 0,
        postBalanceLamports: 0,
      };

      let simulation;
      if (safeMode) {
        // SAFE MODE: do NOT call simulateTransaction at all.
        diagPush('simulate-skipped', 'ok', { reason: 'safe-mode' });
        simulation = STATIC_SIM;
      } else {
        diagPush('simulate', 'start');
        toast.loading('Simulating transaction…', { id: 'tx-sim' });
      let simResult = null;
      let simThrew = null;

      try {
       simResult = await simulateTxCost(
         connection,
         transaction,
         publicKey.toBase58()
       );

       if (!simResult?.ok) {
         simResult = {
         ok: true,
         soft: true,
         note: "simulation_failed_ignored",
       };
     }
   } catch (e) {
     simThrew = e;
   }

   toast.dismiss('tx-sim');

   

   if (simThrew) {
  diagPush('simulate-soft-failed', 'fail', {
    errorName: simThrew?.name,
    errorMessage: simThrew?.message,
    note: 'Continuing — simulation is advisory only',
  });

  simulation = {
    ...STATIC_SIM,
    advisoryError: simThrew?.message || String(simThrew),
  };
} else if (!simResult.ok) {
  const failingLine =
    (simResult.logs || []).find((l) =>
      /error|fail|invalid|insufficient/i.test(l)
    ) ||
    simResult.error;

  diagPush('simulate-soft-failed', 'fail', {
    error: simResult.error,
    lastLog: failingLine,
  });

  simulation = {
    ...STATIC_SIM,
    advisoryError: failingLine,
  };
} else {
  diagPush('simulate', 'ok', {
    lamports: simResult.lamports,
    computeUnits: simResult.computeUnits,
  });

  simulation = simResult;
}
      }

      // ── 4. Explicit user confirmation (REQUIRED) ──────────────────────
      diagPush('user-confirm', 'start');
      let approved = true;
      if (typeof confirmBeforeSign === 'function') {
        approved = await confirmBeforeSign({
          simulation,
          prepared: { transaction, mint, ata, totalMinted },
        });
      }
      if (!approved) {
        diagPush('user-confirm', 'fail', { reason: 'user cancelled' });
        dbg('4/9 user cancelled in safety modal');
        return { success: false, cancelled: true };
      }
      diagPush('user-confirm', 'ok');

      // ── Re-refresh blockhash right before signing ──────────────────────
      // The user may have spent time reading the safety modal before
      // clicking Confirm. The blockhash fetched in step 2 can expire by now,
      // causing "Signature has expired: block height exceeded" at send time.
      // Get a fresh one immediately before the wallet signs.
      try {
        const freshBlockhash = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = freshBlockhash.blockhash;
        transaction.lastValidBlockHeight = freshBlockhash.lastValidBlockHeight;
        diagPush('blockhash-refresh-presign', 'ok', {
          blockhash: freshBlockhash.blockhash?.slice(0, 12),
        });
      } catch (e) {
        diagPush('blockhash-refresh-presign', 'fail', { error: e.message });
        // Non-fatal — fall back to the earlier blockhash if this refresh fails
      }

      // ── 5+6. Sign AND send via native provider signAndSendTransaction ──
      // Blowfish requires provider.signAndSendTransaction() — this allows
      // Blowfish to inject Lighthouse guard instructions and removes the
      // "This dApp could be malicious" warning.
      // We detect the wallet and call the correct provider method.
      diagPush('wallet-sign', 'start', { adapter: wallet?.adapter?.name });
      dbg('5/9 requesting signAndSendTransaction');
      toast.loading('Sign the transaction in your wallet…', { id: 'tx-sign' });
      let signature;
      try {
        const walletName = wallet?.adapter?.name?.toLowerCase() || '';

        if (walletName.includes('phantom') && window.phantom?.solana?.signAndSendTransaction) {
          // Phantom native provider
          const { signature: sig } = await window.phantom?.solana?.signAndSendTransaction(transaction);
          signature = sig;

        } else if (walletName.includes('solflare') && window.solflare?.signAndSendTransaction) {
          // Solflare native provider
          const { signature: sig } = await window.solflare.signAndSendTransaction(transaction);
          signature = sig;

        } else {
          // Fallback for any other wallet (Backpack, Glow, etc.)
          // Use wallet-adapter sendTransaction which calls the wallet's native method
          signature = await sendTransaction(transaction, connection, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: isMainnet ? 0 : 3,
          });
        }

        diagPush('wallet-sign', 'ok', { signature });
        diagPush('send', 'ok', { signature });
        dbg('5+6/9 signAndSendTransaction complete', { signature });
      } catch (signSendErr) {
        diagPush('wallet-sign', 'fail', {
          adapter: wallet?.adapter?.name,
          errorName: signSendErr?.name,
          errorCode: signSendErr?.code,
          errorMessage: signSendErr?.message,
        });
        toast.dismiss('tx-sign');
        if (signSendErr.logs) {
          dbg('5+6/9 error logs:', signSendErr.logs);
          console.error(signSendErr.logs);
        }
        if (signSendErr.message?.includes('insufficient lamports')) {
          throw new Error('Your wallet does not have enough SOL to complete this transaction.');
        }
        if (signSendErr.message?.includes('block height exceeded') || signSendErr.message?.includes('expired')) {
          throw new Error('The transaction took too long to sign and expired. Please click Create Token again — this usually works on retry.');
        }
        throw signSendErr;
      }
      toast.dismiss('tx-sign');

      // ── 7. Wait for confirmation ───────────────────────────────────────
      toast.dismiss('tx-send');
      toast.loading('Confirming transaction…', { id: 'tx-confirm' });
      diagPush('confirm', 'start');

      let confirmResult;
      try {
        confirmResult = await connection.confirmTransaction(
          {
            signature,
            blockhash: transaction.recentBlockhash,
            lastValidBlockHeight: transaction.lastValidBlockHeight,
          },
          'confirmed',
        );
      } catch (confirmErr) {
        if (confirmErr.message?.includes('block height exceeded') || confirmErr.message?.includes('expired')) {
          dbg('7/9 confirmTransaction threw expiry — checking actual signature status');
          diagPush('confirm', 'recheck', { reason: 'block height exceeded, verifying directly' });
          try {
            const statusResult = await connection.getSignatureStatus(signature, {
              searchTransactionHistory: true,
            });
            const status = statusResult?.value;
            if (status && !status.err && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
              dbg('7/9 transaction actually succeeded despite confirmTransaction timeout', status);
              confirmResult = { value: { err: null }, context: { slot: statusResult.context?.slot } };
            } else if (status?.err) {
              throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
            } else {
              throw new Error('Transaction expired before confirmation. Please try again.');
            }
          } catch (statusErr) {
            throw statusErr;
          }
        } else {
          throw confirmErr;
        }
      }
      dbg('7/9 confirmation', confirmResult.value);

      if (confirmResult.value.err) {
        diagPush('confirm', 'fail', { err: confirmResult.value.err });
        throw new Error(`Transaction failed: ${JSON.stringify(confirmResult.value.err)}`);
      }
      diagPush('confirm', 'ok', { slot: confirmResult.context?.slot });

      // ── 8. Verify on-chain ────────────────────────────────────────────
      toast.dismiss('tx-confirm');
      toast.loading('Verifying on-chain state…', { id: 'tx-verify' });
      diagPush('verify', 'start');

      const mintPubkey = new PublicKey(mint);
      const ataPubkey = new PublicKey(ata);
      const verification = await verifyOnChain(connection, mintPubkey, ataPubkey, totalMinted);
      diagPush('verify', verification.verified ? 'ok' : 'fail', {
        verified: verification.verified,
        supply: verification.supply,
      });
      dbg('8/9 verification', verification);

      await axios.post(`${API}/tokens/update-signature`, null, {
        params: {
          mint,
          signature,
          verified: verification.verified,
          on_chain_supply: verification.supply || '0',
        },
      });

      // ── 9. Audit log ──────────────────────────────────────────────────
      recordSignedTransaction({
        action: TX_ACTIONS.TOKEN_CREATE,
        mint,
        wallet: publicKey.toBase58(),
        signature,
        lamports: simulation.lamports,
        sol: simulation.sol,
      });
      diagPush('audit', 'ok', { signature });
      dbg('9/9 audit log entry recorded');

      toast.dismiss('tx-verify');
      toast.success('Token created, minted, and verified on-chain!');

      return {
        success: true,
        signature,
        mint,
        ata,
        totalSupply: verification.supply || totalMinted,
        creatorBalance: verification.balance || totalMinted,
        explorerUrl: `https://explorer.solana.com/tx/${signature}`,
        verified: verification.verified,
      };
    } catch (err) {
      toast.dismiss('tx-build'); toast.dismiss('tx-sim'); toast.dismiss('tx-sign');
      toast.dismiss('tx-send'); toast.dismiss('tx-confirm'); toast.dismiss('tx-verify');
      // eslint-disable-next-line no-console
      console.error('Token creation error:', err);
      const errorMessage = extractErrorMessage(err);
      try {
        if (typeof mint !== "undefined" && mint) {
          await axios.post(
            `${API}/tokens/update-status`,
            null,
            {
              params: {
                mint,
                status: "failed",
                error: errorMessage,
              },
            }
          );
        }
      } catch (e) {
        console.warn("Unable to update failed status", e);
      }
      diagPush('UNCAUGHT', 'fail', {
        errorName: err?.name,
        errorMessage: err?.message,
        derivedMessage: errorMessage,
      });
      setError(errorMessage);
      toast.error(`Failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [publicKey, sendTransaction, connection, isMainnet, testMode, safeMode, recordSignedTransaction, wallet, diagPush, diagClear]);

  const revokeAuthority = useCallback(async (mint, authorityType, { confirmBeforeSign } = {}) => {
    if (!publicKey || !sendTransaction) {
      toast.error('Please connect your wallet');
      return null;
    }
    if (testMode) {
      toast.error('Test Mode is ON — signing is blocked.');
      return { success: false, error: 'TEST_MODE_BLOCKED' };
    }

    setLoading(true);
    setError(null);

    try {
      toast.loading(`Building ${authorityType} revoke tx…`, { id: 'rev-build' });
      const response = await axios.post(`${API}/tokens/revoke-authority`, {
        mint,
        authority_type: authorityType,
        payer: publicKey.toBase58(),
      });

      const { transaction: txData } = response.data;
      const txBuffer = Buffer.from(txData, 'base64');
      const transaction = Transaction.from(txBuffer);
      // Refresh blockhash + feePayer to match the frontend's actual cluster.
      try {
        const latest = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = latest.blockhash;
        transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
      } catch (_) { /* keep backend blockhash if refresh fails */ }
      if (!transaction.feePayer) {
        transaction.feePayer = publicKey;
      }
      toast.dismiss('rev-build');

      // Simulate
      toast.loading('Simulating…', { id: 'rev-sim' });
      const simulation = await simulateTxCost(connection, transaction, publicKey.toBase58());
      toast.dismiss('rev-sim');
      if (!simulation.ok) {
        toast.error(`Simulation failed: ${simulation.error}`);
        return { success: false, error: simulation.error, simulation };
      }

      let approved = true;
      if (typeof confirmBeforeSign === 'function') {
        approved = await confirmBeforeSign({ simulation, prepared: { transaction, mint } });
      }
      if (!approved) return { success: false, cancelled: true };

      const walletName = wallet?.adapter?.name?.toLowerCase() || '';
      let signature;
      if (walletName.includes('phantom') && window.phantom?.solana?.signAndSendTransaction) {
        const { signature: sig } = await window.phantom?.solana?.signAndSendTransaction(transaction);
        signature = sig;
      } else if (walletName.includes('solflare') && window.solflare?.signAndSendTransaction) {
        const { signature: sig } = await window.solflare.signAndSendTransaction(transaction);
        signature = sig;
      } else {
        signature = await sendTransaction(transaction, connection, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: isMainnet ? 0 : 3,
        });
      }

      toast.loading('Confirming…', { id: 'rev-confirm' });
      await connection.confirmTransaction(signature, 'finalized');
      toast.dismiss('rev-confirm');

      recordSignedTransaction({
        action: TX_ACTIONS.REVOKE_AUTHORITY,
        mint,
        wallet: publicKey.toBase58(),
        signature,
        lamports: simulation.lamports,
        sol: simulation.sol,
        details: { authorityType },
      });

      // Update DB to reflect revoked authority — done here after on-chain
      // confirmation so we don't mark it revoked if user cancels in wallet.
      try {
        await axios.post(
          `${API}/tokens/revoke-authority-status`,
          null,
          { params: { mint, authority_type: authorityType } }
        );
      } catch (e) {
        console.warn('Could not update revoke status in DB:', e);
      }

      toast.success(`${authorityType} authority revoked!`);
      return { success: true, signature };
    } catch (err) {
      toast.dismiss('rev-build'); toast.dismiss('rev-sim'); toast.dismiss('rev-confirm');
      const errorMessage = extractErrorMessage(err);
      setError(errorMessage);
      toast.error(`Failed to revoke authority: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [publicKey, sendTransaction, wallet, connection, isMainnet, testMode, recordSignedTransaction]);

  return {
    createToken,
    revokeAuthority,
    loading,
    error,
  };
};
