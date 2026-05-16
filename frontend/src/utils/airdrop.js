import { PublicKey } from '@solana/web3.js';

/**
 * Validate a base58 Solana public key string.
 */
export function isValidSolanaAddress(address) {
  if (typeof address !== 'string' || address.length < 32 || address.length > 44) {
    return false;
  }
  try {
    new PublicKey(address.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse free-form input into airdrop recipients.
 * Accepts `address,amount` (one per line). Tolerates extra whitespace,
 * tabs, and semicolons as separators. Strips blank lines and comments.
 *
 * Returns { valid: [{address, amount, line}], errors: [{line, raw, reason}], duplicates: [address] }
 */
export function parseAirdropInput(text) {
  const valid = [];
  const errors = [];
  const seen = new Map(); // address -> first line number

  if (!text || typeof text !== 'string') {
    return { valid, errors, duplicates: [] };
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

    // Split on comma, semicolon, tab, or whitespace
    const parts = trimmed.split(/[,;\t]|\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      errors.push({ line: lineNum, raw: rawLine, reason: 'Expected "address,amount"' });
      return;
    }

    const [address, amountStr] = parts;

    if (!isValidSolanaAddress(address)) {
      errors.push({ line: lineNum, raw: rawLine, reason: `Invalid wallet address` });
      return;
    }

    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ line: lineNum, raw: rawLine, reason: `Invalid amount "${amountStr}"` });
      return;
    }

    if (seen.has(address)) {
      errors.push({
        line: lineNum,
        raw: rawLine,
        reason: `Duplicate address (first seen on line ${seen.get(address)})`,
      });
      return;
    }
    seen.set(address, lineNum);

    valid.push({ address, amount, line: lineNum });
  });

  return { valid, errors, duplicates: [] };
}

/**
 * Split a list of recipients into chunks small enough for one tx (~1232 byte cap).
 * Empirical: ~190 bytes per recipient (CreateATAIdempotent + TransferChecked).
 * Using 5 per batch leaves headroom for blockhash refresh + sig overhead.
 */
export function chunkRecipients(recipients, chunkSize = 5) {
  const chunks = [];
  for (let i = 0; i < recipients.length; i += chunkSize) {
    chunks.push(recipients.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Parse a CSV file's text content. First row may be a header
 * (e.g. "address,amount") and is auto-detected.
 */
export function parseCsvText(csvText) {
  const lines = (csvText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  // Drop header row if first cell isn't a valid address
  const firstCells = lines[0].split(/[,;\t]/).map((c) => c.trim());
  const dataLines = isValidSolanaAddress(firstCells[0]) ? lines : lines.slice(1);
  return dataLines.join('\n');
}
