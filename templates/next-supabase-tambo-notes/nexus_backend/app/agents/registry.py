"""
Agent Registry for managing and discovering agents
"""
from typing import Dict, Type, List, Optional, Any
from app.agents.base import BaseAgent
import structlog

logger = structlog.get_logger()


class AgentRegistry:
    """Registry for agent types and instances"""
    
    _instance: Optional['AgentRegistry'] = None
    _agent_classes: Dict[str, Type[BaseAgent]] = {}
    _agent_instances: Dict[str, BaseAgent] = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def register(self, agent_id: str, name: str, description: str = ""):
        """
        Decorator to register an agent class.
        
        Usage:
            @registry.register("research", "Research Agent", "Researches topics using web search")
            class ResearchAgent(BaseAgent):
                ...
        """
        def decorator(agent_class: Type[BaseAgent]):
            # Store metadata for later use
            agent_class._registry_metadata = {
                "agent_id": agent_id,
                "name": name,
                "description": description,
            }
            self._agent_classes[agent_id] = agent_class
            logger.info("Agent registered", agent_id=agent_id, name=name)
            return agent_class
        return decorator
    
    def get(self, agent_id: str, **kwargs) -> Optional[BaseAgent]:
        """
        Get an agent instance by ID.
        Creates instance if it doesn't exist.
        """
        # Check if instance already exists
        if agent_id in self._agent_instances:
            return self._agent_instances[agent_id]
        
        # Create new instance from registered class
        if agent_id in self._agent_classes:
            agent_class = self._agent_classes[agent_id]
            instance = agent_class(agent_id=agent_id, **kwargs)
            self._agent_instances[agent_id] = instance
            return instance
        
        logger.warning("Agent not found", agent_id=agent_id)
        return None
    
    def list_all(self) -> List[Dict[str, Any]]:
        """List all registered agents with metadata"""
        agents = []
        for agent_id, agent_class in self._agent_classes.items():
            # Get metadata from registry or create instance
            try:
                if hasattr(agent_class, "_registry_metadata"):
                    metadata = agent_class._registry_metadata
                    agents.append({
                        "agent_id": metadata["agent_id"],
                        "name": metadata["name"],
                        "description": metadata["description"],
                    })
                else:
                    # Fallback: create instance
                    instance = agent_class(agent_id=agent_id, name=agent_id, description="")
                    agents.append(instance.get_metadata())
            except Exception as e:
                logger.warning("Failed to get metadata for agent", agent_id=agent_id, error=str(e))
                agents.append({
                    "agent_id": agent_id,
                    "name": agent_id,
                    "description": "Agent metadata unavailable",
                })
        return agents
    
    def get_agent_info(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get metadata for a specific agent"""
        agent = self.get(agent_id)
        if agent:
            return agent.get_metadata()
        return None
    
    def is_registered(self, agent_id: str) -> bool:
        """Check if an agent is registered"""
        return agent_id in self._agent_classes


# Global registry instance
registry = AgentRegistry()
