"""
Simplified Authentication endpoints using Supabase Auth API
No database connection required
"""
from fastapi import APIRouter, HTTPException, status, Depends, Header
from pydantic import BaseModel, EmailStr
from app.services.supabase_auth import supabase_auth
from app.config import settings
import structlog

logger = structlog.get_logger()

router = APIRouter()


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    username: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister):
    """
    Register a new user using Supabase Auth API
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase authentication is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY in .env"
        )
    
    try:
        result = await supabase_auth.sign_up(
            email=user_data.email,
            password=user_data.password,
            username=user_data.username
        )
        
        # Extract tokens and user data
        session = result.get("session", {})
        user = result.get("user", {})
        
        return {
            "access_token": session.get("access_token"),
            "refresh_token": session.get("refresh_token"),
            "token_type": "bearer",
            "user": {
                "id": user.get("id"),
                "email": user.get("email"),
                "username": user.get("user_metadata", {}).get("username"),
                "is_active": True
            }
        }
    except Exception as e:
        error_msg = str(e)
        logger.error("Registration failed", error=error_msg)
        
        # Check for common errors
        if "already registered" in error_msg.lower() or"user already exists" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists"
            )
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {error_msg}"
        )


@router.post("/login")
async def login(login_data: UserLogin):
    """
    Login using Supabase Auth API
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase authentication is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY in .env"
        )
    
    try:
        result = await supabase_auth.sign_in(
            email=login_data.email,
            password=login_data.password
        )
        
        if not result:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"}
            )
        
        # Extract tokens and user data
        user = result.get("user", {})
        
        return {
            "access_token": result.get("access_token"),
            "refresh_token": result.get("refresh_token"),
            "token_type": "bearer",
            "user": {
                "id": user.get("id"),
                "email": user.get("email"),
                "username": user.get("user_metadata", {}).get("username"),
                "is_active": True
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error("Login failed", error=error_msg)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Login failed: {error_msg}"
        )


@router.post("/refresh")
async def refresh_token(refresh_data: RefreshTokenRequest):
    """
    Refresh access token using refresh token
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase authentication is not configured"
        )
    
    try:
        result = await supabase_auth.refresh_token(refresh_data.refresh_token)
        
        if not result:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token",
                headers={"WWW-Authenticate": "Bearer"}
            )
        
        return {
            "access_token": result.get("access_token"),
            "token_type": "bearer"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Token refresh failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Token refresh failed: {str(e)}"
        )


@router.get("/me")
async def get_current_user_info(authorization: str = Header(None)):
    """
    Get current user information
    Requires Bearer token in Authorization header
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase authentication is not configured"
        )
    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"}
        )
            
    token = authorization.split(" ")[1]
    
    try:
        user = await supabase_auth.get_user(token)
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
                headers={"WWW-Authenticate": "Bearer"}
            )
        
        return {
            "id": user.get("id"),
            "email": user.get("email"),
            "username": user.get("user_metadata", {}).get("username"),
            "is_active": True
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get user info", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get user info: {str(e)}"
        )
