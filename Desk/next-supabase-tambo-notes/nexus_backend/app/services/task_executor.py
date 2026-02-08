"""
Task Executor - Orchestrates intent parsing, task creation, approval, and agent execution
"""
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID, uuid4
from datetime import datetime
from app.models.task import Task, TaskStatus
from app.models.transaction import Transaction, TransactionType, TransactionStatus
from app.models.audit_log import AuditLog, AuditEventType
from app.schemas.intent import IntentRequest
from app.services.intent_parser import parse_intent
from app.services.budget_service import BudgetService
from app.services.approval_service import ApprovalService
from app.services.policy_service import PolicyService
from app.services.event_service import event_service
from app.agents.registry import registry
from app.config import settings
import structlog

logger = structlog.get_logger()


class TaskExecutor:
    """Executes tasks with intent parsing, approval, and agent execution"""
    
    @staticmethod
    async def execute_task(
        db: AsyncSession,
        user_id: UUID,
        user_message: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Task:
        """
        Main entry point: Parse intent, create task, check approval, execute agent.
        
        Flow:
        1. Parse intent from user message
        2. Create Task DB record
        3. Check budget (if cost > 0)
        4. Check/create approval request (if required)
        5. Execute agent (if approved or no approval needed)
        6. Store result in task
        7. Record Transaction
        8. Write AuditLog entries
        """
        # Step 1: Parse intent
        logger.info("Parsing intent", user_id=str(user_id), message_length=len(user_message))
        intent_request = IntentRequest(user_message=user_message, context=context)
        intent_result = await parse_intent(intent_request)
        
        # Step 2: Create Task DB record
        task = Task(
            id=uuid4(),
            title=f"Task: {intent_result.intent}",
            description=user_message,
            command=intent_result.command,
            parameters=intent_result.parameters or {},
            priority=TaskPriority.MEDIUM,  # Default priority
            status=TaskStatus.PENDING,
            created_by=user_id,
            result={
                "intent": intent_result.intent,
                "confidence": intent_result.confidence,
                "entities": intent_result.entities,
            },
        )
        db.add(task)
        await db.flush()  # Get task.id
        
        # Audit: Task created
        await TaskExecutor._log_audit(
            db, user_id, AuditEventType.TASK_CREATED,
            f"Task {task.id} created", task_id=task.id
        )
        
        # Publish event: task_created
        await event_service.publish(
            user_id,
            "task_created",
            {
                "task_id": str(task.id),
                "title": task.title,
                "status": task.status.value,
                "intent": intent_result.intent,
            }
        )
        
        # Step 3: Check budget (if cost > 0)
        if intent_result.estimated_cost and intent_result.estimated_cost > 0:
            is_allowed, error_message = await BudgetService.check_budget(
                db, user_id, intent_result.estimated_cost, "daily"
            )
            if not is_allowed:
                task.status = TaskStatus.FAILED
                task.error_message = error_message
                await db.commit()
                
                await TaskExecutor._log_audit(
                    db, user_id, AuditEventType.TASK_FAILED,
                    f"Task {task.id} failed: budget exceeded", task_id=task.id
                )
                return task
        
        # Step 4: Check/create approval request
        if intent_result.requires_approval:
            logger.info("Approval required", task_id=str(task.id))
            approval_data = await ApprovalService.create_approval_request(
                db, task.id, intent_result, user_id
            )
            task.status = TaskStatus.PENDING
            
            await TaskExecutor._log_audit(
                db, user_id, AuditEventType.SECURITY_EVENT,
                f"Approval requested for task {task.id}", task_id=task.id
            )
            
            # Publish event: approval_needed
            await event_service.publish(
                user_id,
                "approval_needed",
                {
                    "task_id": str(task.id),
                    "title": task.title,
                    "risk_level": intent_result.risk_level,
                    "estimated_cost": intent_result.estimated_cost,
                }
            )
            
            await db.commit()
            await db.refresh(task)
            return task  # Task pending approval
        
        # Step 5: Execute agent (no approval needed or auto-approved)
        task.status = TaskStatus.IN_PROGRESS
        task.started_at = datetime.utcnow()
        await db.commit()
        await db.refresh(task)
        
        await TaskExecutor._log_audit(
            db, user_id, AuditEventType.TASK_CREATED,
            f"Task {task.id} started execution", 
            task_id=task.id, ip_address=ip_address, user_agent=user_agent
        )
        
        # Publish event: status_changed
        await event_service.publish(
            user_id,
            "status_changed",
            {
                "task_id": str(task.id),
                "status": task.status.value,
                "previous_status": "pending",
            }
        )
        
        # Publish event: agent_started
        await event_service.publish(
            user_id,
            "agent_started",
            {
                "task_id": str(task.id),
                "agent_type": agent_type,
            }
        )
        
        # Determine agent type from intent/command
        agent_type = TaskExecutor._determine_agent_type(intent_result)
        
        if not agent_type:
            task.status = TaskStatus.FAILED
            task.error_message = "No suitable agent found for this intent"
            await db.commit()
            return task
        
        # Get agent from registry
        agent = registry.get(agent_type)
        if not agent:
            task.status = TaskStatus.FAILED
            task.error_message = f"Agent type '{agent_type}' not found"
            await db.commit()
            return task
        
        # Prepare task data for agent
        agent_task = {
            "id": str(task.id),
            "query": user_message,
            "message": user_message,
            "text": user_message,
            "command": intent_result.command,
            "parameters": intent_result.parameters or {},
        }
        
        agent_context = {
            "user_id": str(user_id),
            "task_id": str(task.id),
            "intent": intent_result.intent,
        }
        if context:
            agent_context.update(context)
        
        # If dependency results exist, include them in agent task
        if context and "dependency_results" in context:
            # Include research summary in email draft if available
            if agent_type == "communication" and "dependency_results" in context:
                dep_results = context["dependency_results"]
                # Find research result (usually first dependency with index "0")
                for dep_key, dep_data in dep_results.items():
                    if isinstance(dep_data, dict):
                        # Check for summary in data or result
                        summary = None
                        if "summary" in dep_data.get("data", {}):
                            summary = dep_data["data"]["summary"]
                        elif "summary" in dep_data:
                            summary = dep_data["summary"]
                        
                        if summary:
                            agent_task["research_summary"] = summary
                            agent_task["message"] = f"{user_message}\n\nResearch findings:\n{summary}"
                            break
        
        # Execute agent
        try:
            logger.info("Executing agent", agent_type=agent_type, task_id=str(task.id))
            agent_result = await agent.run(agent_task, agent_context)
            
            # Step 6: Store result in task
            if agent_result.success:
                task.status = TaskStatus.COMPLETED
                task.completed_at = datetime.utcnow()
                
                # Update task result with agent output
                if task.result is None:
                    task.result = {}
                task.result.update({
                    "agent_result": agent_result.data,
                    "sources": agent_result.sources,
                    "execution_time_ms": agent_result.execution_time_ms,
                })
                
                await TaskExecutor._log_audit(
                    db, user_id, AuditEventType.TASK_COMPLETED,
                    f"Task {task.id} completed successfully", task_id=task.id
                )
                
                # Publish event: agent_completed
                await event_service.publish(
                    user_id,
                    "agent_completed",
                    {
                        "task_id": str(task.id),
                        "agent_type": agent_type,
                        "success": True,
                        "execution_time_ms": agent_result.execution_time_ms,
                    }
                )
                
                # Publish event: task_completed
                await event_service.publish(
                    user_id,
                    "task_completed",
                    {
                        "task_id": str(task.id),
                        "status": task.status.value,
                        "success": True,
                    }
                )
            else:
                task.status = TaskStatus.FAILED
                task.error_message = agent_result.error
                task.completed_at = datetime.utcnow()
                
                # Sanitize error message
                sanitized_error = PolicyService.sanitize_error_message(
                    Exception(agent_result.error), agent_result.error
                )
                await TaskExecutor._log_audit(
                    db, user_id, AuditEventType.TASK_FAILED,
                    f"Task {task.id} failed: {sanitized_error}", 
                    task_id=task.id, ip_address=ip_address, user_agent=user_agent
                )
                
                # Publish event: agent_completed (failed)
                await event_service.publish(
                    user_id,
                    "agent_completed",
                    {
                        "task_id": str(task.id),
                        "agent_type": agent_type,
                        "success": False,
                        "error": agent_result.error,
                    }
                )
                
                # Publish event: status_changed (failed)
                await event_service.publish(
                    user_id,
                    "status_changed",
                    {
                        "task_id": str(task.id),
                        "status": task.status.value,
                        "previous_status": "in_progress",
                        "error": agent_result.error,
                    }
                )
            
        except Exception as e:
            logger.error("Agent execution error", error=str(e), task_id=str(task.id), exc_info=True)
            task.status = TaskStatus.FAILED
            # Sanitize error message to prevent leaking sensitive data
            sanitized_error = PolicyService.sanitize_error_message(e, str(e))
            task.error_message = f"Agent execution error: {sanitized_error}"
            task.completed_at = datetime.utcnow()
            
            await TaskExecutor._log_audit(
                db, user_id, AuditEventType.TASK_FAILED,
                f"Task {task.id} failed with exception: {sanitized_error}", 
                task_id=task.id, ip_address=ip_address, user_agent=user_agent
            )
        
        # Step 7: Record Transaction
        transaction = Transaction(
            id=uuid4(),
            transaction_type=TransactionType.COMMAND,
            status=TransactionStatus.SUCCESS if task.status == TaskStatus.COMPLETED else TransactionStatus.FAILED,
            task_id=task.id,
            request_data={
                "user_message": user_message,
                "intent": intent_result.intent,
                "agent_type": agent_type,
            },
            response_data=task.result,
            cost=intent_result.estimated_cost or 0.0,
            created_by=user_id,
            started_at=task.started_at,
            completed_at=task.completed_at,
        )
        db.add(transaction)
        
        # Step 8: Record spending if cost > 0
        if intent_result.estimated_cost and intent_result.estimated_cost > 0:
            await BudgetService.record_spending(
                db, user_id, intent_result.estimated_cost, transaction.id
            )
        
        await db.commit()
        await db.refresh(task)
        
        await TaskExecutor._log_audit(
            db, user_id, AuditEventType.TRANSACTION_COMPLETED,
            f"Transaction {transaction.id} recorded for task {task.id}",
            task_id=task.id, transaction_id=transaction.id, 
            ip_address=ip_address, user_agent=user_agent
        )
        
        return task
    
    @staticmethod
    def _determine_agent_type(intent_result) -> Optional[str]:
        """Determine agent type from intent result"""
        intent = intent_result.intent.lower()
        command = (intent_result.command or "").lower()
        
        # Research-related
        if any(keyword in intent for keyword in ["research", "search", "find", "lookup"]):
            return "research"
        
        # Communication-related
        if any(keyword in intent for keyword in ["email", "send", "draft", "communicate", "message"]):
            return "communication"
        
        # Purchase/product-related
        if any(keyword in intent for keyword in ["purchase", "buy", "product", "price", "compare"]):
            return "purchase"
        
        # Check command
        if "research" in command:
            return "research"
        if "email" in command or "send" in command:
            return "communication"
        if "purchase" in command or "buy" in command:
            return "purchase"
        
        # Default to research for unknown intents
        return "research"
    
    @staticmethod
    async def _log_audit(
        db: AsyncSession,
        user_id: UUID,
        event_type: AuditEventType,
        description: str,
        task_id: Optional[UUID] = None,
        transaction_id: Optional[UUID] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> None:
        """Create audit log entry with IP address and user agent"""
        audit_log = AuditLog(
            id=uuid4(),
            event_type=event_type,
            event_name=event_type.value,
            description=description,
            user_id=user_id,
            task_id=task_id,
            transaction_id=transaction_id,
            ip_address=ip_address,
            user_agent=user_agent,
            created_at=datetime.utcnow(),
        )
        db.add(audit_log)
        await db.flush()
