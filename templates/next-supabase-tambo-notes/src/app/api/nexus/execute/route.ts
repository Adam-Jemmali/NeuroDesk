import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/supabaseServer'
import { createServerClient } from '@/lib/supabaseServer'
import { ExecutorService } from '@/lib/nexus/executor-service'
import { AuditLogger } from '@/lib/nexus/audit-logger'
import { EventService } from '@/lib/nexus/event-service'
import { RUN_STATUS, STEP_STATUS } from '@/lib/nexus/constants'
import type { ExecuteRequest, ExecuteResponse } from '@/lib/nexus/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ExecuteRequest = await request.json()
    const { run_id } = body

    if (!run_id || typeof run_id !== 'string') {
      return NextResponse.json(
        { error: 'run_id is required and must be a string' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // Verify run belongs to user
    const { data: run, error: runError } = await supabase
      .from('nexus_runs')
      .select('*')
      .eq('id', run_id)
      .eq('user_id', session.user.id)
      .single()

    if (runError || !run) {
      return NextResponse.json(
        { error: 'Run not found or access denied' },
        { status: 404 }
      )
    }

    // Get all steps for this run that are approved or don't require approval
    const { data: steps, error: stepsError } = await supabase
      .from('task_steps')
      .select('*, task_plans!inner(run_id)')
      .eq('task_plans.run_id', run_id)
      .in('status', [STEP_STATUS.APPROVED, STEP_STATUS.PENDING])
      .order('step_number', { ascending: true })

    if (stepsError || !steps) {
      return NextResponse.json(
        { error: stepsError?.message || 'Failed to fetch steps' },
        { status: 500 }
      )
    }

    // Filter steps: only execute approved steps or steps that don't require approval
    const stepsToExecute = steps.filter((step) => {
      if (step.status === STEP_STATUS.APPROVED) {
        return true
      }
      // Check if step requires approval
      if (step.requires_approval) {
        // Check if there's an approved approval for this step
        return false // Will be handled by checking approvals table
      }
      return true
    })

    // For steps that require approval, check if they have approved approvals
    const stepsWithApprovals = []
    for (const step of steps) {
      if (step.requires_approval && step.status === STEP_STATUS.PENDING) {
        const { data: approval } = await supabase
          .from('approvals')
          .select('*')
          .eq('step_id', step.id)
          .eq('status', 'approved')
          .single()

        if (approval) {
          stepsWithApprovals.push(step)
        }
      }
    }

    const allStepsToExecute = [...stepsToExecute, ...stepsWithApprovals]

    if (allStepsToExecute.length === 0) {
      return NextResponse.json(
        { error: 'No approved steps to execute' },
        { status: 400 }
      )
    }

    // Update run status to executing
    await supabase
      .from('nexus_runs')
      .update({ status: RUN_STATUS.EXECUTING })
      .eq('id', run_id)

    await AuditLogger.logExecutionStarted(
      session.user.id,
      run_id,
      `Starting execution of ${allStepsToExecute.length} steps`
    )

    // Publish execution_started event
    EventService.publish(session.user.id, {
      type: 'execution_started',
      data: {
        run_id,
        step_count: allStepsToExecute.length,
      },
    })

    // Execute steps sequentially
    const executedSteps = []
    const failedSteps = []

    for (const step of allStepsToExecute) {
      const result = await ExecutorService.executeStep(step, session.user.id, run_id)
      
      // Publish step_executed event
      EventService.publish(session.user.id, {
        type: 'step_executed',
        data: {
          run_id,
          step_id: step.id,
          step_number: step.step_number,
          status: result.success ? 'completed' : 'failed',
          result: result.result,
          error: result.error,
        },
      })
      
      if (result.success) {
        executedSteps.push(step)
      } else {
        failedSteps.push(step)
      }
    }

    // Update run status
    const newStatus = failedSteps.length === 0 ? RUN_STATUS.COMPLETED : RUN_STATUS.EXECUTING
    if (newStatus === RUN_STATUS.COMPLETED) {
      await supabase
        .from('nexus_runs')
        .update({ status: RUN_STATUS.COMPLETED, completed_at: new Date().toISOString() })
        .eq('id', run_id)
    }

    await AuditLogger.logExecutionCompleted(
      session.user.id,
      run_id,
      `Execution completed: ${executedSteps.length} succeeded, ${failedSteps.length} failed`
    )

    // Publish execution_completed or execution_failed event
    if (failedSteps.length === 0) {
      EventService.publish(session.user.id, {
        type: 'execution_completed',
        data: {
          run_id,
          success: true,
          executed_count: executedSteps.length,
          failed_count: failedSteps.length,
        },
      })
    } else {
      EventService.publish(session.user.id, {
        type: 'execution_failed',
        data: {
          run_id,
          success: false,
          executed_count: executedSteps.length,
          failed_count: failedSteps.length,
        },
      })
    }

    // Publish status_changed event
    EventService.publish(session.user.id, {
      type: 'status_changed',
      data: {
        run_id,
        old_status: RUN_STATUS.EXECUTING,
        new_status: newStatus,
      },
    })

    const response: ExecuteResponse = {
      run_id,
      executed_steps: executedSteps,
      failed_steps: failedSteps,
      progress: {
        total: allStepsToExecute.length,
        completed: executedSteps.length,
        failed: failedSteps.length,
      },
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[Nexus Execute] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
