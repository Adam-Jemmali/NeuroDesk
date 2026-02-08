import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/supabaseServer'
import { ApprovalManager } from '@/lib/nexus/approval-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[Nexus Approvals API] Fetching approvals for user:', session.user.id)
    const approvals = await ApprovalManager.getPendingApprovals(session.user.id)
    console.log('[Nexus Approvals API] Found approvals:', approvals.length)

    return NextResponse.json({ approvals }, { status: 200 })
  } catch (error) {
    console.error('[Nexus Approvals] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { approval_id, action, review_notes } = body

    if (!approval_id || typeof approval_id !== 'string') {
      return NextResponse.json(
        { error: 'approval_id is required and must be a string' },
        { status: 400 }
      )
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "approve" or "reject"' },
        { status: 400 }
      )
    }

    let result
    if (action === 'approve') {
      result = await ApprovalManager.approve(approval_id, session.user.id, review_notes)
    } else {
      result = await ApprovalManager.reject(approval_id, session.user.id, review_notes)
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to process approval' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('[Nexus Approvals] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
