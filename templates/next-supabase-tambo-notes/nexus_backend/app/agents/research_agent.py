"""
Research Agent - Web research using Brave Search + scraping + summarization
"""
from typing import Dict, Any, Optional, List
from app.agents.base import BaseAgent, AgentResult
from app.agents.registry import registry
from app.config import settings
import httpx
from bs4 import BeautifulSoup
import structlog

logger = structlog.get_logger()

BRAVE_API_KEY = getattr(settings, "BRAVE_API_KEY", None)
MAX_SOURCES = 5
MAX_CONTENT_LENGTH = 5000  # Characters per source


@registry.register("research", "Research Agent", "Researches topics using web search and summarization")
class ResearchAgent(BaseAgent):
    """Agent that researches topics using Brave Search, scrapes content, and summarizes"""
    
    def __init__(self, agent_id: str, name: str = "Research Agent", description: str = ""):
        super().__init__(agent_id, name, description or "Researches topics using web search and summarization")
        self.brave_api_key = BRAVE_API_KEY or settings.BRAVE_API_KEY if hasattr(settings, "BRAVE_API_KEY") else None
    
    async def execute(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute research task"""
        query = task.get("query") or task.get("message") or task.get("text", "")
        if not query:
            return AgentResult(
                success=False,
                error="Query is required for research",
            )
        
        try:
            # Step 1: Search for sources
            sources = await self._search_sources(query)
            
            if not sources:
                return AgentResult(
                    success=False,
                    error="No sources found for query",
                )
            
            # Step 2: Scrape and process content
            processed_sources = await self._scrape_and_process(sources)
            
            # Step 3: Summarize using Groq
            summary = await self._summarize(query, processed_sources)
            
            return AgentResult(
                success=True,
                data={
                    "query": query,
                    "summary": summary.get("summary", ""),
                    "findings": summary.get("findings", []),
                    "recommendations": summary.get("recommendations", []),
                },
                sources=processed_sources,
                metadata={
                    "sources_count": len(processed_sources),
                    "search_method": "brave" if self.brave_api_key else "duckduckgo",
                },
            )
            
        except Exception as e:
            logger.error("Research agent execution failed", error=str(e), exc_info=True)
            return AgentResult(
                success=False,
                error=f"Research failed: {str(e)}",
            )
    
    async def _search_sources(self, query: str) -> List[Dict[str, Any]]:
        """Search for sources using Brave API or DuckDuckGo fallback"""
        if self.brave_api_key:
            return await self._search_brave(query)
        else:
            return await self._search_duckduckgo(query)
    
    async def _search_brave(self, query: str) -> List[Dict[str, Any]]:
        """Search using Brave Search API"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={
                        "Accept": "application/json",
                        "X-Subscription-Token": self.brave_api_key,
                    },
                    params={
                        "q": query,
                        "count": MAX_SOURCES,
                    },
                )
                response.raise_for_status()
                data = response.json()
                
                sources = []
                for result in data.get("web", {}).get("results", [])[:MAX_SOURCES]:
                    sources.append({
                        "title": result.get("title", ""),
                        "url": result.get("url", ""),
                        "description": result.get("description", ""),
                    })
                
                logger.info("Brave search completed", query=query, sources_found=len(sources))
                return sources
                
        except Exception as e:
            logger.warning("Brave search failed, falling back to DuckDuckGo", error=str(e))
            return await self._search_duckduckgo(query)
    
    async def _search_duckduckgo(self, query: str) -> List[Dict[str, Any]]:
        """Fallback: Search using DuckDuckGo HTML scraping"""
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    "https://html.duckduckgo.com/html/",
                    params={"q": query},
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                )
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, "html.parser")
                sources = []
                
                for result in soup.select("div.result")[:MAX_SOURCES]:
                    title_elem = result.select_one("a.result__a")
                    snippet_elem = result.select_one("a.result__snippet")
                    
                    if title_elem:
                        sources.append({
                            "title": title_elem.get_text(strip=True),
                            "url": title_elem.get("href", ""),
                            "description": snippet_elem.get_text(strip=True) if snippet_elem else "",
                        })
                
                logger.info("DuckDuckGo search completed", query=query, sources_found=len(sources))
                return sources
                
        except Exception as e:
            logger.error("DuckDuckGo search failed", error=str(e))
            return []
    
    async def _scrape_and_process(self, sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Scrape content from sources and process"""
        processed = []
        
        for source in sources:
            try:
                url = source.get("url")
                if not url:
                    continue
                
                # Scrape content
                content = await self._scrape_url(url)
                
                if content:
                    processed.append({
                        "title": source.get("title", ""),
                        "url": url,
                        "description": source.get("description", ""),
                        "content": content[:MAX_CONTENT_LENGTH],  # Truncate
                        "content_length": len(content),
                    })
            except Exception as e:
                logger.warning("Failed to scrape source", url=source.get("url"), error=str(e))
                # Include source even if scraping failed
                processed.append({
                    "title": source.get("title", ""),
                    "url": source.get("url", ""),
                    "description": source.get("description", ""),
                    "content": "",
                    "error": str(e),
                })
        
        return processed
    
    async def _scrape_url(self, url: str) -> str:
        """Scrape text content from a URL"""
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                )
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, "html.parser")
                
                # Remove script and style elements
                for script in soup(["script", "style"]):
                    script.decompose()
                
                # Get text content
                text = soup.get_text(separator=" ", strip=True)
                return text
                
        except Exception as e:
            logger.warning("Failed to scrape URL", url=url, error=str(e))
            return ""
    
    async def _summarize(self, query: str, sources: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Summarize research using Groq"""
        from app.services.intent_parser import parse_intent_groq
        
        # Prepare context from sources
        context_text = "\n\n".join([
            f"Source {i+1}: {s.get('title', '')}\n{s.get('content', s.get('description', ''))[:1000]}"
            for i, s in enumerate(sources[:3])  # Use top 3 sources for summary
        ])
        
        prompt = f"""Based on the following research sources, provide:
1. A comprehensive summary
2. Key findings (as a list)
3. Recommendations (as a list)

Query: {query}

Sources:
{context_text}

Return JSON with keys: summary, findings (array), recommendations (array)"""
        
        try:
            # Use Groq for summarization (reusing intent parser's Groq function)
            groq_api_key = getattr(settings, "GROQ_API_KEY", None)
            if not groq_api_key:
                # Fallback to simple summary
                return {
                    "summary": f"Research on '{query}' found {len(sources)} sources.",
                    "findings": [s.get("title", "") for s in sources[:3]],
                    "recommendations": ["Review the sources for more details"],
                }
            
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
                            {"role": "system", "content": "You are a research assistant. Return JSON only."},
                            {"role": "user", "content": prompt},
                        ],
                        "temperature": 0.3,
                        "response_format": {"type": "json_object"},
                    },
                )
                response.raise_for_status()
                data = response.json()
                
                import json
                content = data["choices"][0]["message"]["content"]
                result = json.loads(content)
                
                return {
                    "summary": result.get("summary", ""),
                    "findings": result.get("findings", []),
                    "recommendations": result.get("recommendations", []),
                }
                
        except Exception as e:
            logger.warning("Groq summarization failed, using fallback", error=str(e))
            # Fallback summary
            return {
                "summary": f"Research on '{query}' found {len(sources)} sources. Review the sources for detailed information.",
                "findings": [s.get("title", "") for s in sources[:3]],
                "recommendations": ["Review the provided sources for comprehensive information"],
            }
    
    async def estimate_cost_and_risk(self, task: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Research agent has minimal cost, low risk"""
        return {
            "cost": 0.01,  # Minimal API cost
            "risk_level": "low",
            "requires_approval": False,
        }
