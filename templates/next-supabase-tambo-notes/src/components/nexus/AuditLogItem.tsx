'use client'

import type { AuditLog } from '@/lib/nexus/schema'

interface AuditLogItemProps {
  log: AuditLog
}

export function AuditLogItem({ log }: AuditLogItemProps) {
  const getEventTypeColor = (eventType: string) => {
    if (eventType.includes('error')) return 'text-red-400'
    if (eventType.includes('approval')) return 'text-yellow-400'
    if (eventType.includes('completed')) return 'text-green-400'
    return 'text-neutral-400'
  }

  const getAgentRoleBadge = (role: string | null) => {
    if (!role) return null
    
    const colors: Record<string, string> = {
      planner: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
      executor: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
      verifier: 'bg-green-500/20 border-green-500/30 text-green-400',
      user: 'bg-neutral-500/20 border-neutral-500/30 text-neutral-400',
    }

    return (
      <span className={`text-xs px-2 py-0.5 rounded border ${colors[role] || colors.user}`}>
        {role.toUpperCase()}
      </span>
    )
  }

  return (
    <div className="p-3 border-b border-neutral-800/60 last:border-b-0">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold ${getEventTypeColor(log.event_type)}`}>
              {log.event_type.replace(/_/g, ' ').toUpperCase()}
            </span>
            {getAgentRoleBadge(log.agent_role)}
          </div>
          <p className="text-sm text-neutral-100">{log.message}</p>
        </div>
        <span className="text-xs text-neutral-500 whitespace-nowrap">
          {new Date(log.created_at).toLocaleString()}
        </span>
      </div>
      {log.metadata && Object.keys(log.metadata).length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-neutral-400 cursor-pointer hover:text-neutral-300">
            View metadata
          </summary>
          <pre className="mt-1 p-2 text-xs bg-neutral-900/50 rounded border border-neutral-800/60 text-neutral-300 overflow-x-auto">
            {JSON.stringify(log.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
