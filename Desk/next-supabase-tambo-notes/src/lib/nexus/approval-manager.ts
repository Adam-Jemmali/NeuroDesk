/**
 * Approval Manager
 * Handles approval workflow logic
 */

import { createServerClient } from '@/lib/supabaseServer'
import { APPROVAL_STATUS, STEP_STATUS, RUN_STATUS } from './constants'
import { AuditLogger } from './audit-logger'
import { EventService } from './event-service'
import type { Approval } from './schema'

export class ApprovalManager {
  /**
   * Approve an approval request
   */
  static async approve(
    approvalId: string,
    userId: string,
    reviewNotes?: string
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = createServerClient()

    // Get approval (RLS will filter by user_id via run_id)
    const { data: approval, error: approvalError } = await supabase
      .from('approvals')
      .select('*')
      .eq('id', approvalId)
      .single()

    if (approvalError || !approval) {
      console.error('[ApprovalManager] Approval not found:', approvalError)
      return { success: false, error: 'Approval not found' }
    }

    // Verify user has access by checking the run
    const { data: run } = await supabase
      .from('nexus_runs')
      .select('user_id')
      .eq('id', approval.run_id)
      .single()

    if (!run || run.user_id !== userId) {
      return { success: false, error: 'Access denied' }
    }

    // Check if already processed
    if (approval.status !== APPROVAL_STATUS.PENDING) {
      return { success: false, error: `Approval already ${approval.status}` }
    }

    // Update approval
    const { error: updateError } = await supabase
      .from('approvals')
      .update({
        status: APPROVAL_STATUS.APPROVED,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
        review_notes: reviewNotes || null,
      })
      .eq('id', approvalId)

    if (updateError) {
      return { success: false, error: updateError.message }
    }

    // If it's a step approval, update step status
    if (approval.approval_type === 'step' && approval.step_id) {
      const { error: stepError } = await supabase
        .from('task_steps')
        .update({ status: STEP_STATUS.APPROVED })
        .eq('id', approval.step_id)

      if (stepError) {
        console.error('[ApprovalManager] Failed to update step status:', stepError)
        // Don't fail the approval, just log the error
      }
    }

    // Check if all approvals for this run are now approved, update run status
    const { data: remainingApprovals } = await supabase
      .from('approvals')
      .select('id')
      .eq('run_id', approval.run_id)
      .eq('status', APPROVAL_STATUS.PENDING)

    // If no pending approvals remain, update run status to approved
    if (!remainingApprovals || remainingApprovals.length === 0) {
      const { data: currentRun } = await supabase
        .from('nexus_runs')
        .select('status')
        .eq('id', approval.run_id)
        .single()

      const oldStatus = currentRun?.status || 'pending'

      const { error: runUpdateError } = await supabase
        .from('nexus_runs')
        .update({ status: RUN_STATUS.APPROVED })
        .eq('id', approval.run_id)

      if (runUpdateError) {
        console.error('[ApprovalManager] Failed to update run status:', runUpdateError)
      } else {
        console.log('[ApprovalManager] All approvals granted, run status updated to approved')

        // Publish status_changed event
        EventService.publish(userId, {
          type: 'status_changed',
          data: {
            run_id: approval.run_id,
            old_status: oldStatus,
            new_status: RUN_STATUS.APPROVED,
          },
        })
      }
    }

    // Log approval
    await AuditLogger.logApprovalGranted(
      userId,
      approval.run_id,
      approval.step_id,
      `Approval granted for ${approval.approval_type}: ${approval.reason}`,
      { approval_id: approvalId, review_notes: reviewNotes }
    )

    // Publish approval_granted event
    EventService.publish(userId, {
      type: 'approval_granted',
      data: {
        run_id: approval.run_id,
        approval_id: approvalId,
        step_id: approval.step_id,
        approval_type: approval.approval_type,
      },
    })

    return { success: true }
  }

  /**
   * Reject an approval request
   */
  static async reject(
    approvalId: string,
    userId: string,
    reviewNotes?: string
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = createServerClient()

    // Get approval (RLS will filter by user_id via run_id)
    const { data: approval, error: approvalError } = await supabase
      .from('approvals')
      .select('*')
      .eq('id', approvalId)
      .single()

    if (approvalError || !approval) {
      console.error('[ApprovalManager] Approval not found:', approvalError)
      return { success: false, error: 'Approval not found' }
    }

    // Verify user has access by checking the run
    const { data: run } = await supabase
      .from('nexus_runs')
      .select('user_id')
      .eq('id', approval.run_id)
      .single()

    if (!run || run.user_id !== userId) {
      return { success: false, error: 'Access denied' }
    }

    // Check if already processed
    if (approval.status !== APPROVAL_STATUS.PENDING) {
      return { success: false, error: `Approval already ${approval.status}` }
    }

    // Update approval
    const { error: updateError } = await supabase
      .from('approvals')
      .update({
        status: APPROVAL_STATUS.REJECTED,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
        review_notes: reviewNotes || null,
      })
      .eq('id', approvalId)

    if (updateError) {
      return { success: false, error: updateError.message }
    }

    // If it's a step approval, update step status to skipped
    if (approval.approval_type === 'step' && approval.step_id) {
      const { error: stepError } = await supabase
        .from('task_steps')
        .update({ status: STEP_STATUS.SKIPPED })
        .eq('id', approval.step_id)

      if (stepError) {
        console.error('[ApprovalManager] Failed to update step status:', stepError)
      }
    }

    // Update run status to rejected if this was a critical approval
    const { error: runError } = await supabase
      .from('nexus_runs')
      .update({ status: 'rejected' })
      .eq('id', approval.run_id)

    if (runError) {
      console.error('[ApprovalManager] Failed to update run status:', runError)
    }

    // Log rejection
    await AuditLogger.logApprovalRejected(
      userId,
      approval.run_id,
      approval.step_id,
      `Approval rejected for ${approval.approval_type}: ${approval.reason}`,
      { approval_id: approvalId, review_notes: reviewNotes }
    )

    // Publish approval_rejected event
    EventService.publish(userId, {
      type: 'approval_rejected',
      data: {
        run_id: approval.run_id,
        approval_id: approvalId,
        step_id: approval.step_id,
        approval_type: approval.approval_type,
      },
    })

    return { success: true }
  }

  /**
   * Approve all pending approvals for a run
   */
  static async approveAllForRun(
    runId: string,
    userId: string,
    reviewNotes?: string
  ): Promise<{ success: boolean; approvedCount: number; error?: string }> {
    const supabase = createServerClient()

    // Verify user has access to this run
    const { data: run, error: runError } = await supabase
      .from('nexus_runs')
      .select('user_id, status')
      .eq('id', runId)
      .single()

    if (runError || !run) {
      return { success: false, approvedCount: 0, error: 'Run not found' }
    }

    if (run.user_id !== userId) {
      return { success: false, approvedCount: 0, error: 'Access denied' }
    }

    // Get all pending approvals for this run
    const { data: approvals, error: approvalsError } = await supabase
      .from('approvals')
      .select('*')
      .eq('run_id', runId)
      .eq('status', APPROVAL_STATUS.PENDING)

    if (approvalsError) {
      return { success: false, approvedCount: 0, error: approvalsError.message }
    }

    if (!approvals || approvals.length === 0) {
      return { success: true, approvedCount: 0 }
    }

    // Approve each approval
    let approvedCount = 0
    for (const approval of approvals) {
      const result = await this.approve(approval.id, userId, reviewNotes)
      if (result.success) {
        approvedCount++
      } else {
        console.error(`[ApprovalManager] Failed to approve ${approval.id}:`, result.error)
      }
    }

    // Update run status to approved if all approvals were granted
    if (approvedCount === approvals.length) {
      const { error: runUpdateError } = await supabase
        .from('nexus_runs')
        .update({ status: RUN_STATUS.APPROVED })
        .eq('id', runId)

      if (runUpdateError) {
        console.error('[ApprovalManager] Failed to update run status:', runUpdateError)
      } else {
        console.log('[ApprovalManager] All approvals granted, run status updated to approved')
      }
    }

    return { success: true, approvedCount }
  }

  /**
   * Get pending approvals for a user
   */
  static async getPendingApprovals(userId: string): Promise<Approval[]> {
    const supabase = createServerClient()

    // Use a simpler query that works with RLS
    // RLS policy on approvals table will automatically filter by user_id via run_id
    const { data: approvals, error } = await supabase
      .from('approvals')
      .select('*')
      .eq('status', APPROVAL_STATUS.PENDING)
      .order('requested_at', { ascending: true })

    if (error) {
      console.error('[ApprovalManager] Failed to fetch approvals:', error)
      return []
    }

    // RLS should have already filtered, but return what we got
    return (approvals || []) as Approval[]
  }

  /**
   * Get approval by ID
   */
  static async getApproval(approvalId: string, userId: string): Promise<Approval | null> {
    const supabase = createServerClient()

    const { data: approval, error } = await supabase
      .from('approvals')
      .select('*, nexus_runs!inner(user_id)')
      .eq('id', approvalId)
      .eq('nexus_runs.user_id', userId)
      .single()

    if (error || !approval) {
      return null
    }

    return approval as Approval
  }
}
