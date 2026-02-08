'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { NexusEvent } from '@/lib/nexus/event-service'

export interface UseNexusEventsOptions {
  onEvent?: (event: NexusEvent) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Error) => void
  enabled?: boolean
}

export interface UseNexusEventsReturn {
  connected: boolean
  error: Error | null
  reconnect: () => void
}

const MAX_RETRY_ATTEMPTS = 5
const INITIAL_RETRY_DELAY = 1000 // 1 second
const MAX_RETRY_DELAY = 30000 // 30 seconds

/**
 * React hook for connecting to NEXUS SSE event stream
 */
export function useNexusEvents(options: UseNexusEventsOptions = {}): UseNexusEventsReturn {
  const { onEvent, onConnect, onDisconnect, onError, enabled = true } = options

  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const retryCountRef = useRef(0)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const connect = useCallback(async () => {
    if (!enabled) {
      return
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Not authenticated')
      }

      // Create EventSource connection
      // EventSource doesn't support custom headers, so pass token via query param
      const url = `/api/nexus/events/stream?token=${encodeURIComponent(session.access_token)}`
      const eventSource = new EventSource(url, {
        withCredentials: true,
      })

      eventSource.onopen = () => {
        console.log('[useNexusEvents] Connected to event stream')
        setConnected(true)
        setError(null)
        retryCountRef.current = 0
        onConnect?.()
      }

      eventSource.onerror = (err) => {
        console.error('[useNexusEvents] EventSource error:', err)
        setConnected(false)
        
        // Check if connection is closed
        if (eventSource.readyState === EventSource.CLOSED) {
          const error = new Error('Event stream connection closed')
          setError(error)
          onError?.(error)
          
          // Attempt reconnection with exponential backoff
          if (retryCountRef.current < MAX_RETRY_ATTEMPTS) {
            const delay = Math.min(
              INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current),
              MAX_RETRY_DELAY
            )
            
            console.log(`[useNexusEvents] Retrying connection in ${delay}ms (attempt ${retryCountRef.current + 1}/${MAX_RETRY_ATTEMPTS})`)
            
            retryTimeoutRef.current = setTimeout(() => {
              retryCountRef.current++
              connect()
            }, delay)
          } else {
            console.error('[useNexusEvents] Max retry attempts reached')
            onError?.(new Error('Max retry attempts reached'))
          }
        }
      }

      // Listen for all event types
      eventSource.addEventListener('connected', (e) => {
        console.log('[useNexusEvents] Received connected event:', e)
      })

      eventSource.addEventListener('ping', (e) => {
        // Keep-alive ping, no action needed
      })

      // Generic event handler
      const handleEvent = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data)
          const event: NexusEvent = {
            type: e.type || 'message',
            data,
            timestamp: new Date().toISOString(),
          }
          
          console.log('[useNexusEvents] Received event:', event.type, event.data)
          
          // Call onEvent in next tick to avoid setState during render
          if (onEvent) {
            // Use setTimeout to defer callback execution
            setTimeout(() => {
              try {
                onEvent(event)
              } catch (err) {
                console.error('[useNexusEvents] Error in onEvent callback:', err)
              }
            }, 0)
          }
        } catch (err) {
          console.error('[useNexusEvents] Failed to parse event data:', err)
        }
      }

      // Register handlers for all known event types
      const eventTypes = [
        'run_created',
        'plan_generated',
        'step_executed',
        'approval_requested',
        'approval_granted',
        'approval_rejected',
        'execution_started',
        'execution_completed',
        'execution_failed',
        'status_changed',
        'error',
      ]

      for (const eventType of eventTypes) {
        eventSource.addEventListener(eventType, handleEvent as EventListener)
      }

      // Fallback for any other events
      eventSource.onmessage = handleEvent

      eventSourceRef.current = eventSource
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to connect to event stream')
      console.error('[useNexusEvents] Connection error:', error)
      setError(error)
      setConnected(false)
      onError?.(error)
    }
  }, [enabled, onEvent, onConnect, onError])

  const reconnect = useCallback(() => {
    retryCountRef.current = 0
    connect()
  }, [connect])

  useEffect(() => {
    if (enabled) {
      connect()
    }

    return () => {
      // Cleanup
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      setConnected(false)
      onDisconnect?.()
    }
  }, [enabled, connect, onDisconnect])

  return {
    connected,
    error,
    reconnect,
  }
}
