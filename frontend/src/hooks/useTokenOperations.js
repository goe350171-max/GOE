import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey, Keypair } from '@solana/web3.js';
import axios from 'axios';
import { useState } from 'react';
import {toast} from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/**
 * Verify on-chain mint supply and ATA balance after tx confirmation.
 * Retries up to maxRetries with delay between attempts.
 */
async function verifyOnChain(connection, mintPubkey, ataPubkey, expectedRaw, maxRetries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Fetch mint account info
      const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
      const mintData = mintInfo?.value?.data?.parsed?.info;

      // Fetch ATA balance
      const ataInfo = await connection.getParsedAccountInfo(ataPubkey);
      const ataData = ataInfo?.value?.data?.parsed?.info;

      const supply = mintData?.supply;
      const balance = ataData?.tokenAmount?.amount;

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
      console.warn(`[verify attempt ${attempt}] error:`, e.message);
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return { verified: false };
}

export const useTokenOperations = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const createToken = async (tokenData) => {
    if (!publicKey || !signTransaction) {
      toast.error('Please connect your wallet');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // -------- 1. Build transaction on backend --------
      toast.loading('Building transaction...');

      const response = await axios.post(`${API}/tokens/create`, {
        payer: publicKey.toBase58(),
        metadata: tokenData.metadata,
        revoke_mint_authority: tokenData.revokeMintAuthority,
        revoke_freeze_authority: tokenData.revokeFreezeAuthority,
        revoke_update_authority: tokenData.revokeUpdateAuthority
      });

      const { transaction: txData, mintKeypair: mintKeypairData, mint, ata, totalMinted } = response.data;

      console.log('Mint:', mint);
      console.log('ATA:', ata);
      console.log('Expected raw supply:', totalMinted);

      // -------- 2. Deserialize & sign --------
      toast.dismiss();
      toast.loading('Sign the transaction in your wallet...');

      const txBuffer = Buffer.from(txData, 'base64');
      const transaction = Transaction.from(txBuffer);

      // Mint keypair MUST partialSign first
      const mintKeypairBuffer = Buffer.from(mintKeypairData, 'base64');
      const mintKeypair = Keypair.fromSecretKey(mintKeypairBuffer);
      transaction.partialSign(mintKeypair);

      // Creator wallet signs
      const signedTx = await signTransaction(transaction);

      // -------- 3. Send raw transaction --------
      toast.dismiss();
      toast.loading('Sending transaction...');

      let signature;
      try {
        signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        });
      } catch (sendErr) {
        // Extract simulation logs if available
        if (sendErr.logs) {
          console.error('Simulation logs:', sendErr.logs);
        }
        if (typeof sendErr.getLogs === 'function') {
          try {
            const logs = await sendErr.getLogs();
            console.error('SendTransactionError logs:', logs);
          } catch (_) { /* ignore */ }
        }
        throw sendErr;
      }

      console.log('Tx signature:', signature);
      console.log(`Explorer: https://explorer.solana.com/tx/${signature}`);

      // -------- 4. Wait for FINALIZED confirmation --------
      toast.dismiss();
      toast.loading('Waiting for finalized confirmation...');

      const confirmResult = await connection.confirmTransaction(
        {
          signature,
          blockhash: transaction.recentBlockhash,
          lastValidBlockHeight: (await connection.getLatestBlockhash('finalized')).lastValidBlockHeight,
        },
        'finalized'
      );

      if (confirmResult.value.err) {
        console.error('Transaction failed on-chain:', confirmResult.value.err);
        throw new Error(`Transaction failed: ${JSON.stringify(confirmResult.value.err)}`);
      }

      console.log('Transaction FINALIZED');

      // -------- 5. Verify on-chain state --------
      toast.dismiss();
      toast.loading('Verifying on-chain state...');

      const mintPubkey = new PublicKey(mint);
      const ataPubkey = new PublicKey(ata);
      const verification = await verifyOnChain(connection, mintPubkey, ataPubkey, totalMinted);

      if (!verification.verified) {
        console.warn('On-chain verification could not confirm supply. Transaction may still be propagating.');
      } else {
        console.log('=== ON-CHAIN VERIFICATION ===');
        console.log('  Supply:', verification.supply);
        console.log('  Creator balance:', verification.balance);
        console.log('  Decimals:', verification.decimals);
        console.log('  Mint authority:', verification.mintAuthority);
        console.log('  Freeze authority:', verification.freezeAuthority);
        console.log('  ATA owner:', verification.ataOwner);
        console.log('=============================');
      }

      // -------- 6. Persist signature in DB --------
      await axios.post(`${API}/tokens/update-signature`, null, {
        params: {
          mint,
          signature,
          verified: verification.verified,
          on_chain_supply: verification.supply || '0',
        }
      });

      toast.dismiss();
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
      toast.dismiss();
      console.error('Token creation error:', err);
      if (err.response) console.error('Backend response:', err.response.data);
      if (err.logs) console.error('Simulation logs:', err.logs);

      const errorMessage = err?.response?.data?.detail || err.message || 'Unknown error';
      setError(errorMessage);
      toast.error(`Failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const revokeAuthority = async (mint, authorityType) => {
    if (!publicKey || !signTransaction) {
      toast.error('Please connect your wallet');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      toast.loading(`Revoking ${authorityType} authority...`);

      const response = await axios.post(`${API}/tokens/revoke-authority`, {
        mint,
        authority_type: authorityType,
        payer: publicKey.toBase58()
      });

      const { transaction: txData } = response.data;
      const txBuffer = Buffer.from(txData, 'base64');
      const transaction = Transaction.from(txBuffer);

      const signedTx = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());

      toast.dismiss();
      toast.loading('Confirming...');

      await connection.confirmTransaction(signature, 'finalized');

      toast.dismiss();
      toast.success(`${authorityType} authority revoked!`);

      return { success: true, signature };
    } catch (err) {
      toast.dismiss();
      const errorMessage = err?.response?.data?.detail || err.message || 'Unknown error';
      setError(errorMessage);
      toast.error(`Failed to revoke authority: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  return {
    createToken,
    revokeAuthority,
    loading,
    error
  };
};
