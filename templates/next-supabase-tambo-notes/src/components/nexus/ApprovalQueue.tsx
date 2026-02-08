'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { ApprovalItem } from './ApprovalItem'
import { useNexusEvents } from '@/hooks/useNexusEvents'
import type { Approval } from '@/lib/nexus/schema'

export function ApprovalQueue() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        return
      }

      console.log('[ApprovalQueue] Fetching approvals...')
      const response = await fetch('/api/nexus/approvals', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
      })

      console.log('[ApprovalQueue] Response status:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[ApprovalQueue] Error response:', errorText)
        throw new Error('Failed to fetch approvals')
      }

      const data = await response.json()
      console.log('[ApprovalQueue] Received approvals:', data)
      const approvalsArray = data.approvals || []
      console.log('[ApprovalQueue] Setting approvals array with length:', approvalsArray.length)
      setApprovals(approvalsArray)
    } catch (err) {
      console.error('[ApprovalQueue] Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load approvals')
    } finally {
      setLoading(false)
    }
  }, [])

  // Use SSE for real-time updates
  useNexusEvents({
    onEvent: (event) => {
      // Use setTimeout to defer state updates and avoid render issues
      if (event.type === 'approval_requested') {
        // New approval requested, refresh list
        setTimeout(() => fetchApprovals(), 0)
      } else if (event.type === 'approval_granted' || event.type === 'approval_rejected') {
        // Approval processed, refresh list to remove it
        setTimeout(() => fetchApprovals(), 0)
      }
    },
    enabled: true,
  })

  useEffect(() => {
    // Initial fetch
    fetchApprovals()
  }, [fetchApprovals])

  const handleAction = async (approvalId: string, action: 'approve' | 'reject', notes?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Not authenticated')
      }

      console.log('[ApprovalQueue] Processing action:', action, 'for approval:', approvalId)
      const response = await fetch('/api/nexus/approvals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          approval_id: approvalId,
          action,
          review_notes: notes,
        }),
      })

      console.log('[ApprovalQueue] Response status:', response.status)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('[ApprovalQueue] Error response:', errorData)
        throw new Error(errorData.error || 'Failed to process approval')
      }

      const result = await response.json()
      console.log('[ApprovalQueue] Action result:', result)

      // Refresh approvals after a short delay to allow DB to update
      setTimeout(() => {
        fetchApprovals()
      }, 500)
    } catch (err) {
      console.error('[ApprovalQueue] Failed to process approval:', err)
      throw err
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-neutral-400 text-sm">Loading approvals...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-center text-red-400 text-sm mb-4">{error}</div>
        <button
          onClick={fetchApprovals}
          className="px-3 py-1.5 text-xs font-semibold bg-white/20 border border-white/40 text-white rounded-lg hover:bg-white/30 transition-all"
        >
          Retry
        </button>
      </div>
    )
  }

  console.log('[ApprovalQueue] Rendering with approvals.length:', approvals.length)
  
  if (approvals.length === 0) {
    console.log('[ApprovalQueue] No approvals to render')
    return (
      <div className="p-6">
        <div className="text-center text-neutral-400 text-sm">No pending approvals</div>
      </div>
    )
  }

  console.log('[ApprovalQueue] Rendering approval items:', approvals.map(a => ({ id: a.id, status: a.status })))
  return (
    <div className="space-y-3 w-full">
      {approvals.map((approval) => {
        console.log('[ApprovalQueue] Rendering approval item:', approval.id)
        return (
          <ApprovalItem key={approval.id} approval={approval} onAction={handleAction} />
        )
      })}
    </div>
  )
}
