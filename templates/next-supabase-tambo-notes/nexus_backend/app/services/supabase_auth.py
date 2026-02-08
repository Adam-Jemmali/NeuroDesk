"""
Supabase Auth Service - Direct API integration
Uses Supabase Auth REST API instead of direct database connection
"""
import httpx
from typing import Optional, Dict,Any
from app.config import settings
import structlog

logger = structlog.get_logger()


class SupabaseAuthService:
    """Supabase Authentication Service using REST API"""
    
    def __init__(self):
        self.url = settings.SUPABASE_URL
        self.anon_key = settings.SUPABASE_ANON_KEY
        self.auth_url = f"{self.url}/auth/v1"
        
    async def sign_up(self, email: str, password: str, username: str) -> Dict[str, Any]:
        """
        Register a new user with Supabase Auth
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.auth_url}/signup",
                json={
                    "email": email,
                    "password": password,
                    "data": {  # User metadata
                        "username": username
                    }
                },
                headers={
                    "apikey": self.anon_key,
                    "Content-Type": "application/json"
                },
                timeout=10.0
            )
            
            if response.status_code != 200:
                error_data = response.json() if response.text else {}
                error_msg = error_data.get("error_description") or error_data.get("msg") or response.text
                logger.error("Supabase signup failed", status=response.status_code, error=error_msg)
                raise Exception(f"Registration failed: {error_msg}")
            
            data = response.json()
            logger.info("User registered via Supabase Auth", email=email)
            return data
    
    async def sign_in(self, email: str, password: str) -> Dict[str, Any]:
        """
        Sign in a user with Supabase Auth
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.auth_url}/token?grant_type=password",
                json={
                    "email": email,
                    "password": password
                },
                headers={
                    "apikey": self.anon_key,
                    "Content-Type": "application/json"
                },
                timeout=10.0
            )
            
            if response.status_code != 200:
                error_data = response.json() if response.text else {}
                error_msg = error_data.get("error_description") or error_data.get("msg") or response.text
                logger.error("Supabase signin failed", status=response.status_code, error=error_msg)
                
                # Return None for invalid credentials (400/401)
                if response.status_code in [400, 401]:
                    return None
                
                raise Exception(f"Login failed: {error_msg}")
            
            data = response.json()
            logger.info("User signed in via Supabase Auth", email=email)
            return data
    
    async def get_user(self, access_token: str) -> Optional[Dict[str, Any]]:
        """
        Get user info from Supabase Auth using access token
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.auth_url}/user",
                headers={
                    "apikey": self.anon_key,
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                timeout=10.0
            )
            
            if response.status_code != 200:
                logger.error("Failed to get user", status=response.status_code)
                return None
            
            return response.json()
    
    async def refresh_token(self, refresh_token: str) -> Optional[Dict[str, Any]]:
        """
        Refresh access token using refresh token
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.auth_url}/token?grant_type=refresh_token",
                json={
                    "refresh_token": refresh_token
                },
                headers={
                    "apikey": self.anon_key,
                    "Content-Type": "application/json"
                },
                timeout=10.0
            )
            
            if response.status_code != 200:
                logger.error("Token refresh failed", status=response.status_code)
                return None
            
            return response.json()


# Singleton instance
supabase_auth = SupabaseAuthService()
