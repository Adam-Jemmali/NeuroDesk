'use client'

import { useNexusEvents } from '@/hooks/useNexusEvents'

/**
 * Component to show SSE connection status
 */
export function NexusConnectionStatus() {
  const { connected, error } = useNexusEvents({
    enabled: true,
  })

  if (!connected && !error) {
    return (
      <div className="nl-card p-2">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
          <span className="text-neutral-400">Connecting to event stream...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="nl-card p-2">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-red-500"></div>
          <span className="text-red-400">Event stream disconnected</span>
        </div>
      </div>
    )
  }

  return (
    <div className="nl-card p-2">
      <div className="flex items-center gap-2 text-xs">
        <div className="w-2 h-2 rounded-full bg-green-500"></div>
        <span className="text-neutral-400">Real-time updates active</span>
      </div>
    </div>
  )
}
