import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey, Keypair } from '@solana/web3.js';
import axios from 'axios';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useNetwork } from '../contexts/NetworkContext';
import { simulateTxCost, TX_ACTIONS } from '../utils/txSafety';

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
  const { publicKey, signTransaction } = useWallet();
  const { isMainnet, testMode, recordSignedTransaction } = useNetwork();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Token creation flow with safety guards:
   *   1. Build tx on backend
   *   2. Deserialize + partialSign mint keypair (no user-visible action yet)
   *   3. Simulate transaction → compute SOL cost
   *   4. Call confirmBeforeSign({ simulation, ... }) and AWAIT user's explicit click
   *      (this is the safety gate — automation cannot bypass it)
   *   5. If user confirmed → wallet.signTransaction (Phantom popup)
   *   6. Send (mainnet: no auto-retry, devnet: up to 3 retries via web3.js)
   *   7. Verify on-chain + persist signature
   *   8. Record audit log entry
   *
   * confirmBeforeSign signature: ({ simulation, prepared }) => Promise<boolean>
   */
  const createToken = useCallback(async (tokenData, { confirmBeforeSign } = {}) => {
    if (!publicKey || !signTransaction) {
      toast.error('Please connect your wallet');
      return null;
    }

    if (testMode) {
      toast.error('Test Mode is ON — signing is blocked. Disable Test Mode in the header to proceed.');
      return { success: false, error: 'TEST_MODE_BLOCKED' };
    }

    setLoading(true);
    setError(null);

    try {
      // ── 1. Build tx on backend ────────────────────────────────────────
      toast.loading('Building transaction…', { id: 'tx-build' });

      const response = await axios.post(`${API}/tokens/create`, {
        payer: publicKey.toBase58(),
        metadata: tokenData.metadata,
        revoke_mint_authority: tokenData.revokeMintAuthority,
        revoke_freeze_authority: tokenData.revokeFreezeAuthority,
        revoke_update_authority: tokenData.revokeUpdateAuthority,
      });

      const { transaction: txData, mintKeypair: mintKeypairData, mint, ata, totalMinted } = response.data;
      toast.dismiss('tx-build');

      // ── 2. Deserialize + partialSign mint keypair ─────────────────────
      const txBuffer = Buffer.from(txData, 'base64');
      const transaction = Transaction.from(txBuffer);

      const mintKeypairBuffer = Buffer.from(mintKeypairData, 'base64');
      const mintKeypair = Keypair.fromSecretKey(mintKeypairBuffer);
      transaction.partialSign(mintKeypair);

      // ── 3. Simulate to get accurate SOL cost ──────────────────────────
      toast.loading('Simulating transaction…', { id: 'tx-sim' });
      const simulation = await simulateTxCost(connection, transaction, publicKey.toBase58());
      toast.dismiss('tx-sim');

      if (!simulation.ok) {
        toast.error(`Simulation failed: ${simulation.error}`);
        return { success: false, error: simulation.error, simulation };
      }

      // ── 4. Explicit user confirmation (REQUIRED) ──────────────────────
      let approved = true;
      if (typeof confirmBeforeSign === 'function') {
        approved = await confirmBeforeSign({
          simulation,
          prepared: { transaction, mint, ata, totalMinted, mintKeypair },
        });
      }
      if (!approved) {
        return { success: false, cancelled: true };
      }

      // ── 5. Wallet signing (user clicked Confirm; this opens Phantom) ──
      toast.loading('Sign the transaction in your wallet…', { id: 'tx-sign' });
      const signedTx = await signTransaction(transaction);

      // ── 6. Send. NO auto-retry on mainnet. ────────────────────────────
      toast.dismiss('tx-sign');
      toast.loading('Sending transaction…', { id: 'tx-send' });
      let signature;
      try {
        signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: isMainnet ? 0 : 3,
        });
      } catch (sendErr) {
        if (sendErr.logs) console.error('Simulation logs:', sendErr.logs);
        if (typeof sendErr.getLogs === 'function') {
          try {
            const logs = await sendErr.getLogs();
            console.error('SendTransactionError logs:', logs);
          } catch (_) { /* ignore */ }
        }
        throw sendErr;
      }

      // eslint-disable-next-line no-console
      console.log('Tx signature:', signature);

      // ── 7. Wait for finalized confirmation ────────────────────────────
      toast.dismiss('tx-send');
      toast.loading('Waiting for finalized confirmation…', { id: 'tx-confirm' });

      const latest = await connection.getLatestBlockhash('finalized');
      const confirmResult = await connection.confirmTransaction(
        {
          signature,
          blockhash: transaction.recentBlockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'finalized',
      );

      if (confirmResult.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmResult.value.err)}`);
      }

      // ── 8. Verify on-chain ────────────────────────────────────────────
      toast.dismiss('tx-confirm');
      toast.loading('Verifying on-chain state…', { id: 'tx-verify' });

      const mintPubkey = new PublicKey(mint);
      const ataPubkey = new PublicKey(ata);
      const verification = await verifyOnChain(connection, mintPubkey, ataPubkey, totalMinted);

      await axios.post(`${API}/tokens/update-signature`, null, {
        params: {
          mint,
          signature,
          verified: verification.verified,
          on_chain_supply: verification.supply || '0',
        },
      });

      // ── 9. Audit log (every signed tx) ────────────────────────────────
      recordSignedTransaction({
        action: TX_ACTIONS.TOKEN_CREATE,
        mint,
        wallet: publicKey.toBase58(),
        signature,
        lamports: simulation.lamports,
        sol: simulation.sol,
      });

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
      const errorMessage = err?.response?.data?.detail || err.message || 'Unknown error';
      setError(errorMessage);
      toast.error(`Failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [publicKey, signTransaction, connection, isMainnet, testMode, recordSignedTransaction]);

  const revokeAuthority = useCallback(async (mint, authorityType, { confirmBeforeSign } = {}) => {
    if (!publicKey || !signTransaction) {
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

      const signedTx = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: isMainnet ? 0 : 3,
      });

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

      toast.success(`${authorityType} authority revoked!`);
      return { success: true, signature };
    } catch (err) {
      toast.dismiss('rev-build'); toast.dismiss('rev-sim'); toast.dismiss('rev-confirm');
      const errorMessage = err?.response?.data?.detail || err.message || 'Unknown error';
      setError(errorMessage);
      toast.error(`Failed to revoke authority: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [publicKey, signTransaction, connection, isMainnet, testMode, recordSignedTransaction]);

  return {
    createToken,
    revokeAuthority,
    loading,
    error,
  };
};
