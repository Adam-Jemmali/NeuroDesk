"""
Agent schemas
"""
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, List, Dict, Any
from app.models.agent import AgentType, AgentStatus


class AgentBase(BaseModel):
    """Base agent schema"""
    name: str = Field(..., min_length=1, max_length=100)
    agent_type: AgentType
    capabilities: Optional[List[str]] = None
    config: Optional[Dict[str, Any]] = None


class AgentCreate(AgentBase):
    """Schema for creating an agent"""
    pass


class AgentUpdate(BaseModel):
    """Schema for updating an agent"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    status: Optional[AgentStatus] = None
    capabilities: Optional[List[str]] = None
    config: Optional[Dict[str, Any]] = None


class AgentResponse(AgentBase):
    """Schema for agent response"""
    id: UUID
    status: AgentStatus
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
