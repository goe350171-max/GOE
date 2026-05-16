# Solana Token Launchpad — PRD

## Problem Statement
Build a Solana token launchpad with free token creation (no platform fees), wallet integration (Phantom, Solflare), metadata support, authority management, token explorer, and airdrop functionality.

## Architecture
- **Frontend**: React + @solana/web3.js + @solana/wallet-adapter
- **Backend**: FastAPI + Python (solders) + MongoDB
- **RPC**: Helius mainnet-beta

## What's Implemented (Feb 2026)

### Live Cost Preview Chip + Deep Diagnostics (Feb 2026)
**Cost preview chip** in Launchpad sidebar:
- New `/app/frontend/src/components/CostPreviewChip.js` shows estimated SOL cost computed from known Solana rent constants (mint rent 1.46M + metadata PDA rent 5.62M + ATA rent 2.04M + 2-sig network fee 10K = ~0.009128 SOL).
- Pure UX preview — no RPC calls, no backend calls, no automatic signing. The accurate per-tx cost is still computed fresh by `SafetyConfirmModal` right before signing.
- Adapts to current network: green DEVNET tag / red MAINNET tag; shows Test Mode hint.
- `data-testid="cost-preview-chip|total|network-tag|breakdown"`.

**Diagnostics pass** (no logic changes):
- Backend: env-gated `DEBUG_TOKEN_CREATE` (default 1 in current build) emits structured `[token-create:<stage>]` logs at every step — request, blockhash, mint_params, uris, tx_built, FAIL. Defense-in-depth checks added:
  - u64-overflow guard at runtime (Pydantic catches it; this is a safety net)
  - Metadata URI auto-truncates to Metaplex 200-byte limit with warning log
  - Built-transaction size pre-checked against 1232-byte Solana wire-format cap before returning to the wallet
  - Outer exception wrapper now includes `type(e).__name__` so generic Python errors are still attributable
- Frontend: new `[token-create]` console group in `useTokenOperations.createToken` with 9 numbered stages (preflight → backend payload → tx deserialized → simulation → safety modal → wallet sign → send → confirm → verify → audit log). Each stage logs structured context. Activated by `REACT_APP_DEBUG_TOKEN_CREATE` (default on).
- Frontend preflight validation: rejects undefined/null `metadata.name`, `symbol`, `decimals` (non-integer), `total_supply` (non-positive), and missing payer pubkey BEFORE the network call.
- Frontend `extractErrorMessage` hardened: detects generic strings ("invalid arguments", "bad arguments", etc.) and falls back to a composite context message + console pointer; never returns a useless toast.
- Backend always returns a clear field-named string in `detail`.

### Inline Field Validation on Launchpad (Feb 2026)
- New `/app/frontend/src/utils/launchpadValidation.js` — pure validators that mirror backend Pydantic constraints exactly (name 1-64, symbol 1-12, decimals 0-18, supply 1..10^18 plus BigInt u64-overflow cross-check, description ≤2000, URL fields with `http/https/ipfs` scheme validation)
- Wired into `/app/frontend/src/pages/Launchpad.js`:
  - `fieldErrors` + `touched` state per field
  - `onBlur` validation per field
  - Submit gate runs `validateAll()` — if any error, marks all touched, shows toast, blocks submission
  - Red border (`border-red-500 focus:ring-red-300`) + inline red text under each invalid field
  - `data-testid="error-<field>"` for each error line (name, symbol, decimals, totalSupply, description, image, twitter, telegram, website)
  - Reactive re-validation of `totalSupply` whenever `decimals` changes (catches u64 overflow as the user tunes either)
- Existing toast notifications still fire for transaction-level failures (network/wallet/RPC errors)
- No changes to submission logic, instruction builders, or any backend behavior

### Validation Hardening — Clear, Field-Specific Errors (Feb 2026)
- Replaced FastAPI's default 422 (array-of-dicts) with a custom `RequestValidationError` handler that returns:
  - `detail`: clean string `"<field>: <message>"` (or `<field1>: ... | <field2>: ...`) — works directly in frontend toasts
  - `field_errors`: structured `[{field, message, type}]` for programmatic UIs
- Raised supply ceiling: `total_supply` now allows up to **10^18** human units; `decimals` allows **0-18** (was 0-9)
- Added `model_validator` that checks BigInt-safe u64 overflow on `total_supply × 10^decimals`. Error tells user the maximum safe supply for their chosen decimals (e.g., "With decimals=9, max total_supply is 18,446,744,073").
- Frontend `extractErrorMessage()` helper handles all error shapes (string detail, Pydantic array, structured field_errors, web3.js with logs)
- Wired through `useTokenOperations`, `useAirdropOperations`, and `Airdrop.js`
- **Verified working examples**:
  - 1B supply + 9 decimals → HTTP 200 (was failing before)
  - 10^18 supply + 9 decimals → HTTP 400 `metadata: total_supply × 10^decimals = ... exceeds Solana u64 max...`
  - Bad pubkey → `payer: Invalid Solana address for payer: Invalid Base58 string`
  - Symbol too long → `metadata.symbol: String should have at most 12 characters`
  - Decimals out of range → `metadata.decimals: Input should be less than or equal to 18`
  - Bad recipient → `recipients.0.address: Invalid Solana address...`
- No changes to mint logic, transaction builders, or IPFS flow — validators and error formatting only.

### Safety-Critical Hardening (Feb 2026) — All P0 Controls Live
**Default = DEVNET, mainnet is opt-in.** Prevents accidental real-SOL spending.
- `NetworkContext` (`/app/frontend/src/contexts/NetworkContext.js`): persisted in localStorage; default `devnet`; tracks `testMode` and a 200-entry signed-tx audit log
- `SolanaProvider` derives RPC endpoint from network: `api.devnet.solana.com` (default) vs Helius mainnet (opt-in). Re-keys on network change for clean remount.
- `NetworkSwitcher` (header): one-click switch to devnet (safe), devnet→mainnet shows explicit warning dialog (`mainnet-warning-dialog`) with safety bullets and red "I understand — enable Mainnet" button.
- `MainnetWarningBanner`: always-visible red banner when mainnet active + yellow Test Mode banner when test mode on.
- **Test Mode**: global toggle (`test-mode-toggle-btn`); when ON, all signing is blocked at the hook level (`useTokenOperations`, `useAirdropOperations`) with a clear error toast.
- **Simulation-first**: every transaction is simulated via `connection.simulateTransaction({ sigVerify: false, replaceRecentBlockhash: true, accounts: { addresses: [payer] } })` BEFORE the wallet prompt opens. The accurate SOL cost = `preBalance - postBalance` (rent + fee + everything).
- **`SafetyConfirmModal`**: reusable cost-preview modal shown before EVERY wallet.signTransaction. Shows network, wallet address, total SOL, post-sign balance, fee breakdown (network fee / rent / compute units), action context. User MUST click "Confirm & Sign" — automation cannot bypass.
- **No auto-retry on mainnet**: `sendRawTransaction` uses `maxRetries: 0` on mainnet (was 3). Airdrop per-batch retry is `0` on mainnet, `1` on devnet.
- **Signed-tx audit log**: every successful tx records `{timestamp, network, action, mint, wallet, signature, lamports, sol}` to localStorage (`solaunch.txLog`). Capped at 200 entries.
- **ErrorBoundary**: catches React errors and shows a recovery UI without leaking stack traces server-side.
- **Existing flows untouched**: token creation tx structure, instruction builders, metadata logic, airdrop instruction builders, IPFS upload — all unchanged. Only safety guards were added around them.

### Airdrop Functionality (Feb 2026) — P1 Complete
- New page `/app/frontend/src/pages/Airdrop.js` (full rewrite)
- Token source: launchpad dropdown (from MongoDB) OR any SPL mint (manual entry)
- On-chain mint info auto-fetched via `/api/airdrop/mint-info/<mint>` (decimals, supply, authority)
- Payer balance fetched via `/api/airdrop/balance` and shown in UI
- Recipients input: paste mode (`address,amount` per line) + CSV upload mode
- Per-line validation: wallet format, invalid amounts, duplicates — error list with line numbers
- Auto-batching: 5 recipients per tx (under Solana 1232-byte cap)
- Dry-run preview panel: recipients, total tokens, batch count, estimated SOL fee
- Confirmation modal before execution
- Batched signing: each batch built fresh via `/api/airdrop/build-batch`, signed via wallet, sent, confirmed
- Per-batch progress UI + retry handling (1 retry) + skip on user rejection
- Per-batch explorer links
- Recipient ATAs auto-created via `CreateAssociatedTokenAccountIdempotent`
- Token transfers via `TransferChecked` (verifies mint + decimals on-chain)
- Insufficient-balance check using BigInt math
- New instruction builders in `server.py`: `build_create_ata_idempotent_ix`, `build_transfer_checked_ix`
- New hook `/app/frontend/src/hooks/useAirdropOperations.js`
- New util `/app/frontend/src/utils/airdrop.js`: `parseAirdropInput`, `chunkRecipients`, `parseCsvText`, `isValidSolanaAddress`

### Share Token + Phantom Visibility (Feb 2026)
- `SuccessModal.js` now has Share on X button (pre-formatted launch post), Copy post button, and Import Token helper
- Wallet polling after creation: polls creator ATA up to 8× / 32s; surfaces "Token detected in wallet" or guidance to import manually
- Phantom import guidance: `Manage Tokens → Add Custom Token → paste mint`
- Token name + symbol now passed from Launchpad to modal

### Security Hardening (Feb 2026)
- Pydantic validators on TokenMetadata: `name` 1-64, `symbol` 1-12, `decimals` 0-9, `total_supply` 1..10^15, URL/text length caps, control-char stripping
- All Pubkey fields validated via `_validate_pubkey`
- `AirdropBatchRequest` capped at 15 recipients per request; duplicate detection inside batches
- Server-side raw-amount overflow check (`< 2^64`)
- Server-side 1232-byte tx size cap (preflight rejection)
- CORS hardening: explicit methods + headers, warning logged when `CORS_ORIGINS='*'`
- New endpoint `GET /api/health`: liveness + mongo/RPC/Pinata dependency health
- Rate limits: `5/minute` token creation, `30/minute` airdrop endpoints, `10/minute` IPFS uploads
- Frontend `ErrorBoundary` component wraps App; catches React render errors
- Pinata JWT only used server-side (never exposed to frontend)
- All signing happens in Phantom — no private keys ever stored or transmitted server-side
- Explorer: ipfs:// image URIs rewritten to gateway URL (no ERR_UNKNOWN_URL_SCHEME)

### Clipboard Fallback (Feb 2026)
- Added `/app/frontend/src/utils/clipboard.js` with `copyText()` utility
- Tries `navigator.clipboard.writeText` first; falls back to hidden textarea + `document.execCommand('copy')` for sandboxed/iframe preview environments
- `SuccessModal.js` updated to use the new utility and emit success/error toasts
- Verified in preview iframe — falls back to `execCommand` path with `ok: true`

## What's Implemented (May 2026)

### Token Creation (Full SPL Minting Flow)
- 1 atomic transaction with 4-6 instructions:
  1. createAccount (mint)
  2. initializeMint
  3. createAssociatedTokenAccount (ATA for creator)
  4. mintTo (full supply → creator ATA)
  5. [optional] SetAuthority — revoke mint
  6. [optional] SetAuthority — revoke freeze
- BigInt-safe supply calculation: `total_supply * (10 ** decimals)`
- Finalized confirmation before success
- On-chain verification (supply > 0, balance > 0) with retry logic
- Explorer link logged

### Wallet Integration
- Phantom & Solflare via @solana/wallet-adapter
- Helius mainnet RPC (env-configurable)
- Custom fetch handler for safe response handling

### Token Explorer
- Searchable token list from MongoDB
- Shows: name, symbol, mint address, supply, authority status
- Links to Solana Explorer

### Airdrop UI
- CSV input for bulk distribution
- Summary with recipient count and total amount

### Authority Management
- Revoke mint authority (fixed supply)
- Revoke freeze authority (no account freezing)
- Revoke update authority toggle

### Zero Platform Fees
- No fee wallets, no commission logic
- Only Solana network transaction fees

## Backlog
- P1: Transaction history page (per-wallet view of created tokens + airdrops)
- P2: Token analytics dashboard
- P2: Liquidity pool integration (Raydium/Orca direct from launchpad)
- P2: Split `server.py` into routers (`routers/airdrop.py`, `routers/tokens.py`, `services/solana.py`) once endpoints grow further
- P2: Replace dead-code `derive_ata()` loop body with direct `find_program_address` call (cleanup)
- P2: Airdrop CSV download of failed-batch recipients for manual retry
