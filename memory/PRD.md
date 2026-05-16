# Solana Token Launchpad — PRD

## Problem Statement
Build a Solana token launchpad with free token creation (no platform fees), wallet integration (Phantom, Solflare), metadata support, authority management, token explorer, and airdrop functionality.

## Architecture
- **Frontend**: React + @solana/web3.js + @solana/wallet-adapter
- **Backend**: FastAPI + Python (solders) + MongoDB
- **RPC**: Helius mainnet-beta

## What's Implemented (Feb 2026)

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
