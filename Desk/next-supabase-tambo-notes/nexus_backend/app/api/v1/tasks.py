"""
Tasks API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import List, Optional
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.task import Task, TaskStatus, TaskPriority
from app.schemas.task import TaskCreate, TaskUpdate, TaskResponse
from app.exceptions import NotFoundError
from app.services.policy_service import PolicyService
import structlog

logger = structlog.get_logger()

router = APIRouter()


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    task_data: TaskCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new task.
    If task_data contains 'user_message', it will be executed via TaskExecutor.
    Otherwise, creates a manual task.
    """
    from app.services.task_executor import TaskExecutor
    
    # Extract IP address and user agent
    headers_dict = dict(request.headers)
    ip_address = PolicyService.extract_ip_address(headers_dict, request.client.host if request.client else None)
    user_agent = headers_dict.get("User-Agent", "")
    
    # If user_message is provided, use TaskExecutor for full workflow
    if hasattr(task_data, 'user_message') and task_data.user_message:
        user_message = task_data.user_message
        context = getattr(task_data, 'context', None)
        
        try:
            task = await TaskExecutor.execute_task(
                db, current_user.id, user_message, context, ip_address, user_agent
            )
            return TaskResponse.model_validate(task)
        except ValueError as e:
            # Input validation error
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        except Exception as e:
            # Sanitize error message
            sanitized_error = PolicyService.sanitize_error_message(e)
            logger.error("Task creation failed", error=sanitized_error, user_id=str(current_user.id))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=sanitized_error
            )
    
    # Manual task creation (legacy)
    task = Task(
        title=task_data.title,
        description=task_data.description,
        command=task_data.command,
        parameters=task_data.parameters,
        priority=task_data.priority,
        assigned_agent_id=task_data.assigned_agent_id,
        created_by=current_user.id,
        status=TaskStatus.PENDING,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    
    logger.info("Task created", task_id=str(task.id), user_id=str(current_user.id))
    return TaskResponse.model_validate(task)


@router.get("", response_model=List[TaskResponse])
async def list_tasks(
    status_filter: Optional[TaskStatus] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List tasks for the current user"""
    query = select(Task).where(Task.created_by == current_user.id)
    
    if status_filter:
        query = query.where(Task.status == status_filter)
    
    query = query.order_by(Task.created_at.desc()).limit(limit).offset(offset)
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    
    return [TaskResponse.model_validate(task) for task in tasks]


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific task by ID"""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.created_by == current_user.id)
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    
    return TaskResponse.model_validate(task)


@router.post("/{task_id}/approve", response_model=TaskResponse)
async def approve_task(
    task_id: UUID,
    notes: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Approve a task (changes status from PENDING to IN_PROGRESS)"""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.created_by == current_user.id)
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    
    if task.status != TaskStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task must be PENDING to approve, current status: {task.status}"
        )
    
    task.status = TaskStatus.IN_PROGRESS
    task.started_at = datetime.utcnow()
    
    # Store approval notes in result metadata
    if notes:
        if task.result is None:
            task.result = {}
        task.result["approval_notes"] = notes
        task.result["approved_by"] = str(current_user.id)
        task.result["approved_at"] = datetime.utcnow().isoformat()
    
    await db.commit()
    await db.refresh(task)
    
    logger.info("Task approved", task_id=str(task.id), user_id=str(current_user.id))
    return TaskResponse.model_validate(task)


@router.post("/{task_id}/verify", response_model=TaskResponse)
async def verify_task(
    task_id: UUID,
    verified: bool = True,
    notes: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify task completion (marks as COMPLETED or FAILED)"""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.created_by == current_user.id)
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    
    if task.status not in [TaskStatus.IN_PROGRESS, TaskStatus.PENDING]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task must be IN_PROGRESS or PENDING to verify, current status: {task.status}"
        )
    
    if verified:
        task.status = TaskStatus.COMPLETED
    else:
        task.status = TaskStatus.FAILED
        if notes:
            task.error_message = notes
    
    task.completed_at = datetime.utcnow()
    
    # Store verification notes
    if notes:
        if task.result is None:
            task.result = {}
        task.result["verification_notes"] = notes
        task.result["verified_by"] = str(current_user.id)
        task.result["verified_at"] = datetime.utcnow().isoformat()
    
    await db.commit()
    await db.refresh(task)
    
    logger.info("Task verified", task_id=str(task.id), verified=verified, user_id=str(current_user.id))
    return TaskResponse.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a task (only if PENDING or FAILED)"""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.created_by == current_user.id)
    )
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    
    if task.status in [TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete task with status {task.status}"
        )
    
    await db.delete(task)
    await db.commit()
    
    return None
    
    logger.info("Task deleted", task_id=str(task.id), user_id=str(current_user.id))
