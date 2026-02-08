"""
Base Agent class and AgentResult dataclass
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime
import structlog

logger = structlog.get_logger()


@dataclass
class AgentResult:
    """Result from agent execution"""
    success: bool
    data: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    execution_time_ms: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    sources: List[Dict[str, Any]] = field(default_factory=list)
    requires_approval: bool = False
    estimated_cost: Optional[float] = None
    risk_level: Optional[str] = None


class BaseAgent(ABC):
    """Base class for all agents"""
    
    def __init__(self, agent_id: str, name: str, description: str):
        self.agent_id = agent_id
        self.name = name
        self.description = description
        self.metadata: Dict[str, Any] = {}
    
    @abstractmethod
    async def execute(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """
        Execute the agent's main logic.
        Must be implemented by subclasses.
        """
        pass
    
    async def run(
        self,
        task: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
        validate: bool = True
    ) -> AgentResult:
        """
        Wrapper around execute() that provides:
        - Input validation
        - Cost/risk estimation
        - Error handling
        - Logging
        - Execution time tracking
        """
        start_time = datetime.utcnow()
        
        try:
            # Validation
            if validate:
                validation_error = await self.validate_input(task, context)
                if validation_error:
                    return AgentResult(
                        success=False,
                        error=f"Validation failed: {validation_error}",
                        execution_time_ms=0.0,
                    )
            
            # Estimation
            estimation = await self.estimate_cost_and_risk(task, context)
            
            logger.info(
                "Agent execution started",
                agent_id=self.agent_id,
                agent_name=self.name,
                task_id=task.get("id"),
                estimated_cost=estimation.get("cost"),
                risk_level=estimation.get("risk_level"),
            )
            
            # Execute
            result = await self.execute(task, context)
            
            # Calculate execution time
            end_time = datetime.utcnow()
            execution_time_ms = (end_time - start_time).total_seconds() * 1000
            result.execution_time_ms = execution_time_ms
            
            # Add estimation to result
            result.estimated_cost = estimation.get("cost")
            result.risk_level = estimation.get("risk_level")
            result.requires_approval = estimation.get("requires_approval", False)
            
            logger.info(
                "Agent execution completed",
                agent_id=self.agent_id,
                success=result.success,
                execution_time_ms=execution_time_ms,
            )
            
            return result
            
        except Exception as e:
            end_time = datetime.utcnow()
            execution_time_ms = (end_time - start_time).total_seconds() * 1000
            
            logger.error(
                "Agent execution failed",
                agent_id=self.agent_id,
                error=str(e),
                execution_time_ms=execution_time_ms,
                exc_info=True,
            )
            
            return AgentResult(
                success=False,
                error=f"Agent execution failed: {str(e)}",
                execution_time_ms=execution_time_ms,
            )
    
    async def validate_input(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """
        Validate input task and context.
        Override in subclasses for specific validation.
        Returns error message if invalid, None if valid.
        """
        if not task:
            return "Task is required"
        return None
    
    async def estimate_cost_and_risk(
        self,
        task: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Estimate cost and risk for the task.
        Override in subclasses for specific estimation.
        Returns dict with 'cost', 'risk_level', 'requires_approval'.
        """
        return {
            "cost": 0.0,
            "risk_level": "low",
            "requires_approval": False,
        }
    
    def get_metadata(self) -> Dict[str, Any]:
        """Get agent metadata"""
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "description": self.description,
            **self.metadata,
        }
