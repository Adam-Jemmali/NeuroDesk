"""
Database configuration with async SQLAlchemy
"""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.exc import OperationalError
from app.config import settings
import structlog

logger = structlog.get_logger()

# Create async engine with better error handling
if not settings.DATABASE_URL:
    raise ValueError(
        "DATABASE_URL is required. Please set it in your .env file.\n"
        "For Supabase: postgresql+asyncpg://postgres:[PASSWORD]@[PROJECT_REF].supabase.co:5432/postgres\n"
        "Get your connection string from: Supabase Dashboard > Settings > Database > Connection string"
    )

try:
    # Validate DATABASE_URL format before creating engine
    if not settings.DATABASE_URL.startswith(("postgresql://", "postgresql+asyncpg://")):
        raise ValueError("DATABASE_URL must start with 'postgresql://' or 'postgresql+asyncpg://'")
    
    # Extract hostname for validation
    if "@" in settings.DATABASE_URL:
        db_host = settings.DATABASE_URL.split("@")[-1].split("/")[0].split(":")[0]
        if not db_host or db_host == "":
            raise ValueError("DATABASE_URL is missing hostname")
    else:
        raise ValueError("DATABASE_URL format is invalid - missing @ symbol")
    
    # Test DNS resolution and try alternative hostname if needed
    # Skipped to prevent blocking on import
    # import socket
    # dns_resolved = False
    # try:
    #     socket.gethostbyname(db_host)
    #     dns_resolved = True
    #     logger.info(f"DNS resolution successful for {db_host}")
    # except socket.gaierror as dns_err:
    #     logger.warning(f"DNS resolution failed for {db_host}: {dns_err}")
    #     # Try alternative hostname format (without db. prefix)
    #     if db_host.startswith("db."):
    #         alt_host = db_host.replace("db.", "", 1)
    #         try:
    #             socket.gethostbyname(alt_host)
    #             logger.warning(f"DNS failed for {db_host}, but {alt_host} resolves. Updating DATABASE_URL to use {alt_host}")
    #             settings.DATABASE_URL = settings.DATABASE_URL.replace(f"@{db_host}:", f"@{alt_host}:")
    #             db_host = alt_host
    #             logger.info(f"Using alternative hostname: {alt_host}")
    #         except socket.gaierror:
    #             logger.error(f"Both hostnames failed: {db_host} and {alt_host}")
    
    # Supabase requires SSL - configure for asyncpg
    # asyncpg requires SSL to be configured via connect_args, not URL parameters
    connect_args = {}
    if "supabase.co" in db_host:
        # For asyncpg, SSL is configured via connect_args
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False  # Supabase uses self-signed certs
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = ssl_context
        logger.info("Configured SSL for Supabase connection (asyncpg)")
    
    # Clean up URL - remove any sslmode or ssl query parameters (not used by asyncpg)
    import re
    db_url_clean = re.sub(r'[?&]sslmode=[^&]*', '', settings.DATABASE_URL)
    db_url_clean = re.sub(r'[?&]ssl=[^&]*', '', db_url_clean)
    # Remove trailing ? if no other params
    db_url_clean = db_url_clean.rstrip('?')
    
    engine = create_async_engine(
        db_url_clean,
        echo=settings.DEBUG,
        future=True,
        pool_pre_ping=True,
        pool_size=3,  # Small pool for Supabase
        max_overflow=5,
        pool_timeout=30,  # Timeout for getting connection from pool
        connect_args=connect_args,
    )
    logger.info("Database engine created", database_host=db_host)
except ValueError as e:
    # Re-raise ValueError as-is (these are our validation errors)
    raise
except Exception as e:
    error_msg = str(e)
    logger.error("Failed to create database engine", error=error_msg)
    
    # Check for connection timeout errors (Windows error 10060)
    if "10060" in error_msg or "connect call failed" in error_msg.lower() or "connection timed out" in error_msg.lower() or "multiple exceptions" in error_msg.lower():
        db_host = settings.DATABASE_URL.split("@")[-1].split("/")[0].split(":")[0] if "@" in settings.DATABASE_URL else "unknown"
        raise ValueError(
            f"Connection timeout to database host: {db_host}\n"
            "This usually means:\n"
            "1. Supabase requires SSL connection - add ?sslmode=require to your DATABASE_URL\n"
            "2. Port 5432 is blocked by firewall\n"
            "3. Your IP is not whitelisted in Supabase (check Supabase Dashboard > Settings > Database)\n"
            "4. Network connectivity issue\n"
            f"Current DATABASE_URL host: {db_host}\n"
            "Fix: Add SSL mode to your DATABASE_URL in .env:\n"
            "DATABASE_URL=postgresql+asyncpg://postgres:PASSWORD@HOST:5432/postgres?sslmode=require"
        ) from e
    
    # Check for DNS resolution errors
    if "getaddrinfo failed" in error_msg or "11001" in error_msg or "gaierror" in error_msg.lower():
        db_host = settings.DATABASE_URL.split("@")[-1].split("/")[0].split(":")[0] if "@" in settings.DATABASE_URL else "unknown"
        # Check if password has brackets (common mistake when copying from Supabase)
        has_bracket_password = "[YOUR-PASSWORD]" in settings.DATABASE_URL or (settings.DATABASE_URL.count("[") > 0 and settings.DATABASE_URL.count("]") > 0)
        bracket_warning = "\n⚠️ WARNING: Your DATABASE_URL contains brackets [ ] around the password. Remove them!" if has_bracket_password else ""
        
        raise ValueError(
            f"DNS resolution failed for database hostname: {db_host}\n"
            "This usually means:\n"
            "1. The hostname in DATABASE_URL is incorrect\n"
            "2. Your internet connection is down\n"
            "3. The Supabase project hostname is wrong\n"
            f"Current DATABASE_URL host: {db_host}\n"
            "For Supabase, the hostname format should be: db.[PROJECT_REF].supabase.co or [PROJECT_REF].supabase.co\n"
            f"{bracket_warning}\n"
            "Steps to fix:\n"
            "1. Copy connection string from Supabase Dashboard > Settings > Database\n"
            "2. Change 'postgresql://' to 'postgresql+asyncpg://' at the start\n"
            "3. Remove any brackets [ ] around the password\n"
            "4. Make sure your .env file has the correct format"
        ) from e
    
    raise ValueError(
        f"Failed to create database engine: {error_msg}\n"
        "Please check your DATABASE_URL in .env file.\n"
        "For Supabase, ensure the connection string is correct and the database is accessible."
    ) from e

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models"""
    pass


async def get_db() -> AsyncSession:
    """
    Dependency for getting database session
    Usage: async with get_db() as session:
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Initialize database (create tables)"""
    # Import all models to register them with Base.metadata
    from app.models.user import User
    from app.models.task import Task
    from app.models.transaction import Transaction
    from app.models.audit_log import AuditLog
    from app.models.agent import Agent
    
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables created successfully")
    except Exception as e:
        error_msg = str(e)
        # If tables already exist, that's fine
        if "already exists" in error_msg.lower() or "duplicate" in error_msg.lower():
            logger.info("Database tables already exist")
        else:
            logger.error("Failed to create database tables", error=error_msg)
            raise


async def close_db():
    """Close database connections"""
    await engine.dispose()
    logger.info("Database connections closed")
