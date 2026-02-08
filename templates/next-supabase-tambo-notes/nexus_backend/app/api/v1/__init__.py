"""
API v1 routes
"""
from fastapi import APIRouter
from app.api.v1 import auth_simple as auth, tasks, intent, budget, agents, events

router = APIRouter()

# Include route modules
router.include_router(auth.router, prefix="/auth", tags=["authentication"])
router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
router.include_router(intent.router, prefix="/intent", tags=["intent"])
router.include_router(budget.router, prefix="/budget", tags=["budget"])
router.include_router(agents.router, prefix="/agents", tags=["agents"])
router.include_router(events.router, prefix="/events", tags=["events"])

# Future routes
# from app.api.v1 import users, agents, transactions, audit_logs
# router.include_router(users.router, prefix="/users", tags=["users"])
# router.include_router(agents.router, prefix="/agents", tags=["agents"])
# router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
# router.include_router(audit_logs.router, prefix="/audit-logs", tags=["audit-logs"])
