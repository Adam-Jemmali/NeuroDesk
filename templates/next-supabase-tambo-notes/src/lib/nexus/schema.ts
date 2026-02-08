/**
 * NEXUS Execution Mode TypeScript Types
 * Matches the database schema
 */

import type {
  ActionType,
  RiskLevel,
  SideEffect,
  RunStatus,
  StepStatus,
  ApprovalStatus,
  ApprovalType,
  AgentRole,
  AuditEventType,
} from './constants'

export interface NexusRun {
  id: string
  user_id: string
  mode: 'simulation' | 'execution'
  user_message: string
  status: RunStatus
  created_at: string
  completed_at: string | null
  error_message: string | null
}

export interface TaskPlan {
  id: string
  run_id: string
  plan_json: Record<string, unknown>
  estimated_cost: number
  risk_level: RiskLevel
  created_at: string
}

export interface TaskStep {
  id: string
  plan_id: string
  step_number: number
  action_type: ActionType
  description: string
  parameters: Record<string, unknown> | null
  estimated_cost: number
  requires_approval: boolean
  risk_level: RiskLevel
  side_effect: SideEffect
  status: StepStatus
  result: Record<string, unknown> | null
  executed_at: string | null
  error_message: string | null
}

export interface Approval {
  id: string
  run_id: string
  step_id: string | null
  approval_type: ApprovalType
  reason: string
  status: ApprovalStatus
  requested_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  review_notes: string | null
  expires_at: string | null
}

export interface AuditLog {
  id: string
  run_id: string | null
  step_id: string | null
  user_id: string
  event_type: AuditEventType
  agent_role: AgentRole | null
  message: string
  metadata: Record<string, unknown> | null
  created_at: string
}

// Request/Response types for API endpoints

export interface CreatePlanRequest {
  user_message: string
  mode?: 'simulation' | 'execution'
}

export interface CreatePlanResponse {
  run_id: string
  plan_id: string
  plan: TaskPlan
  steps: TaskStep[]
  approvals: Approval[]
}

export interface ExecuteRequest {
  run_id: string
}

export interface ExecuteResponse {
  run_id: string
  executed_steps: TaskStep[]
  failed_steps: TaskStep[]
  progress: {
    total: number
    completed: number
    failed: number
  }
}

export interface VerifyRequest {
  run_id: string
  step_id?: string
}

export interface VerifyResponse {
  run_id: string
  verified: boolean
  summary: string
  issues: string[]
}
