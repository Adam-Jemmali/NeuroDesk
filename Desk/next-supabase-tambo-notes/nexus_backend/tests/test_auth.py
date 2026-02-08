"""
Tests for authentication endpoints
"""
import pytest
from httpx import AsyncClient
from app.models.user import User
from app.services.auth_service import (
    create_access_token,
    decode_token,
    verify_password,
    get_password_hash,
    create_refresh_token,
)


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient, db_session):
    """Test successful user registration"""
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "newuser@example.com",
            "password": "securepass123",  # Shorter password to avoid bcrypt 72-byte limit
            "username": "newuser",
        },
    )
    
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert "user" in data
    assert data["user"]["email"] == "newuser@example.com"
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient, test_user: User):
    """Test registration with duplicate email returns 409"""
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": test_user.email,
            "password": "pass123",  # Shorter password
            "username": "anotheruser",
        },
    )
    
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, test_user: User):
    """Test successful login"""
    response = await client.post(
        "/api/v1/auth/login",
        data={
            "email": test_user.email,
            "password": "testpass123",  # Match the test user password
        },
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert "user" in data
    assert data["user"]["email"] == test_user.email
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient, test_user: User):
    """Test login with invalid credentials returns 401"""
    response = await client.post(
        "/api/v1/auth/login",
        data={
            "email": test_user.email,
            "password": "wrongpassword",
        },
    )
    
    assert response.status_code == 401
    assert "incorrect" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    """Test login with non-existent user returns 401"""
    response = await client.post(
        "/api/v1/auth/login",
        data={
            "email": "nonexistent@example.com",
            "password": "password123",
        },
    )
    
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_success(client: AsyncClient, test_user: User):
    """Test successful token refresh"""
    from app.services.auth_service import create_refresh_token
    
    refresh_token = create_refresh_token(data={"sub": str(test_user.id), "email": test_user.email})
    
    response = await client.post(
        "/api/v1/auth/refresh",
        data={"refresh_token": refresh_token},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_refresh_token_invalid(client: AsyncClient):
    """Test refresh with invalid token returns 401"""
    response = await client.post(
        "/api/v1/auth/refresh",
        data={"refresh_token": "invalid_token"},
    )
    
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_endpoint_success(client: AsyncClient, test_user: User, test_user_token: str):
    """Test /me endpoint with valid token"""
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == test_user.email
    assert data["id"] == str(test_user.id)


@pytest.mark.asyncio
async def test_me_endpoint_no_token(client: AsyncClient):
    """Test /me endpoint without token returns 401"""
    response = await client.get("/api/v1/auth/me")
    
    assert response.status_code == 403  # HTTPBearer returns 403 for missing token


@pytest.mark.asyncio
async def test_me_endpoint_invalid_token(client: AsyncClient):
    """Test /me endpoint with invalid token returns 401"""
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid_token"},
    )
    
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_password_hashing():
    """Test password hashing and verification"""
    password = "testpass123"  # Shorter password to avoid bcrypt 72-byte limit
    hashed = get_password_hash(password)
    
    assert hashed != password
    assert verify_password(password, hashed)
    assert not verify_password("wrongpassword", hashed)


@pytest.mark.asyncio
async def test_jwt_token_creation_and_decoding():
    """Test JWT token creation and decoding"""
    from app.services.auth_service import create_access_token
    
    data = {"sub": "123", "email": "test@example.com"}
    token = create_access_token(data)
    
    assert token is not None
    assert isinstance(token, str)
    
    decoded = decode_token(token)
    assert decoded["sub"] == "123"
    assert decoded["email"] == "test@example.com"
    assert decoded["type"] == "access"


@pytest.mark.asyncio
async def test_jwt_token_expiry():
    """Test that expired tokens are rejected"""
    from datetime import timedelta
    from app.services.auth_service import create_access_token
    
    # Create token with very short expiry
    data = {"sub": "123", "email": "test@example.com"}
    token = create_access_token(data, expires_delta=timedelta(seconds=-1))  # Already expired
    
    # Should raise AuthenticationError
    with pytest.raises(Exception):  # JWTError or AuthenticationError
        decode_token(token)
