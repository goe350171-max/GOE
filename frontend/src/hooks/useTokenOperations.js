import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey, Keypair } from '@solana/web3.js';
import axios from 'axios';
import { useState } from 'react';
import {toast} from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

console.info('Backend URL:', BACKEND_URL);
console.info('API Base:', API);

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
      toast.loading('Creating token...');
      
      console.log('POST Request to:', `${API}/tokens/create`);
      console.log('Request data:', {
        payer: publicKey.toBase58(),
        metadata: tokenData.metadata,
        revoke_mint_authority: tokenData.revokeMintAuthority,
        revoke_freeze_authority: tokenData.revokeFreezeAuthority,
        revoke_update_authority: tokenData.revokeUpdateAuthority
      });
      
      const response = await axios.post(`${API}/tokens/create`, {
        payer: publicKey.toBase58(),
        metadata: tokenData.metadata,
        revoke_mint_authority: tokenData.revokeMintAuthority,
        revoke_freeze_authority: tokenData.revokeFreezeAuthority,
        revoke_update_authority: tokenData.revokeUpdateAuthority
      });
      
      console.log('Response:', response.data);

      const { transaction: txData, mintKeypair: mintKeypairData, mint } = response.data;
      
      const txBuffer = Buffer.from(txData, 'base64');
      const transaction = Transaction.from(txBuffer);
      
      const mintKeypairBuffer = Buffer.from(mintKeypairData, 'base64');
      const mintKeypair = Keypair.fromSecretKey(mintKeypairBuffer);
      
      transaction.partialSign(mintKeypair);
      
      const signedTx = await signTransaction(transaction);
      
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      
      toast.dismiss();
      toast.loading('Confirming transaction...');
      
      await connection.confirmTransaction(signature, 'confirmed');
      
      await axios.post(`${API}/tokens/update-signature`, null, {
        params: { mint, signature }
      });
      
      toast.dismiss();
      toast.success('Token created successfully!');
      
      return { success: true, signature, mint };
    } catch (err) {
      toast.dismiss();
      console.error('Token creation error:', err);
      console.error('Error response:', err.response);
      console.error('Request config:', err.config);
      const errorMessage = err?.response?.data?.detail || err.message || 'Unknown error';
      setError(errorMessage);
      toast.error(`Failed to create token: ${errorMessage}`);
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
      toast.loading('Confirming transaction...');
      
      await connection.confirmTransaction(signature, 'confirmed');
      
      toast.dismiss();
      toast.success(`${authorityType} authority revoked successfully!`);
      
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
