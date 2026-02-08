"""
AI agent implementations
"""
# Import agents to register them
from app.agents.research_agent import ResearchAgent
from app.agents.communication_agent import CommunicationAgent
from app.agents.purchase_agent import PurchaseAgent

__all__ = [
    "ResearchAgent",
    "CommunicationAgent",
    "PurchaseAgent",
]