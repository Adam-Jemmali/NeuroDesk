import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/supabaseServer'
import { VerifierService } from '@/lib/nexus/verifier-service'
import type { VerifyRequest, VerifyResponse } from '@/lib/nexus/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: VerifyRequest = await request.json()
    const { run_id, step_id } = body

    if (!run_id || typeof run_id !== 'string') {
      return NextResponse.json(
        { error: 'run_id is required and must be a string' },
        { status: 400 }
      )
    }

    // Verify the run
    const verification = await VerifierService.verifyRun(run_id, session.user.id)

    const response: VerifyResponse = {
      run_id,
      verified: verification.verified,
      summary: verification.summary,
      issues: verification.issues,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[Nexus Verify] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
