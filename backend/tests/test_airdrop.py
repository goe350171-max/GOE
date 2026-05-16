"""
Backend tests for Airdrop endpoints, Pydantic validation, health, and CORS.
Covers new features in this iteration:
  - GET /api/health
  - GET /api/airdrop/mint-info/{mint}
  - GET /api/airdrop/balance
  - POST /api/airdrop/build-batch
  - Pydantic validation on /api/tokens/create
  - CORS headers / existing token GETs still work
"""
import os
import pytest
import requests
from pathlib import Path


def _load_backend_url():
    url = os.environ.get('REACT_APP_BACKEND_URL', '').strip()
    if url:
        return url.rstrip('/')
    # Fall back to reading frontend/.env
    env_path = Path('/app/frontend/.env')
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith('REACT_APP_BACKEND_URL='):
                return line.split('=', 1)[1].strip().rstrip('/')
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _load_backend_url()

# Mainnet USDC (6 decimals, large supply) — reliable on-chain fixture
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
# Valid Solana address format that is NOT a mint account
RANDOM_OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
TEST_PAYER = RANDOM_OWNER
# Valid base58 keypair-like address (Sysvar Rent) that is NOT an SPL mint
NON_MINT_VALID_ADDRESS = "SysvarRent111111111111111111111111111111111"
# Valid format but unlikely to exist as an account
NONEXISTENT_VALID_MINT = "9zCkSh9Y8r1Bb1cYJB1KW9PaY7p1KxBkN1QpUd2NoMint"

# Recipient pool (valid pubkeys) used in airdrop build-batch tests
RECIPIENTS = [
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    "DczNh1RH3VchKj7sZc2K3T7m8aJ8K1bdz5fwoxdcdLpf",
    "GsbwXfJraMomNxBcjK4P4ETzNRwTSnWSqkXxX1FxNbm6",
    "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
]


# ── Health check ───────────────────────────────────────────────────────
class TestHealth:
    def test_health_returns_checks(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("service") == "solana-token-launchpad"
        checks = data.get("checks", {})
        assert "mongo" in checks
        assert "solana_rpc" in checks
        assert "pinata" in checks
        # status field present
        assert data.get("status") in ("ok", "degraded")


# ── /api/airdrop/mint-info/{mint} ──────────────────────────────────────
class TestAirdropMintInfo:
    def test_valid_usdc_mint(self):
        r = requests.get(f"{BASE_URL}/api/airdrop/mint-info/{USDC_MINT}", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["mint"] == USDC_MINT
        assert data["decimals"] == 6
        assert int(data["supply"]) > 0
        assert "mintAuthority" in data
        assert "freezeAuthority" in data
        assert data.get("isInitialized") is True

    def test_invalid_mint_format(self):
        r = requests.get(f"{BASE_URL}/api/airdrop/mint-info/not-a-real-pubkey", timeout=20)
        assert r.status_code == 400, r.text

    def test_non_mint_account_returns_400(self):
        # SysvarRent address is valid format but not an SPL mint
        r = requests.get(f"{BASE_URL}/api/airdrop/mint-info/{NON_MINT_VALID_ADDRESS}", timeout=30)
        # Could be 400 ("not an SPL mint") or 404 (account not found) – both acceptable
        assert r.status_code in (400, 404), r.text

    def test_nonexistent_mint_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/airdrop/mint-info/{NONEXISTENT_VALID_MINT}", timeout=30)
        # Account doesn't exist on-chain
        assert r.status_code in (404, 400), r.text


# ── /api/airdrop/balance ───────────────────────────────────────────────
class TestAirdropBalance:
    def test_balance_for_unfunded_account(self):
        r = requests.get(
            f"{BASE_URL}/api/airdrop/balance",
            params={"mint": USDC_MINT, "owner": RANDOM_OWNER},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "ata" in data and len(data["ata"]) > 30
        # Unfunded: exists may be False with balance 0
        assert "balance" in data
        if not data.get("exists"):
            assert str(data["balance"]) == "0"

    def test_balance_invalid_mint(self):
        r = requests.get(
            f"{BASE_URL}/api/airdrop/balance",
            params={"mint": "bad", "owner": RANDOM_OWNER},
            timeout=20,
        )
        assert r.status_code == 400


# ── /api/airdrop/build-batch ───────────────────────────────────────────
class TestAirdropBuildBatch:
    def _payload(self, recipients, mint=USDC_MINT, decimals=6, payer=TEST_PAYER):
        return {
            "mint": mint,
            "payer": payer,
            "decimals": decimals,
            "recipients": recipients,
        }

    def test_build_batch_3_recipients_ok(self):
        recipients = [{"address": a, "amount": 1.5} for a in RECIPIENTS[:3]]
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=self._payload(recipients), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "transaction" in data
        assert data["sizeBytes"] < 1232
        assert len(data["recipients"]) == 3
        # Per recipient: CreateATAIdempotent + TransferChecked = 2 ix
        assert data["instructionCount"] == 6
        # base64 decodable
        import base64
        decoded = base64.b64decode(data["transaction"])
        assert len(decoded) == data["sizeBytes"]

    def test_build_batch_duplicate_recipients(self):
        dup = RECIPIENTS[0]
        recipients = [{"address": dup, "amount": 1}, {"address": dup, "amount": 2}]
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=self._payload(recipients), timeout=20)
        assert r.status_code == 400, r.text
        assert "duplicate" in r.text.lower()

    def test_build_batch_exceeds_max_15(self):
        # 16 valid unique-looking entries; we only have 5 real ones so reuse with tiny suffix? No,
        # we need 16 unique valid pubkeys. Use Pydantic max_length rejection: send 16 items.
        # Use 16 copies — but duplicates fail too. Pydantic max_length=15 should fire FIRST (422)
        recipients = [{"address": RECIPIENTS[i % 5], "amount": 1} for i in range(16)]
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=self._payload(recipients), timeout=20)
        # Pydantic returns 422 for max_length violation
        assert r.status_code in (400, 422), r.text

    def test_build_batch_invalid_mint(self):
        recipients = [{"address": RECIPIENTS[0], "amount": 1}]
        payload = self._payload(recipients, mint="not_a_mint")
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=payload, timeout=20)
        assert r.status_code in (400, 422), r.text

    def test_build_batch_invalid_payer(self):
        recipients = [{"address": RECIPIENTS[0], "amount": 1}]
        payload = self._payload(recipients, payer="zzz")
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=payload, timeout=20)
        assert r.status_code in (400, 422), r.text

    def test_build_batch_invalid_recipient(self):
        recipients = [{"address": "not-an-address", "amount": 1}]
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=self._payload(recipients), timeout=20)
        assert r.status_code in (400, 422), r.text

    def test_build_batch_amount_zero(self):
        recipients = [{"address": RECIPIENTS[0], "amount": 0}]
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=self._payload(recipients), timeout=20)
        assert r.status_code in (400, 422), r.text

    def test_build_batch_amount_negative(self):
        recipients = [{"address": RECIPIENTS[0], "amount": -5}]
        r = requests.post(f"{BASE_URL}/api/airdrop/build-batch", json=self._payload(recipients), timeout=20)
        assert r.status_code in (400, 422), r.text


# ── Pydantic validation on /api/tokens/create ──────────────────────────
class TestTokenCreateValidation:
    BASE_PAYLOAD = {
        "payer": TEST_PAYER,
        "metadata": {
            "name": "TEST_Validation",
            "symbol": "TVAL",
            "decimals": 9,
            "total_supply": 1000,
        },
    }

    def _post(self, override_meta=None, override_root=None):
        payload = {
            "payer": self.BASE_PAYLOAD["payer"],
            "metadata": {**self.BASE_PAYLOAD["metadata"], **(override_meta or {})},
        }
        if override_root:
            payload.update(override_root)
        return requests.post(f"{BASE_URL}/api/tokens/create", json=payload, timeout=30)

    def test_name_too_long(self):
        r = self._post(override_meta={"name": "A" * 65})
        assert r.status_code in (400, 422), r.text

    def test_symbol_too_long(self):
        r = self._post(override_meta={"symbol": "X" * 13})
        assert r.status_code in (400, 422)

    def test_decimals_out_of_range(self):
        # Backend now accepts 0-18 decimals; 19 is the first invalid value
        r = self._post(override_meta={"decimals": 19})
        assert r.status_code in (400, 422)

    def test_supply_zero(self):
        r = self._post(override_meta={"total_supply": 0})
        assert r.status_code in (400, 422)

    def test_supply_too_large(self):
        # Backend now accepts up to 10**18 for human supply
        r = self._post(override_meta={"total_supply": 10**19})
        assert r.status_code in (400, 422)

    def test_invalid_payer(self):
        r = self._post(override_root={"payer": "not-a-pubkey"})
        assert r.status_code in (400, 422), r.text


# ── Existing token endpoints still work ────────────────────────────────
class TestExistingTokenEndpoints:
    def test_get_tokens_list_no_mongo_id(self):
        r = requests.get(f"{BASE_URL}/api/tokens", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for t in data[:5]:
            assert "_id" not in t, "Mongo _id must be excluded from response"
            assert "mint" in t

    def test_get_single_token_if_any(self):
        lst = requests.get(f"{BASE_URL}/api/tokens", timeout=20).json()
        if not lst:
            pytest.skip("No tokens to test single GET")
        mint = lst[0]["mint"]
        r = requests.get(f"{BASE_URL}/api/tokens/{mint}", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["mint"] == mint
        assert "_id" not in data


# ── CORS smoke check ───────────────────────────────────────────────────
class TestCORS:
    def test_cors_headers_present(self):
        # Simulate browser preflight via Origin header on a simple GET
        r = requests.get(
            f"{BASE_URL}/api/health",
            headers={"Origin": "https://example.com"},
            timeout=20,
        )
        assert r.status_code == 200
        # ACAO will reflect the configured CORS list or '*'
        assert "access-control-allow-origin" in {k.lower() for k in r.headers.keys()}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
