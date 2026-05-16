/**
 * Robust clipboard copy that works across modern browsers and sandboxed/preview
 * environments where `navigator.clipboard` is blocked by permissions policy.
 *
 * Strategy:
 *  1. Try the async Clipboard API (`navigator.clipboard.writeText`).
 *  2. If unavailable or it throws (Permission denied / NotAllowedError in iframes),
 *     fall back to a hidden <textarea> + `document.execCommand('copy')`.
 *  3. Return a boolean indicating success so callers can show appropriate toasts.
 */
export async function copyText(text) {
  if (text === undefined || text === null) return false;
  const value = String(text);

  // Attempt modern async API first when available and in a secure context.
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function' &&
    typeof window !== 'undefined' &&
    window.isSecureContext !== false
  ) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (err) {
      // Permission policy or transient error — fall through to legacy path.
      // eslint-disable-next-line no-console
      console.warn('[clipboard] async API failed, falling back to execCommand:', err);
    }
  }

  // Legacy fallback using a hidden textarea + execCommand('copy').
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);

    // Preserve current selection so we can restore it after copying.
    const selection = document.getSelection();
    const previousRange =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);

    const ok = document.execCommand('copy');

    document.body.removeChild(textarea);

    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }

    return !!ok;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[clipboard] fallback execCommand failed:', err);
    return false;
  }
}
