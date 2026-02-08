"""
Event Service for real-time event publishing via SSE
"""
from typing import Dict, Any, Optional, Callable, List
from uuid import UUID
import asyncio
import json
import structlog
from datetime import datetime

logger = structlog.get_logger()


class EventService:
    """In-memory event service for SSE broadcasting"""
    
    _instance: Optional['EventService'] = None
    _subscribers: Dict[str, List[Callable]] = {}  # user_id -> list of callbacks
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def subscribe(self, user_id: UUID, callback: Callable) -> None:
        """Subscribe a user to events"""
        user_id_str = str(user_id)
        if user_id_str not in self._subscribers:
            self._subscribers[user_id_str] = []
        self._subscribers[user_id_str].append(callback)
        logger.info("User subscribed to events", user_id=user_id_str, subscribers=len(self._subscribers[user_id_str]))
    
    def unsubscribe(self, user_id: UUID, callback: Callable) -> None:
        """Unsubscribe a user from events"""
        user_id_str = str(user_id)
        if user_id_str in self._subscribers:
            try:
                self._subscribers[user_id_str].remove(callback)
                if not self._subscribers[user_id_str]:
                    del self._subscribers[user_id_str]
                logger.info("User unsubscribed from events", user_id=user_id_str)
            except ValueError:
                pass
    
    async def publish(
        self,
        user_id: UUID,
        event_type: str,
        data: Dict[str, Any],
        event_id: Optional[str] = None
    ) -> None:
        """
        Publish an event to a specific user.
        
        Args:
            user_id: Target user ID
            event_type: Event type (e.g., 'task_created', 'status_changed')
            data: Event data payload
            event_id: Optional event ID for SSE
        """
        user_id_str = str(user_id)
        
        event = {
            "id": event_id or f"{int(datetime.utcnow().timestamp() * 1000)}",
            "type": event_type,
            "data": json.dumps(data),
            "timestamp": datetime.utcnow().isoformat(),
        }
        
        if user_id_str in self._subscribers:
            # Send to all subscribers for this user
            for callback in self._subscribers[user_id_str]:
                try:
                    await callback(event)
                except Exception as e:
                    logger.error("Error sending event to subscriber", error=str(e), user_id=user_id_str)
        
        logger.debug("Event published", user_id=user_id_str, event_type=event_type)
    
    async def publish_broadcast(
        self,
        event_type: str,
        data: Dict[str, Any],
        event_id: Optional[str] = None
    ) -> None:
        """Broadcast event to all subscribers"""
        for user_id_str in list(self._subscribers.keys()):
            user_id = UUID(user_id_str)
            await self.publish(user_id, event_type, data, event_id)
    
    def get_subscriber_count(self, user_id: Optional[UUID] = None) -> int:
        """Get number of subscribers (for a user or total)"""
        if user_id:
            return len(self._subscribers.get(str(user_id), []))
        return sum(len(callbacks) for callbacks in self._subscribers.values())


# Global instance
event_service = EventService()
