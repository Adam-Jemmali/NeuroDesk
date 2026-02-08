"""
Intent Parser service using Groq (primary) and Gemini (fallback)
"""
from typing import Optional, Dict, Any
from app.schemas.intent import IntentResult, IntentRequest
from app.config import settings
import httpx
import json
import structlog

logger = structlog.get_logger()

# API Keys from environment
GROQ_API_KEY = getattr(settings, "GROQ_API_KEY", None)
GEMINI_API_KEY = getattr(settings, "GEMINI_API_KEY", None)

# Model configurations
GROQ_MODEL = "llama-3.1-70b-versatile"
GEMINI_MODEL = "gemini-1.5-flash"


async def parse_intent_groq(user_message: str, context: Optional[Dict[str, Any]] = None) -> IntentResult:
    """Parse intent using Groq API"""
    groq_api_key = settings.GROQ_API_KEY
    if not groq_api_key:
        raise ValueError("GROQ_API_KEY not configured")
    
    system_prompt = """You are an intent parser for a command and control system. 
Analyze the user's message and extract:
1. Intent (e.g., 'execute_command', 'query_status', 'create_task', 'approve_action')
2. Confidence score (0.0 to 1.0)
3. Entities (command name, parameters, etc.)
4. Suggested command to execute
5. Whether approval is required (true if involves spending, destructive actions, or external writes)
6. Estimated cost (if applicable)
7. Risk level ('low', 'medium', 'high', 'critical')

Return ONLY valid JSON matching this schema:
{
  "intent": "string",
  "confidence": 0.0-1.0,
  "entities": {},
  "command": "string or null",
  "parameters": {},
  "requires_approval": boolean,
  "estimated_cost": number or null,
  "risk_level": "low|medium|high|critical or null"
}"""

    user_prompt = f"User message: {user_message}\n\nContext: {json.dumps(context or {})}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        data = response.json()
        
        content = data["choices"][0]["message"]["content"]
        # Parse JSON response
        intent_data = json.loads(content)
        
        return IntentResult(**intent_data)


async def parse_intent_gemini(user_message: str, context: Optional[Dict[str, Any]] = None) -> IntentResult:
    """Parse intent using Gemini API (fallback)"""
    gemini_api_key = settings.GEMINI_API_KEY
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY not configured")
    
    system_prompt = """You are an intent parser for a command and control system. 
Analyze the user's message and extract intent, confidence, entities, command, parameters, approval requirements, cost, and risk level.
Return ONLY valid JSON matching this schema:
{
  "intent": "string",
  "confidence": 0.0-1.0,
  "entities": {},
  "command": "string or null",
  "parameters": {},
  "requires_approval": boolean,
  "estimated_cost": number or null,
  "risk_level": "low|medium|high|critical or null"
}"""

    prompt = f"{system_prompt}\n\nUser message: {user_message}\n\nContext: {json.dumps(context or {})}\n\nReturn JSON only:"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={gemini_api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{
                    "parts": [{"text": prompt}]
                }],
                "generationConfig": {
                    "temperature": 0.3,
                    "responseMimeType": "application/json",
                },
            },
        )
        response.raise_for_status()
        data = response.json()
        
        content = data["candidates"][0]["content"]["parts"][0]["text"]
        # Clean up JSON if needed (remove markdown code blocks)
        content = content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        intent_data = json.loads(content)
        return IntentResult(**intent_data)


async def parse_intent(request: IntentRequest) -> IntentResult:
    """
    Parse user intent using Groq (primary) with Gemini fallback.
    Applies business rules for confidence and approval requirements.
    """
    user_message = request.user_message
    context = request.context
    
    # Try Groq first
    try:
        logger.info("Parsing intent with Groq", message_length=len(user_message))
        result = await parse_intent_groq(user_message, context)
        
        # Apply business rules
        result = apply_business_rules(result, user_message)
        
        logger.info("Intent parsed successfully", intent=result.intent, confidence=result.confidence)
        return result
        
    except Exception as groq_error:
        logger.warning("Groq parsing failed, trying Gemini fallback", error=str(groq_error))
        
        # Fallback to Gemini
        try:
            result = await parse_intent_gemini(user_message, context)
            result = apply_business_rules(result, user_message)
            
            logger.info("Intent parsed with Gemini fallback", intent=result.intent, confidence=result.confidence)
            return result
            
        except Exception as gemini_error:
            logger.error("Both Groq and Gemini failed", groq_error=str(groq_error), gemini_error=str(gemini_error))
            # Return a default low-confidence result
            return IntentResult(
                intent="unknown",
                confidence=0.0,
                requires_approval=True,
                risk_level="high",
            )


def apply_business_rules(result: IntentResult, user_message: str) -> IntentResult:
    """Apply business rules to intent result"""
    # Rule 1: Low confidence requires clarification
    if result.confidence < 0.70:
        # Note: We can't modify Pydantic models directly, so we'll return a new one
        # For now, we'll just log it - the API can handle this
        logger.warning("Low confidence intent", confidence=result.confidence, intent=result.intent)
    
    # Rule 2: Any spending requires approval
    if result.estimated_cost and result.estimated_cost > 0:
        result.requires_approval = True
        if not result.risk_level or result.risk_level == "low":
            result.risk_level = "medium"
    
    # Rule 3: Detect spending keywords in message
    spending_keywords = ["pay", "cost", "buy", "purchase", "spend", "price", "fee", "charge"]
    if any(keyword in user_message.lower() for keyword in spending_keywords):
        result.requires_approval = True
        if not result.estimated_cost:
            result.estimated_cost = 0.0  # Unknown cost, but requires approval
    
    # Rule 4: Destructive actions require approval
    destructive_keywords = ["delete", "remove", "destroy", "drop", "kill", "terminate"]
    if any(keyword in user_message.lower() for keyword in destructive_keywords):
        result.requires_approval = True
        if not result.risk_level or result.risk_level in ["low", "medium"]:
            result.risk_level = "high"
    
    return result
