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
    const id = searchParams.get('id')

    const supabase = createServerClient()

    if (id) {
      // Get single run
      const { data: run, error } = await supabase
        .from('nexus_runs')
        .select('*')
        .eq('id', id)
        .eq('user_id', session.user.id)
        .single()

      if (error || !run) {
        return NextResponse.json(
          { error: 'Run not found' },
          { status: 404 }
        )
      }

      return NextResponse.json({ run }, { status: 200 })
    } else {
      // Get recent runs
      const { data: runs, error } = await supabase
        .from('nexus_runs')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({ runs: runs || [] }, { status: 200 })
    }
  } catch (error) {
    console.error('[Nexus Runs] Unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
