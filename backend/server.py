from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Request
from fastapi.exceptions import RequestValidationError
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from slowapi import Limiter
from solders.pubkey import Pubkey
from solders.hash import Hash
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import base64

from solders.keypair import Keypair
from solders.system_program import (
    create_account,
    transfer,
    TransferParams,
    CreateAccountParams,
    ID as SYS_PROGRAM_ID,
)
from solders.transaction import Transaction as SoldersTransaction
from solders.message import Message
from solders.instruction import Instruction, AccountMeta
import asyncio
import aiohttp
import struct
import time

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ─── Rate limiter ────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI()

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests. Please wait before trying again."})


def _format_validation_errors(exc: RequestValidationError) -> dict:
    """Convert Pydantic validation errors into a flat, user-friendly response.

    Returns:
      detail        : human-readable summary (string) — works directly with frontend toasts
      field_errors  : structured array of { field, message, type } for programmatic UIs
    """
    field_errors = []
    pretty = []
    for err in exc.errors():
        # Drop the leading "body" / "query" / "path" prefix and join dotted path
        loc_parts = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
        field = ".".join(loc_parts) if loc_parts else "(request)"
        msg = err.get("msg", "Invalid value")
        # Pydantic v2 prepends "Value error, " to user-raised ValueError messages
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        field_errors.append({"field": field, "message": msg, "type": err.get("type", "value_error")})
        pretty.append(f"{field}: {msg}")
    return {
        "detail": " | ".join(pretty) if pretty else "Validation failed",
        "field_errors": field_errors,
    }


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """Replace FastAPI's default 422 array-of-dicts response with a clean,
    field-named string so frontends can show meaningful errors directly."""
    body = _format_validation_errors(exc)
    logger.warning("Validation error on %s: %s", request.url.path, body["detail"])
    return JSONResponse(status_code=400, content=body)

app.state.limiter = limiter
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# Optional verbose diagnostics for token creation. Off by default in prod.
DEBUG_TOKEN_CREATE = os.environ.get('DEBUG_TOKEN_CREATE', '0') in ('1', 'true', 'True', 'yes')


def dbg_create(stage: str, **data):
    """Structured diagnostic log for token-create stages.
    Gated by DEBUG_TOKEN_CREATE env var to avoid log spam in production."""
    if not DEBUG_TOKEN_CREATE:
        return
    safe = {}
    for k, v in data.items():
        sv = str(v)
        if len(sv) > 400:
            sv = sv[:400] + '…(trunc)'
        safe[k] = sv
    logger.info("[token-create:%s] %s", stage, safe)


SYSTEM_PROGRAM_ID = Pubkey.from_string(
    "11111111111111111111111111111111"
)

RENT_PROGRAM_ID = Pubkey.from_string(
    "SysvarRent111111111111111111111111111111111"
)

TOKEN_METADATA_PROGRAM_ID = Pubkey.from_string(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
)

SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')
SOLANA_RPC_URL = os.environ.get(
    "SOLANA_RPC_URL",
    "https://api.mainnet-beta.solana.com",
)

SOLANA_RPC_FALLBACKS = [
    SOLANA_RPC_URL,
    "https://api.mainnet-beta.solana.com",
]
# Remove duplicates while preserving order
SOLANA_RPC_FALLBACKS = list(dict.fromkeys(SOLANA_RPC_FALLBACKS))


async def rpc_request(method: str, params: list):
    last_error = None

    for rpc_url in SOLANA_RPC_FALLBACKS:

        logger.info(f"[RPC] Trying {method} -> {rpc_url}")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": method,
                        "params": params,
                    },
                    headers={"Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:

                    if resp.status != 200:
                        last_error = f"{rpc_url} HTTP {resp.status}"
                        logger.warning(last_error)
                        continue

                    data = await resp.json()

                    if "error" in data:
                        last_error = str(data["error"])
                        logger.warning(last_error)
                        continue

                    if "result" not in data:
                        last_error = "RPC returned no result"
                        logger.warning(last_error)
                        continue

                    return data["result"]

        except Exception as e:
            last_error = str(e)
            logger.warning(last_error)

    raise HTTPException(
        status_code=503,
        detail=f"All RPC endpoints failed: {last_error}",
    )


# Log RPC connection at startup (mask API key for security)
rpc_display = SOLANA_RPC_URL.split('api-key=')[0] + 'api-key=***' if 'api-key=' in SOLANA_RPC_URL else SOLANA_RPC_URL
logger.info(f"Solana RPC primary: {rpc_display}")
logger.info(f"RPC failover endpoints: {len(SOLANA_RPC_FALLBACKS)}")
if 'helius' in SOLANA_RPC_URL.lower():
    logger.info("Using Helius RPC (Mainnet)")
elif 'devnet' in SOLANA_RPC_URL.lower():
    logger.info("Using Devnet RPC")

# ─── Pinata IPFS Configuration ──────────────────────────────────────────
PINATA_JWT = os.environ.get('PINATA_JWT', '')
PINATA_API_URL = "https://api.pinata.cloud"
PINATA_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"
PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs"

if PINATA_JWT:
    logger.info("✓ Pinata IPFS configured")
else:
    logger.warning("⚠ Pinata JWT not set – IPFS uploads disabled")



# ─── Platform Fee Configuration ─────────────────────────────────────────

LAMPORTS_PER_SOL = 1_000_000_000

PLATFORM_FEE_SOL = float(os.environ.get("PLATFORM_FEE_SOL", "0.045"))
PLATFORM_FEE_LAMPORTS = int(PLATFORM_FEE_SOL * LAMPORTS_PER_SOL)

PLATFORM_WALLET = os.environ.get("PLATFORM_WALLET", "")

PLATFORM_WALLET_PUBKEY = (
    Pubkey.from_string(PLATFORM_WALLET)
    if PLATFORM_WALLET
    else None
)

logger.info(
    f"Platform fee: {PLATFORM_FEE_SOL} SOL "
    f"({PLATFORM_FEE_LAMPORTS} lamports)"
)


async def pin_image_to_ipfs(image_url: str, token_name: str) -> str:
    """Download an image from URL and pin it to IPFS via Pinata pinFileToIPFS."""
    if not PINATA_JWT:
        raise HTTPException(status_code=503, detail="Pinata JWT not configured")

    async with aiohttp.ClientSession() as session:
        # Download image (follow redirects, accept any content)
        headers = {"User-Agent": "Mozilla/5.0 (compatible; TokenLaunchpad/1.0)"}
        async with session.get(image_url, allow_redirects=True, timeout=aiohttp.ClientTimeout(total=30), headers=headers) as img_resp:
            if img_resp.status != 200:
                raise HTTPException(status_code=400, detail=f"Cannot fetch image from {image_url} (HTTP {img_resp.status})")
            image_bytes = await img_resp.read()
            content_type = img_resp.headers.get('Content-Type', 'application/octet-stream')
            # Some servers return text/plain for images served via CDN
            if 'text' in content_type or 'html' in content_type:
                content_type = 'image/png'

        # Determine file extension
        ext_map = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
                   'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/octet-stream': '.png'}
        ext = ext_map.get(content_type.split(';')[0].strip(), '.png')
        filename = f"{token_name.replace(' ', '_').lower()}{ext}"

        # Build multipart form for Pinata pinFileToIPFS
        form = aiohttp.FormData()
        form.add_field('file', image_bytes, filename=filename, content_type=content_type)
        form.add_field('pinataMetadata', f'{{"name":"{filename}"}}')
        form.add_field('pinataOptions', '{"cidVersion":1}')

        async with session.post(
            "https://api.pinata.cloud/pinning/pinFileToIPFS",
            headers={"Authorization": f"Bearer {PINATA_JWT}"},
            data=form,
            timeout=aiohttp.ClientTimeout(total=60)
        ) as resp:
            if resp.status != 200:
                err_text = await resp.text()
                logger.error(f"Pinata pinFile error: {err_text}")
                raise HTTPException(status_code=503, detail=f"Pinata upload failed: {err_text}")
            data = await resp.json()
            ipfs_hash = data['IpfsHash']
            logger.info(f"  Image pinned: ipfs://{ipfs_hash}")
            return f"ipfs://{ipfs_hash}"


async def pin_json_to_ipfs(metadata: dict, token_name: str) -> str:
    """Pin metadata JSON to IPFS via Pinata pinJSONToIPFS."""
    if not PINATA_JWT:
        raise HTTPException(status_code=503, detail="Pinata JWT not configured")

    payload = {
        "pinataContent": metadata,
        "pinataMetadata": {"name": f"{token_name}_metadata.json"},
        "pinataOptions": {"cidVersion": 1}
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            "https://api.pinata.cloud/pinning/pinJSONToIPFS",
            headers={
                "Authorization": f"Bearer {PINATA_JWT}",
                "Content-Type": "application/json"
            },
            json=payload
        ) as resp:
            if resp.status != 200:
                err_text = await resp.text()
                logger.error(f"Pinata pinJSON error: {err_text}")
                raise HTTPException(status_code=503, detail=f"Pinata JSON upload failed: {err_text}")
            data = await resp.json()
            ipfs_hash = data['IpfsHash']
            logger.info(f"  Metadata pinned: ipfs://{ipfs_hash}")
            return f"ipfs://{ipfs_hash}"

def _validate_pubkey(value: str, field_name: str = "address") -> str:
    """Validate a Solana base58 pubkey. Raises ValueError on failure."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")
    try:
        Pubkey.from_string(value.strip())
    except Exception as e:
        raise ValueError(f"Invalid Solana address for {field_name}: {e}")
    return value.strip()


def _sanitize_str(value: Optional[str], max_len: int) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Must be a string")
    cleaned = value.strip()
    if len(cleaned) > max_len:
        raise ValueError(f"Field exceeds max length {max_len}")
    # Strip null bytes and control chars (except common whitespace)
    cleaned = ''.join(ch for ch in cleaned if ch == '\n' or ch == '\t' or ord(ch) >= 32)
    return cleaned


class TokenMetadata(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    symbol: str = Field(..., min_length=1, max_length=12)
    # SPL Token program accepts u8 decimals; cap at 18 (common upper bound for
    # tokens — Ethereum-style 18 included). Token program technically allows 0-255
    # but anything above 18 is impractical.
    decimals: int = Field(9, ge=0, le=18)
    # Human-readable supply. Pydantic guards a sane upper bound; the real
    # safety check is the u64 overflow validator below which inspects
    # total_supply × 10^decimals against Solana's u64 amount limit.
    # Allow up to 10^18 human units (covers every realistic SPL supply).
    total_supply: int = Field(..., gt=0, le=10**18)
    description: Optional[str] = Field(None, max_length=2000)
    image: Optional[str] = Field(None, max_length=2048)
    logo: Optional[str] = Field(None, max_length=2048)
    twitter: Optional[str] = Field(None, max_length=256)
    telegram: Optional[str] = Field(None, max_length=256)
    website: Optional[str] = Field(None, max_length=512)

    @field_validator('name', 'symbol', 'description', 'twitter', 'telegram')
    @classmethod
    def _strip_control(cls, v):
        if v is None:
            return v
        return _sanitize_str(v, 4096) or v

    @model_validator(mode='after')
    def _check_u64_supply_overflow(self):
        """Solana SPL amounts are u64. The mint instruction multiplies
        human supply by 10^decimals. Reject combinations that would overflow,
        with a clear, actionable message specifying both fields."""
        U64_MAX = (1 << 64) - 1
        raw = self.total_supply * (10 ** self.decimals)
        if raw > U64_MAX:
            # Compute max safe supply for the chosen decimals so the user
            # knows exactly what to change.
            max_supply_at_dec = U64_MAX // (10 ** self.decimals)
            raise ValueError(
                f"total_supply × 10^decimals = {raw} exceeds Solana u64 max ({U64_MAX}). "
                f"With decimals={self.decimals}, max total_supply is {max_supply_at_dec:,}. "
                f"Reduce total_supply or lower decimals."
            )
        return self

class TokenCreationRequest(BaseModel):
    payer: str
    metadata: TokenMetadata
    revoke_mint_authority: bool = False
    revoke_freeze_authority: bool = False
    revoke_update_authority: bool = False

    @field_validator('payer')
    @classmethod
    def _v_payer(cls, v):
        return _validate_pubkey(v, "payer")

class AuthorityRevocationRequest(BaseModel):
    mint: str
    authority_type: str
    payer: str

    @field_validator('mint', 'payer')
    @classmethod
    def _v_pk(cls, v):
        return _validate_pubkey(v, "address")

    @field_validator('authority_type')
    @classmethod
    def _v_at(cls, v):
        allowed = {"mint", "freeze", "owner", "close"}
        if v not in allowed:
            raise ValueError(f"authority_type must be one of {sorted(allowed)}")
        return v

class AirdropRecipient(BaseModel):
    address: str = Field(..., max_length=64)
    amount: float = Field(..., gt=0)

    @field_validator('address')
    @classmethod
    def _v_addr(cls, v):
        return _validate_pubkey(v, "recipient address")

class AirdropBatchRequest(BaseModel):
    mint: str
    payer: str
    recipients: List[AirdropRecipient] = Field(..., min_length=1, max_length=15)
    decimals: int = Field(..., ge=0, le=9)

    # Phantom signature proving platform fee payment
    fee_signature: str

    @field_validator('mint', 'payer')
    @classmethod
    def _v_pk(cls, v):
        return _validate_pubkey(v, "address")

class TokenRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    mint: str
    name: str
    symbol: str
    decimals: int
    total_supply: int
    description: Optional[str] = None
    image: Optional[str] = None
    logo: Optional[str] = None
    social_links: Optional[dict] = None
    creator: str
    mint_authority_revoked: bool = False
    freeze_authority_revoked: bool = False
    update_authority_revoked: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    transaction_signature: Optional[str] = None
    ata: Optional[str] = None
    on_chain_verified: bool = False
    on_chain_supply: Optional[str] = None

async def get_latest_blockhash():
    """
    Fetch the latest finalized blockhash using the shared RPC helper.
    """

    result = await rpc_request(
        "getLatestBlockhash",
        [
            {
                "commitment": "finalized"
            }
        ]
    )

    return Hash.from_string(
        result["value"]["blockhash"]
    )

async def get_transaction(signature: str):
    """
    Fetch a confirmed transaction from Solana RPC.
    Tries every configured RPC endpoint.
    """

    last_error = None

    for rpc_url in SOLANA_RPC_FALLBACKS:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getTransaction",
                        "params": [
                            signature,
                            {
                                "encoding": "jsonParsed",
                                "maxSupportedTransactionVersion": 0,
                            },
                        ],
                    },
                    headers={"Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=20),
                ) as resp:

                    if resp.status != 200:
                        continue

                    data = await resp.json()

                    if data.get("result"):
                        return data["result"]

                    last_error = data.get("error")

        except Exception as e:
            last_error = str(e)

    raise HTTPException(
        status_code=400,
        detail=f"Unable to verify payment transaction ({last_error})",
    )

async def verify_airdrop_fee_payment(
    payer: str,
    signature: str,
    recipient_count: int,
):
    """
    Verify that the platform fee payment was actually made.
    """

    tx = await get_transaction(signature)

    if tx.get("meta", {}).get("err") is not None:
        raise HTTPException(
            status_code=400,
            detail="Platform fee transaction failed.",
        )

    account_keys = tx["transaction"]["message"]["accountKeys"]

    signer = None

    for account in account_keys:
        if account.get("signer"):
            signer = account["pubkey"]
            break

    if signer != payer:
        raise HTTPException(
            status_code=400,
            detail="Platform fee payer does not match wallet.",
        )

    expected_wallet = os.getenv("PLATFORM_WALLET")

    expected_fee = (
        float(os.getenv("AIRDROP_FEE_SOL_PER_RECIPIENT", "0"))
        * recipient_count
    )

    expected_lamports = int(expected_fee * 1_000_000_000)

    found = False

    for instruction in tx["transaction"]["message"]["instructions"]:

        if instruction.get("program") != "system":
            continue

        parsed = instruction.get("parsed")

        if not parsed:
            continue

        if parsed.get("type") != "transfer":
            continue

        info = parsed["info"]

        if (
            info["source"] == payer
            and info["destination"] == expected_wallet
            and int(info["lamports"]) >= expected_lamports
        ):
            found = True
            break

    if not found:
        raise HTTPException(
            status_code=400,
            detail="Platform fee payment not found or incorrect.",
        )

    return True


async def pin_with_retry(upload_fn, *args, max_retries=3, delay=2):
    """Retry wrapper for Pinata IPFS uploads."""
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            return await upload_fn(*args)
        except Exception as e:
            last_error = e
            logger.warning(f"IPFS upload attempt {attempt}/{max_retries} failed: {e}")
            if attempt < max_retries:
                await asyncio.sleep(delay * attempt)
    raise last_error

@api_router.get("/")
async def root():
    return {"message": "Solana Token Launchpad API"}


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 MB


@api_router.post("/upload-image")
@limiter.limit("10/minute")
async def upload_image(request: Request, file: UploadFile = File(...)):
    """Upload an image file directly to Pinata IPFS. Returns the IPFS URI."""
    if not PINATA_JWT:
        raise HTTPException(status_code=503, detail="Pinata IPFS not configured")

    # Validate content type
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{file.content_type}'. Allowed: PNG, JPEG, GIF, WEBP, SVG"
        )

    # Read and validate size
    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({len(contents) // 1024}KB). Maximum: {MAX_IMAGE_SIZE // 1024 // 1024}MB"
        )

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Pin to IPFS via Pinata
    filename = file.filename or "token_image.png"

    async with aiohttp.ClientSession() as session:
        form = aiohttp.FormData()
        form.add_field('file', contents, filename=filename, content_type=file.content_type)
        form.add_field('pinataMetadata', f'{{"name":"{filename}"}}')
        form.add_field('pinataOptions', '{"cidVersion":1}')

        async with session.post(
            f"{PINATA_API_URL}/pinning/pinFileToIPFS",
            headers={"Authorization": f"Bearer {PINATA_JWT}"},
            data=form,
            timeout=aiohttp.ClientTimeout(total=60)
        ) as resp:
            if resp.status != 200:
                err_text = await resp.text()
                logger.error(f"Pinata upload error: {err_text}")
                raise HTTPException(status_code=503, detail="IPFS upload failed")
            data = await resp.json()

    ipfs_hash = data['IpfsHash']
    ipfs_uri = f"ipfs://{ipfs_hash}"
    gateway_url = f"{PINATA_GATEWAY}/{ipfs_hash}"

    logger.info(f"Image uploaded: {filename} -> {ipfs_uri} ({len(contents)} bytes)")

    return {
        "ipfsUri": ipfs_uri,
        "gatewayUrl": gateway_url,
        "ipfsHash": ipfs_hash,
        "fileName": filename,
        "fileSize": len(contents),
        "contentType": file.content_type,
    }

def derive_ata(owner: Pubkey, mint: Pubkey) -> Pubkey:
    """Derive the Associated Token Account address for a given owner and mint."""
    seeds = bytes(owner) + bytes(TOKEN_PROGRAM_ID) + bytes(mint)
    # PDA derivation: find_program_address equivalent
    for nonce in range(255, -1, -1):
        try:
            seed_with_nonce = seeds + bytes([nonce])
            import hashlib
            h = hashlib.sha256(seed_with_nonce + bytes(ASSOCIATED_TOKEN_PROGRAM_ID) + b"ProgramDerivedAddress")
            candidate = h.digest()
            # Check if it's a valid PDA (not on the ed25519 curve)
            # Use solders to validate
            from solders.pubkey import Pubkey as SoldersPubkey
            result = SoldersPubkey.from_bytes(candidate)
            # If we get here without error, check if it's off-curve
            # For PDA derivation, we need to use the proper method
            return Pubkey.find_program_address(
                [bytes(owner), bytes(TOKEN_PROGRAM_ID), bytes(mint)],
                ASSOCIATED_TOKEN_PROGRAM_ID
            )[0]
        except Exception:
            continue
    raise Exception("Could not derive ATA")


def build_create_ata_ix(payer: Pubkey, ata: Pubkey, owner: Pubkey, mint: Pubkey) -> Instruction:
    """Build CreateAssociatedTokenAccount instruction."""
    return Instruction(
        program_id=ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts=[
            AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
            AccountMeta(pubkey=ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=False, is_writable=False),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=Pubkey.from_string("11111111111111111111111111111111"), is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
        data=bytes()
    )


def build_mint_to_ix(mint: Pubkey, dest_ata: Pubkey, authority: Pubkey, amount: int) -> Instruction:
    """Build MintTo instruction. Opcode 7, followed by u64 LE amount."""
    data = bytes([7]) + amount.to_bytes(8, 'little')
    return Instruction(
        program_id=TOKEN_PROGRAM_ID,
        accounts=[
            AccountMeta(pubkey=mint, is_signer=False, is_writable=True),
            AccountMeta(pubkey=dest_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=authority, is_signer=True, is_writable=False),
        ],
        data=data
    )


def build_set_authority_ix(account: Pubkey, current_authority: Pubkey, authority_type: int, new_authority=None) -> Instruction:
    """Build SetAuthority instruction. Opcode 6.
    authority_type: 0=MintTokens, 1=FreezeAccount
    new_authority: None to revoke
    """
    if new_authority is None:
        data = bytes([6]) + authority_type.to_bytes(1, 'little') + bytes([0])
    else:
        data = bytes([6]) + authority_type.to_bytes(1, 'little') + bytes([1]) + bytes(new_authority)
    return Instruction(
        program_id=TOKEN_PROGRAM_ID,
        accounts=[
            AccountMeta(pubkey=account, is_signer=False, is_writable=True),
            AccountMeta(pubkey=current_authority, is_signer=True, is_writable=False),
        ],
        data=data
    )


def build_create_ata_idempotent_ix(payer: Pubkey, ata: Pubkey, owner: Pubkey, mint: Pubkey) -> Instruction:
    """Build CreateAssociatedTokenAccountIdempotent (data = [1]).
    Will succeed silently if the ATA already exists."""
    return Instruction(
        program_id=ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts=[
            AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
            AccountMeta(pubkey=ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=False, is_writable=False),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
        data=bytes([1]),
    )


def build_transfer_checked_ix(
    source_ata: Pubkey,
    mint: Pubkey,
    dest_ata: Pubkey,
    owner: Pubkey,
    amount: int,
    decimals: int,
) -> Instruction:
    """Build SPL Token TransferChecked instruction (opcode 12).
    Layout: u8(12) + u64 LE amount + u8 decimals.
    Verifies mint + decimals on-chain (safer than basic Transfer)."""
    data = bytes([12]) + amount.to_bytes(8, 'little') + bytes([decimals])
    return Instruction(
        program_id=TOKEN_PROGRAM_ID,
        accounts=[
            AccountMeta(pubkey=source_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=dest_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=True, is_writable=False),
        ],
        data=data,
    )


# ─── Metaplex Token Metadata helpers ───────────────────────────────────

import struct

def _borsh_string(s: str) -> bytes:
    """Borsh-encode a String (u32 LE length + UTF-8 bytes)."""
    b = s.encode("utf-8")
    return struct.pack("<I", len(b)) + b

def _borsh_option_none() -> bytes:
    return b"\x00"

def _borsh_bool(v: bool) -> bytes:
    return b"\x01" if v else b"\x00"

def derive_metadata_pda(mint: Pubkey) -> Pubkey:
    """Derive the Metaplex metadata PDA for a given mint."""
    return Pubkey.find_program_address(
        [b"metadata", bytes(TOKEN_METADATA_PROGRAM_ID), bytes(mint)],
        TOKEN_METADATA_PROGRAM_ID
    )[0]

def build_create_metadata_v3_ix(
    metadata_pda: Pubkey,
    mint: Pubkey,
    mint_authority: Pubkey,
    payer: Pubkey,
    update_authority: Pubkey,
    name: str,
    symbol: str,
    uri: str,
    is_mutable: bool = True,
) -> Instruction:
    """Build CreateMetadataAccountV3 instruction (discriminator = 33).

    Borsh layout:
      u8(33)
      DataV2 { name, symbol, uri, seller_fee_basis_points, creators, collection, uses }
      bool  is_mutable
      Option<CollectionDetails>  (None)

    Account order:
      0  metadata        (writable)
      1  mint
      2  mintAuthority   (signer)
      3  payer           (writable, signer)
      4  updateAuthority
      5  systemProgram
      6  rent            (optional but explicit for safety)
    """
    data = bytes([33])  # CreateMetadataAccountV3 discriminator

    # DataV2
    data += _borsh_string(name)
    data += _borsh_string(symbol)
    data += _borsh_string(uri)
    data += struct.pack("<H", 0)        # seller_fee_basis_points = 0 (fungible)
    data += _borsh_option_none()        # creators  = None
    data += _borsh_option_none()        # collection = None
    data += _borsh_option_none()        # uses       = None

    # is_mutable
    data += _borsh_bool(is_mutable)

    # collection_details = None
    data += _borsh_option_none()

    return Instruction(
        program_id=TOKEN_METADATA_PROGRAM_ID,
        accounts=[
            AccountMeta(pubkey=metadata_pda, is_signer=False, is_writable=True),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=mint_authority, is_signer=True, is_writable=False),
            AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
            AccountMeta(pubkey=update_authority, is_signer=False, is_writable=False),
            AccountMeta(pubkey=Pubkey.from_string("11111111111111111111111111111111"), is_signer=False, is_writable=False),
            AccountMeta(pubkey=RENT_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
        data=data,
    )


# ─── Metadata JSON endpoint ────────────────────────────────────────────

@api_router.get("/metadata/{mint_address}.json")
async def get_token_metadata_json(mint_address: str):
    """Serve off-chain metadata JSON for a given mint address.
    This URL is stored on-chain as the `uri` field in Metaplex metadata."""
    token = await db.tokens.find_one({"mint": mint_address}, {"_id": 0})
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    social_links = token.get("social_links") or {}

    metadata_json = {
        "name": token.get("name", ""),
        "symbol": token.get("symbol", ""),
        "description": token.get("description", ""),
        "image": token.get("image") or token.get("logo") or "",
        "external_url": social_links.get("website", ""),
        "attributes": [],
        "properties": {
            "links": {
                k: v for k, v in social_links.items() if v
            },
            "category": "currency",
        },
    }

    from fastapi.responses import JSONResponse
    return JSONResponse(content=metadata_json)


@api_router.post("/tokens/create")
@limiter.limit("5/minute")
async def create_token(request: Request, payload: TokenCreationRequest):
    try:
        start_time = time.time()
        logger.info(f"Creating token: {payload.metadata.name}")
        dbg_create('request', payer=payload.payer, name=payload.metadata.name,
                   symbol=payload.metadata.symbol, decimals=payload.metadata.decimals,
                   total_supply=payload.metadata.total_supply,
                   image_present=bool(payload.metadata.image),
                   logo_present=bool(payload.metadata.logo),
                   revoke_mint=payload.revoke_mint_authority,
                   revoke_freeze=payload.revoke_freeze_authority,
                   revoke_update=payload.revoke_update_authority)

        payer_pubkey = Pubkey.from_string(payload.payer)
        mint_keypair = Keypair()
        mint_pubkey = mint_keypair.pubkey()

        recent_blockhash = await get_latest_blockhash()
        dbg_create('blockhash', value=str(recent_blockhash))
        
        # --- Derive ATA for creator ---
        ata_pubkey = Pubkey.find_program_address(
            [bytes(payer_pubkey), bytes(TOKEN_PROGRAM_ID), bytes(mint_pubkey)],
            ASSOCIATED_TOKEN_PROGRAM_ID
        )[0]
        
        logger.info(f"  Mint:    {mint_pubkey}")
        logger.info(f"  ATA:     {ata_pubkey}")
        
        # --- Calculate mint amount with BigInt-safe integer math ---
        decimals = payload.metadata.decimals
        total_supply = payload.metadata.total_supply
        mint_amount = total_supply * (10 ** decimals)

        # Defense in depth: u64 safety check (Pydantic should have caught this)
        U64_MAX = (1 << 64) - 1
        if mint_amount > U64_MAX:
            raise HTTPException(
                status_code=400,
                detail=f"metadata: total_supply × 10^decimals = {mint_amount} exceeds Solana u64 max ({U64_MAX})."
            )

        logger.info(f"  Supply:  {total_supply}")
        logger.info(f"  Decimals: {decimals}")
        logger.info(f"  Raw amt: {mint_amount}")
        dbg_create('mint_params', mint=str(mint_pubkey), ata=str(ata_pubkey),
                   decimals=decimals, total_supply=total_supply, raw_amount=mint_amount)
        
        # --- Instruction 1: Create mint account ---
        MINT_SIZE = 82

        lamports_for_mint = await rpc_get_minimum_balance_for_rent_exemption(MINT_SIZE)

        logger.info(
            f"Mint rent exemption: {lamports_for_mint} lamports"
        )
        
        create_account_ix = create_account(
            CreateAccountParams(
                from_pubkey=payer_pubkey,
                to_pubkey=mint_pubkey,
                lamports=lamports_for_mint,
                space=MINT_SIZE,
                owner=TOKEN_PROGRAM_ID
            )
        )
        
        # --- Instruction 2: Initialize mint ---
        initialize_mint_data = bytes([0]) + \
                               decimals.to_bytes(1, 'little') + \
                               bytes(payer_pubkey) + \
                               bytes([1]) + \
                               bytes(payer_pubkey)
        
        initialize_mint_ix = Instruction(
            program_id=TOKEN_PROGRAM_ID,
            accounts=[
                AccountMeta(pubkey=mint_pubkey, is_signer=False, is_writable=True),
                AccountMeta(pubkey=RENT_PROGRAM_ID, is_signer=False, is_writable=False)
            ],
            data=initialize_mint_data
        )
        
        # --- Instruction 3: Create Associated Token Account ---
        create_ata_ix = build_create_ata_ix(payer_pubkey, ata_pubkey, payer_pubkey, mint_pubkey)
        
        # --- Instruction 4: MintTo (full supply → creator ATA) ---
        mint_to_ix = build_mint_to_ix(mint_pubkey, ata_pubkey, payer_pubkey, mint_amount)
        
        # --- Instruction 5: Create Metaplex Token Metadata ---
        metadata_pda = derive_metadata_pda(mint_pubkey)
        mint_address_str = str(mint_pubkey)
        
        # ─── Upload image + metadata to IPFS via Pinata (with retry) ────
        image_ipfs_uri = ""
        if payload.metadata.image:
            try:
                image_ipfs_uri = await pin_with_retry(
                    pin_image_to_ipfs, payload.metadata.image, payload.metadata.name
                )
            except Exception as img_err:
                logger.warning(f"  Image IPFS upload failed after retries: {img_err}. Using original URL.")
                image_ipfs_uri = payload.metadata.image
        elif payload.metadata.logo:
            try:
                image_ipfs_uri = await pin_with_retry(
                    pin_image_to_ipfs, payload.metadata.logo, payload.metadata.name
                )
            except Exception as img_err:
                logger.warning(f"  Logo IPFS upload failed after retries: {img_err}. Using original URL.")
                image_ipfs_uri = payload.metadata.logo

        social_links = {
            k: v for k, v in {
                "twitter": payload.metadata.twitter,
                "telegram": payload.metadata.telegram,
                "website": payload.metadata.website,
            }.items() if v
        }

        metadata_json = {
            "name": payload.metadata.name,
            "symbol": payload.metadata.symbol,
            "description": payload.metadata.description or "",
            "image": image_ipfs_uri,
            "external_url": payload.metadata.website or "",
            "attributes": [],
            "properties": {
                "links": social_links,
                "category": "currency",
            },
        }

        try:
            metadata_uri = await pin_with_retry(
                pin_json_to_ipfs, metadata_json, payload.metadata.name
            )
        except Exception as json_err:
            logger.warning(f"  Metadata IPFS upload failed after retries: {json_err}. Falling back to backend URI.")
            backend_url = os.environ.get('BACKEND_PUBLIC_URL', '')
            metadata_uri = f"{backend_url}/api/metadata/{mint_address_str}.json" if backend_url else ""

        logger.info(f"  Metadata PDA: {metadata_pda}")
        logger.info(f"  Image URI:    {image_ipfs_uri}")
        logger.info(f"  Metadata URI: {metadata_uri}")
        dbg_create('uris', image=image_ipfs_uri, metadata=metadata_uri,
                   metadata_pda=str(metadata_pda))

        # Metaplex hard limit on metadata URI is 200 bytes.
        # Truncate (with warning) rather than letting Borsh fail downstream.
        if metadata_uri and len(metadata_uri) > 200:
            logger.warning(
                f"  Metadata URI {len(metadata_uri)} bytes exceeds Metaplex 200-byte limit; truncating"
            )
            metadata_uri = metadata_uri[:200]
        
        create_metadata_ix = build_create_metadata_v3_ix(
            metadata_pda=metadata_pda,
            mint=mint_pubkey,
            mint_authority=payer_pubkey,
            payer=payer_pubkey,
            update_authority=payer_pubkey,
            name=payload.metadata.name,
            symbol=payload.metadata.symbol,
            uri=metadata_uri,
            is_mutable=not payload.revoke_update_authority,
        )
        
                # --- Build instruction list ---
        instructions = [
            create_account_ix,
            initialize_mint_ix,
            create_metadata_ix,
            create_ata_ix,
            mint_to_ix,
        ]

        # ─── Platform Fee Transfer ───────────────────────────────────────
        if PLATFORM_FEE_LAMPORTS > 0 and PLATFORM_WALLET_PUBKEY:
            fee_ix = transfer(
                TransferParams(
                    from_pubkey=payer_pubkey,
                    to_pubkey=PLATFORM_WALLET_PUBKEY,
                    lamports=PLATFORM_FEE_LAMPORTS,
                )
            )
            instructions.append(fee_ix)
            logger.info(f"  + Platform fee charged: {PLATFORM_FEE_SOL} SOL")

        # --- Instruction 5+: Revoke authorities AFTER minting ---
        if payload.revoke_mint_authority:
            instructions.append(
                build_set_authority_ix(mint_pubkey, payer_pubkey, 0, None)
            )
            logger.info("  + Revoke mint authority")

        if payload.revoke_freeze_authority:
            instructions.append(
                build_set_authority_ix(mint_pubkey, payer_pubkey, 1, None)
            )
            logger.info("  + Revoke freeze authority")

        # ---------- DEBUG ----------
        logger.info("========== TRANSACTION DEBUG ==========")

        for i, ix in enumerate(instructions):
            logger.info(f"Instruction #{i}")
            logger.info(f"Program: {ix.program_id}")
            logger.info(f"Data Length: {len(ix.data)}")
            logger.info(f"Data (hex): {ix.data.hex()}")

            for j, acc in enumerate(ix.accounts):
                logger.info(
                    f"[{j}] {acc.pubkey} "
                    f"signer={acc.is_signer} "
                    f"writable={acc.is_writable}"
                )

        logger.info("=======================================")

        # --- Build transaction ---
        msg = Message.new_with_blockhash(
            instructions,
            payer_pubkey,
            recent_blockhash,
        )

        tx = SoldersTransaction.new_unsigned(msg)
        tx_serialized = bytes(tx)

        # ---------- TX SUMMARY ----------
        logger.info("========== TX SUMMARY ==========")
        logger.info(f"Serialized size: {len(tx_serialized)} bytes")
        logger.info(f"Instructions: {len(instructions)}")
        logger.info(f"Recent blockhash: {recent_blockhash}")
        logger.info(f"Payer: {payer_pubkey}")
        logger.info(f"Mint: {mint_pubkey}")
        logger.info("================================")

        # ---------- SERIALIZED TX ----------
        logger.info("===== SERIALIZED TX =====")
        logger.info(base64.b64encode(tx_serialized).decode())
        logger.info("=========================")

        mint_secret = bytes(mint_keypair)

        # Defense in depth: enforce Solana wire-format 1232-byte cap before
        # returning to the wallet (saves a guaranteed-to-fail signing prompt).
        if len(tx_serialized) > 1232:
            raise HTTPException(
                status_code=400,
                detail=f"Built transaction is {len(tx_serialized)} bytes (>1232 cap). "
                       f"Reduce metadata length (currently {len(payload.metadata.name)+len(payload.metadata.symbol)+len(metadata_uri)} bytes of strings)."
            )

        mint_address = str(mint_pubkey)
        ata_address = str(ata_pubkey)
        dbg_create('tx_built', size_bytes=len(tx_serialized),
                   instruction_count=len(instructions), mint=mint_address)
        
        # --- Save token record ---
        token_record = TokenRecord(
            mint=mint_address,
            name=payload.metadata.name,
            symbol=payload.metadata.symbol,
            decimals=decimals,
            total_supply=total_supply,
            description=payload.metadata.description,
            image=payload.metadata.image,
            logo=payload.metadata.logo,
            social_links={
                "twitter": payload.metadata.twitter,
                "telegram": payload.metadata.telegram,
                "website": payload.metadata.website
            },
            creator=payload.payer,
            mint_authority_revoked=payload.revoke_mint_authority,
            freeze_authority_revoked=payload.revoke_freeze_authority,
            update_authority_revoked=payload.revoke_update_authority,

            status="pending"
       )
        
        doc = token_record.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['ata'] = ata_address
        doc['metadata_pda'] = str(metadata_pda)
        doc['metadata_uri'] = metadata_uri
        doc['image_ipfs_uri'] = image_ipfs_uri

        doc["status"] = "pending"
        
        await db.tokens.insert_one(doc)
        
        elapsed = round(time.time() - start_time, 2)
        logger.info(f"  Transaction built: {len(instructions)} ix, {elapsed}s elapsed")
        
        # Analytics event
        await db.analytics.insert_one({
            "event": "token_created",
            "mint": mint_address,
            "name": payload.metadata.name,
            "symbol": payload.metadata.symbol,
            "creator": payload.payer,
            "ipfs_image": bool(image_ipfs_uri.startswith("ipfs://")),
            "ipfs_metadata": bool(metadata_uri.startswith("ipfs://")),
            "revoke_mint": payload.revoke_mint_authority,
            "revoke_freeze": payload.revoke_freeze_authority,
            "instructions": len(instructions),
            "elapsed_seconds": elapsed,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        
        # Estimated costs
        mint_rent_sol = 0.001462
        metadata_rent_sol = 0.005617
        ata_rent_sol = 0.002039
        network_fee_sol = 0.000010

        estimated_network_cost = (
            mint_rent_sol +
            metadata_rent_sol +
            ata_rent_sol +
            network_fee_sol
        )

        estimated_total_cost = (
            PLATFORM_FEE_SOL +
            estimated_network_cost
        )

        return {
            "transaction": base64.b64encode(tx_serialized).decode('utf-8'),
            "mint": mint_address,
            "ata": ata_address,
            "metadataPda": str(metadata_pda),
            "metadataUri": metadata_uri,
            "imageUri": image_ipfs_uri,
            "mintKeypair": base64.b64encode(mint_secret).decode('utf-8'),
            "totalMinted": str(mint_amount),

            "platformFee": PLATFORM_FEE_SOL,
            "platformFeeLamports": PLATFORM_FEE_LAMPORTS,

            "estimatedNetworkCost": estimated_network_cost,
            "estimatedTotalCost": estimated_total_cost,

            "explorerUrl": f"https://explorer.solana.com/address/{mint_address}",
            "message": "Transaction ready for signing"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token creation failed: {str(e)}", exc_info=True)
        dbg_create('FAIL', error=str(e), error_type=type(e).__name__)
        raise HTTPException(status_code=400, detail=f"token_create: {type(e).__name__}: {e}")

@api_router.post("/tokens/update-signature")
async def update_token_signature(mint: str, signature: str, verified: bool = False, on_chain_supply: str = "0"):
    try:
        update_fields = {
            "transaction_signature": signature,
            "on_chain_verified": verified,
            "on_chain_supply": on_chain_supply,
            "status": "success",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
            "explorer_url": f"https://explorer.solana.com/tx/{signature}",
        }
        await db.tokens.update_one(
            {"mint": mint},
            {"$set": update_fields}
        )

        updated_token = await db.tokens.find_one(
            {"mint": mint},
            {"_id": 0}
        )

        logger.info(
            f"Token {mint} updated: sig={signature[:12]}... "
            f"verified={verified} supply={on_chain_supply}"
        )

        return {
            "success": True,
            "token": updated_token
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/tokens/update-status")
async def update_token_status(
    mint: str,
    status: str,
    error: str = "",
):
    try:
        update_fields = {
            "status": status,
            "last_error": error,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        await db.tokens.update_one(
            {"mint": mint},
            {"$set": update_fields}
        )

        return {"success": True}

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/tokens/verify/{mint_address}")
async def verify_token_on_chain(mint_address: str):
    """Query Solana RPC directly to verify on-chain state of a mint."""
    try:
        async with aiohttp.ClientSession() as session:
            # Fetch mint account info
            async with session.post(
                SOLANA_RPC_URL,
                json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": "getAccountInfo",
                    "params": [mint_address, {"encoding": "jsonParsed"}]
                },
                headers={"Content-Type": "application/json"}
            ) as resp:
                data = await resp.json()
        
        account_info = data.get("result", {}).get("value")
        if not account_info:
            return {"exists": False, "mint": mint_address}
        
        parsed = account_info.get("data", {}).get("parsed", {}).get("info", {})
        
        return {
            "exists": True,
            "mint": mint_address,
            "supply": parsed.get("supply", "0"),
            "decimals": parsed.get("decimals", 0),
            "mintAuthority": parsed.get("mintAuthority"),
            "freezeAuthority": parsed.get("freezeAuthority"),
            "isInitialized": parsed.get("isInitialized", False),
        }
    except Exception as e:
        logger.error(f"Verify error for {mint_address}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.get("/tokens", response_model=List[TokenRecord])
async def get_tokens():
    try:
        tokens = await db.tokens.find(
            {
                "transaction_signature": {"$ne": None},
                "on_chain_verified": True,
            },
            {"_id": 0}
        ).sort("created_at", -1).to_list(100)

        for token in tokens:
            if isinstance(token.get("created_at"), str):
                token["created_at"] = datetime.fromisoformat(token["created_at"])

        return tokens

    except Exception as e:
        logger.error(f"Error fetching tokens: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/my-tokens")
async def get_my_tokens(wallet: str):
    try:
        tokens = await db.tokens.find(
            {
                "creator": wallet,
                "transaction_signature": {"$ne": None},
                "on_chain_verified": True,
            },
            {"_id": 0}
        ).sort("created_at", -1).to_list(100)

        for token in tokens:
            if isinstance(token.get("created_at"), str):
                token["created_at"] = datetime.fromisoformat(token["created_at"])

        return tokens

    except Exception as e:
        logger.error(f"Error fetching my tokens: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
        
       

@api_router.post("/tokens/revoke-authority")
@limiter.limit("5/minute")
async def revoke_authority(request: Request, payload: AuthorityRevocationRequest):
    try:
        payer_pk = Pubkey.from_string(payload.payer)
        mint_pk = Pubkey.from_string(payload.mint)

        
        recent_blockhash = await get_latest_blockhash()
        
        authority_type_map = {
            "mint": 0,
            "freeze": 1,
            "owner": 2,
            "close": 3
        }
        
        authority_type_byte = authority_type_map.get(payload.authority_type, 0)
        
        set_authority_data = bytes([6]) + \
                            authority_type_byte.to_bytes(1, 'little') + \
                            bytes([0])
        
        set_authority_ix = Instruction(
            program_id=TOKEN_PROGRAM_ID,
            accounts=[
                AccountMeta(pubkey=mint_pubkey, is_signer=False, is_writable=True),
                AccountMeta(pubkey=payer_pubkey, is_signer=True, is_writable=False)
            ],
            data=set_authority_data
        )
        
        msg = Message.new_with_blockhash(
            [set_authority_ix],
            payer_pubkey,
            recent_blockhash
        )
        
        tx = SoldersTransaction.new_unsigned(msg)
        
        field_name = f"{payload.authority_type}_authority_revoked"
        await db.tokens.update_one(
            {"mint": payload.mint},
            {"$set": {field_name: True}}
        )
        
        return {
            "transaction": base64.b64encode(bytes(tx)).decode('utf-8'),
            "message": f"{payload.authority_type} authority revocation transaction ready"
        }
        
    except Exception as e:
        logger.error(f"Error revoking authority: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

async def rpc_get_parsed_account(account: str):
    """Call getAccountInfo with jsonParsed encoding using failover."""
    last_error = None
    for rpc_url in SOLANA_RPC_FALLBACKS:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    rpc_url,
                    json={
                        "jsonrpc": "2.0", "id": 1,
                        "method": "getAccountInfo",
                        "params": [account, {"encoding": "jsonParsed", "commitment": "confirmed"}],
                    },
                    headers={"Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status != 200:
                        last_error = f"HTTP {resp.status}"
                        continue
                    data = await resp.json()
                    if 'error' in data:
                        last_error = data['error']
                        continue
                    return data.get('result', {}).get('value')
        except Exception as e:
            last_error = str(e)
            continue
    raise HTTPException(status_code=503, detail=f"RPC unavailable: {last_error}")

async def rpc_get_minimum_balance_for_rent_exemption(size: int):
    """Get rent exemption using RPC with failover."""
   async def rpc_get_minimum_balance_for_rent_exemption(size: int):
    """Get rent exemption using RPC with failover."""

    result = await rpc_request(
        "getMinimumBalanceForRentExemption",
        [size],
    )

    return int(result)

@api_router.get("/airdrop/mint-info/{mint}")
@limiter.limit("30/minute")
async def airdrop_mint_info(request: Request, mint: str):
    """Fetch on-chain decimals + supply + freeze state for any SPL mint.
    Used by airdrop UI for arbitrary mints (not just launchpad ones)."""
    try:
        _validate_pubkey(mint, "mint")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    value = await rpc_get_parsed_account(mint)
    if not value:
        raise HTTPException(status_code=404, detail="Mint account not found on-chain")
    parsed = value.get('data', {}).get('parsed', {})
    if parsed.get('type') != 'mint':
        raise HTTPException(status_code=400, detail="Account is not an SPL mint")
    info = parsed.get('info', {})
    return {
        "mint": mint,
        "decimals": info.get('decimals', 0),
        "supply": info.get('supply', "0"),
        "mintAuthority": info.get('mintAuthority'),
        "freezeAuthority": info.get('freezeAuthority'),
        "isInitialized": info.get('isInitialized', False),
    }


@api_router.get("/airdrop/balance")
@limiter.limit("30/minute")
async def airdrop_balance(request: Request, mint: str, owner: str):
    """Fetch token balance for a given (mint, owner) — derives the owner's ATA."""
    try:
        _validate_pubkey(mint, "mint")
        _validate_pubkey(owner, "owner")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    mint_pk = Pubkey.from_string(mint)
    owner_pk = Pubkey.from_string(owner)
    ata = Pubkey.find_program_address(
        [bytes(owner_pk), bytes(TOKEN_PROGRAM_ID), bytes(mint_pk)],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0]
    value = await rpc_get_parsed_account(str(ata))
    if not value:
        return {"ata": str(ata), "exists": False, "balance": "0", "uiAmount": 0, "decimals": None}
    info = value.get('data', {}).get('parsed', {}).get('info', {})
    token_amount = info.get('tokenAmount', {}) or {}
    return {
        "ata": str(ata),
        "exists": True,
        "balance": token_amount.get('amount', "0"),
        "uiAmount": token_amount.get('uiAmount', 0),
        "decimals": token_amount.get('decimals'),
    }


@api_router.get("/airdrop/fee")
async def get_airdrop_fee():
    return {
        "wallet": os.getenv("PLATFORM_WALLET"),
        "fee_per_recipient": float(
            os.getenv("AIRDROP_FEE_SOL_PER_RECIPIENT", "0")
        ),
    }


@api_router.post("/airdrop/build-batch")
@limiter.limit("30/minute")
async def airdrop_build_batch(request: Request, payload: AirdropBatchRequest):
    """Build an unsigned transaction for one airdrop batch.
    Per recipient: CreateATAIdempotent + TransferChecked.
    Frontend signs with Phantom (no private keys ever leave the user's wallet)."""
    try:
        payer_pk = Pubkey.from_string(payload.payer)
        mint_pk = Pubkey.from_string(payload.mint)

        # Verify platform fee payment BEFORE building the batch
        await verify_airdrop_fee_payment(
            payer=payload.payer,
            signature=payload.fee_signature,
            recipient_count=len(payload.recipients),
        )

        # Derive payer's source ATA
        source_ata = Pubkey.find_program_address(
            [bytes(payer_pk), bytes(TOKEN_PROGRAM_ID), bytes(mint_pk)],
            ASSOCIATED_TOKEN_PROGRAM_ID,
        )[0]

        # Reject duplicate recipient addresses inside one batch
        seen = set()
        instructions = []
        recipient_atas = []
        for r in payload.recipients:
            if r.address in seen:
                raise HTTPException(status_code=400, detail=f"Duplicate recipient in batch: {r.address}")
            seen.add(r.address)

            recipient_pk = Pubkey.from_string(r.address)
            recipient_ata = Pubkey.find_program_address(
                [bytes(recipient_pk), bytes(TOKEN_PROGRAM_ID), bytes(mint_pk)],
                ASSOCIATED_TOKEN_PROGRAM_ID,
            )[0]

            # Convert UI amount -> raw u64 with decimal precision
            raw_amount = int(round(r.amount * (10 ** payload.decimals)))
            if raw_amount <= 0:
                raise HTTPException(status_code=400, detail=f"Amount too small for {r.address}")
            if raw_amount >= 2**64:
                raise HTTPException(status_code=400, detail=f"Amount overflow for {r.address}")

            instructions.append(
                build_create_ata_idempotent_ix(payer_pk, recipient_ata, recipient_pk, mint_pk)
            )
            instructions.append(
                build_transfer_checked_ix(
                    source_ata=source_ata,
                    mint=mint_pk,
                    dest_ata=recipient_ata,
                    owner=payer_pk,
                    amount=raw_amount,
                    decimals=payload.decimals,
                )
            )
            recipient_atas.append({"address": r.address, "ata": str(recipient_ata), "amount": str(raw_amount)})

        recent_blockhash = await get_latest_blockhash()
        msg = Message.new_with_blockhash(instructions, payer_pk, recent_blockhash)
        tx = SoldersTransaction.new_unsigned(msg)
        tx_bytes = bytes(tx)

        # Enforce 1232-byte hard cap of Solana wire format
        if len(tx_bytes) > 1232:
            raise HTTPException(
                status_code=400,
                detail=f"Batch too large ({len(tx_bytes)} bytes). Reduce recipients per batch.",
            )

        return {
            "transaction": base64.b64encode(tx_bytes).decode('utf-8'),
            "sourceAta": str(source_ata),
            "recipients": recipient_atas,
            "instructionCount": len(instructions),
            "sizeBytes": len(tx_bytes),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"airdrop/build-batch failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/health")
async def health_check():
    """Liveness + dependency health for production monitoring."""
    health = {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "solana-token-launchpad",
        "checks": {},
    }
    # MongoDB
    try:
        await db.command("ping")
        health["checks"]["mongo"] = "ok"
    except Exception as e:
        health["checks"]["mongo"] = f"fail: {e}"
        health["status"] = "degraded"
    # RPC
    try:
        await get_latest_blockhash()
        health["checks"]["solana_rpc"] = "ok"
    except Exception as e:
        health["checks"]["solana_rpc"] = f"fail: {e}"
        health["status"] = "degraded"
    # IPFS
    health["checks"]["pinata"] = "configured" if PINATA_JWT else "missing"
    return health


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
    max_age=3600,
)

if os.environ.get('CORS_ORIGINS', '*').strip() == '*':
    logger.warning("CORS_ORIGINS is wildcard (*). Set explicit origins in production.")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
