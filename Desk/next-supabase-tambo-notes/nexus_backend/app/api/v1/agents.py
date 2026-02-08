"""
Agents API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.agent import Agent, AgentType, AgentStatus
from app.models.task import Task
from app.agents.registry import registry
import structlog

logger = structlog.get_logger()

router = APIRouter()


@router.get("/types")
async def list_agent_types():
    """List all available agent types from registry"""
    agents = registry.list_all()
    return {
        "agent_types": agents,
        "count": len(agents),
    }


@router.get("/active")
async def list_active_agents(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List active agents for current user with statistics"""
    result = await db.execute(
        select(Agent)
        .where(
            Agent.created_by == current_user.id,
            Agent.status == AgentStatus.BUSY
        )
    )
    agents = result.scalars().all()
    
    # Get stats for each agent
    agents_with_stats = []
    for agent in agents:
        # Count tasks for this agent
        task_count_result = await db.execute(
            select(func.count(Task.id))
            .where(Task.assigned_agent_id == agent.id)
        )
        task_count = task_count_result.scalar() or 0
        
        agents_with_stats.append({
            "id": str(agent.id),
            "name": agent.name,
            "agent_type": agent.agent_type.value,
            "status": agent.status.value,
            "capabilities": agent.capabilities,
            "task_count": task_count,
            "created_at": agent.created_at.isoformat(),
        })
    
    return {
        "agents": agents_with_stats,
        "count": len(agents_with_stats),
    }


@router.get("/types/{agent_type}")
async def get_agent_type_info(agent_type: str):
    """Get public information about a specific agent type"""
    agent_info = registry.get_agent_info(agent_type)
    
    if not agent_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent type '{agent_type}' not found"
        )
    
    return {
        "agent_type": agent_type,
        "info": agent_info,
    }


@router.post("/{agent_type}/execute")
async def execute_agent(
    agent_type: str,
    task: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute an agent with a task"""
    agent = registry.get(agent_type)
    
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent type '{agent_type}' not found"
        )
    
    # Add user context
    context = {
        "user_id": str(current_user.id),
        "user_email": current_user.email,
    }
    
    # Execute agent
    result = await agent.run(task, context)
    
    return {
        "agent_type": agent_type,
        "result": {
            "success": result.success,
            "data": result.data,
            "error": result.error,
            "execution_time_ms": result.execution_time_ms,
            "requires_approval": result.requires_approval,
            "estimated_cost": result.estimated_cost,
            "risk_level": result.risk_level,
            "sources": result.sources,
        },
    }
