"""
Audit log schemas
"""
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any
from app.models.audit_log import AuditEventType


class AuditLogResponse(BaseModel):
    """Schema for audit log response"""
    id: UUID
    event_type: AuditEventType
    event_name: str
    description: Optional[str] = None
    user_id: Optional[UUID] = None
    agent_id: Optional[UUID] = None
    task_id: Optional[UUID] = None
    transaction_id: Optional[UUID] = None
    extra_metadata: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
