"""
Authentication endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.auth_service import (
    authenticate_user,
    create_user,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_user_by_email,
)
from app.schemas.user import UserCreate, UserResponse, UserLogin
from app.api.dependencies import get_current_user
from app.models.user import User
from app.exceptions import ConflictError, AuthenticationError
from datetime import timedelta
from app.config import settings
import structlog

logger = structlog.get_logger()

router = APIRouter()


@router.post("/register", response_model=dict, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new user.
    Returns user data and access/refresh tokens.
    """
    try:
        # Create user
        user = await create_user(
            db=db,
            email=user_data.email,
            password=user_data.password,
            username=user_data.username,
        )
        
        # Create tokens
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email},
            expires_delta=access_token_expires,
        )
        refresh_token = create_refresh_token(
            data={"sub": str(user.id), "email": user.email},
        )
        
        logger.info("User registered", user_id=str(user.id), email=user.email)
        
        return {
            "user": UserResponse.model_validate(user),
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
        }
        
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e.detail),
        )
    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__
        # Check if it's a database connection error
        if "10060" in error_msg or "connect call failed" in error_msg.lower() or "connection" in error_msg.lower() or "operationalerror" in error_type.lower():
            logger.error("Database connection failed", error=error_msg)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database connection failed. Please check your DATABASE_URL in .env file and ensure the database is accessible."
            ) from e
        # Check if it's a DNS resolution error
        if "getaddrinfo failed" in error_msg.lower() or "11001" in error_msg or "gaierror" in error_msg.lower():
            logger.error("DNS resolution failed for database", error=error_msg)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"DNS resolution failed for database hostname. Check your DATABASE_URL in .env file. Error: {error_msg}"
            ) from e
        # Check if it's a password authentication error
        if "password authentication failed" in error_msg.lower() or "asyncpg" in error_msg.lower():
            logger.error("Database authentication failed", error=error_msg)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database authentication failed. Please check your DATABASE_URL password in .env file."
            ) from e
        # Check if it's a table doesn't exist error
        if "does not exist" in error_msg.lower() or "relation" in error_msg.lower() or "table" in error_msg.lower() or "no such table" in error_msg.lower():
            logger.error("Database table missing", error=error_msg)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Database tables not found: {error_msg}. Please run migrations: 'alembic upgrade head' or the server will auto-create them on restart."
            ) from e
        # Re-raise other exceptions with better error message
        logger.error("Unexpected error during registration", error=error_msg, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {error_type}: {error_msg}"
        ) from e


@router.post("/login", response_model=dict)
async def login(
    login_data: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    """
    Login with email and password.
    Returns access and refresh tokens.
    """
    try:
        logger.info("Login attempt", email=login_data.email)
        user = await authenticate_user(db, login_data.email, login_data.password)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Create tokens
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email},
            expires_delta=access_token_expires,
        )
        refresh_token = create_refresh_token(
            data={"sub": str(user.id), "email": user.email},
        )
        
        logger.info("User logged in", user_id=str(user.id), email=user.email)
        
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": UserResponse.model_validate(user),
        }
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__
        logger.error("Login failed", error=error_msg, error_type=error_type, exc_info=True)
        
        # Check for database connection errors (OSError, OperationalError, etc.)
        is_db_error = (
            "10060" in error_msg or 
            "connect call failed" in error_msg.lower() or 
            "connection" in error_msg.lower() or 
            "operationalerror" in error_type.lower() or
            error_type == "OSError" or
            "multiple exceptions" in error_msg.lower() or
            "errno 10060" in error_msg.lower()
        )
        
        if is_db_error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database connection failed. Please check your DATABASE_URL in .env file and ensure the database is accessible. Error: " + error_msg[:200]
            ) from e
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Login failed: {error_type}: {error_msg[:200]}"
        ) from e


@router.post("/refresh", response_model=dict)
async def refresh_token(
    refresh_data: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh access token using refresh token.
    """
    try:
        refresh_token = refresh_data.get("refresh_token")
        if not refresh_token:
            raise AuthenticationError("refresh_token is required")
        payload = decode_token(refresh_token)
        token_type = payload.get("type")
        
        if token_type != "refresh":
            raise AuthenticationError("Invalid token type")
        
        user_id = payload.get("sub")
        if not user_id:
            raise AuthenticationError("Token missing user ID")
        
        # Verify user exists and is active
        user = await get_user_by_email(db, payload.get("email"))
        if not user or not user.is_active:
            raise AuthenticationError("User not found or inactive")
        
        # Create new access token
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email},
            expires_delta=access_token_expires,
        )
        
        logger.info("Token refreshed", user_id=str(user.id))
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
        }
        
    except AuthenticationError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e.detail),
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
):
    """
    Get current authenticated user information.
    Requires Bearer token in Authorization header.
    """
    return UserResponse.model_validate(current_user)
