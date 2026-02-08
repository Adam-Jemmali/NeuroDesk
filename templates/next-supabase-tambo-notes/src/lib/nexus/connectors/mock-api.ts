/**
 * Mock API Connector
 * Simulates external API calls (safe - no real external calls)
 */

import { BaseConnector } from './base'
import type { TaskStep, ExecutionResult } from '../../executor-service'

export class MockApiConnector extends BaseConnector {
  getName(): string {
    return 'mock-api'
  }

  async execute(step: TaskStep): Promise<ExecutionResult> {
    const endpoint = (step.parameters?.endpoint as string) || '/api/endpoint'
    const method = (step.parameters?.method as string) || 'GET'
    const body = step.parameters?.body
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // Mock response based on method
    let response: Record<string, unknown> = {
      message: 'Mock API call successful',
      endpoint,
      method,
    }

    if (method === 'GET') {
      response.data = { items: [] }
    } else if (['POST', 'PUT', 'PATCH'].includes(method)) {
      response.data = body || { created: true }
      response.id = `mock_id_${Date.now()}`
    } else if (method === 'DELETE') {
      response.deleted = true
    }
    
    return {
      success: true,
      result: {
        endpoint,
        method,
        status_code: 200,
        response,
        timestamp: new Date().toISOString(),
      },
    }
  }

  validate(step: TaskStep): { valid: boolean; error?: string } {
    const baseValidation = super.validate(step)
    if (!baseValidation.valid) return baseValidation

    const method = step.parameters?.method as string
    if (method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return { valid: false, error: 'Method must be one of: GET, POST, PUT, PATCH, DELETE' }
    }

    return { valid: true }
  }
}
