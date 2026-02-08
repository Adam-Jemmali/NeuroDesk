"""
Agent model
"""
from sqlalchemy import Column, String, Enum, JSON, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid
import enum


class AgentType(str, enum.Enum):
    """Agent type enumeration"""
    PLANNER = "planner"
    EXECUTOR = "executor"
    VERIFIER = "verifier"
    COORDINATOR = "coordinator"


class AgentStatus(str, enum.Enum):
    """Agent status enumeration"""
    IDLE = "idle"
    BUSY = "busy"
    ERROR = "error"
    OFFLINE = "offline"


class Agent(Base):
    """Agent model for managing AI agents"""
    __tablename__ = "agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String(100), nullable=False, index=True)
    agent_type = Column(Enum(AgentType), nullable=False, index=True)
    status = Column(Enum(AgentStatus), default=AgentStatus.IDLE, nullable=False)
    capabilities = Column(JSON, nullable=True)  # JSON array of capability strings
    config = Column(JSON, nullable=True)  # Agent-specific configuration
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    creator = relationship("User", foreign_keys=[created_by], backref="created_agents")
    tasks = relationship("Task", back_populates="assigned_agent", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Agent(id={self.id}, name={self.name}, type={self.agent_type})>"
