/**
 * Mock Marketplace Connector
 * Simulates marketplace/hiring operations (safe - no real hiring)
 */

import { BaseConnector } from './base'
import type { TaskStep, ExecutionResult } from '../../executor-service'

export class MockMarketplaceConnector extends BaseConnector {
  getName(): string {
    return 'mock-marketplace'
  }

  async execute(step: TaskStep): Promise<ExecutionResult> {
    const role = (step.parameters?.role as string) || 'developer'
    const budget = (step.parameters?.budget as number) || 500
    
    // Simulate hiring process delay
    await new Promise(resolve => setTimeout(resolve, 800))
    
    return {
      success: true,
      result: {
        contractor_id: `mock_contractor_${Date.now()}`,
        role,
        budget,
        status: 'hired',
        message: `Mock hiring of ${role} completed successfully`,
        estimated_start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
        timestamp: new Date().toISOString(),
      },
    }
  }

  validate(step: TaskStep): { valid: boolean; error?: string } {
    const baseValidation = super.validate(step)
    if (!baseValidation.valid) return baseValidation

    if (!step.parameters?.role || typeof step.parameters.role !== 'string') {
      return { valid: false, error: 'Role is required and must be a string' }
    }

    return { valid: true }
  }
}
