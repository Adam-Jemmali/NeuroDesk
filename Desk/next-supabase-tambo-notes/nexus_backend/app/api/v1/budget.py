"""
Budget API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.services.budget_service import BudgetService
import structlog

logger = structlog.get_logger()

router = APIRouter()


@router.get("/summary")
async def get_budget_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get spending summary for current user"""
    summary = await BudgetService.get_spending_summary(db, current_user.id)
    return summary


@router.post("/check")
async def check_budget(
    amount: float,
    period: str = "daily",  # "daily" or "monthly"
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if spending amount is within budget"""
    if period not in ["daily", "monthly"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Period must be 'daily' or 'monthly'"
        )
    
    is_allowed, error_message = await BudgetService.check_budget(
        db, current_user.id, amount, period
    )
    
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=error_message
        )
    
    return {
        "allowed": True,
        "amount": amount,
        "period": period,
        "message": "Budget check passed"
    }
