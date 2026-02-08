import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/supabaseServer'
import { ApprovalManager } from '@/lib/nexus/approval-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { run_id, review_notes } = body

    if (!run_id || typeof run_id !== 'string') {
      return NextResponse.json(
        { error: 'run_id is required and must be a string' },
        { status: 400 }
      )
    }

    console.log('[Nexus Approve All] Approving all for run:', run_id)
    const result = await ApprovalManager.approveAllForRun(
      run_id,
      session.user.id,
      review_notes
    )

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to approve all' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      approvedCount: result.approvedCount,
    }, { status: 200 })
  } catch (error) {
    console.error('[Nexus Approve All] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
