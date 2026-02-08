import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/supabaseServer'
import { createServerClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('run_id')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')

    const supabase = createServerClient()

    let query = supabase
      .from('audit_logs')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })

    if (runId) {
      query = query.eq('run_id', runId)
    }

    if (limit) {
      const limitNum = parseInt(limit, 10)
      if (!isNaN(limitNum) && limitNum > 0) {
        query = query.limit(limitNum)
      }
    }

    if (offset) {
      const offsetNum = parseInt(offset, 10)
      if (!isNaN(offsetNum) && offsetNum >= 0) {
        query = query.range(offsetNum, offsetNum + (limit ? parseInt(limit, 10) : 100) - 1)
      }
    }

    const { data: logs, error } = await query

    if (error) {
      console.error('[Nexus Audit API] Query error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    console.log('[Nexus Audit API] Found logs:', logs?.length || 0)
    return NextResponse.json({ logs: logs || [] }, { status: 200 })
  } catch (error) {
    console.error('[Nexus Audit] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
