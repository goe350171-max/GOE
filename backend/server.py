from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import base64
import base58
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import create_account, CreateAccountParams, ID as SYS_PROGRAM_ID
from solders.transaction import Transaction as SoldersTransaction
from solders.message import Message
from solders.hash import Hash
from solders.instruction import Instruction, AccountMeta
from solders.rpc.responses import GetLatestBlockhashResp
import asyncio
import aiohttp

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
RENT_PROGRAM_ID = Pubkey.from_string("SysvarRent111111111111111111111111111111111")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
TOKEN_METADATA_PROGRAM_ID = Pubkey.from_string("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")

SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')

# Log RPC connection at startup (mask API key for security)
rpc_display = SOLANA_RPC_URL.split('api-key=')[0] + 'api-key=***' if 'api-key=' in SOLANA_RPC_URL else SOLANA_RPC_URL
logger.info(f"Solana RPC configured: {rpc_display}")
if 'helius' in SOLANA_RPC_URL.lower():
    logger.info("✓ Using Helius RPC (Mainnet)")
elif 'devnet' in SOLANA_RPC_URL.lower():
    logger.info("⚠ Using Devnet RPC")
else:
    logger.info("Using custom RPC endpoint")

class TokenMetadata(BaseModel):
    name: str
    symbol: str
    decimals: int = 9
    total_supply: int
    description: Optional[str] = None
    image: Optional[str] = None
    logo: Optional[str] = None
    twitter: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None

class TokenCreationRequest(BaseModel):
    payer: str
    metadata: TokenMetadata
    revoke_mint_authority: bool = False
    revoke_freeze_authority: bool = False
    revoke_update_authority: bool = False

class AuthorityRevocationRequest(BaseModel):
    mint: str
    authority_type: str
    payer: str

class AirdropRequest(BaseModel):
    mint: str
    payer: str
    recipients: List[dict]

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
    """Get latest blockhash from Solana RPC with error handling"""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            SOLANA_RPC_URL,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "finalized"}]
            },
            headers={
                "Content-Type": "application/json"
            }
        ) as resp:
            if resp.status == 403:
                raise HTTPException(
                    status_code=503,
                    detail="Solana RPC endpoint rate limit exceeded. Please use a dedicated RPC endpoint (Helius, QuickNode, or Alchemy) for production. Set SOLANA_RPC_URL in backend/.env"
                )
            
            if resp.status != 200:
                error_text = await resp.text()
                raise HTTPException(
                    status_code=503,
                    detail=f"Solana RPC error ({resp.status}): {error_text}"
                )
            
            data = await resp.json()
            if 'result' in data and 'value' in data['result']:
                blockhash_str = data['result']['value']['blockhash']
                return Hash.from_string(blockhash_str)
            
            if 'error' in data:
                raise HTTPException(
                    status_code=503,
                    detail=f"Solana RPC error: {data['error']}"
                )
            
            raise HTTPException(
                status_code=503,
                detail="Failed to get blockhash from Solana RPC"
            )

@api_router.get("/")
async def root():
    return {"message": "Solana Token Launchpad API"}

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
async def create_token(request: TokenCreationRequest):
    try:
        logger.info(f"Creating token: {request.metadata.name}")
        
        payer_pubkey = Pubkey.from_string(request.payer)
        mint_keypair = Keypair()
        mint_pubkey = mint_keypair.pubkey()
        
        recent_blockhash = await get_latest_blockhash()
        
        # --- Derive ATA for creator ---
        ata_pubkey = Pubkey.find_program_address(
            [bytes(payer_pubkey), bytes(TOKEN_PROGRAM_ID), bytes(mint_pubkey)],
            ASSOCIATED_TOKEN_PROGRAM_ID
        )[0]
        
        logger.info(f"  Mint:    {mint_pubkey}")
        logger.info(f"  ATA:     {ata_pubkey}")
        
        # --- Calculate mint amount with BigInt-safe integer math ---
        decimals = request.metadata.decimals
        total_supply = request.metadata.total_supply
        mint_amount = total_supply * (10 ** decimals)
        
        logger.info(f"  Supply:  {total_supply}")
        logger.info(f"  Decimals: {decimals}")
        logger.info(f"  Raw amt: {mint_amount}")
        
        # --- Instruction 1: Create mint account ---
        MINT_SIZE = 82
        lamports_for_mint = 1461600
        
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
        
        # Build the off-chain metadata URI (served by our backend)
        backend_url = os.environ.get('BACKEND_PUBLIC_URL', '')
        if not backend_url:
            # Fallback: use the frontend URL since /api/ routes are proxied
            backend_url = os.environ.get('CORS_ORIGINS', '').split(',')[0].strip()
            if backend_url == '*':
                backend_url = ''
        metadata_uri = f"{backend_url}/api/metadata/{mint_address_str}.json" if backend_url else ""
        
        # If user supplied an image URL, use that as a direct URI hint
        # The on-chain URI points to the JSON metadata endpoint
        logger.info(f"  Metadata PDA: {metadata_pda}")
        logger.info(f"  Metadata URI: {metadata_uri}")
        
        create_metadata_ix = build_create_metadata_v3_ix(
            metadata_pda=metadata_pda,
            mint=mint_pubkey,
            mint_authority=payer_pubkey,
            payer=payer_pubkey,
            update_authority=payer_pubkey,
            name=request.metadata.name,
            symbol=request.metadata.symbol,
            uri=metadata_uri,
            is_mutable=not request.revoke_update_authority,
        )
        
        # --- Build instruction list ---
        instructions = [
            create_account_ix,      # 1. Create mint account
            initialize_mint_ix,     # 2. Initialize mint
            create_metadata_ix,     # 3. Create Metaplex metadata (must be after initMint)
            create_ata_ix,          # 4. Create ATA for creator
            mint_to_ix,             # 5. Mint full supply to creator ATA
        ]
        
        # --- Instruction 5+: Revoke authorities AFTER minting ---
        if request.revoke_mint_authority:
            instructions.append(
                build_set_authority_ix(mint_pubkey, payer_pubkey, 0, None)
            )
            logger.info("  + Revoke mint authority")
        
        if request.revoke_freeze_authority:
            instructions.append(
                build_set_authority_ix(mint_pubkey, payer_pubkey, 1, None)
            )
            logger.info("  + Revoke freeze authority")
        
        # --- Build transaction ---
        msg = Message.new_with_blockhash(
            instructions,
            payer_pubkey,
            recent_blockhash
        )
        
        tx = SoldersTransaction.new_unsigned(msg)
        tx_serialized = bytes(tx)
        mint_secret = bytes(mint_keypair)
        
        mint_address = str(mint_pubkey)
        ata_address = str(ata_pubkey)
        
        # --- Save token record ---
        token_record = TokenRecord(
            mint=mint_address,
            name=request.metadata.name,
            symbol=request.metadata.symbol,
            decimals=decimals,
            total_supply=total_supply,
            description=request.metadata.description,
            image=request.metadata.image,
            logo=request.metadata.logo,
            social_links={
                "twitter": request.metadata.twitter,
                "telegram": request.metadata.telegram,
                "website": request.metadata.website
            },
            creator=request.payer,
            mint_authority_revoked=request.revoke_mint_authority,
            freeze_authority_revoked=request.revoke_freeze_authority,
            update_authority_revoked=request.revoke_update_authority
        )
        
        doc = token_record.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        doc['ata'] = ata_address
        doc['metadata_pda'] = str(metadata_pda)
        doc['metadata_uri'] = metadata_uri
        await db.tokens.insert_one(doc)
        
        logger.info(f"  Transaction built with {len(instructions)} instructions")
        
        return {
            "transaction": base64.b64encode(tx_serialized).decode('utf-8'),
            "mint": mint_address,
            "ata": ata_address,
            "metadataPda": str(metadata_pda),
            "metadataUri": metadata_uri,
            "mintKeypair": base64.b64encode(mint_secret).decode('utf-8'),
            "totalMinted": str(mint_amount),
            "message": "Transaction ready for signing"
        }
        
    except Exception as e:
        logger.error(f"Error creating token: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/tokens/update-signature")
async def update_token_signature(mint: str, signature: str, verified: bool = False, on_chain_supply: str = "0"):
    try:
        update_fields = {
            "transaction_signature": signature,
            "on_chain_verified": verified,
            "on_chain_supply": on_chain_supply,
        }
        await db.tokens.update_one(
            {"mint": mint},
            {"$set": update_fields}
        )
        logger.info(f"Token {mint} updated: sig={signature[:12]}... verified={verified} supply={on_chain_supply}")
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
        tokens = await db.tokens.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
        
        for token in tokens:
            if isinstance(token.get('created_at'), str):
                token['created_at'] = datetime.fromisoformat(token['created_at'])
        
        return tokens
    except Exception as e:
        logger.error(f"Error fetching tokens: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.get("/tokens/{mint}")
async def get_token(mint: str):
    try:
        token = await db.tokens.find_one({"mint": mint}, {"_id": 0})
        if not token:
            raise HTTPException(status_code=404, detail="Token not found")
        
        if isinstance(token.get('created_at'), str):
            token['created_at'] = datetime.fromisoformat(token['created_at'])
        
        return token
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching token: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/tokens/revoke-authority")
async def revoke_authority(request: AuthorityRevocationRequest):
    try:
        payer_pubkey = Pubkey.from_string(request.payer)
        mint_pubkey = Pubkey.from_string(request.mint)
        
        recent_blockhash = await get_latest_blockhash()
        
        authority_type_map = {
            "mint": 0,
            "freeze": 1,
            "owner": 2,
            "close": 3
        }
        
        authority_type_byte = authority_type_map.get(request.authority_type, 0)
        
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
        
        field_name = f"{request.authority_type}_authority_revoked"
        await db.tokens.update_one(
            {"mint": request.mint},
            {"$set": {field_name: True}}
        )
        
        return {
            "transaction": base64.b64encode(bytes(tx)).decode('utf-8'),
            "message": f"{request.authority_type} authority revocation transaction ready"
        }
        
    except Exception as e:
        logger.error(f"Error revoking authority: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
