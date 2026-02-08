/**
 * Audit Logger Utility
 * Logs all events to the audit_logs table
 */

import { createServerClient } from '@/lib/supabaseServer'
import type { AuditLog, AgentRole, AuditEventType } from './schema'
import type { AUDIT_EVENT_TYPES } from './constants'

export interface AuditLogMetadata {
  [key: string]: unknown
}

export class AuditLogger {
  /**
   * Log an event to the audit log
   */
  static async log(
    userId: string,
    eventType: AuditEventType,
    message: string,
    options?: {
      runId?: string
      stepId?: string
      agentRole?: AgentRole
      metadata?: AuditLogMetadata
    }
  ): Promise<void> {
    try {
      const supabase = createServerClient()
      
      const { error } = await supabase.from('audit_logs').insert({
        user_id: userId,
        run_id: options?.runId || null,
        step_id: options?.stepId || null,
        event_type: eventType,
        agent_role: options?.agentRole || null,
        message,
        metadata: options?.metadata || null,
      })

      if (error) {
        console.error('[AuditLogger] Failed to log event:', error)
        // Don't throw - audit logging failures shouldn't break the app
      }
    } catch (error) {
      console.error('[AuditLogger] Unexpected error logging event:', error)
      // Don't throw - audit logging failures shouldn't break the app
    }
  }

  /**
   * Convenience methods for common event types
   */
  static async logRunCreated(userId: string, runId: string, message: string, metadata?: AuditLogMetadata) {
    return this.log(userId, 'run_created', message, { runId, metadata })
  }

  static async logPlanGenerated(userId: string, runId: string, message: string, metadata?: AuditLogMetadata) {
    return this.log(userId, 'plan_generated', message, { runId, agentRole: 'planner', metadata })
  }

  static async logStepExecuted(
    userId: string,
    runId: string,
    stepId: string,
    message: string,
    metadata?: AuditLogMetadata
  ) {
    return this.log(userId, 'step_executed', message, { runId, stepId, agentRole: 'executor', metadata })
  }

  static async logApprovalRequested(
    userId: string,
    runId: string,
    stepId: string | null,
    message: string,
    metadata?: AuditLogMetadata
  ) {
    return this.log(userId, 'approval_requested', message, { runId, stepId, agentRole: 'planner', metadata })
  }

  static async logApprovalGranted(
    userId: string,
    runId: string,
    stepId: string | null,
    message: string,
    metadata?: AuditLogMetadata
  ) {
    return this.log(userId, 'approval_granted', message, { runId, stepId, agentRole: 'user', metadata })
  }

  static async logApprovalRejected(
    userId: string,
    runId: string,
    stepId: string | null,
    message: string,
    metadata?: AuditLogMetadata
  ) {
    return this.log(userId, 'approval_rejected', message, { runId, stepId, agentRole: 'user', metadata })
  }

  static async logExecutionStarted(userId: string, runId: string, message: string, metadata?: AuditLogMetadata) {
    return this.log(userId, 'execution_started', message, { runId, agentRole: 'executor', metadata })
  }

  static async logExecutionCompleted(userId: string, runId: string, message: string, metadata?: AuditLogMetadata) {
    return this.log(userId, 'execution_completed', message, { runId, agentRole: 'executor', metadata })
  }

  static async logVerificationCompleted(userId: string, runId: string, message: string, metadata?: AuditLogMetadata) {
    return this.log(userId, 'verification_completed', message, { runId, agentRole: 'verifier', metadata })
  }

  static async logError(
    userId: string,
    runId: string | null,
    stepId: string | null,
    message: string,
    metadata?: AuditLogMetadata
  ) {
    return this.log(userId, 'error_occurred', message, { runId, stepId, metadata })
  }
}
