/**
 * Event Service
 * In-memory event service for SSE real-time updates
 */

// UUID type - using string for compatibility

export interface NexusEvent {
  type: string
  data: Record<string, unknown>
  timestamp: string
}

export interface EventQueue {
  queue: NexusEvent[]
  maxSize: number
  ttl: number // milliseconds
}

export class EventService {
  private static subscribers: Map<string, Set<AsyncQueue<NexusEvent>>> = new Map()
  private static eventQueues: Map<string, EventQueue> = new Map()
  private static readonly MAX_QUEUE_SIZE = 100
  private static readonly EVENT_TTL = 60000 // 60 seconds
  private static readonly MAX_CONNECTIONS_PER_USER = 5

  /**
   * Subscribe to events for a user
   * Returns an async queue that will receive events
   */
  static subscribe(userId: string): AsyncQueue<NexusEvent> {
    // Check connection limit
    const userSubscribers = this.subscribers.get(userId) || new Set()
    if (userSubscribers.size >= this.MAX_CONNECTIONS_PER_USER) {
      throw new Error('Maximum connections per user exceeded')
    }

    const queue = new AsyncQueue<NexusEvent>()
    
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, new Set())
    }
    
    this.subscribers.get(userId)!.add(queue)

    // Initialize event queue for user if not exists
    if (!this.eventQueues.has(userId)) {
      this.eventQueues.set(userId, {
        queue: [],
        maxSize: this.MAX_QUEUE_SIZE,
        ttl: this.EVENT_TTL,
      })
    }

    console.log(`[EventService] User ${userId} subscribed. Total subscribers: ${userSubscribers.size + 1}`)
    
    return queue
  }

  /**
   * Unsubscribe a user's queue
   */
  static unsubscribe(userId: string, queue: AsyncQueue<NexusEvent>): void {
    const userSubscribers = this.subscribers.get(userId)
    if (userSubscribers) {
      userSubscribers.delete(queue)
      if (userSubscribers.size === 0) {
        this.subscribers.delete(userId)
        this.eventQueues.delete(userId)
      }
      console.log(`[EventService] User ${userId} unsubscribed. Remaining subscribers: ${userSubscribers.size}`)
    }
  }

  /**
   * Publish an event to all subscribers of a user
   */
  static publish(userId: string, event: Omit<NexusEvent, 'timestamp'>): void {
    const fullEvent: NexusEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    }

    // Add to event queue for this user
    const eventQueue = this.eventQueues.get(userId)
    if (eventQueue) {
      // Clean up old events
      const now = Date.now()
      eventQueue.queue = eventQueue.queue.filter(
        (e) => now - new Date(e.timestamp).getTime() < eventQueue.ttl
      )

      // Add new event
      eventQueue.queue.push(fullEvent)

      // Enforce max size
      if (eventQueue.queue.length > eventQueue.maxSize) {
        eventQueue.queue.shift()
      }
    }

    // Send to all active subscribers
    const userSubscribers = this.subscribers.get(userId)
    if (userSubscribers) {
      let sentCount = 0
      for (const queue of userSubscribers) {
        try {
          queue.enqueue(fullEvent)
          sentCount++
        } catch (error) {
          console.error(`[EventService] Failed to send event to queue:`, error)
          // Remove dead queue
          userSubscribers.delete(queue)
        }
      }
      console.log(`[EventService] Published event ${event.type} to ${sentCount} subscribers for user ${userId}`)
    }
  }

  /**
   * Get pending events for a user (for catch-up after reconnection)
   */
  static getPendingEvents(userId: string, since?: string): NexusEvent[] {
    const eventQueue = this.eventQueues.get(userId)
    if (!eventQueue) {
      return []
    }

    if (since) {
      return eventQueue.queue.filter((e) => e.timestamp > since)
    }

    return [...eventQueue.queue]
  }

  /**
   * Get subscriber count for a user (for monitoring)
   */
  static getSubscriberCount(userId: string): number {
    return this.subscribers.get(userId)?.size || 0
  }
}

/**
 * Simple async queue implementation for event streaming
 */
export class AsyncQueue<T> {
  private items: T[] = []
  private waiters: Array<(item: T) => void> = []

  async dequeue(): Promise<T> {
    if (this.items.length > 0) {
      return this.items.shift()!
    }

    return new Promise<T>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  enqueue(item: T): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      waiter(item)
    } else {
      this.items.push(item)
    }
  }

  isEmpty(): boolean {
    return this.items.length === 0 && this.waiters.length === 0
  }

  clear(): void {
    this.items = []
    this.waiters = []
  }
}
