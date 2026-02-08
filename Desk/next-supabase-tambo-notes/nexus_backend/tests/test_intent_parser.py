"""
Tests for Intent Parser service
"""
import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.intent_parser import parse_intent, parse_intent_groq, parse_intent_gemini, apply_business_rules
from app.schemas.intent import IntentRequest, IntentResult
from app.config import settings


# Sample test inputs
TEST_INPUTS = [
    {
        "message": "Create a new user account",
        "expected_intent": "create_task",
        "should_require_approval": False,
    },
    {
        "message": "Delete all files in /tmp",
        "expected_intent": "execute_command",
        "should_require_approval": True,
        "expected_risk": "high",
    },
    {
        "message": "Pay $500 for hosting services",
        "expected_intent": "execute_command",
        "should_require_approval": True,
        "expected_cost": 500.0,
    },
    {
        "message": "What is the status of task 123?",
        "expected_intent": "query_status",
        "should_require_approval": False,
    },
    {
        "message": "Buy 10 servers for $1000 each",
        "expected_intent": "execute_command",
        "should_require_approval": True,
        "expected_cost": 10000.0,
    },
    {
        "message": "Approve the pending deployment",
        "expected_intent": "approve_action",
        "should_require_approval": False,
    },
    {
        "message": "Remove the database backup",
        "expected_intent": "execute_command",
        "should_require_approval": True,
        "expected_risk": "high",
    },
    {
        "message": "Show me the budget summary",
        "expected_intent": "query_status",
        "should_require_approval": False,
    },
]


@pytest.mark.asyncio
async def test_parse_intent_groq_success():
    """Test successful intent parsing with Groq"""
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "choices": [{
            "message": {
                "content": json.dumps({
                    "intent": "create_task",
                    "confidence": 0.95,
                    "entities": {"action": "create", "resource": "user"},
                    "command": "create_user",
                    "parameters": {"username": "test"},
                    "requires_approval": False,
                    "estimated_cost": None,
                    "risk_level": "low",
                })
            }
        }]
    }
    mock_response.raise_for_status = MagicMock()
    
    with patch("app.services.intent_parser.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        mock_client.return_value.__aenter__.return_value.__aexit__ = AsyncMock(return_value=None)
        
        # Mock settings
        with patch.object(settings, "GROQ_API_KEY", "test-key"):
            result = await parse_intent_groq("Create a new user")
            
            assert result.intent == "create_task"
            assert result.confidence == 0.95
            assert result.requires_approval is False


@pytest.mark.asyncio
async def test_parse_intent_groq_fallback_to_gemini():
    """Test fallback to Gemini when Groq fails"""
    # Mock Groq failure
    groq_error = Exception("Groq API error")
    
    # Mock Gemini success
    gemini_response = MagicMock()
    gemini_response.json.return_value = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": json.dumps({
                        "intent": "query_status",
                        "confidence": 0.88,
                        "entities": {},
                        "command": None,
                        "parameters": {},
                        "requires_approval": False,
                        "estimated_cost": None,
                        "risk_level": "low",
                    })
                }]
            }
        }]
    }
    gemini_response.raise_for_status = MagicMock()
    
    with patch("app.services.intent_parser.httpx.AsyncClient") as mock_client:
        # First call (Groq) raises error, second call (Gemini) succeeds
        mock_post = AsyncMock(side_effect=[groq_error, gemini_response])
        mock_client.return_value.__aenter__.return_value.post = mock_post
        mock_client.return_value.__aenter__.return_value.__aexit__ = AsyncMock(return_value=None)
        
        # Mock settings
        with patch.object(settings, "GROQ_API_KEY", "test-key"), \
             patch.object(settings, "GEMINI_API_KEY", "test-gemini-key"):
            
            request = IntentRequest(user_message="What is the status?")
            result = await parse_intent(request)
            
            assert result.intent == "query_status"
            assert result.confidence == 0.88


@pytest.mark.asyncio
async def test_parse_intent_both_apis_fail():
    """Test that parse_intent returns default result when both APIs fail"""
    with patch("app.services.intent_parser.parse_intent_groq", side_effect=Exception("Groq failed")), \
         patch("app.services.intent_parser.parse_intent_gemini", side_effect=Exception("Gemini failed")):
        
        request = IntentRequest(user_message="Test message")
        result = await parse_intent(request)
        
        assert result.intent == "unknown"
        assert result.confidence == 0.0
        assert result.requires_approval is True
        assert result.risk_level == "high"


@pytest.mark.asyncio
async def test_parse_intent_gemini_success():
    """Test successful intent parsing with Gemini"""
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": '{"intent": "execute_command", "confidence": 0.92, "requires_approval": true, "risk_level": "medium"}'
                }]
            }
        }]
    }
    mock_response.raise_for_status = MagicMock()
    
    with patch("app.services.intent_parser.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        mock_client.return_value.__aenter__.return_value.__aexit__ = AsyncMock(return_value=None)
        
        with patch.object(settings, "GEMINI_API_KEY", "test-key"):
            result = await parse_intent_gemini("Delete the database")
            
            assert result.intent == "execute_command"
            assert result.confidence == 0.92
            assert result.requires_approval is True


def test_apply_business_rules_spending():
    """Test that spending keywords trigger approval requirement"""
    result = IntentResult(
        intent="execute_command",
        confidence=0.9,
        requires_approval=False,
        estimated_cost=None,
        risk_level="low",
    )
    
    modified = apply_business_rules(result, "Pay $100 for services")
    
    assert modified.requires_approval is True
    assert modified.estimated_cost == 0.0  # Unknown cost but requires approval


def test_apply_business_rules_destructive():
    """Test that destructive keywords trigger approval and high risk"""
    result = IntentResult(
        intent="execute_command",
        confidence=0.9,
        requires_approval=False,
        risk_level="low",
    )
    
    modified = apply_business_rules(result, "Delete all files")
    
    assert modified.requires_approval is True
    assert modified.risk_level == "high"


def test_apply_business_rules_estimated_cost():
    """Test that estimated cost triggers approval"""
    result = IntentResult(
        intent="execute_command",
        confidence=0.9,
        requires_approval=False,
        estimated_cost=500.0,
        risk_level="low",
    )
    
    modified = apply_business_rules(result, "Execute command")
    
    assert modified.requires_approval is True
    assert modified.risk_level == "medium"


def test_apply_business_rules_low_confidence():
    """Test that low confidence is logged but not modified"""
    result = IntentResult(
        intent="unknown",
        confidence=0.5,  # Below 0.70 threshold
        requires_approval=False,
    )
    
    # Should not modify, just log
    modified = apply_business_rules(result, "Unclear message")
    
    assert modified.confidence == 0.5  # Unchanged


@pytest.mark.asyncio
async def test_parse_intent_json_parsing():
    """Test that JSON parsing handles various formats"""
    # Test with markdown code blocks
    gemini_response = MagicMock()
    gemini_response.json.return_value = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": "```json\n{\"intent\": \"test\", \"confidence\": 0.8}\n```"
                }]
            }
        }]
    }
    gemini_response.raise_for_status = MagicMock()
    
    with patch("app.services.intent_parser.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=gemini_response)
        mock_client.return_value.__aenter__.return_value.__aexit__ = AsyncMock(return_value=None)
        
        with patch.object(settings, "GEMINI_API_KEY", "test-key"):
            result = await parse_intent_gemini("Test message")
            
            assert result.intent == "test"
            assert result.confidence == 0.8


@pytest.mark.asyncio
async def test_parse_intent_sample_inputs():
    """Test intent parsing with sample inputs (mocked)"""
    # Mock successful Groq response
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "choices": [{
            "message": {
                "content": json.dumps({
                    "intent": "execute_command",
                    "confidence": 0.85,
                    "entities": {},
                    "command": "delete_files",
                    "parameters": {},
                    "requires_approval": True,
                    "estimated_cost": None,
                    "risk_level": "high",
                })
            }
        }]
    }
    mock_response.raise_for_status = MagicMock()
    
    with patch("app.services.intent_parser.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        mock_client.return_value.__aenter__.return_value.__aexit__ = AsyncMock(return_value=None)
        
        with patch.object(settings, "GROQ_API_KEY", "test-key"):
            for test_case in TEST_INPUTS[:3]:  # Test first 3 cases
                request = IntentRequest(user_message=test_case["message"])
                result = await parse_intent(request)
                
                # Verify basic structure
                assert result.intent is not None
                assert 0.0 <= result.confidence <= 1.0
                
                # Verify business rules applied
                if test_case.get("should_require_approval"):
                    assert result.requires_approval is True
