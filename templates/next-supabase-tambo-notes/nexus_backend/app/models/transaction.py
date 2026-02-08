"""
Transaction model
"""
from sqlalchemy import Column, String, Text, Enum, JSON, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid
import enum


class TransactionType(str, enum.Enum):
    """Transaction type enumeration"""
    COMMAND = "command"
    QUERY = "query"
    NOTIFICATION = "notification"
    SYSTEM = "system"


class TransactionStatus(str, enum.Enum):
    """Transaction status enumeration"""
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCESS = "success"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


class Transaction(Base):
    """Transaction model for audit and rollback"""
    __tablename__ = "transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    transaction_type = Column(Enum(TransactionType), nullable=False, index=True)
    status = Column(Enum(TransactionStatus), default=TransactionStatus.PENDING, nullable=False, index=True)
    task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=True, index=True)
    request_data = Column(JSON, nullable=True)  # Original request data
    response_data = Column(JSON, nullable=True)  # Response data
    error_data = Column(JSON, nullable=True)  # Error details if failed
    cost = Column(Numeric(10, 2), nullable=True)  # Transaction cost (if applicable)
    extra_metadata = Column(JSON, nullable=True)  # Additional metadata (renamed from 'metadata' to avoid SQLAlchemy conflict)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    task = relationship("Task", back_populates="transactions")
    creator = relationship("User", foreign_keys=[created_by], backref="created_transactions")

    def __repr__(self):
        return f"<Transaction(id={self.id}, type={self.transaction_type}, status={self.status})>"
