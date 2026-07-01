import React from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

const PhantomTest = () => {
  const { connection } = useConnection();
  const { publicKey, wallet } = useWallet();

  const runTest = async () => {
    if (!publicKey || !wallet) {
      alert("Connect wallet first");
      return;
    }

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    const tx = new Transaction({
      feePayer: publicKey,
      blockhash,
      lastValidBlockHeight,
    });

    try {
      const walletName = wallet?.adapter?.name?.toLowerCase() || '';
      let signature;
      if (walletName.includes('phantom') && window.phantom?.solana?.signAndSendTransaction) {
        const { signature: sig } = await window.phantom?.solana?.signAndSendTransaction(tx);
        signature = sig;
      } else if (walletName.includes('solflare') && window.solflare?.signAndSendTransaction) {
        const { signature: sig } = await window.solflare.signAndSendTransaction(tx);
        signature = sig;
      } else {
        signature = await wallet.adapter.sendTransaction(tx, connection);
      }
      alert("Transaction sent: " + signature);
    } catch (err) {
      console.error(err);
      alert("Signing failed or rejected");
    }
  };

  return (
    <div style={{ padding: 30 }}>
      <h2>Phantom Safety Test</h2>
      <p>This page sends an EMPTY transaction (no instructions).</p>
      <button onClick={runTest}>
        Sign Empty Transaction
      </button>
    </div>
  );
};

export default PhantomTest;
