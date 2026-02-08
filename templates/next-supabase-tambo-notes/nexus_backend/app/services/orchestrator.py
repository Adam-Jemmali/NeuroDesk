"""
Orchestrator - Decomposes complex intents into multi-agent task graphs
"""
from typing import Dict, Any, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID, uuid4
from datetime import datetime
from app.models.task import Task, TaskStatus, TaskPriority
from app.schemas.intent import IntentResult
from app.services.intent_parser import parse_intent
from app.services.task_executor import TaskExecutor
from app.services.event_service import event_service
from app.agents.registry import registry
import structlog

logger = structlog.get_logger()


class Orchestrator:
    """Orchestrates multi-agent task execution with dependencies"""
    
    @staticmethod
    async def orchestrate(
        db: AsyncSession,
        user_id: UUID,
        user_message: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Task:
        """
        Orchestrate complex intent into subtasks with dependencies.
        
        Flow:
        1. Parse intent and determine complexity
        2. Decompose into subtasks if complex
        3. Create parent task and subtasks
        4. Execute with topological order
        5. Pass dependency results to dependent tasks
        """
        # Step 1: Parse intent
        from app.schemas.intent import IntentRequest
        intent_request = IntentRequest(user_message=user_message, context=context)
        intent_result = await parse_intent(intent_request)
        
        # Determine complexity
        is_complex = Orchestrator._is_complex_intent(intent_result, user_message)
        
        if not is_complex:
            # Simple intent - use TaskExecutor directly
            return await TaskExecutor.execute_task(db, user_id, user_message, context)
        
        # Step 2: Decompose into subtasks
        subtasks = Orchestrator._decompose_intent(intent_result, user_message)
        
        if len(subtasks) <= 1:
            # Not actually complex, use TaskExecutor
            return await TaskExecutor.execute_task(db, user_id, user_message, context)
        
        # Step 3: Create parent task
        parent_task = Task(
            id=uuid4(),
            title=f"Orchestrated: {intent_result.intent}",
            description=user_message,
            command=intent_result.command,
            parameters=intent_result.parameters or {},
            priority=TaskPriority.MEDIUM,
            status=TaskStatus.PENDING,
            created_by=user_id,
            result={
                "intent": intent_result.intent,
                "complexity": "multi-agent",
                "subtasks_count": len(subtasks),
            },
        )
        db.add(parent_task)
        await db.flush()
        
        # Step 4: Create subtasks with dependencies
        created_subtasks = []
        for i, subtask_spec in enumerate(subtasks):
            subtask_spec["index"] = i  # Add index to spec for dependency resolution
            subtask = Task(
                id=uuid4(),
                title=subtask_spec["title"],
                description=subtask_spec["description"],
                command=subtask_spec.get("command"),
                parameters=subtask_spec.get("parameters", {}),
                priority=TaskPriority.MEDIUM,
                status=TaskStatus.PENDING,
                created_by=user_id,
                assigned_agent_id=None,  # Will be determined by TaskExecutor
                result={
                    "parent_task_id": str(parent_task.id),
                    "subtask_index": i,
                    "dependencies": subtask_spec.get("dependencies", []),
                    "agent_type": subtask_spec.get("agent_type"),
                },
            )
            db.add(subtask)
            created_subtasks.append({
                "task": subtask,
                "spec": subtask_spec,
            })
        
        await db.commit()
        await db.refresh(parent_task)
        
        # Publish event: task_created (parent task)
        await event_service.publish(
            user_id,
            "task_created",
            {
                "task_id": str(parent_task.id),
                "title": parent_task.title,
                "status": parent_task.status.value,
                "is_orchestrated": True,
                "subtasks_count": len(subtasks),
            }
        )
        
        # Step 5: Execute subtasks in topological order
        parent_task.status = TaskStatus.IN_PROGRESS
        parent_task.started_at = datetime.utcnow()
        
        # Publish event: status_changed (parent task)
        await event_service.publish(
            user_id,
            "status_changed",
            {
                "task_id": str(parent_task.id),
                "status": parent_task.status.value,
                "previous_status": "pending",
            }
        )
        
        executed_results = {}  # Store results by subtask index
        all_succeeded = True
        
        for subtask_info in created_subtasks:
            subtask = subtask_info["task"]
            spec = subtask_info["spec"]
            
            # Check dependencies
            dependencies_met = True
            dependency_results = {}
            for dep_index in spec.get("dependencies", []):
                if dep_index not in executed_results:
                    dependencies_met = False
                    break
                dependency_results[str(dep_index)] = executed_results[dep_index]
            
            if not dependencies_met:
                subtask.status = TaskStatus.FAILED
                subtask.error_message = "Dependencies not met"
                all_succeeded = False
                continue
            
            # Prepare context with dependency results
            subtask_context = context.copy() if context else {}
            subtask_context["dependency_results"] = dependency_results
            subtask_context["parent_task_id"] = str(parent_task.id)
            
            # Execute subtask
            try:
                # Use TaskExecutor for each subtask
                executed_subtask = await TaskExecutor.execute_task(
                    db, user_id, spec["description"], subtask_context
                )
                
                # Update subtask with execution results
                subtask.status = executed_subtask.status
                subtask.result = executed_subtask.result
                subtask.started_at = executed_subtask.started_at
                subtask.completed_at = executed_subtask.completed_at
                subtask.error_message = executed_subtask.error_message
                
                # Store result for dependencies (use subtask index)
                subtask_index = spec.get("index", len(executed_results))
                executed_results[subtask_index] = {
                    "status": executed_subtask.status.value,
                    "result": executed_subtask.result,
                    "data": executed_subtask.result.get("agent_result", {}) if executed_subtask.result else {},
                    "summary": executed_subtask.result.get("agent_result", {}).get("summary", "") if executed_subtask.result else "",
                }
                
                if executed_subtask.status != TaskStatus.COMPLETED:
                    all_succeeded = False
                    
            except Exception as e:
                logger.error("Subtask execution failed", subtask_id=str(subtask.id), error=str(e))
                subtask.status = TaskStatus.FAILED
                subtask.error_message = str(e)
                all_succeeded = False
        
        # Update parent task status
        if all_succeeded:
            parent_task.status = TaskStatus.COMPLETED
        else:
            parent_task.status = TaskStatus.FAILED
            parent_task.error_message = "One or more subtasks failed"
        
        parent_task.completed_at = datetime.utcnow()
        
        # Aggregate results
        if parent_task.result is None:
            parent_task.result = {}
        parent_task.result["subtask_results"] = executed_results
        parent_task.result["all_succeeded"] = all_succeeded
        
        await db.commit()
        await db.refresh(parent_task)
        
        # Publish event: task_completed (parent task)
        await event_service.publish(
            user_id,
            "task_completed",
            {
                "task_id": str(parent_task.id),
                "status": parent_task.status.value,
                "success": all_succeeded,
                "subtasks_count": len(created_subtasks),
            }
        )
        
        return parent_task
    
    @staticmethod
    def _is_complex_intent(intent_result: IntentResult, user_message: str) -> bool:
        """Determine if intent requires multiple agents"""
        message_lower = user_message.lower()
        
        # Check for multiple action keywords
        action_keywords = {
            "research": ["research", "search", "find", "lookup"],
            "communication": ["email", "send", "draft", "message"],
            "purchase": ["buy", "purchase", "product", "price"],
        }
        
        found_actions = []
        for action, keywords in action_keywords.items():
            if any(keyword in message_lower for keyword in keywords):
                found_actions.append(action)
        
        # Complex if multiple distinct actions
        return len(set(found_actions)) > 1
    
    @staticmethod
    def _decompose_intent(intent_result: IntentResult, user_message: str) -> List[Dict[str, Any]]:
        """Decompose complex intent into subtasks"""
        message_lower = user_message.lower()
        subtasks = []
        
        # Pattern: "Research X and draft email"
        if "research" in message_lower and ("email" in message_lower or "draft" in message_lower):
            # Extract research query
            research_query = user_message
            if "and" in message_lower:
                parts = user_message.split(" and ", 1)
                research_query = parts[0].replace("research", "").strip()
            
            # Subtask 1: Research
            subtasks.append({
                "title": "Research Task",
                "description": f"Research: {research_query}",
                "agent_type": "research",
                "dependencies": [],
            })
            
            # Subtask 2: Draft email (depends on research)
            email_description = f"Draft email based on research about: {research_query}"
            if "email" in message_lower:
                # Extract email recipient if mentioned
                email_parts = user_message.split("email", 1)
                if len(email_parts) > 1:
                    email_description += f" {email_parts[1]}"
            
            subtasks.append({
                "title": "Email Draft Task",
                "description": email_description,
                "agent_type": "communication",
                "dependencies": [0],  # Depends on first subtask (research)
                "parameters": {
                    "action": "draft",
                    "include_research": True,
                },
            })
        
        # Pattern: "Research products and compare prices"
        elif "research" in message_lower and ("compare" in message_lower or "price" in message_lower):
            query = user_message.replace("research", "").replace("compare", "").replace("prices", "").strip()
            
            subtasks.append({
                "title": "Product Research",
                "description": f"Research products: {query}",
                "agent_type": "research",
                "dependencies": [],
            })
            
            subtasks.append({
                "title": "Price Comparison",
                "description": f"Compare prices for: {query}",
                "agent_type": "purchase",
                "dependencies": [0],
            })
        
        # Default: Single task if no pattern matches
        if not subtasks:
            subtasks.append({
                "title": "Execute Task",
                "description": user_message,
                "agent_type": None,  # Will be determined by TaskExecutor
                "dependencies": [],
            })
        
        return subtasks
