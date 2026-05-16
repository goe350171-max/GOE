import { PublicKey } from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Simulate a transaction and compute the SOL cost from the payer's
 * pre/post balance delta. Replaces blockhash so an expired one doesn't
 * cause spurious failures. Does NOT verify signatures (sigVerify: false)
 * so we can simulate before the user signs.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   lamports: number,        // total cost to payer (rent + fee + everything)
 *   sol: number,
 *   baseFeeLamports: number, // 5000 × signature count (best-effort)
 *   rentLamports: number,    // cost - baseFee (approximation)
 *   computeUnits: number,
 *   logs: string[],
 *   preBalanceLamports: number,
 *   postBalanceLamports: number,
 * }>}
 */
export async function simulateTxCost(connection, transaction, payerStr) {
  const payerPk = new PublicKey(payerStr);
  const preBalance = await connection.getBalance(payerPk, 'confirmed');

  const sim = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
    accounts: {
      encoding: 'base64',
      addresses: [payerStr],
    },
  });

  const value = sim?.value;
  if (!value) {
    return {
      ok: false,
      error: 'No simulation response',
      lamports: 0, sol: 0, baseFeeLamports: 0, rentLamports: 0,
      computeUnits: 0, logs: [], preBalanceLamports: preBalance, postBalanceLamports: preBalance,
    };
  }

  if (value.err) {
    return {
      ok: false,
      error: typeof value.err === 'string' ? value.err : JSON.stringify(value.err),
      lamports: 0, sol: 0, baseFeeLamports: 0, rentLamports: 0,
      computeUnits: value.unitsConsumed || 0,
      logs: value.logs || [],
      preBalanceLamports: preBalance, postBalanceLamports: preBalance,
    };
  }

  const postAccount = value.accounts?.[0];
  const postBalance = postAccount?.lamports ?? preBalance;
  const totalLamports = Math.max(0, preBalance - postBalance);

  // Best-effort base fee: assume 5000 lamports per signature
  const sigCount = (transaction.signatures || []).length || 1;
  const baseFeeLamports = 5000 * sigCount;
  const rentLamports = Math.max(0, totalLamports - baseFeeLamports);

  return {
    ok: true,
    lamports: totalLamports,
    sol: totalLamports / LAMPORTS_PER_SOL,
    baseFeeLamports,
    rentLamports,
    computeUnits: value.unitsConsumed || 0,
    logs: value.logs || [],
    preBalanceLamports: preBalance,
    postBalanceLamports: postBalance,
  };
}

/** Format lamports as SOL string with 6 decimals. */
export function formatSol(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

/** Friendly action label for tx-log entries. */
export const TX_ACTIONS = {
  TOKEN_CREATE: 'token_create',
  AIRDROP_BATCH: 'airdrop_batch',
  REVOKE_AUTHORITY: 'revoke_authority',
};
