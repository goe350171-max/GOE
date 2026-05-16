/**
 * Convert any axios/fetch/web3.js error into a clean human-readable string.
 * Handles:
 *  - Backend 400 with `detail` as string (our preferred shape)
 *  - Backend 422 with `detail` as Pydantic array of {loc, msg, type}
 *  - Backend with `field_errors: [{field, message}]`
 *  - RPC / web3.js errors with logs
 *  - Plain Error
 */
export function extractErrorMessage(err) {
  if (!err) return 'Unknown error';

  // Backend response shape
  const data = err?.response?.data;
  if (data) {
    // Preferred: structured field_errors from our custom handler
    if (Array.isArray(data.field_errors) && data.field_errors.length > 0) {
      return data.field_errors
        .map((fe) => `${fe.field || 'field'}: ${fe.message || fe.msg || 'invalid'}`)
        .join(' | ');
    }
    // Custom handler string detail
    if (typeof data.detail === 'string' && data.detail.trim()) {
      return data.detail;
    }
    // Default FastAPI 422 — array of {loc, msg, type}
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
      try {
        return JSON.stringify(data.detail);
      } catch {
        return 'Server returned an unreadable error';
      }
    }
  }

  // web3.js errors often carry simulation logs
  if (err?.logs && Array.isArray(err.logs) && err.logs.length > 0) {
    return `${err.message || 'Transaction error'}\n${err.logs.slice(-3).join('\n')}`;
  }

  if (typeof err === 'string') return err;
  return err?.message || String(err) || 'Unknown error';
}
