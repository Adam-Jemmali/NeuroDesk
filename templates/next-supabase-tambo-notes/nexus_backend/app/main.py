"""
FastAPI application entry point
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings
import structlog

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer(),
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events"""
    # Startup
    logger.info("NEXUS is online", version=settings.APP_VERSION, environment=settings.ENVIRONMENT)
    # Initialize database tables if they don't exist
    try:
        # specific timeout for DB init to not block startup too long
        import asyncio
        from app.database import init_db
        
        # Try to init db with a short timeout
        try:
            await asyncio.wait_for(init_db(), timeout=5.0)
            logger.info("Database tables initialized successfully")
        except asyncio.TimeoutError:
            logger.warning("Database initialization timed out - continuing startup without DB connection")
            logger.warning("Some features requiring direct DB access may be unavailable")
    except Exception as e:
        error_msg = str(e)
        # Don't fail startup if tables already exist (common error: "already exists")
        if "already exists" in error_msg.lower() or "duplicate" in error_msg.lower():
            logger.info("Database tables already exist, skipping initialization")
        else:
            logger.warning("Database initialization failed", error=error_msg)
            logger.warning("Tables may need to be created manually. Error will appear on first API call.")
    yield
    # Shutdown
    logger.info("NEXUS is shutting down")
    try:
        from app.database import close_db
        await close_db()
    except Exception:
        pass


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="NEXUS Command Center Backend API",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS middleware
# Ensure localhost:3000 is always included for frontend
cors_origins = settings.cors_origins_list
if "http://localhost:3000" not in cors_origins:
    cors_origins.append("http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler to catch database connection errors"""
    error_msg = str(exc)
    error_type = type(exc).__name__
    
    # Check for database connection errors
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
        logger.error("Database connection error", error=error_msg, path=request.url.path)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "detail": "Database connection failed. Please check your DATABASE_URL in .env file and ensure the database is accessible."
            }
        )
    
    # Let other exceptions be handled normally
    raise exc


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
    }


# Import agents to register them (must be before API router)
from app.agents import ResearchAgent, CommunicationAgent, PurchaseAgent

# Import and include API routers
from app.api.v1 import router as api_router
app.include_router(api_router, prefix=settings.API_V1_PREFIX)
