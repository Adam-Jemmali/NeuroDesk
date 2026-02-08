"""
Intent parsing API endpoint
"""
from fastapi import APIRouter, Depends
from app.api.dependencies import get_current_user
from app.models.user import User
from app.schemas.intent import IntentRequest, IntentResult
from app.services.intent_parser import parse_intent
import structlog

logger = structlog.get_logger()

router = APIRouter()


@router.post("/parse", response_model=IntentResult)
async def parse_user_intent(
    request: IntentRequest,
    current_user: User = Depends(get_current_user),
):
    """Parse user intent from natural language message"""
    logger.info("Parsing intent", user_id=str(current_user.id), message_length=len(request.user_message))
    result = await parse_intent(request)
    return result
