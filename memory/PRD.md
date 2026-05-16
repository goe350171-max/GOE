# Solana Token Launchpad — PRD

## Problem Statement
Build a Solana token launchpad with free token creation (no platform fees), wallet integration (Phantom, Solflare), metadata support, authority management, token explorer, and airdrop functionality.

## Architecture
- **Frontend**: React + @solana/web3.js + @solana/wallet-adapter
- **Backend**: FastAPI + Python (solders) + MongoDB
- **RPC**: Helius mainnet-beta

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
- P0: Actual airdrop transaction execution (currently UI-only)
- P1: Transaction history page
- P2: Token analytics dashboard
- P2: Liquidity pool integration
