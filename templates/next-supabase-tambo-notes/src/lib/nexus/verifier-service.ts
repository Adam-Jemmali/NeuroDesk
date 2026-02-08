/**
 * Verifier Service
 * Validates execution results and generates summaries
 */

import { createServerClient } from '@/lib/supabaseServer'
import type { TaskStep, NexusRun } from './schema'
import { RUN_STATUS } from './constants'
import { AuditLogger } from './audit-logger'

export interface VerificationResult {
  verified: boolean
  summary: string
  issues: string[]
}

export class VerifierService {
  /**
   * Verify a run's execution results
   */
  static async verifyRun(runId: string, userId: string): Promise<VerificationResult> {
    const supabase = createServerClient()

    // Get all steps for this run
    const { data: steps, error: stepsError } = await supabase
      .from('task_steps')
      .select('*, task_plans!inner(run_id)')
      .eq('task_plans.run_id', runId)
      .order('step_number', { ascending: true })

    if (stepsError || !steps) {
      await AuditLogger.logError(userId, runId, null, `Failed to fetch steps for verification: ${stepsError?.message}`)
      return {
        verified: false,
        summary: 'Failed to fetch execution steps',
        issues: [stepsError?.message || 'Unknown error'],
      }
    }

    const issues: string[] = []
    let allVerified = true

    // Check each step
    for (const step of steps) {
      if (step.status === 'failed') {
        allVerified = false
        issues.push(`Step ${step.step_number} failed: ${step.error_message || 'Unknown error'}`)
      } else if (step.status === 'completed') {
        // Verify result structure
        if (!step.result || typeof step.result !== 'object') {
          allVerified = false
          issues.push(`Step ${step.step_number} completed but has invalid result`)
        }
      } else if (step.status === 'pending' || step.status === 'approved') {
        allVerified = false
        issues.push(`Step ${step.step_number} was not executed (status: ${step.status})`)
      }
    }

    // Generate summary
    const completedCount = steps.filter((s) => s.status === 'completed').length
    const failedCount = steps.filter((s) => s.status === 'failed').length
    const totalCount = steps.length

    const summary = `Verification complete: ${completedCount}/${totalCount} steps completed successfully${
      failedCount > 0 ? `, ${failedCount} failed` : ''
    }`

    // Update run status
    const newStatus = allVerified ? RUN_STATUS.COMPLETED : RUN_STATUS.FAILED
    await this.updateRunStatus(runId, newStatus)

    // Log verification
    await AuditLogger.logVerificationCompleted(
      userId,
      runId,
      summary,
      {
        verified: allVerified,
        completed: completedCount,
        failed: failedCount,
        total: totalCount,
        issues,
      }
    )

    return {
      verified: allVerified,
      summary,
      issues,
    }
  }

  /**
   * Update run status
   */
  private static async updateRunStatus(runId: string, status: string): Promise<void> {
    const supabase = createServerClient()

    const updateData: {
      status: string
      completed_at?: string
    } = {
      status,
    }

    if (status === RUN_STATUS.COMPLETED || status === RUN_STATUS.FAILED) {
      updateData.completed_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('nexus_runs')
      .update(updateData)
      .eq('id', runId)

    if (error) {
      console.error('[VerifierService] Failed to update run status:', error)
      throw error
    }
  }
}
