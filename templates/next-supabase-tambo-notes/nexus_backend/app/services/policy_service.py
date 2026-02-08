"""
Policy Service - Security guardrails and policy enforcement
"""
from typing import Dict, Any, Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
import structlog
import re

logger = structlog.get_logger()

# Tool allowlist - only these tools can be executed
ALLOWED_TOOLS = {
    "research": "ResearchAgent",
    "communication": "CommunicationAgent",
    "purchase": "PurchaseAgent",
}

# Maximum spend per task
MAX_SPEND_PER_TASK = 1000.0  # Can be overridden in config

# External effect actions that require mandatory approval
MANDATORY_APPROVAL_ACTIONS = {
    "send_email",
    "send_message",
    "make_payment",
    "purchase",
    "delete",
    "update_external",
}


class PolicyService:
    """Service for enforcing security policies and guardrails"""
    
    @staticmethod
    def sanitize_error_message(error: Exception, original_message: Optional[str] = None) -> str:
        """
        Sanitize error messages to prevent leaking tokens, passwords, or sensitive data.
        """
        error_str = str(error)
        
        # Remove potential JWT tokens (base64-like strings)
        error_str = re.sub(r'[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}', '[TOKEN_REDACTED]', error_str)
        
        # Remove potential API keys (long alphanumeric strings)
        error_str = re.sub(r'\b[A-Za-z0-9]{32,}\b', '[API_KEY_REDACTED]', error_str)
        
        # Remove potential passwords (common patterns)
        error_str = re.sub(r'(?i)(password|passwd|pwd|secret|token|key)\s*[:=]\s*[^\s]+', r'\1=[REDACTED]', error_str)
        
        # Remove email addresses (optional - might want to keep for debugging)
        # error_str = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_REDACTED]', error_str)
        
        # Remove database connection strings
        error_str = re.sub(r'(postgresql|mysql|mongodb)://[^\s]+', '[DB_CONNECTION_REDACTED]', error_str)
        
        # Generic message for internal errors
        if "traceback" in error_str.lower() or "exception" in error_str.lower():
            return "An internal error occurred. Please try again or contact support."
        
        return error_str
    
    @staticmethod
    def sanitize_user_input(user_input: str) -> str:
        """
        Sanitize user input to prevent prompt injection attacks.
        Removes or neutralizes common prompt injection patterns.
        """
        if not user_input:
            return ""
        
        # Remove common prompt injection patterns
        # Pattern 1: Ignore previous instructions
        user_input = re.sub(
            r'(?i)(ignore|forget|disregard).*?(previous|prior|earlier|above).*?(instruction|command|directive|prompt)',
            '',
            user_input
        )
        
        # Pattern 2: System role override attempts
        user_input = re.sub(
            r'(?i)(you are|act as|pretend to be|roleplay as).*?(system|admin|root|assistant)',
            '',
            user_input
        )
        
        # Pattern 3: Instruction injection via special characters
        user_input = re.sub(r'```.*?```', '', user_input, flags=re.DOTALL)
        
        # Pattern 4: XML/HTML tag injection
        user_input = re.sub(r'<[^>]+>', '', user_input)
        
        # Pattern 5: Command injection attempts
        user_input = re.sub(r'[;&|`$(){}]', '', user_input)
        
        # Pattern 6: Base64 encoded instructions (basic detection)
        # This is a simple check - more sophisticated detection would be needed in production
        base64_pattern = r'[A-Za-z0-9+/]{50,}={0,2}'
        if re.search(base64_pattern, user_input):
            # If suspicious base64 found, remove it
            user_input = re.sub(base64_pattern, '', user_input)
        
        # Trim and clean whitespace
        user_input = user_input.strip()
        
        # Limit length to prevent buffer overflow attacks
        max_length = 10000
        if len(user_input) > max_length:
            user_input = user_input[:max_length]
            logger.warning("User input truncated due to length", original_length=len(user_input))
        
        return user_input
    
    @staticmethod
    def check_tool_allowed(tool_name: str) -> Tuple[bool, Optional[str]]:
        """
        Check if a tool is in the allowlist.
        Returns (is_allowed, error_message)
        """
        if tool_name not in ALLOWED_TOOLS:
            return False, f"Tool '{tool_name}' is not in the allowlist. Allowed tools: {', '.join(ALLOWED_TOOLS.keys())}"
        return True, None
    
    @staticmethod
    def check_max_spend_per_task(estimated_cost: float, max_spend: float = MAX_SPEND_PER_TASK) -> Tuple[bool, Optional[str]]:
        """
        Check if estimated cost exceeds maximum spend per task.
        Returns (is_allowed, error_message)
        """
        if estimated_cost > max_spend:
            return False, f"Estimated cost ${estimated_cost:.2f} exceeds maximum spend per task (${max_spend:.2f})"
        return True, None
    
    @staticmethod
    def requires_mandatory_approval(action: str, agent_type: str) -> bool:
        """
        Check if an action requires mandatory approval.
        """
        # Communication agent send_email always requires approval
        if agent_type == "communication" and action == "send":
            return True
        
        # Check against mandatory approval actions
        if action.lower() in MANDATORY_APPROVAL_ACTIONS:
            return True
        
        return False
    
    @staticmethod
    def extract_ip_address(request_headers: Dict[str, str], client_host: Optional[str] = None) -> Optional[str]:
        """
        Extract client IP address from request headers.
        Handles proxies and load balancers.
        """
        # Check X-Forwarded-For (most common proxy header)
        forwarded_for = request_headers.get("X-Forwarded-For")
        if forwarded_for:
            # X-Forwarded-For can contain multiple IPs, take the first one
            ip = forwarded_for.split(",")[0].strip()
            if ip:
                return ip
        
        # Check X-Real-IP (nginx proxy)
        real_ip = request_headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
        
        # Check CF-Connecting-IP (Cloudflare)
        cf_ip = request_headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()
        
        # Fallback to client_host (direct connection)
        if client_host:
            return client_host
        
        return None
    
    @staticmethod
    def validate_user_input(user_input: str) -> Tuple[bool, Optional[str]]:
        """
        Validate user input for security concerns.
        Returns (is_valid, error_message)
        """
        if not user_input or len(user_input.strip()) == 0:
            return False, "Input cannot be empty"
        
        # Check for suspicious patterns
        suspicious_patterns = [
            (r'eval\s*\(', "Potential code execution attempt"),
            (r'exec\s*\(', "Potential code execution attempt"),
            (r'__import__', "Potential code import attempt"),
            (r'subprocess', "Potential subprocess execution attempt"),
            (r'os\.system', "Potential OS command execution"),
            (r'shell\s*=', "Potential shell command injection"),
        ]
        
        for pattern, reason in suspicious_patterns:
            if re.search(pattern, user_input, re.IGNORECASE):
                logger.warning("Suspicious input detected", pattern=pattern, reason=reason)
                return False, f"Input contains potentially unsafe content: {reason}"
        
        return True, None
