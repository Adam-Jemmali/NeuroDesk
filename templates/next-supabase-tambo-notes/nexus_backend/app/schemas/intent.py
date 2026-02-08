"""
Intent schemas for natural language processing
"""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List


class IntentRequest(BaseModel):
    """Schema for intent recognition request"""
    user_message: str = Field(..., min_length=1, description="User's natural language message")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context for intent recognition")


class IntentResult(BaseModel):
    """Schema for intent recognition result"""
    intent: str = Field(..., description="Recognized intent (e.g., 'execute_command', 'query_status')")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score (0.0 to 1.0)")
    entities: Optional[Dict[str, Any]] = Field(None, description="Extracted entities from the message")
    command: Optional[str] = Field(None, description="Suggested command to execute")
    parameters: Optional[Dict[str, Any]] = Field(None, description="Extracted command parameters")
    requires_approval: bool = Field(False, description="Whether this intent requires approval")
    estimated_cost: Optional[float] = Field(None, ge=0.0, description="Estimated cost if applicable")
    risk_level: Optional[str] = Field(None, description="Risk level: 'low', 'medium', 'high', 'critical'")
