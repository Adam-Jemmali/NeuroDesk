import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/supabaseServer'
import { createServerClient } from '@/lib/supabaseServer'
import { PlannerService } from '@/lib/nexus/planner-service'
import { RiskAssessor } from '@/lib/nexus/risk-assessor'
import { AuditLogger } from '@/lib/nexus/audit-logger'
import { EventService } from '@/lib/nexus/event-service'
import { RUN_STATUS } from '@/lib/nexus/constants'
import type { CreatePlanRequest, CreatePlanResponse } from '@/lib/nexus/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: CreatePlanRequest = await request.json()
    const { user_message, mode = 'execution' } = body

    if (!user_message || typeof user_message !== 'string') {
      return NextResponse.json(
        { error: 'user_message is required and must be a string' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // Create run
    const { data: run, error: runError } = await supabase
      .from('nexus_runs')
      .insert({
        user_id: session.user.id,
        mode,
        user_message,
        status: RUN_STATUS.PLANNING,
      })
      .select()
      .single()

    if (runError || !run) {
      console.error('[Nexus Plan] Failed to create run:', runError)
      return NextResponse.json(
        { error: runError?.message || 'Failed to create run' },
        { status: 500 }
      )
    }

    await AuditLogger.logRunCreated(
      session.user.id,
      run.id,
      `Run created for message: ${user_message.substring(0, 100)}`
    )

    // Publish run_created event
    EventService.publish(session.user.id, {
      type: 'run_created',
      data: {
        run_id: run.id,
        mode: run.mode,
        status: run.status,
        user_message: user_message.substring(0, 100),
      },
    })

    // Generate plan
    const generatedPlan = await PlannerService.generatePlan(user_message)

    // Create task plan
    const { data: plan, error: planError } = await supabase
      .from('task_plans')
      .insert({
        run_id: run.id,
        plan_json: generatedPlan as unknown as Record<string, unknown>,
        estimated_cost: generatedPlan.estimated_total_cost,
        risk_level: generatedPlan.overall_risk,
      })
      .select()
      .single()

    if (planError || !plan) {
      console.error('[Nexus Plan] Failed to create plan:', planError)
      // Update run status to failed
      await supabase
        .from('nexus_runs')
        .update({ status: RUN_STATUS.FAILED, error_message: planError?.message })
        .eq('id', run.id)
      
      return NextResponse.json(
        { error: planError?.message || 'Failed to create plan' },
        { status: 500 }
      )
    }

    await AuditLogger.logPlanGenerated(
      session.user.id,
      run.id,
      `Plan generated with ${generatedPlan.steps.length} steps`
    )

    // Publish plan_generated event
    EventService.publish(session.user.id, {
      type: 'plan_generated',
      data: {
        run_id: run.id,
        plan_id: plan.id,
        step_count: generatedPlan.steps.length,
        estimated_cost: generatedPlan.estimated_total_cost,
        risk_level: generatedPlan.overall_risk,
      },
    })

    // Create task steps
    const taskSteps = PlannerService.convertToTaskSteps(generatedPlan, plan.id)
    
    const { data: steps, error: stepsError } = await supabase
      .from('task_steps')
      .insert(taskSteps)
      .select()

    if (stepsError || !steps) {
      console.error('[Nexus Plan] Failed to create steps:', stepsError)
      return NextResponse.json(
        { error: stepsError?.message || 'Failed to create steps' },
        { status: 500 }
      )
    }

    // Create approval requests for steps that require approval
    const approvals = []
    for (const step of steps) {
      if (step.requires_approval) {
        const { data: approval, error: approvalError } = await supabase
          .from('approvals')
          .insert({
            run_id: run.id,
            step_id: step.id,
            approval_type: 'step',
            reason: `Step requires approval due to ${step.risk_level} risk level and ${step.side_effect} side effect`,
            status: 'pending',
          })
          .select()
          .single()

        if (!approvalError && approval) {
          approvals.push(approval)
          await AuditLogger.logApprovalRequested(
            session.user.id,
            run.id,
            step.id,
            `Approval requested for step ${step.step_number}: ${step.description}`
          )

          // Publish approval_requested event
          EventService.publish(session.user.id, {
            type: 'approval_requested',
            data: {
              run_id: run.id,
              approval_id: approval.id,
              step_id: step.id,
              approval_type: approval.approval_type,
              reason: approval.reason,
            },
          })
        }
      }
    }

    // Update run status
    const newStatus = approvals.length > 0 ? RUN_STATUS.PENDING : RUN_STATUS.APPROVED
    await supabase
      .from('nexus_runs')
      .update({ status: newStatus })
      .eq('id', run.id)

    // Publish status_changed event
    EventService.publish(session.user.id, {
      type: 'status_changed',
      data: {
        run_id: run.id,
        old_status: RUN_STATUS.PLANNING,
        new_status: newStatus,
      },
    })

    const response: CreatePlanResponse = {
      run_id: run.id,
      plan_id: plan.id,
      plan,
      steps,
      approvals,
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    console.error('[Nexus Plan] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
