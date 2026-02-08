/**
 * NEXUS Execution Mode Constants
 * Action types, risk levels, status enums, and configuration
 */

export const ACTION_TYPES = {
  API_CALL: 'api_call',
  DATA_UPDATE: 'data_update',
  PAYMENT: 'payment',
  MARKETPLACE_HIRE: 'marketplace_hire',
  NOTIFICATION: 'notification',
  FILE_OPERATION: 'file_operation',
  DATABASE_QUERY: 'database_query',
} as const

export type ActionType = typeof ACTION_TYPES[keyof typeof ACTION_TYPES]

export const RISK_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const

export type RiskLevel = typeof RISK_LEVELS[keyof typeof RISK_LEVELS]

export const SIDE_EFFECTS = {
  READ_ONLY: 'read_only',
  EXTERNAL_WRITE: 'external_write',
  PAYMENT: 'payment',
  PHYSICAL: 'physical',
  DESTRUCTIVE: 'destructive',
} as const

export type SideEffect = typeof SIDE_EFFECTS[keyof typeof SIDE_EFFECTS]

export const RUN_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REJECTED: 'rejected',
} as const

export type RunStatus = typeof RUN_STATUS[keyof typeof RUN_STATUS]

export const STEP_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const

export type StepStatus = typeof STEP_STATUS[keyof typeof STEP_STATUS]

export const APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
} as const

export type ApprovalStatus = typeof APPROVAL_STATUS[keyof typeof APPROVAL_STATUS]

export const APPROVAL_TYPE = {
  PLAN: 'plan',
  STEP: 'step',
} as const

export type ApprovalType = typeof APPROVAL_TYPE[keyof typeof APPROVAL_TYPE]

export const AGENT_ROLES = {
  PLANNER: 'planner',
  EXECUTOR: 'executor',
  VERIFIER: 'verifier',
  USER: 'user',
} as const

export type AgentRole = typeof AGENT_ROLES[keyof typeof AGENT_ROLES]

// Action types that require approval
export const APPROVAL_REQUIRED_ACTIONS: readonly ActionType[] = [
  ACTION_TYPES.PAYMENT,
  ACTION_TYPES.MARKETPLACE_HIRE,
]

// Side effects that require approval
export const APPROVAL_REQUIRED_SIDE_EFFECTS: readonly SideEffect[] = [
  SIDE_EFFECTS.PAYMENT,
  SIDE_EFFECTS.PHYSICAL,
  SIDE_EFFECTS.DESTRUCTIVE,
]

// Event types for audit logging
export const AUDIT_EVENT_TYPES = {
  RUN_CREATED: 'run_created',
  PLAN_GENERATED: 'plan_generated',
  STEP_EXECUTED: 'step_executed',
  APPROVAL_REQUESTED: 'approval_requested',
  APPROVAL_GRANTED: 'approval_granted',
  APPROVAL_REJECTED: 'approval_rejected',
  EXECUTION_STARTED: 'execution_started',
  EXECUTION_COMPLETED: 'execution_completed',
  VERIFICATION_COMPLETED: 'verification_completed',
  ERROR_OCCURRED: 'error_occurred',
} as const

export type AuditEventType = typeof AUDIT_EVENT_TYPES[keyof typeof AUDIT_EVENT_TYPES]
