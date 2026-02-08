"""
Pytest configuration and fixtures
"""
# Patch passlib's bcrypt bug detection before any imports
# This prevents the 72-byte password limit error during bcrypt initialization
try:
    import passlib.handlers.bcrypt as bcrypt_module
    
    # Patch the _finalize_backend_mixin to skip bug detection
    original_finalize = bcrypt_module._BcryptBackendMixin._finalize_backend_mixin
    
    @classmethod
    def patched_finalize_backend_mixin(cls, name, dryrun=False):
        """Patched version that skips bug detection"""
        # Call parent but skip the bug detection step
        from passlib.utils.handlers import SubclassBackendMixin
        return SubclassBackendMixin._finalize_backend_mixin(cls, name, dryrun)
    
    bcrypt_module._BcryptBackendMixin._finalize_backend_mixin = patched_finalize_backend_mixin
except Exception:
    # If patching fails, try simpler approach
    try:
        def patched_detect_wrap_bug(ident):
            return False
        bcrypt_module.detect_wrap_bug = patched_detect_wrap_bug
    except Exception:
        pass

import pytest
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.config import settings
from app.models.user import User
from app.services.auth_service import create_user, create_access_token
from httpx import AsyncClient
from app.main import app
import uuid


# Test database URL (in-memory SQLite for testing)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


# Remove custom event_loop fixture - pytest-asyncio handles this automatically


@pytest.fixture(scope="function")
async def test_db():
    """Create a test database with all tables."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session_maker = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session_maker() as session:
        yield session
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    
    await engine.dispose()


@pytest.fixture
async def db_session(test_db: AsyncSession):
    """Provide a database session for tests."""
    yield test_db
    await test_db.rollback()


@pytest.fixture
async def override_get_db(db_session: AsyncSession):
    """Override the get_db dependency with test database."""
    async def _get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = _get_db
    yield db_session
    app.dependency_overrides.clear()


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = await create_user(
        db=db_session,
        email="test@example.com",
        password="testpass123",  # Shorter password to avoid bcrypt 72-byte limit
        username="testuser",
    )
    return user


@pytest.fixture
async def test_user_token(test_user: User) -> str:
    """Create an access token for test user."""
    return create_access_token(data={"sub": str(test_user.id), "email": test_user.email})


@pytest.fixture
async def client(override_get_db: AsyncSession) -> AsyncClient:
    """Create a test HTTP client."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
