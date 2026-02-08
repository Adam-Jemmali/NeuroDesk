"""
Approval Service for managing task approvals
"""
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.task import Task, TaskStatus
from app.models.transaction import Transaction, TransactionType, TransactionStatus
from app.schemas.intent import IntentResult
import structlog

logger = structlog.get_logger()


class ApprovalService:
    """Service for managing task approvals"""
    
    @staticmethod
    async def create_approval_request(
        db: AsyncSession,
        task_id: UUID,
        intent_result: IntentResult,
        user_id: UUID
    ) -> Dict[str, Any]:
        """
        Create an approval request for a task based on intent result.
        Stores approval metadata in task.result.
        """
        result = await db.execute(
            select(Task).where(Task.id == task_id)
        )
        task = result.scalar_one_or_none()
        
        if not task:
            raise ValueError(f"Task {task_id} not found")
        
        # Store approval request metadata in task.result
        if task.result is None:
            task.result = {}
        
        task.result["approval_request"] = {
            "requires_approval": intent_result.requires_approval,
            "risk_level": intent_result.risk_level,
            "estimated_cost": intent_result.estimated_cost,
            "intent": intent_result.intent,
            "confidence": intent_result.confidence,
            "requested_at": datetime.utcnow().isoformat(),
            "requested_by": str(user_id),
        }
        
        # If approval is required, keep task in PENDING status
        # Otherwise, can auto-approve
        if intent_result.requires_approval:
            task.status = TaskStatus.PENDING
            logger.info("Approval requested", task_id=task_id, risk_level=intent_result.risk_level)
        else:
            task.status = TaskStatus.IN_PROGRESS
            task.started_at = datetime.utcnow()
            logger.info("Task auto-approved", task_id=task_id)
        
        await db.commit()
        await db.refresh(task)
        
        return {
            "task_id": str(task.id),
            "requires_approval": intent_result.requires_approval,
            "status": task.status.value,
            "approval_metadata": task.result.get("approval_request", {}),
        }
    
    @staticmethod
    async def approve_task(
        db: AsyncSession,
        task_id: UUID,
        user_id: UUID,
        notes: Optional[str] = None
    ) -> Task:
        """Approve a task and update its status"""
        result = await db.execute(
            select(Task).where(Task.id == task_id)
        )
        task = result.scalar_one_or_none()
        
        if not task:
            raise ValueError(f"Task {task_id} not found")
        
        if task.status != TaskStatus.PENDING:
            raise ValueError(f"Task must be PENDING to approve, current status: {task.status}")
        
        # Update task status
        task.status = TaskStatus.IN_PROGRESS
        task.started_at = datetime.utcnow()
        
        # Store approval record
        if task.result is None:
            task.result = {}
        
        if "approval_request" in task.result:
            task.result["approval_request"]["approved"] = True
            task.result["approval_request"]["approved_at"] = datetime.utcnow().isoformat()
            task.result["approval_request"]["approved_by"] = str(user_id)
            if notes:
                task.result["approval_request"]["approval_notes"] = notes
        
        await db.commit()
        await db.refresh(task)
        
        logger.info("Task approved", task_id=task_id, approved_by=user_id)
        return task
    
    @staticmethod
    async def reject_task(
        db: AsyncSession,
        task_id: UUID,
        user_id: UUID,
        reason: str
    ) -> Task:
        """Reject a task approval request"""
        result = await db.execute(
            select(Task).where(Task.id == task_id)
        )
        task = result.scalar_one_or_none()
        
        if not task:
            raise ValueError(f"Task {task_id} not found")
        
        if task.status != TaskStatus.PENDING:
            raise ValueError(f"Task must be PENDING to reject, current status: {task.status}")
        
        # Update task status to cancelled
        task.status = TaskStatus.CANCELLED
        task.error_message = f"Rejected: {reason}"
        
        # Store rejection record
        if task.result is None:
            task.result = {}
        
        if "approval_request" in task.result:
            task.result["approval_request"]["approved"] = False
            task.result["approval_request"]["rejected_at"] = datetime.utcnow().isoformat()
            task.result["approval_request"]["rejected_by"] = str(user_id)
            task.result["approval_request"]["rejection_reason"] = reason
        
        await db.commit()
        await db.refresh(task)
        
        logger.info("Task rejected", task_id=task_id, rejected_by=user_id, reason=reason)
        return task
    
    @staticmethod
    async def get_pending_approvals(
        db: AsyncSession,
        user_id: UUID
    ) -> list[Task]:
        """Get all pending approval tasks for a user"""
        result = await db.execute(
            select(Task)
            .where(
                Task.created_by == user_id,
                Task.status == TaskStatus.PENDING
            )
            .order_by(Task.created_at.desc())
        )
        tasks = result.scalars().all()
        return list(tasks)
