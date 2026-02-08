/**
 * Executor Service
 * Executes task steps using appropriate connectors
 */

import { createServerClient } from '@/lib/supabaseServer'
import type { TaskStep } from './schema'
import { STEP_STATUS } from './constants'
import { AuditLogger } from './audit-logger'
import { StepExecutor } from './step-executor'

export interface ExecutionResult {
  success: boolean
  result?: Record<string, unknown>
  error?: string
}

export class ExecutorService {
  /**
   * Execute a single step
   */
  static async executeStep(
    step: TaskStep,
    userId: string,
    runId: string
  ): Promise<ExecutionResult> {
    try {
      // Update step status to executing
      await this.updateStepStatus(step.id, STEP_STATUS.EXECUTING)

      // Log execution start
      await AuditLogger.logStepExecuted(
        userId,
        runId,
        step.id,
        `Executing step ${step.step_number}: ${step.description}`
      )

      // Execute using StepExecutor (which uses connectors)
      // For action types without connectors, fall back to inline execution
      let result: ExecutionResult

      // Try to use connector first
      const connectorResult = await StepExecutor.execute(step)
      if (connectorResult.success || connectorResult.error?.includes('No connector')) {
        // Use connector result, or fall through to inline execution
        if (!connectorResult.error?.includes('No connector')) {
          result = connectorResult
        } else {
          // Fall back to inline execution for action types without connectors
          switch (step.action_type) {
            case 'data_update':
              result = await this.executeDataUpdate(step)
              break
            case 'notification':
              result = await this.executeNotification(step)
              break
            case 'file_operation':
              result = await this.executeFileOperation(step)
              break
            case 'database_query':
              result = await this.executeDatabaseQuery(step)
              break
            default:
              result = {
                success: false,
                error: `Unknown action type: ${step.action_type}`,
              }
          }
        }
      } else {
        result = connectorResult
      }

      // Update step with result
      if (result.success) {
        await this.updateStepStatus(step.id, STEP_STATUS.COMPLETED, result.result)
        await AuditLogger.logStepExecuted(
          userId,
          runId,
          step.id,
          `Step ${step.step_number} completed successfully`,
          { result: result.result }
        )
      } else {
        await this.updateStepStatus(step.id, STEP_STATUS.FAILED, null, result.error)
        await AuditLogger.logError(userId, runId, step.id, `Step ${step.step_number} failed: ${result.error}`)
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.updateStepStatus(step.id, STEP_STATUS.FAILED, null, errorMessage)
      await AuditLogger.logError(userId, runId, step.id, `Step ${step.step_number} error: ${errorMessage}`)
      
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Execute payment (mock)
   */
  private static async executePayment(step: TaskStep): Promise<ExecutionResult> {
    // Mock payment execution
    const amount = (step.parameters?.amount as number) || 0
    
    return {
      success: true,
      result: {
        transaction_id: `mock_txn_${Date.now()}`,
        amount,
        status: 'completed',
        message: `Mock payment of $${amount} processed successfully`,
      },
    }
  }

  /**
   * Execute marketplace hire (mock)
   */
  private static async executeMarketplaceHire(step: TaskStep): Promise<ExecutionResult> {
    // Mock marketplace hiring
    const role = (step.parameters?.role as string) || 'developer'
    
    return {
      success: true,
      result: {
        contractor_id: `mock_contractor_${Date.now()}`,
        role,
        status: 'hired',
        message: `Mock hiring of ${role} completed successfully`,
      },
    }
  }

  /**
   * Execute API call (mock)
   */
  private static async executeApiCall(step: TaskStep): Promise<ExecutionResult> {
    // Mock API call
    const endpoint = (step.parameters?.endpoint as string) || '/api/endpoint'
    const method = (step.parameters?.method as string) || 'GET'
    
    return {
      success: true,
      result: {
        endpoint,
        method,
        status_code: 200,
        response: { message: 'Mock API call successful' },
      },
    }
  }

  /**
   * Execute data update (mock)
   */
  private static async executeDataUpdate(step: TaskStep): Promise<ExecutionResult> {
    // Mock data update
    return {
      success: true,
      result: {
        records_updated: 1,
        message: 'Mock data update completed successfully',
      },
    }
  }

  /**
   * Execute notification (mock)
   */
  private static async executeNotification(step: TaskStep): Promise<ExecutionResult> {
    // Mock notification
    return {
      success: true,
      result: {
        notification_id: `mock_notif_${Date.now()}`,
        status: 'sent',
        message: 'Mock notification sent successfully',
      },
    }
  }

  /**
   * Execute file operation (mock)
   */
  private static async executeFileOperation(step: TaskStep): Promise<ExecutionResult> {
    // Mock file operation
    return {
      success: true,
      result: {
        operation: step.parameters?.operation || 'read',
        file_path: step.parameters?.file_path || '/mock/path',
        status: 'completed',
        message: 'Mock file operation completed successfully',
      },
    }
  }

  /**
   * Execute database query (mock)
   */
  private static async executeDatabaseQuery(step: TaskStep): Promise<ExecutionResult> {
    // Mock database query
    return {
      success: true,
      result: {
        query: step.parameters?.query || 'SELECT * FROM table',
        rows_returned: 0,
        message: 'Mock database query completed successfully',
      },
    }
  }

  /**
   * Update step status in database
   */
  private static async updateStepStatus(
    stepId: string,
    status: string,
    result: Record<string, unknown> | null = null,
    errorMessage: string | null = null
  ): Promise<void> {
    const supabase = createServerClient()
    
    const updateData: {
      status: string
      result?: Record<string, unknown> | null
      executed_at?: string
      error_message?: string | null
    } = {
      status,
    }

    if (result !== null) {
      updateData.result = result
    }

    if (status === STEP_STATUS.COMPLETED || status === STEP_STATUS.FAILED) {
      updateData.executed_at = new Date().toISOString()
    }

    if (errorMessage) {
      updateData.error_message = errorMessage
    }

    const { error } = await supabase
      .from('task_steps')
      .update(updateData)
      .eq('id', stepId)

    if (error) {
      console.error('[ExecutorService] Failed to update step status:', error)
      throw error
    }
  }
}
