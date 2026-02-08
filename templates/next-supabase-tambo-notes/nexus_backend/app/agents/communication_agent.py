"""
Communication Agent - Email drafting and sending via Resend
"""
from typing import Dict, Any, Optional
from app.agents.base import BaseAgent, AgentResult
from app.agents.registry import registry
from app.config import settings
import httpx
import structlog
import re
from datetime import datetime, timedelta

logger = structlog.get_logger()

RESEND_API_KEY = getattr(settings, "RESEND_API_KEY", None)
RATE_LIMIT_EMAILS_PER_HOUR = 10


@registry.register("communication", "Communication Agent", "Drafts and sends emails via Resend")
class CommunicationAgent(BaseAgent):
    """Agent that drafts and sends emails"""
    
    def __init__(self, agent_id: str, name: str = "Communication Agent", description: str = ""):
        super().__init__(agent_id, name, description or "Drafts and sends emails via Resend")
        self.resend_api_key = RESEND_API_KEY or (settings.RESEND_API_KEY if hasattr(settings, "RESEND_API_KEY") else None)
    
    async def execute(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute communication task"""
        action = task.get("action", "draft")
        
        if action == "draft":
            return await self._draft_email(task, context)
        elif action == "send":
            return await self._send_email(task, context)
        else:
            return AgentResult(
                success=False,
                error=f"Unknown action: {action}. Use 'draft' or 'send'",
            )
    
    async def _draft_email(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Draft an email using Groq"""
        to_email = task.get("to")
        subject = task.get("subject", "")
        message = task.get("message", "")
        
        if not to_email:
            return AgentResult(
                success=False,
                error="Recipient email (to) is required",
            )
        
        if not self._validate_email(to_email):
            return AgentResult(
                success=False,
                error=f"Invalid email format: {to_email}",
            )
        
        try:
            # Use Groq to draft email
            draft = await self._generate_email_draft(to_email, subject, message, context)
            
            return AgentResult(
                success=True,
                data={
                    "to": to_email,
                    "subject": draft.get("subject", subject),
                    "body": draft.get("body", ""),
                    "draft_only": True,
                },
                metadata={
                    "drafted_at": datetime.utcnow().isoformat(),
                },
            )
            
        except Exception as e:
            logger.error("Email drafting failed", error=str(e), exc_info=True)
            return AgentResult(
                success=False,
                error=f"Email drafting failed: {str(e)}",
            )
    
    async def _send_email(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Send an email via Resend (requires approval)"""
        # Check rate limit
        user_id = context.get("user_id") if context else None
        if user_id:
            rate_limit_ok = await self._check_rate_limit(user_id)
            if not rate_limit_ok:
                return AgentResult(
                    success=False,
                    error=f"Rate limit exceeded. Maximum {RATE_LIMIT_EMAILS_PER_HOUR} emails per hour.",
                )
        
        to_email = task.get("to")
        subject = task.get("subject", "")
        body = task.get("body", "")
        
        if not to_email:
            return AgentResult(
                success=False,
                error="Recipient email (to) is required",
            )
        
        if not self._validate_email(to_email):
            return AgentResult(
                success=False,
                error=f"Invalid email format: {to_email}",
            )
        
        if not self.resend_api_key:
            return AgentResult(
                success=False,
                error="Resend API key not configured",
            )
        
        try:
            # Send via Resend
            result = await self._send_via_resend(to_email, subject, body, task.get("from_email"))
            
            # Record rate limit
            if user_id:
                await self._record_email_sent(user_id)
            
            return AgentResult(
                success=True,
                data={
                    "to": to_email,
                    "subject": subject,
                    "sent": True,
                    "message_id": result.get("id"),
                },
                metadata={
                    "sent_at": datetime.utcnow().isoformat(),
                },
            )
            
        except Exception as e:
            logger.error("Email sending failed", error=str(e), exc_info=True)
            return AgentResult(
                success=False,
                error=f"Email sending failed: {str(e)}",
            )
    
    async def _generate_email_draft(
        self,
        to_email: str,
        subject: str,
        message: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Generate email draft using Groq"""
        groq_api_key = getattr(settings, "GROQ_API_KEY", None)
        if not groq_api_key:
            # Fallback to simple draft
            return {
                "subject": subject or "Email",
                "body": message or f"Dear recipient,\n\n{message}\n\nBest regards",
            }
        
        prompt = f"""Draft a professional email with the following details:
Recipient: {to_email}
Subject: {subject or "(generate appropriate subject)"}
Message/Context: {message}

Return JSON with keys: subject, body (formatted email body)"""
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {groq_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "llama-3.1-70b-versatile",
                        "messages": [
                            {"role": "system", "content": "You are an email drafting assistant. Return JSON only."},
                            {"role": "user", "content": prompt},
                        ],
                        "temperature": 0.7,
                        "response_format": {"type": "json_object"},
                    },
                )
                response.raise_for_status()
                data = response.json()
                
                import json
                content = data["choices"][0]["message"]["content"]
                draft = json.loads(content)
                
                return {
                    "subject": draft.get("subject", subject),
                    "body": draft.get("body", message),
                }
                
        except Exception as e:
            logger.warning("Groq email drafting failed, using fallback", error=str(e))
            return {
                "subject": subject or "Email",
                "body": message or f"Dear recipient,\n\n{message}\n\nBest regards",
            }
    
    async def _send_via_resend(self, to_email: str, subject: str, body: str, from_email: Optional[str] = None) -> Dict[str, Any]:
        """Send email via Resend API"""
        if not self.resend_api_key:
            raise ValueError("Resend API key not configured")
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {self.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": from_email or "onboarding@resend.dev",  # Default Resend domain
                    "to": to_email,
                    "subject": subject,
                    "html": body.replace("\n", "<br>"),  # Simple HTML conversion
                },
            )
            response.raise_for_status()
            return response.json()
    
    def _validate_email(self, email: str) -> bool:
        """Validate email format"""
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return bool(re.match(pattern, email))
    
    async def _check_rate_limit(self, user_id: str) -> bool:
        """Check if user has exceeded rate limit using Redis"""
        # TODO: Implement Redis rate limiting
        # For now, return True (no rate limiting)
        # In production, use Redis to track emails per hour per user
        return True
    
    async def _record_email_sent(self, user_id: str) -> None:
        """Record that an email was sent (for rate limiting)"""
        # TODO: Implement Redis recording
        # In production, increment counter in Redis with TTL of 1 hour
        pass
    
    async def estimate_cost_and_risk(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Communication agent cost and risk estimation"""
        action = task.get("action", "draft")
        
        if action == "send":
            # Sending always requires approval
            return {
                "cost": 0.0,  # Resend has free tier
                "risk_level": "medium",
                "requires_approval": True,  # ALWAYS true for send_email
            }
        else:
            # Drafting is safe
            return {
                "cost": 0.0,
                "risk_level": "low",
                "requires_approval": False,
            }
    
    async def validate_input(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Validate communication task input"""
        action = task.get("action")
        if action not in ["draft", "send"]:
            return f"Action must be 'draft' or 'send', got: {action}"
        
        if action == "send" and not task.get("to"):
            return "Recipient email (to) is required for sending"
        
        return None
