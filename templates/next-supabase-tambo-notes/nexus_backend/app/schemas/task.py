"""
Task schemas
"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any
from app.models.task import TaskStatus, TaskPriority


class TaskBase(BaseModel):
    """Base task schema"""
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    command: str = Field(..., min_length=1, max_length=500)
    parameters: Optional[Dict[str, Any]] = None
    priority: TaskPriority = TaskPriority.MEDIUM


class TaskCreate(TaskBase):
    """Schema for creating a task"""
    assigned_agent_id: Optional[UUID] = None
    user_message: Optional[str] = None  # If provided, uses Orchestrator/TaskExecutor
    context: Optional[Dict[str, Any]] = None  # Additional context for intent parsing


class TaskUpdate(BaseModel):
    """Schema for updating a task"""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    assigned_agent_id: Optional[UUID] = None


class TaskResponse(TaskBase):
    """Schema for task response"""
    id: UUID
    status: TaskStatus
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    assigned_agent_id: Optional[UUID] = None
    created_by: UUID
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
