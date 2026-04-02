# Solana RPC Configuration

## Current Setup: Devnet (Free, No Rate Limits)

The app is currently configured to use Solana **Devnet** to avoid rate limiting issues with public mainnet endpoints.

- **Network**: Devnet
- **RPC Endpoint**: `https://api.devnet.solana.com`
- **Free SOL**: Available from [Solana Faucet](https://faucet.solana.com/)

---

## Switching to Mainnet (Production)

To deploy on mainnet, you **MUST** use a dedicated RPC provider to avoid 403 errors:

### Recommended RPC Providers:

1. **Helius** (Best for Solana)
   - Free tier: 100k requests/day
   - Sign up: https://helius.dev
   - Endpoint example: `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`

2. **QuickNode**
   - Free tier: 50k requests/month
   - Sign up: https://www.quicknode.com
   - Endpoint example: `https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_KEY/`

3. **Alchemy**
   - Free tier: 300M compute units/month
   - Sign up: https://www.alchemy.com
   - Endpoint example: `https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY`

### Configuration Steps:

1. **Backend** - Update `/app/backend/.env`:
   ```env
   SOLANA_RPC_URL="https://your-rpc-provider-url-with-api-key"
   ```

2. **Frontend** - Update `/app/frontend/src/contexts/SolanaProvider.js`:
   ```javascript
   const network = WalletAdapterNetwork.Mainnet;
   const endpoint = "https://your-rpc-provider-url-with-api-key";
   ```

3. **Update UI** - Change network badge in `/app/frontend/src/components/Header.js`:
   ```javascript
   <span>Mainnet</span>
   <div className="w-2 h-2 bg-success rounded-full" />
   ```

4. **Restart services**:
   ```bash
   sudo supervisorctl restart backend frontend
   ```

---

## Why Public Mainnet RPC Returns 403

The public Solana mainnet endpoint (`https://api.mainnet-beta.solana.com`) enforces strict rate limits:

- **Max**: ~100 requests/10 seconds
- **Error**: HTTP 403 Forbidden when exceeded
- **Not suitable** for production applications

Always use a dedicated RPC provider for mainnet deployments.
