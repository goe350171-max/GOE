import React from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

const PhantomTest = () => {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const runTest = async () => {
    if (!publicKey || !signTransaction) {
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

    // 🚨 NO INSTRUCTIONS AT ALL

    try {
      await signTransaction(tx);
      alert("Transaction signed successfully");
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
