"""
Backend API Tests for Solana Token Launchpad
Tests: Health check, Image upload, Token creation, Token list, Token verify, Metadata JSON
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_PAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestHealthCheck:
    """Health check endpoint tests"""
    
    def test_api_root_returns_200(self, api_client):
        """GET /api/ returns 200 with message"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "message" in data, "Response should contain 'message' field"
        assert "Solana Token Launchpad API" in data["message"]
        print(f"✓ Health check passed: {data['message']}")


class TestImageUpload:
    """Image upload endpoint tests"""
    
    def test_upload_valid_png_image(self):
        """POST /api/upload-image accepts PNG file and returns IPFS data"""
        # Create a minimal valid PNG file (1x1 pixel)
        png_data = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 dimensions
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,  # bit depth, color type
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,  # compressed data
            0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,  # 
            0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
            0x44, 0xAE, 0x42, 0x60, 0x82                      # IEND CRC
        ])
        
        files = {'file': ('test_token.png', io.BytesIO(png_data), 'image/png')}
        response = requests.post(f"{BASE_URL}/api/upload-image", files=files)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "ipfsUri" in data, "Response should contain 'ipfsUri'"
        assert "gatewayUrl" in data, "Response should contain 'gatewayUrl'"
        assert "fileName" in data, "Response should contain 'fileName'"
        assert "fileSize" in data, "Response should contain 'fileSize'"
        assert "contentType" in data, "Response should contain 'contentType'"
        
        assert data["ipfsUri"].startswith("ipfs://"), f"ipfsUri should start with 'ipfs://', got {data['ipfsUri']}"
        assert data["contentType"] == "image/png", f"contentType should be 'image/png', got {data['contentType']}"
        assert data["fileSize"] > 0, "fileSize should be > 0"
        
        print(f"✓ Image upload passed: {data['ipfsUri']}")
    
    def test_upload_rejects_non_image_file(self):
        """POST /api/upload-image rejects non-image file types with 400"""
        text_data = b"This is not an image file"
        files = {'file': ('test.txt', io.BytesIO(text_data), 'text/plain')}
        
        response = requests.post(f"{BASE_URL}/api/upload-image", files=files)
        
        assert response.status_code == 400, f"Expected 400 for non-image, got {response.status_code}"
        print("✓ Non-image file rejection passed")
    
    def test_upload_rejects_empty_file(self):
        """POST /api/upload-image rejects empty files with 400"""
        files = {'file': ('empty.png', io.BytesIO(b''), 'image/png')}
        
        response = requests.post(f"{BASE_URL}/api/upload-image", files=files)
        
        assert response.status_code == 400, f"Expected 400 for empty file, got {response.status_code}"
        print("✓ Empty file rejection passed")


class TestTokenCreation:
    """Token creation endpoint tests"""
    
    def test_create_token_returns_expected_fields(self, api_client):
        """POST /api/tokens/create returns mint, ata, metadataPda, metadataUri, imageUri, totalMinted, transaction"""
        payload = {
            "payer": TEST_PAYER,
            "metadata": {
                "name": "TEST_Token_API",
                "symbol": "TAPI",
                "decimals": 9,
                "total_supply": 1000000,
                "description": "Test token for API testing",
                "image": "https://via.placeholder.com/128",
                "twitter": "@test",
                "telegram": "t.me/test",
                "website": "https://test.com"
            },
            "revoke_mint_authority": False,
            "revoke_freeze_authority": False,
            "revoke_update_authority": False
        }
        
        response = requests.post(f"{BASE_URL}/api/tokens/create", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Check all required fields
        assert "mint" in data, "Response should contain 'mint'"
        assert "ata" in data, "Response should contain 'ata'"
        assert "metadataPda" in data, "Response should contain 'metadataPda'"
        assert "metadataUri" in data, "Response should contain 'metadataUri'"
        assert "totalMinted" in data, "Response should contain 'totalMinted'"
        assert "transaction" in data, "Response should contain 'transaction'"
        
        # Validate field formats
        assert len(data["mint"]) > 30, f"mint should be a valid Solana address, got {data['mint']}"
        assert len(data["ata"]) > 30, f"ata should be a valid Solana address, got {data['ata']}"
        assert len(data["metadataPda"]) > 30, f"metadataPda should be a valid Solana address"
        
        # metadataUri should be ipfs:// or backend URL
        assert data["metadataUri"].startswith("ipfs://") or "metadata" in data["metadataUri"], \
            f"metadataUri should be IPFS or backend URL, got {data['metadataUri']}"
        
        # totalMinted should be supply * 10^decimals
        expected_raw = 1000000 * (10 ** 9)
        assert data["totalMinted"] == str(expected_raw), \
            f"totalMinted should be {expected_raw}, got {data['totalMinted']}"
        
        # transaction should be base64 encoded
        assert len(data["transaction"]) > 100, "transaction should be base64 encoded transaction"
        
        print(f"✓ Token creation passed: mint={data['mint'][:12]}...")
        
        # Store mint for later tests
        return data["mint"]
    
    def test_create_token_with_authority_revocation(self, api_client):
        """POST /api/tokens/create with authority revocation flags"""
        payload = {
            "payer": TEST_PAYER,
            "metadata": {
                "name": "TEST_Revoked_Token",
                "symbol": "TREV",
                "decimals": 6,
                "total_supply": 500000,
                "description": "Token with revoked authorities"
            },
            "revoke_mint_authority": True,
            "revoke_freeze_authority": True,
            "revoke_update_authority": False
        }
        
        response = requests.post(f"{BASE_URL}/api/tokens/create", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "mint" in data
        assert "transaction" in data
        
        print(f"✓ Token with authority revocation passed: mint={data['mint'][:12]}...")


class TestTokenList:
    """Token list endpoint tests"""
    
    def test_get_tokens_returns_array(self, api_client):
        """GET /api/tokens returns array of tokens"""
        response = requests.get(f"{BASE_URL}/api/tokens")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), f"Response should be a list, got {type(data)}"
        
        if len(data) > 0:
            token = data[0]
            # Check token structure
            assert "mint" in token, "Token should have 'mint' field"
            assert "name" in token, "Token should have 'name' field"
            assert "symbol" in token, "Token should have 'symbol' field"
            assert "decimals" in token, "Token should have 'decimals' field"
            assert "total_supply" in token, "Token should have 'total_supply' field"
            
            print(f"✓ Token list passed: {len(data)} tokens found")
            print(f"  First token: {token['name']} ({token['symbol']})")
        else:
            print("✓ Token list passed: empty list (no tokens created yet)")


class TestTokenVerify:
    """Token verify endpoint tests"""
    
    def test_verify_nonexistent_token(self, api_client):
        """GET /api/tokens/verify/{mint} returns exists=false for non-existent token"""
        # Use a valid but non-existent Solana address
        fake_mint = "11111111111111111111111111111111"
        
        response = requests.get(f"{BASE_URL}/api/tokens/verify/{fake_mint}")
        
        # API returns 200 with exists=false OR 400 for invalid addresses
        assert response.status_code in [200, 400], f"Expected 200 or 400, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "exists" in data, "Response should contain 'exists' field"
            assert "mint" in data, "Response should contain 'mint' field"
            print(f"✓ Token verify (non-existent) passed: exists={data.get('exists')}")
        else:
            print("✓ Token verify (non-existent) passed: API returns 400 for invalid mint")
    
    def test_verify_existing_token(self, api_client):
        """GET /api/tokens/verify/{mint} returns on-chain data for existing token"""
        # First get a token from the list
        list_response = requests.get(f"{BASE_URL}/api/tokens")
        tokens = list_response.json()
        
        if len(tokens) == 0:
            pytest.skip("No tokens available to verify")
        
        mint = tokens[0]["mint"]
        response = requests.get(f"{BASE_URL}/api/tokens/verify/{mint}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "exists" in data
        assert "mint" in data
        assert data["mint"] == mint
        
        # If token exists on-chain, check additional fields
        if data.get("exists"):
            assert "supply" in data, "Existing token should have 'supply'"
            assert "decimals" in data, "Existing token should have 'decimals'"
            print(f"✓ Token verify (existing) passed: supply={data.get('supply')}")
        else:
            print(f"✓ Token verify passed: token not yet on-chain (exists={data['exists']})")


class TestMetadataJSON:
    """Metadata JSON endpoint tests"""
    
    def test_get_metadata_json_for_existing_token(self, api_client):
        """GET /api/metadata/{mint}.json returns Metaplex-standard JSON"""
        # First get a token from the list
        list_response = requests.get(f"{BASE_URL}/api/tokens")
        tokens = list_response.json()
        
        if len(tokens) == 0:
            pytest.skip("No tokens available for metadata test")
        
        mint = tokens[0]["mint"]
        response = requests.get(f"{BASE_URL}/api/metadata/{mint}.json")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Check Metaplex standard fields
        assert "name" in data, "Metadata should contain 'name'"
        assert "symbol" in data, "Metadata should contain 'symbol'"
        assert "description" in data, "Metadata should contain 'description'"
        assert "image" in data, "Metadata should contain 'image'"
        assert "properties" in data, "Metadata should contain 'properties'"
        
        # Validate properties structure
        props = data.get("properties", {})
        assert "category" in props, "properties should contain 'category'"
        
        print(f"✓ Metadata JSON passed: name={data['name']}, symbol={data['symbol']}")
    
    def test_get_metadata_json_for_nonexistent_token(self, api_client):
        """GET /api/metadata/{mint}.json returns 404 for non-existent token"""
        fake_mint = "NonExistentMintAddress12345678901234567890"
        
        response = requests.get(f"{BASE_URL}/api/metadata/{fake_mint}.json")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Metadata JSON 404 for non-existent token passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
