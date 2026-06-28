import {
  Transaction,
} from "@solana/web3.js";

export async function buildTokenTransaction({
  connection,
  instructionData,
  payer,
}) {
  const tx = new Transaction();

  const latest = await connection.getLatestBlockhash("finalized");

  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = payer;

  return tx;
}
