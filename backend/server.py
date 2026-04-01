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

SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')

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

async def get_latest_blockhash():
    async with aiohttp.ClientSession() as session:
        async with session.post(
            SOLANA_RPC_URL,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "finalized"}]
            }
        ) as resp:
            data = await resp.json()
            if 'result' in data and 'value' in data['result']:
                blockhash_str = data['result']['value']['blockhash']
                return Hash.from_string(blockhash_str)
            raise Exception("Failed to get blockhash")

@api_router.get("/")
async def root():
    return {"message": "Solana Token Launchpad API"}

@api_router.post("/tokens/create")
async def create_token(request: TokenCreationRequest):
    try:
        logger.info(f"Creating token: {request.metadata.name}")
        
        payer_pubkey = Pubkey.from_string(request.payer)
        mint_keypair = Keypair()
        
        recent_blockhash = await get_latest_blockhash()
        
        MINT_SIZE = 82
        lamports_for_mint = 1461600
        
        create_account_ix = create_account(
            CreateAccountParams(
                from_pubkey=payer_pubkey,
                to_pubkey=mint_keypair.pubkey(),
                lamports=lamports_for_mint,
                space=MINT_SIZE,
                owner=TOKEN_PROGRAM_ID
            )
        )
        
        initialize_mint_data = bytes([0]) + \
                               request.metadata.decimals.to_bytes(1, 'little') + \
                               bytes(payer_pubkey) + \
                               bytes([1]) + \
                               bytes(payer_pubkey)
        
        initialize_mint_ix = Instruction(
            program_id=TOKEN_PROGRAM_ID,
            accounts=[
                AccountMeta(pubkey=mint_keypair.pubkey(), is_signer=False, is_writable=True),
                AccountMeta(pubkey=RENT_PROGRAM_ID, is_signer=False, is_writable=False)
            ],
            data=initialize_mint_data
        )
        
        instructions = [create_account_ix, initialize_mint_ix]
        
        msg = Message.new_with_blockhash(
            instructions,
            payer_pubkey,
            recent_blockhash
        )
        
        tx = SoldersTransaction.new_unsigned(msg)
        tx_serialized = bytes(tx)
        mint_secret = bytes(mint_keypair)
        
        mint_address = str(mint_keypair.pubkey())
        
        token_record = TokenRecord(
            mint=mint_address,
            name=request.metadata.name,
            symbol=request.metadata.symbol,
            decimals=request.metadata.decimals,
            total_supply=request.metadata.total_supply,
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
        await db.tokens.insert_one(doc)
        
        return {
            "transaction": base64.b64encode(tx_serialized).decode('utf-8'),
            "mint": mint_address,
            "mintKeypair": base64.b64encode(mint_secret).decode('utf-8'),
            "message": "Transaction ready for signing"
        }
        
    except Exception as e:
        logger.error(f"Error creating token: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/tokens/update-signature")
async def update_token_signature(mint: str, signature: str):
    try:
        await db.tokens.update_one(
            {"mint": mint},
            {"$set": {"transaction_signature": signature}}
        )
        return {"success": True}
    except Exception as e:
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
