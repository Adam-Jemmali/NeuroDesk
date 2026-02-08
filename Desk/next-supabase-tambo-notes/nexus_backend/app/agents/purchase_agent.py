"""
Purchase Agent - Product research and recommendations (no purchasing)
"""
from typing import Dict, Any, Optional, List
from app.agents.base import BaseAgent, AgentResult
from app.agents.registry import registry
from app.config import settings
import httpx
import structlog
import json

logger = structlog.get_logger()

BRAVE_API_KEY = getattr(settings, "BRAVE_API_KEY", None)
COINGECKO_API_URL = "https://api.coingecko.com/api/v3"


@registry.register("purchase", "Purchase Agent", "Researches products and provides recommendations (no purchasing)")
class PurchaseAgent(BaseAgent):
    """Agent that researches products and recommends options but never purchases"""
    
    def __init__(self, agent_id: str, name: str = "Purchase Agent", description: str = ""):
        super().__init__(agent_id, name, description or "Researches products and provides recommendations")
        self.brave_api_key = BRAVE_API_KEY or (settings.BRAVE_API_KEY if hasattr(settings, "BRAVE_API_KEY") else None)
    
    async def execute(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute purchase research task"""
        query = task.get("query") or task.get("product") or task.get("message", "")
        if not query:
            return AgentResult(
                success=False,
                error="Product query is required",
            )
        
        try:
            # Check if it's a crypto query
            is_crypto = await self._is_crypto_query(query)
            
            if is_crypto:
                # Get crypto price
                crypto_data = await self._get_crypto_price(query)
                return AgentResult(
                    success=True,
                    data={
                        "query": query,
                        "type": "crypto",
                        "price_data": crypto_data,
                        "recommendation": f"Current price information for {query}",
                    },
                    metadata={"is_crypto": True},
                )
            
            # Regular product research
            products = await self._research_products(query)
            comparison = await self._compare_products(query, products)
            budget_analysis = await self._analyze_budget(products)
            
            return AgentResult(
                success=True,
                data={
                    "query": query,
                    "type": "product",
                    "products": products,
                    "comparison": comparison,
                    "recommendation": comparison.get("recommendation", ""),
                    "budget_analysis": budget_analysis,
                },
                sources=[{"title": p.get("title", ""), "url": p.get("url", "")} for p in products],
                metadata={"is_crypto": False, "products_count": len(products)},
            )
            
        except Exception as e:
            logger.error("Purchase research failed", error=str(e), exc_info=True)
            return AgentResult(
                success=False,
                error=f"Purchase research failed: {str(e)}",
            )
    
    async def _is_crypto_query(self, query: str) -> bool:
        """Check if query is about cryptocurrency"""
        crypto_keywords = ["bitcoin", "btc", "ethereum", "eth", "crypto", "cryptocurrency", "coin", "token"]
        query_lower = query.lower()
        return any(keyword in query_lower for keyword in crypto_keywords)
    
    async def _get_crypto_price(self, query: str) -> Dict[str, Any]:
        """Get cryptocurrency price from CoinGecko"""
        # Extract coin name from query
        coin_id = self._extract_coin_id(query)
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{COINGECKO_API_URL}/simple/price",
                    params={
                        "ids": coin_id,
                        "vs_currencies": "usd",
                        "include_24hr_change": "true",
                    },
                )
                response.raise_for_status()
                data = response.json()
                
                if coin_id in data:
                    price_data = data[coin_id]
                    return {
                        "coin": coin_id,
                        "price_usd": price_data.get("usd"),
                        "change_24h": price_data.get("usd_24h_change"),
                    }
                else:
                    return {"error": f"Coin {coin_id} not found"}
                    
        except Exception as e:
            logger.warning("CoinGecko API failed", error=str(e))
            return {"error": f"Failed to fetch price: {str(e)}"}
    
    def _extract_coin_id(self, query: str) -> str:
        """Extract coin ID from query (simplified mapping)"""
        query_lower = query.lower()
        coin_mapping = {
            "bitcoin": "bitcoin",
            "btc": "bitcoin",
            "ethereum": "ethereum",
            "eth": "ethereum",
            "solana": "solana",
            "sol": "solana",
            "cardano": "cardano",
            "ada": "cardano",
        }
        
        for keyword, coin_id in coin_mapping.items():
            if keyword in query_lower:
                return coin_id
        
        # Default to bitcoin if no match
        return "bitcoin"
    
    async def _research_products(self, query: str) -> List[Dict[str, Any]]:
        """Research products using Brave Search + scraping"""
        # Reuse ResearchAgent's search logic
        from app.agents.research_agent import ResearchAgent
        
        research_agent = ResearchAgent("research_temp", "Research Agent", "")
        sources = await research_agent._search_sources(f"{query} product review price")
        
        # Process sources to extract product info
        products = []
        for source in sources[:5]:  # Top 5 results
            products.append({
                "title": source.get("title", ""),
                "url": source.get("url", ""),
                "description": source.get("description", ""),
                "price": None,  # Would extract from scraping
            })
        
        return products
    
    async def _compare_products(self, query: str, products: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Compare products using Groq"""
        groq_api_key = getattr(settings, "GROQ_API_KEY", None)
        if not groq_api_key:
            return {
                "recommendation": f"Found {len(products)} products. Review the sources for comparison.",
                "factors": ["price", "quality", "reviews"],
            }
        
        products_text = "\n".join([
            f"{i+1}. {p.get('title', '')} - {p.get('description', '')[:200]}"
            for i, p in enumerate(products)
        ])
        
        prompt = f"""Compare the following products for query: {query}

Products:
{products_text}

Provide:
1. A recommendation (which product to choose and why)
2. Key comparison factors
3. Pros and cons

Return JSON with keys: recommendation, factors (array), pros (array), cons (array)"""
        
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
                            {"role": "system", "content": "You are a product comparison assistant. Return JSON only."},
                            {"role": "user", "content": prompt},
                        ],
                        "temperature": 0.3,
                        "response_format": {"type": "json_object"},
                    },
                )
                response.raise_for_status()
                data = response.json()
                
                content = data["choices"][0]["message"]["content"]
                comparison = json.loads(content)
                
                return {
                    "recommendation": comparison.get("recommendation", ""),
                    "factors": comparison.get("factors", []),
                    "pros": comparison.get("pros", []),
                    "cons": comparison.get("cons", []),
                }
                
        except Exception as e:
            logger.warning("Product comparison failed", error=str(e))
            return {
                "recommendation": f"Found {len(products)} products. Review sources for detailed comparison.",
                "factors": ["price", "quality", "reviews"],
            }
    
    async def _analyze_budget(self, products: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze budget for products"""
        # Extract prices if available
        prices = [p.get("price") for p in products if p.get("price")]
        
        return {
            "products_analyzed": len(products),
            "price_range": {
                "min": min(prices) if prices else None,
                "max": max(prices) if prices else None,
            },
            "average_price": sum(prices) / len(prices) if prices else None,
            "note": "Prices extracted from research sources",
        }
    
    async def estimate_cost_and_risk(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Purchase agent is research-only, no approval needed"""
        return {
            "cost": 0.0,
            "risk_level": "low",
            "requires_approval": False,  # Research-only, no purchasing
        }
