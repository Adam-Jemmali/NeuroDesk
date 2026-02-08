import { NextRequest } from 'next/server'
import { getServerSession } from '@/lib/supabaseServer'
import { EventService } from '@/lib/nexus/event-service'
import type { NexusEvent } from '@/lib/nexus/event-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE endpoint for real-time NEXUS events
 * GET /api/nexus/events/stream
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate user - try session first, then token from query param
    let session = await getServerSession()
    
    // If no session, try token from query parameter (for EventSource which doesn't support headers)
    if (!session) {
      const { searchParams } = new URL(request.url)
      const token = searchParams.get('token')
      
      if (token) {
        // Verify token and get user
        const { createClient } = await import('@supabase/supabase-js')
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
        
        const supabase = createClient(url, anonKey, {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        })
        
        const { data: { user }, error } = await supabase.auth.getUser(token)
        
        if (!error && user) {
          session = {
            access_token: token,
            user,
            expires_at: null,
            expires_in: null,
            refresh_token: null,
            token_type: 'bearer',
          } as any
        }
      }
    }
    
    if (!session) {
      return new Response('Unauthorized', { status: 401 })
    }

    const userId = session.user.id

    // Subscribe to events
    const eventQueue = EventService.subscribe(userId)

    // Create SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        let pingInterval: NodeJS.Timeout | null = null

        // Send initial connection event
        const sendEvent = (event: NexusEvent | { type: string; data: Record<string, unknown> }) => {
          const data = JSON.stringify(event.data)
          const message = `event: ${event.type}\ndata: ${data}\n\n`
          controller.enqueue(encoder.encode(message))
        }

        sendEvent({
          type: 'connected',
          data: { message: 'Connected to NEXUS event stream', timestamp: new Date().toISOString() },
        })

        // Send ping every 30 seconds to keep connection alive
        pingInterval = setInterval(() => {
          try {
            sendEvent({
              type: 'ping',
              data: { timestamp: new Date().toISOString() },
            })
          } catch (error) {
            console.error('[SSE Stream] Error sending ping:', error)
            if (pingInterval) {
              clearInterval(pingInterval)
            }
          }
        }, 30000)

        // Listen for events
        let isActive = true
        while (isActive) {
          try {
            // Wait for event with timeout
            const event = await Promise.race([
              eventQueue.dequeue(),
              new Promise<NexusEvent>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 30000)
              ),
            ])

            // Send event to client
            sendEvent(event)
          } catch (error) {
            // Timeout is expected - continue loop (ping will keep connection alive)
            if (error instanceof Error && error.message === 'Timeout') {
              continue
            }

            // Other errors - log and close
            console.error('[SSE Stream] Error in event loop:', error)
            sendEvent({
              type: 'error',
              data: { message: 'Stream error', error: error instanceof Error ? error.message : 'Unknown error' },
            })
            isActive = false
          }
        }

        // Cleanup
        if (pingInterval) {
          clearInterval(pingInterval)
        }
        EventService.unsubscribe(userId, eventQueue)
        controller.close()
      },

      cancel() {
        // Client disconnected
        EventService.unsubscribe(userId, eventQueue)
        console.log(`[SSE Stream] Client disconnected for user ${userId}`)
      },
    })

    // Return SSE response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    })
  } catch (error) {
    console.error('[SSE Stream] Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
