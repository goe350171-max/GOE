/**
 * Launchpad form validation — mirrors backend Pydantic constraints in
 * `/app/backend/server.py` (TokenMetadata + TokenCreationRequest).
 *
 * Keep this file in lock-step with the backend. The backend remains the
 * source of truth; these are UX-level previews to surface issues earlier.
 */

const U64_MAX = (1n << 64n) - 1n;

const isHttpUrl = (v) => {
  if (!v) return true; // optional
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ipfs:';
  } catch {
    return false;
  }
};

/**
 * Validate a single field. Returns an error string or null.
 * `values` is the full form object (used for cross-field checks like u64 overflow).
 */
export function validateField(field, value, values = {}) {
  const v = typeof value === 'string' ? value.trim() : value;

  switch (field) {
    case 'name': {
      if (!v) return 'Token name is required';
      if (v.length > 64) return 'Token name must be 64 characters or fewer';
      return null;
    }

    case 'symbol': {
      if (!v) return 'Symbol is required';
      if (v.length > 12) return 'Symbol must be 12 characters or fewer';
      return null;
    }

    case 'decimals': {
      if (v === '' || v === null || v === undefined) return 'Decimals is required';
      const n = Number(v);
      if (!Number.isInteger(n)) return 'Decimals must be a whole number';
      if (n < 0) return 'Decimals must be 0 or greater';
      if (n > 18) return 'Decimals must be 18 or fewer';
      return null;
    }

    case 'totalSupply': {
      if (v === '' || v === null || v === undefined) return 'Total supply is required';
      const trimmed = String(v).trim();
      if (!/^\d+$/.test(trimmed)) return 'Total supply must be a whole number';
      let supply;
      try { supply = BigInt(trimmed); } catch { return 'Total supply is not a valid number'; }
      if (supply <= 0n) return 'Total supply must be greater than 0';
      if (supply > 10n ** 18n) return 'Total supply must be 10^18 or fewer';
      // Cross-field: u64 overflow with decimals
      const decRaw = values.decimals;
      const dec = decRaw === '' || decRaw === undefined || decRaw === null ? 9 : Number(decRaw);
      if (Number.isInteger(dec) && dec >= 0 && dec <= 18) {
        const raw = supply * (10n ** BigInt(dec));
        if (raw > U64_MAX) {
          const maxAtDec = U64_MAX / (10n ** BigInt(dec));
          return `total_supply × 10^${dec} exceeds Solana u64 max. With decimals=${dec}, max supply is ${maxAtDec.toLocaleString()}`;
        }
      }
      return null;
    }

    case 'description': {
      if (!v) return null;
      if (v.length > 2000) return 'Description must be 2000 characters or fewer';
      return null;
    }

    case 'image': {
      if (!v) return null;
      if (v.length > 2048) return 'Image URL is too long (max 2048 characters)';
      if (!isHttpUrl(v)) return 'Image URL must be http(s) or ipfs://';
      return null;
    }

    case 'twitter': {
      if (!v) return null;
      if (v.length > 256) return 'Twitter handle is too long (max 256 characters)';
      return null;
    }

    case 'telegram': {
      if (!v) return null;
      if (v.length > 256) return 'Telegram is too long (max 256 characters)';
      return null;
    }

    case 'website': {
      if (!v) return null;
      if (v.length > 512) return 'Website URL is too long (max 512 characters)';
      if (!isHttpUrl(v)) return 'Website must be a valid http(s) URL';
      return null;
    }

    default:
      return null;
  }
}

/**
 * Validate every field. Returns { errors, isValid }.
 */
export function validateAll(values) {
  const fields = [
    'name', 'symbol', 'decimals', 'totalSupply',
    'description', 'image', 'twitter', 'telegram', 'website',
  ];
  const errors = {};
  for (const f of fields) {
    const err = validateField(f, values[f], values);
    if (err) errors[f] = err;
  }
  return { errors, isValid: Object.keys(errors).length === 0 };
}
