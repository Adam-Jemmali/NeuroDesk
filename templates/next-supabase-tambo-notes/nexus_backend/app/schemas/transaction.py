"""
Transaction schemas
"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any
from decimal import Decimal
from app.models.transaction import TransactionType, TransactionStatus


class TransactionBase(BaseModel):
    """Base transaction schema"""
    transaction_type: TransactionType
    task_id: Optional[UUID] = None
    request_data: Optional[Dict[str, Any]] = None
    extra_metadata: Optional[Dict[str, Any]] = None


class TransactionCreate(TransactionBase):
    """Schema for creating a transaction"""
    pass


class TransactionResponse(TransactionBase):
    """Schema for transaction response"""
    id: UUID
    status: TransactionStatus
    response_data: Optional[Dict[str, Any]] = None
    error_data: Optional[Dict[str, Any]] = None
    cost: Optional[Decimal] = None
    extra_metadata: Optional[Dict[str, Any]] = None
    created_by: UUID
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
