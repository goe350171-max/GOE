import {
  Transaction,
  SystemProgram,
  PublicKey,
  Keypair,
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";

export async function buildTokenTransaction({
  connection,
  instructionData,
  payer,
  mintKeypairData,
}) {
  const tx = new Transaction();

  const latest = await connection.getLatestBlockhash("finalized");

  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = payer;

  return tx;
}
