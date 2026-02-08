# NEXUS Backend Setup Guide

## Phase 1.1 - Backend Scaffolding ✅

**Created:**
- ✅ FastAPI app structure (`app/`)
- ✅ Docker Compose for Postgres + Redis
- ✅ `.env.example` with all required variables
- ✅ `requirements.txt` with dependencies
- ✅ Health endpoint (`GET /health`)
- ✅ Swagger docs (`/docs`)

## Phase 1.2 - Database Async Setup ✅

**Created:**
- ✅ `app/database.py` - Async SQLAlchemy engine + session dependency
- ✅ `app/config.py` - Pydantic-settings for environment variables
- ✅ `app/exceptions.py` - Custom exception classes
- ✅ Structured logging configured in `app/main.py`

## Phase 1.3 - SQLAlchemy Models ✅

**Created:**
- ✅ `app/models/user.py` - User model
- ✅ `app/models/agent.py` - Agent model (with AgentType, AgentStatus enums)
- ✅ `app/models/task.py` - Task model (with TaskStatus, TaskPriority enums)
- ✅ `app/models/transaction.py` - Transaction model (with TransactionType, TransactionStatus enums)
- ✅ `app/models/audit_log.py` - AuditLog model (with AuditEventType enum)
- ✅ All models exported in `app/models/__init__.py`

## Phase 1.4 - Pydantic Schemas ✅

**Created:**
- ✅ `app/schemas/user.py` - UserCreate, UserUpdate, UserResponse
- ✅ `app/schemas/agent.py` - AgentCreate, AgentUpdate, AgentResponse
- ✅ `app/schemas/task.py` - TaskCreate, TaskUpdate, TaskResponse
- ✅ `app/schemas/transaction.py` - TransactionCreate, TransactionResponse
- ✅ `app/schemas/audit_log.py` - AuditLogResponse
- ✅ `app/schemas/intent.py` - IntentRequest, IntentResult
- ✅ All schemas use `from_attributes=True`

## Phase 1.5 - Alembic Async Migrations ✅

**Created:**
- ✅ `alembic.ini` - Alembic configuration
- ✅ `alembic/env.py` - Async migration environment
- ✅ `alembic/script.py.mako` - Migration template
- ✅ Models imported in `alembic/env.py` for autogenerate

## Quick Start

1. **Navigate to backend directory:**
   ```bash
   cd nexus_backend
   ```

2. **Create virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Copy and configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your database URL (use Supabase or local Postgres)
   ```

5. **Start Docker services:**
   ```bash
   docker-compose up -d
   ```

6. **Run migrations:**
   ```bash
   alembic revision --autogenerate -m "initial"
   alembic upgrade head
   ```

7. **Start the server:**
   ```bash
   uvicorn app.main:app --reload
   ```

8. **Verify:**
   - Health: http://localhost:8000/health
   - Docs: http://localhost:8000/docs

## Database Connection

For **Supabase**, update `.env`:
```
DATABASE_URL=postgresql+asyncpg://postgres:[PASSWORD]@[HOST]:5432/postgres
```

For **local Docker Postgres**:
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/nexus_db
```

## Next Steps

- Implement API routes in `app/api/v1/`
- Implement services in `app/services/`
- Implement agents in `app/agents/`
- Add tests in `tests/`
