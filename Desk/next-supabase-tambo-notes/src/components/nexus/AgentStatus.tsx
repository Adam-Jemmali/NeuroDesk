'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useNexusEvents } from '@/hooks/useNexusEvents'
import type { NexusRun } from '@/lib/nexus/schema'

interface AgentStatusProps {
  runId?: string
}

export function AgentStatus({ runId }: AgentStatusProps) {
  const [currentRun, setCurrentRun] = useState<NexusRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [isApproving, setIsApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) {
      setLoading(false)
      return
    }

    const fetchRun = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const response = await fetch(`/api/nexus/runs?id=${runId}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          credentials: 'include',
        })

        if (response.ok) {
          const { run } = await response.json()
          setCurrentRun(run)
        }
      } catch (error) {
        console.error('Failed to fetch run:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchRun()
  }, [runId])

  // Use SSE for real-time status updates
  useNexusEvents({
    onEvent: (event) => {
      // Refresh run status when relevant events occur
      if (
        event.type === 'status_changed' ||
        event.type === 'execution_started' ||
        event.type === 'execution_completed' ||
        event.type === 'execution_failed'
      ) {
        const eventRunId = event.data.run_id as string
        if (eventRunId === runId) {
          // Fetch updated run status (deferred to avoid render issues)
          setTimeout(async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession()
              if (!session) return

              const response = await fetch(`/api/nexus/runs?id=${runId}`, {
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
                credentials: 'include',
              })

              if (response.ok) {
                const { run } = await response.json()
                setCurrentRun(run)
              }
            } catch (error) {
              console.error('Failed to fetch run:', error)
            }
          }, 0)
        }
      }
    },
    enabled: !!runId,
  })

  if (!runId) {
    return (
      <div className="nl-card p-4">
        <div className="text-sm text-neutral-400">No active run</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="nl-card p-4">
        <div className="text-sm text-neutral-400">Loading status...</div>
      </div>
    )
  }

  if (!currentRun) {
    return (
      <div className="nl-card p-4">
        <div className="text-sm text-red-400">Run not found</div>
      </div>
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 border-green-500/30 text-green-400'
      case 'failed':
      case 'rejected':
        return 'bg-red-500/20 border-red-500/30 text-red-400'
      case 'executing':
        return 'bg-blue-500/20 border-blue-500/30 text-blue-400'
      case 'planning':
        return 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
      default:
        return 'bg-neutral-500/20 border-neutral-500/30 text-neutral-400'
    }
  }

  const handleApproveAll = async () => {
    if (!runId || !currentRun) return

    setIsApproving(true)
    setApproveError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Not authenticated')
      }

      console.log('[AgentStatus] Approving all for run:', runId)
      const response = await fetch('/api/nexus/approve-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          run_id: runId,
        }),
      })

      if (!response.ok) {
        const { error } = await response.json()
        throw new Error(error || 'Failed to approve all')
      }

      const result = await response.json()
      console.log('[AgentStatus] Approved count:', result.approvedCount)

      // Refresh run status
      const fetchRun = async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const response = await fetch(`/api/nexus/runs?id=${runId}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          credentials: 'include',
        })

        if (response.ok) {
          const { run } = await response.json()
          setCurrentRun(run)
        }
      }

      // Wait a bit for DB to update, then refresh
      setTimeout(fetchRun, 500)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to approve all'
      console.error('[AgentStatus] Error:', errorMessage)
      setApproveError(errorMessage)
    } finally {
      setIsApproving(false)
    }
  }

  const showApproveButton = currentRun && 
    (currentRun.status === 'pending' || currentRun.status === 'planning')

  return (
    <div className="nl-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-neutral-100">Current Run Status</h3>
        <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(currentRun.status)}`}>
          {currentRun.status.toUpperCase()}
        </span>
      </div>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-neutral-400">Mode:</span>
          <span className="text-neutral-100">{currentRun.mode}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">Created:</span>
          <span className="text-neutral-100">
            {new Date(currentRun.created_at).toLocaleString()}
          </span>
        </div>
        {currentRun.completed_at && (
          <div className="flex justify-between">
            <span className="text-neutral-400">Completed:</span>
            <span className="text-neutral-100">
              {new Date(currentRun.completed_at).toLocaleString()}
            </span>
          </div>
        )}
        {currentRun.error_message && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
            {currentRun.error_message}
          </div>
        )}
      </div>

      {showApproveButton && (
        <div className="mt-4 pt-4 border-t border-neutral-800/60">
          <button
            onClick={handleApproveAll}
            disabled={isApproving}
            className="w-full px-4 py-2 text-sm font-semibold bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isApproving ? 'Approving...' : 'Approve All Pending Approvals'}
          </button>
          {approveError && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
              {approveError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
