# NEXUS Command Center Backend

FastAPI backend for the NEXUS Command Center application.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Update `.env` with your configuration:**
   - Set `DATABASE_URL` to your Postgres connection string
   - Set `REDIS_URL` if using Redis
   - Configure other settings as needed

4. **Start services with Docker:**
   ```bash
   docker-compose up -d
   ```

5. **Run migrations:**
   ```bash
   alembic upgrade head
   ```

6. **Start the server:**
   ```bash
   uvicorn app.main:app --reload
   ```

## Development

- API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health

## Database Migrations

- Create migration: `alembic revision --autogenerate -m "description"`
- Apply migrations: `alembic upgrade head`
- Rollback: `alembic downgrade -1`
