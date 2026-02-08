"""
Audit log model
"""
from sqlalchemy import Column, String, Text, Enum, JSON, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid
import enum


class AuditEventType(str, enum.Enum):
    """Audit event type enumeration"""
    USER_ACTION = "user_action"
    AGENT_ACTION = "agent_action"
    TASK_CREATED = "task_created"
    TASK_COMPLETED = "task_completed"
    TASK_FAILED = "task_failed"
    TRANSACTION_CREATED = "transaction_created"
    TRANSACTION_COMPLETED = "transaction_completed"
    SYSTEM_EVENT = "system_event"
    SECURITY_EVENT = "security_event"


class AuditLog(Base):
    """Audit log model for tracking all system events"""
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_type = Column(Enum(AuditEventType), nullable=False, index=True)
    event_name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=True, index=True)
    task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=True, index=True)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=True, index=True)
    extra_metadata = Column(JSON, nullable=True)  # Additional event metadata (renamed from 'metadata' to avoid SQLAlchemy conflict)
    ip_address = Column(String(45), nullable=True)  # IPv4 or IPv6
    user_agent = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    # Relationships
    user = relationship("User", foreign_keys=[user_id], backref="audit_logs")
    agent = relationship("Agent", foreign_keys=[agent_id], backref="audit_logs")
    task = relationship("Task", foreign_keys=[task_id], backref="audit_logs")
    transaction = relationship("Transaction", foreign_keys=[transaction_id], backref="audit_logs")

    def __repr__(self):
        return f"<AuditLog(id={self.id}, event_type={self.event_type}, event_name={self.event_name})>"
