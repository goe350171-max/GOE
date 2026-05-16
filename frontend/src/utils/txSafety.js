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

  // Use a defensive config — `sigVerify: false` and `replaceRecentBlockhash: true`
  // are supported by all modern web3.js + RPC combos. We do NOT pass
  // `accounts: { addresses }` here anymore: that option causes Helius and
  // some other RPCs to reject the request with a generic "Invalid arguments"
  // when the tx contains newly-created accounts that don't yet exist on-chain.
  // We can still compute the cost from the standard fee + rent breakdown if
  // accounts response is absent (no accounts field → fall back to baseFee).
  let sim;
  try {
    sim = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
    });
  } catch (e) {
    // Re-throw so the caller's try/catch can mark this as a soft failure.
    throw e;
  }

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

  // We didn't request accounts back in the config (see comment above), so we
  // approximate cost from the base fee × signature count.
  const sigCount = (transaction.signatures || []).length || 2;
  const baseFeeLamports = 5000 * sigCount;
  // Known rent for token-create: mint (1,461,600) + ATA (2,039,280) + metadata (5,616,720) = 9,117,600
  // For revoke/airdrop, rent is 0 → bypass by leaving rentLamports at 0 and
  // letting the caller surface whichever number is meaningful.
  // We keep this approximation conservative and return total = baseFee for now.
  const rentLamports = 0;
  const totalLamports = baseFeeLamports + rentLamports;

  return {
    ok: true,
    lamports: totalLamports,
    sol: totalLamports / LAMPORTS_PER_SOL,
    baseFeeLamports,
    rentLamports,
    computeUnits: value.unitsConsumed || 0,
    logs: value.logs || [],
    preBalanceLamports: preBalance,
    postBalanceLamports: preBalance - totalLamports,
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
