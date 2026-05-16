/**
 * Convert any axios/fetch/web3.js/wallet-adapter error into a clean
 * human-readable string. Never returns generic strings like "invalid arguments"
 * — if that's the only thing available, the wrapper surfaces additional
 * context (RPC body, logs, payload) instead.
 *
 * Handles:
 *  - Backend 400 with `detail` as string (preferred shape)
 *  - Backend 422 with `detail` as Pydantic array of {loc, msg, type}
 *  - Backend with `field_errors: [{field, message}]`
 *  - web3.js SendTransactionError with `.logs`
 *  - Wallet adapter rejection codes (Phantom, Solflare)
 *  - Plain Error / string
 */

const GENERIC_MESSAGES = new Set([
  'invalid arguments',
  'invalid argument',
  'bad arguments',
  'bad argument',
  'unknown error',
  '',
]);

const isGeneric = (msg) => {
  if (!msg) return true;
  return GENERIC_MESSAGES.has(String(msg).trim().toLowerCase());
};

const extractFromBackend = (data) => {
  if (!data) return null;
  if (Array.isArray(data.field_errors) && data.field_errors.length > 0) {
    return data.field_errors
      .map((fe) => `${fe.field || 'field'}: ${fe.message || fe.msg || 'invalid'}`)
      .join(' | ');
  }
  if (typeof data.detail === 'string' && data.detail.trim()) {
    return data.detail;
  }
  if (Array.isArray(data.detail)) {
    return data.detail
      .map((d) => {
        const loc = (d.loc || [])
          .filter((p) => p !== 'body' && p !== 'query' && p !== 'path')
          .join('.');
        const msg = (d.msg || '').replace(/^Value error,\s*/, '');
        return loc ? `${loc}: ${msg}` : msg;
      })
      .join(' | ');
  }
  if (data.detail && typeof data.detail === 'object') {
    try { return JSON.stringify(data.detail); } catch { return null; }
  }
  return null;
};

const extractFromWeb3 = (err) => {
  // SendTransactionError or simulation error often has logs
  if (err?.logs && Array.isArray(err.logs) && err.logs.length > 0) {
    const errLine =
      err.logs.find((l) => /(error|failed|insufficient|invalid)/i.test(l)) ||
      err.logs[err.logs.length - 1];
    return `${err.message || 'Transaction error'} — ${errLine}`;
  }
  // Wallet-adapter errors — keep them named, never collapse to a generic toast.
  const name = err?.name || '';
  if (
    name === 'WalletSignTransactionError' ||
    name === 'WalletSendTransactionError' ||
    name === 'WalletConnectionError' ||
    name === 'WalletNotConnectedError' ||
    name === 'WalletDisconnectedError' ||
    name === 'WalletPublicKeyError' ||
    /wallet/i.test(name)
  ) {
    const msg = err?.message || 'Wallet refused the request';
    if (/user rejected|rejected the request|user denied/i.test(msg)) {
      return 'You cancelled the wallet prompt.';
    }
    // Phantom often surfaces "Invalid arguments" — annotate so the toast is
    // never the bare two words.
    if (isGeneric(msg)) {
      return `${name}: Phantom refused this transaction (likely missing fee payer or stale blockhash). Check the Diagnostics panel for the exact stage.`;
    }
    return `${name || 'Wallet error'}: ${msg}`;
  }
  return null;
};

export function extractErrorMessage(err) {
  if (!err) return 'Unknown error';

  // Always log the raw error for debugging (no PII)
  try {
    // eslint-disable-next-line no-console
    console.error('[extractErrorMessage] raw error:', err, {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      responseStatus: err?.response?.status,
      responseData: err?.response?.data,
      logs: err?.logs,
    });
  } catch { /* ignore */ }

  // 1. Backend error first
  const backendMsg = extractFromBackend(err?.response?.data);
  if (backendMsg && !isGeneric(backendMsg)) return backendMsg;

  // 2. web3.js / wallet errors with logs
  const web3Msg = extractFromWeb3(err);
  if (web3Msg && !isGeneric(web3Msg)) return web3Msg;

  // 3. Plain message
  const plain = typeof err === 'string' ? err : err?.message;
  if (plain && !isGeneric(plain)) return plain;

  // 4. Fallback — we have ONLY a generic message. Surface as much side context
  //    as we can so the user can self-diagnose.
  const ctx = [];
  if (err?.response?.status) ctx.push(`HTTP ${err.response.status}`);
  if (err?.code) ctx.push(`code=${err.code}`);
  if (err?.name) ctx.push(err.name);
  if (plain) ctx.push(plain);
  if (backendMsg) ctx.push(backendMsg);
  if (web3Msg) ctx.push(web3Msg);
  const ctxStr = ctx.filter(Boolean).join(' · ');
  return ctxStr
    ? `Transaction failed (${ctxStr}) — see browser console for full details`
    : 'Transaction failed — see browser console for full details';
}
