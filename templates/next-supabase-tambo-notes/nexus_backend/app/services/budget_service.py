"""
Budget Service for tracking and enforcing spending limits
"""
from datetime import datetime, date
from typing import Optional, Dict, Any
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.transaction import Transaction, TransactionStatus
from app.config import settings
import structlog

logger = structlog.get_logger()


class BudgetService:
    """Service for managing budget limits and spending tracking"""
    
    @staticmethod
    async def check_budget(
        db: AsyncSession,
        user_id: UUID,
        amount: float,
        period: str = "daily"  # "daily" or "monthly"
    ) -> tuple[bool, Optional[str]]:
        """
        Check if spending amount is within budget limits.
        Returns (is_allowed, error_message)
        """
        if period == "daily":
            limit = settings.DAILY_BUDGET_LIMIT
            start_date = date.today()
            end_date = start_date
        elif period == "monthly":
            limit = settings.MONTHLY_BUDGET_LIMIT
            start_date = date.today().replace(day=1)
            end_date = date.today()
        else:
            return False, f"Invalid period: {period}"
        
        # Calculate current spending
        current_spending = await BudgetService.get_spending(
            db, user_id, start_date, end_date
        )
        
        if current_spending + amount > limit:
            return False, f"Budget limit exceeded. Current: ${current_spending:.2f}, Requested: ${amount:.2f}, Limit: ${limit:.2f}"
        
        return True, None
    
    @staticmethod
    async def get_spending(
        db: AsyncSession,
        user_id: UUID,
        start_date: date,
        end_date: date
    ) -> float:
        """Get total spending for a user in a date range"""
        result = await db.execute(
            select(func.coalesce(func.sum(Transaction.cost), 0))
            .where(
                and_(
                    Transaction.created_by == user_id,
                    Transaction.status == TransactionStatus.SUCCESS,
                    func.date(Transaction.created_at) >= start_date,
                    func.date(Transaction.created_at) <= end_date,
                )
            )
        )
        total = result.scalar() or 0.0
        return float(total)
    
    @staticmethod
    async def record_spending(
        db: AsyncSession,
        user_id: UUID,
        amount: float,
        transaction_id: Optional[UUID] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """Record a spending transaction"""
        # This is handled by Transaction model, but we can add logging here
        logger.info(
            "Spending recorded",
            user_id=user_id,
            amount=amount,
            transaction_id=transaction_id
        )
    
    @staticmethod
    async def get_spending_summary(
        db: AsyncSession,
        user_id: UUID
    ) -> Dict[str, Any]:
        """Get spending summary for a user"""
        today = date.today()
        month_start = today.replace(day=1)
        
        daily_spending = await BudgetService.get_spending(db, user_id, today, today)
        monthly_spending = await BudgetService.get_spending(db, user_id, month_start, today)
        
        return {
            "daily_spending": daily_spending,
            "daily_limit": settings.DAILY_BUDGET_LIMIT,
            "daily_remaining": max(0, settings.DAILY_BUDGET_LIMIT - daily_spending),
            "monthly_spending": monthly_spending,
            "monthly_limit": settings.MONTHLY_BUDGET_LIMIT,
            "monthly_remaining": max(0, settings.MONTHLY_BUDGET_LIMIT - monthly_spending),
            "date": today.isoformat(),
        }
    
    @staticmethod
    async def reset_daily_budget(db: AsyncSession) -> None:
        """
        Placeholder for daily budget reset.
        In production, this would be called by a scheduled job (e.g., cron, Celery).
        """
        logger.info("Daily budget reset (placeholder - should be called by scheduler)")
