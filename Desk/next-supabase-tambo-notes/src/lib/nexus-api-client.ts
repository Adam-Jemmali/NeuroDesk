/**
 * NEXUS Backend API Client
 * Handles authentication and API calls to the FastAPI backend
 */

const NEXUS_API_URL = process.env.NEXT_PUBLIC_NEXUS_API_URL || 'http://localhost:8000'

export interface NexusAuthTokens {
  access_token: string
  refresh_token: string
}

export interface NexusUser {
  id: string
  email: string
  username: string
  is_active: boolean
}

export interface NexusTask {
  id: string
  title: string
  description?: string
  command: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'critical'
  result?: any
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export interface NexusApproval {
  id: string
  task_id: string
  status: 'pending' | 'approved' | 'rejected'
  risk_level?: string
  estimated_cost?: number
  created_at: string
}

export interface NexusBudgetSummary {
  daily_spent: number
  daily_limit: number
  monthly_spent: number
  monthly_limit: number
}

export interface NexusAuditLog {
  id: string
  event_type: string
  event_name: string
  description: string
  created_at: string
  task_id?: string
  transaction_id?: string
}

class NexusApiClient {
  private baseUrl: string
  private accessToken: string | null = null

  constructor(baseUrl: string = NEXUS_API_URL) {
    this.baseUrl = baseUrl
    // Load token from localStorage on init
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('nexus_access_token')
    }
  }

  setAccessToken(token: string | null) {
    this.accessToken = token
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('nexus_access_token', token)
      } else {
        localStorage.removeItem('nexus_access_token')
      }
    }
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      // #region debug log
      fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexus-api-client.ts:106',message:'API error response',data:{status:response.status,statusText:response.statusText,error:JSON.stringify(error)},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      // Handle FastAPI validation errors (422) which return {detail: [...]}
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      if (error.detail) {
        if (Array.isArray(error.detail)) {
          // Validation errors are arrays of objects
          errorMessage = error.detail.map((e: any) => {
            if (typeof e === 'object' && e.loc && e.msg) {
              return `${e.loc.join('.')}: ${e.msg}`
            }
            return e.msg || JSON.stringify(e)
          }).join(', ')
        } else if (typeof error.detail === 'string') {
          errorMessage = error.detail
        } else {
          errorMessage = JSON.stringify(error.detail)
        }
      }
      // Provide user-friendly messages for common errors
      if (response.status === 401) {
        errorMessage = 'Incorrect email or password. Please check your credentials or register a new account.'
      } else if (response.status === 422) {
        errorMessage = `Validation error: ${errorMessage}`
      } else if (response.status === 503) {
        errorMessage = `Service unavailable: ${errorMessage}. This usually means the database connection failed. Please check your backend configuration.`
      } else if (response.status === 500) {
        errorMessage = `Server error: ${errorMessage}. Please check the backend logs for more details.`
      }
      throw new Error(errorMessage)
    }

    return response.json()
  }

  // Auth endpoints
  async register(email: string, password: string, username: string): Promise<NexusAuthTokens> {
    const data = await this.request<NexusAuthTokens>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username }),
    })
    this.setAccessToken(data.access_token)
    return data
  }

  async login(email: string, password: string): Promise<NexusAuthTokens> {
    // #region debug log
    const requestBody = { email, password }
    fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexus-api-client.ts:136',message:'Login request',data:{email,hasPassword:!!password,passwordLength:password.length},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    const data = await this.request<NexusAuthTokens>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })
    // #region debug log
    fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'nexus-api-client.ts:145',message:'Login success',data:{hasToken:!!data.access_token},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    this.setAccessToken(data.access_token)
    return data
  }

  async refreshToken(refreshToken: string): Promise<NexusAuthTokens> {
    const data = await this.request<NexusAuthTokens>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    this.setAccessToken(data.access_token)
    return data
  }

  async getCurrentUser(): Promise<NexusUser> {
    return this.request<NexusUser>('/api/v1/auth/me')
  }

  logout() {
    this.setAccessToken(null)
  }

  // Task endpoints
  async submitTask(userMessage: string, context?: Record<string, any>): Promise<NexusTask> {
    return this.request<NexusTask>('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Task',
        command: 'execute',
        user_message: userMessage,
        context,
      }),
    })
  }

  async listTasks(): Promise<NexusTask[]> {
    return this.request<NexusTask[]>('/api/v1/tasks')
  }

  async getTask(taskId: string): Promise<NexusTask> {
    return this.request<NexusTask>(`/api/v1/tasks/${taskId}`)
  }

  async approveTask(taskId: string, notes?: string): Promise<NexusTask> {
    return this.request<NexusTask>(`/api/v1/tasks/${taskId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    })
  }

  async verifyTask(taskId: string): Promise<NexusTask> {
    return this.request<NexusTask>(`/api/v1/tasks/${taskId}/verify`, {
      method: 'POST',
    })
  }

  // Approval endpoints
  async getPendingApprovals(): Promise<NexusApproval[]> {
    // Note: This would need to be implemented in the backend
    // For now, we'll get tasks with pending status
    const tasks = await this.listTasks()
    return tasks
      .filter(t => t.status === 'pending')
      .map(t => ({
        id: t.id,
        task_id: t.id,
        status: 'pending' as const,
        created_at: t.created_at,
      }))
  }

  // Budget endpoints
  async getSpending(): Promise<NexusBudgetSummary> {
    return this.request<NexusBudgetSummary>('/api/v1/budget/summary')
  }

  // Audit log endpoints
  async getAuditLogs(limit: number = 20): Promise<NexusAuditLog[]> {
    // Note: This would need to be implemented in the backend
    // For now, return empty array
    return []
  }

  // SSE endpoint URL (for EventSource)
  getEventStreamUrl(): string {
    return `${this.baseUrl}/api/v1/events/stream`
  }
}

// Singleton instance
export const nexusApi = new NexusApiClient()
