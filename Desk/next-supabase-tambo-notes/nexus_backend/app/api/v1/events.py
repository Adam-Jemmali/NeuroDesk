"""
SSE Events API endpoint
"""
from fastapi import APIRouter, Depends, Request, HTTPException, status
from fastapi.responses import StreamingResponse
from app.api.dependencies import get_current_user
from app.models.user import User
from app.services.event_service import event_service
import asyncio
import json
import structlog

logger = structlog.get_logger()

router = APIRouter()


@router.get("/stream")
async def stream_events(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """
    Server-Sent Events (SSE) stream for real-time updates.
    
    Note: EventSource in browsers doesn't support custom headers.
    Authentication should be done via:
    - Cookie-based auth (if using session cookies)
    - Query parameter token (for API tokens)
    - Or use a WebSocket endpoint instead
    
    Clients should connect to this endpoint to receive events.
    """
    """
    Server-Sent Events (SSE) stream for real-time updates.
    Clients should connect to this endpoint to receive events.
    """
    async def event_generator():
        """Generator function that yields SSE events"""
        # Queue to receive events
        event_queue = asyncio.Queue()
        
        async def event_callback(event: dict):
            """Callback to receive events from EventService"""
            await event_queue.put(event)
        
        # Subscribe to events
        event_service.subscribe(current_user.id, event_callback)
        
        try:
            # Send initial connection event
            yield f"data: {json.dumps({'type': 'connected', 'message': 'Event stream connected'})}\n\n"
            
            # Send ping every 30 seconds to keep connection alive
            ping_interval = 30
            last_ping = asyncio.get_event_loop().time()
            
            while True:
                try:
                    # Wait for event with timeout for ping
                    timeout = max(1.0, ping_interval - (asyncio.get_event_loop().time() - last_ping))
                    
                    try:
                        event = await asyncio.wait_for(event_queue.get(), timeout=timeout)
                        # Format as SSE
                        yield f"id: {event.get('id', '')}\n"
                        yield f"event: {event.get('type', 'message')}\n"
                        yield f"data: {event.get('data', '{}')}\n\n"
                    except asyncio.TimeoutError:
                        # Send ping to keep connection alive
                        current_time = asyncio.get_event_loop().time()
                        if current_time - last_ping >= ping_interval:
                            yield f"data: {json.dumps({'type': 'ping', 'timestamp': asyncio.get_event_loop().time()})}\n\n"
                            last_ping = current_time
                    
                    # Check if client disconnected
                    if await request.is_disconnected():
                        logger.info("Client disconnected", user_id=str(current_user.id))
                        break
                        
                except Exception as e:
                    logger.error("Error in event stream", error=str(e), user_id=str(current_user.id))
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                    break
        
        finally:
            # Unsubscribe when client disconnects
            event_service.unsubscribe(current_user.id, event_callback)
            logger.info("User unsubscribed from events", user_id=str(current_user.id))
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )
