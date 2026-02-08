"""
End-to-end test script for NEXUS Backend
Tests the full flow: register, login, create task, wait, verify, check spending, check audit logs
"""
import asyncio
import httpx
import json
import time
from typing import Dict, Any, Optional
from uuid import UUID

# Configuration
BASE_URL = "http://localhost:8000"
API_PREFIX = "/api/v1"

# Test user credentials
TEST_EMAIL = f"test_{int(time.time())}@example.com"
TEST_PASSWORD = "test_password_123"
TEST_USERNAME = f"testuser_{int(time.time())}"

# Global state
access_token: Optional[str] = None
refresh_token: Optional[str] = None
user_id: Optional[str] = None
task_id: Optional[str] = None


async def check_server_health() -> bool:
    """Check if the server is running and healthy"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{BASE_URL}/health", timeout=5.0)
            return response.status_code == 200
    except Exception:
        return False


async def make_request(
    method: str,
    endpoint: str,
    data: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 60.0,
) -> Dict[str, Any]:
    """Make HTTP request to API"""
    url = f"{BASE_URL}{API_PREFIX}{endpoint}"
    default_headers = {"Content-Type": "application/json"}
    if access_token:
        default_headers["Authorization"] = f"Bearer {access_token}"
    if headers:
        default_headers.update(headers)
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if method == "GET":
                response = await client.get(url, headers=default_headers, timeout=timeout)
            elif method == "POST":
                response = await client.post(url, headers=default_headers, json=data, timeout=timeout)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json()
    except httpx.ConnectError as e:
        raise ConnectionError(f"Cannot connect to server at {BASE_URL}. Is the server running?") from e
    except httpx.ReadTimeout as e:
        raise TimeoutError(f"Request to {url} timed out after {timeout}s") from e
    except httpx.HTTPStatusError as e:
        error_detail = "Unknown error"
        try:
            error_detail = e.response.json().get("detail", str(e.response.text))
        except:
            error_detail = str(e.response.text)
        raise ValueError(f"HTTP {e.response.status_code}: {error_detail}") from e


async def register_user() -> Dict[str, Any]:
    """Step 1: Register a new user"""
    print(f"\n[1/7] Registering user: {TEST_EMAIL}")
    data = {
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "username": TEST_USERNAME,
    }
    result = await make_request("POST", "/auth/register", data=data)
    global access_token, refresh_token
    access_token = result["access_token"]
    refresh_token = result["refresh_token"]
    print(f"✓ User registered successfully")
    return result


async def login_user() -> Dict[str, Any]:
    """Step 2: Login user"""
    print(f"\n[2/7] Logging in user: {TEST_EMAIL}")
    data = {
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
    }
    result = await make_request("POST", "/auth/login", data=data)
    global access_token, refresh_token
    access_token = result["access_token"]
    refresh_token = result["refresh_token"]
    print(f"✓ User logged in successfully")
    return result


async def get_current_user() -> Dict[str, Any]:
    """Get current user info"""
    result = await make_request("GET", "/auth/me")
    global user_id
    user_id = result["id"]
    return result


async def create_research_task() -> Dict[str, Any]:
    """Step 3: Create a research task"""
    print(f"\n[3/7] Creating research task...")
    data = {
        "title": "Test Task",
        "command": "execute",
        "user_message": "Research the best programming languages for AI development in 2024",
        "context": {},
    }
    result = await make_request("POST", "/tasks", data=data)
    global task_id
    task_id = result["id"]
    print(f"✓ Task created: {task_id}")
    print(f"  Status: {result['status']}")
    return result


async def wait_for_task_completion(max_wait: int = 60, poll_interval: int = 2) -> Dict[str, Any]:
    """Step 4: Wait for task to complete"""
    print(f"\n[4/7] Waiting for task completion (max {max_wait}s)...")
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        result = await make_request("GET", f"/tasks/{task_id}")
        status = result["status"]
        
        print(f"  Status: {status} (elapsed: {int(time.time() - start_time)}s)")
        
        if status == "completed":
            print(f"✓ Task completed successfully")
            return result
        elif status == "failed":
            error = result.get("error_message", "Unknown error")
            print(f"✗ Task failed: {error}")
            return result
        elif status == "pending":
            # Check if approval is needed
            if result.get("result", {}).get("requires_approval"):
                print(f"  Task requires approval - approving...")
                await make_request("POST", f"/tasks/{task_id}/approve", data={"notes": "E2E test approval"})
                print(f"✓ Task approved")
        
        await asyncio.sleep(poll_interval)
    
    print(f"✗ Task did not complete within {max_wait}s")
    return result


async def verify_task_result() -> Dict[str, Any]:
    """Step 5: Verify task result"""
    print(f"\n[5/7] Verifying task result...")
    result = await make_request("GET", f"/tasks/{task_id}")
    
    assert result["status"] == "completed", f"Expected completed, got {result['status']}"
    assert "result" in result, "Task result missing"
    assert result["result"] is not None, "Task result is None"
    
    # Check for agent result
    agent_result = result["result"].get("agent_result", {})
    if agent_result:
        print(f"✓ Task has agent result")
        if "summary" in agent_result:
            print(f"  Summary: {agent_result['summary'][:100]}...")
        if "sources" in agent_result:
            print(f"  Sources: {len(agent_result['sources'])} found")
    
    print(f"✓ Task result verified")
    return result


async def check_spending() -> Dict[str, Any]:
    """Step 6: Check spending endpoint"""
    print(f"\n[6/7] Checking spending summary...")
    result = await make_request("GET", "/budget/summary")
    
    print(f"✓ Spending summary retrieved:")
    print(f"  Daily spent: ${result.get('daily_spent', 0):.2f} / ${result.get('daily_limit', 0):.2f}")
    print(f"  Monthly spent: ${result.get('monthly_spent', 0):.2f} / ${result.get('monthly_limit', 0):.2f}")
    
    return result


async def check_audit_logs() -> Dict[str, Any]:
    """Step 7: Check audit logs"""
    print(f"\n[7/7] Checking audit logs...")
    
    # Note: Audit logs endpoint would need to be implemented
    # For now, we'll check if we can query tasks which should have audit logs
    result = await make_request("GET", "/tasks")
    
    # Filter for our task
    our_task = next((t for t in result if t["id"] == task_id), None)
    if our_task:
        print(f"✓ Found task in task list")
        print(f"  Task ID: {our_task['id']}")
        print(f"  Status: {our_task['status']}")
        print(f"  Created: {our_task.get('created_at', 'N/A')}")
    
    # In a real implementation, there would be an /audit-logs endpoint
    print(f"✓ Audit log check completed (note: dedicated endpoint not yet implemented)")
    
    return result


async def run_e2e_test():
    """Run the complete E2E test flow"""
    print("=" * 60)
    print("NEXUS Backend E2E Test")
    print("=" * 60)
    print(f"Base URL: {BASE_URL}")
    print(f"Test User: {TEST_EMAIL}")
    
    # Check if server is running
    print("\n[0/7] Checking server health...")
    is_healthy = await check_server_health()
    if not is_healthy:
        # Try root endpoint as fallback
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{BASE_URL}/", timeout=5.0)
                if response.status_code in [200, 404]:  # 404 is OK, means server is running
                    print("✓ Server is running (health endpoint not available)")
                    is_healthy = True
        except Exception:
            pass
    
    if not is_healthy:
        print(f"✗ Server is not responding at {BASE_URL}")
        print("  Please start the server with: uvicorn app.main:app --reload")
        raise ConnectionError(f"Cannot connect to server at {BASE_URL}")
    
    print("✓ Server is running")
    
    try:
        # Step 1: Register
        await register_user()
        
        # Step 2: Login (redundant but tests login endpoint)
        await login_user()
        
        # Get user info
        user_info = await get_current_user()
        print(f"\nUser ID: {user_info['id']}")
        
        # Step 3: Create research task
        task = await create_research_task()
        
        # Step 4: Wait for completion
        completed_task = await wait_for_task_completion()
        
        # Step 5: Verify result
        await verify_task_result()
        
        # Step 6: Check spending
        await check_spending()
        
        # Step 7: Check audit logs
        await check_audit_logs()
        
        print("\n" + "=" * 60)
        print("✓ E2E Test PASSED")
        print("=" * 60)
        
    except ConnectionError as e:
        print(f"\n✗ Connection Error: {e}")
        print("  Make sure the server is running:")
        print("    cd nexus_backend")
        print("    uvicorn app.main:app --reload")
        raise
    except TimeoutError as e:
        print(f"\n✗ Timeout Error: {e}")
        print("  The server may be slow or unresponsive.")
        raise
    except ValueError as e:
        print(f"\n✗ HTTP Error: {e}")
        raise
    except Exception as e:
        print(f"\n✗ Test failed with error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        raise


if __name__ == "__main__":
    asyncio.run(run_e2e_test())
