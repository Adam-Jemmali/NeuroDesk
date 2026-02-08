'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { AuditLogItem } from './AuditLogItem'
import { useNexusEvents } from '@/hooks/useNexusEvents'
import type { AuditLog } from '@/lib/nexus/schema'

interface AuditLogViewerProps {
  runId?: string
  limit?: number
}

export function AuditLogViewer({ runId, limit = 50 }: AuditLogViewerProps) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        return
      }

      const params = new URLSearchParams()
      if (runId) params.set('run_id', runId)
      if (limit) params.set('limit', limit.toString())

      console.log('[AuditLogViewer] Fetching logs with params:', params.toString())
      const response = await fetch(`/api/nexus/audit?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
      })

      console.log('[AuditLogViewer] Response status:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[AuditLogViewer] Error response:', errorText)
        throw new Error('Failed to fetch audit logs')
      }

      const data = await response.json()
      console.log('[AuditLogViewer] Received logs:', data)
      setLogs(data.logs || [])
    } catch (err) {
      console.error('[AuditLogViewer] Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [runId, limit])

  // Use SSE for real-time audit log updates
  useNexusEvents({
    onEvent: () => {
      // Any event means a new audit log entry might exist
      // Refresh logs when events occur (deferred to avoid render issues)
      setTimeout(() => fetchLogs(), 0)
    },
    enabled: true,
  })

  useEffect(() => {
    // Initial fetch
    fetchLogs()
  }, [fetchLogs])

  if (loading) {
    return (
      <div className="nl-card p-6">
        <div className="text-center text-neutral-400 text-sm">Loading audit logs...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="nl-card p-6">
        <div className="text-center text-red-400 text-sm mb-4">{error}</div>
        <button
          onClick={fetchLogs}
          className="px-3 py-1.5 text-xs font-semibold bg-white/20 border border-white/40 text-white rounded-lg hover:bg-white/30 transition-all"
        >
          Retry
        </button>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="nl-card p-6">
        <div className="text-center text-neutral-400 text-sm">No audit logs found</div>
      </div>
    )
  }

  return (
    <div className="nl-card overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-800/60">
        <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">
          Audit Log {runId ? `(Run: ${runId.substring(0, 8)}...)` : ''}
        </h3>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {logs.map((log) => (
          <AuditLogItem key={log.id} log={log} />
        ))}
      </div>
    </div>
  )
}
