/**
 * Mock Payment Connector
 * Simulates payment processing (safe - no real payments)
 */

import { BaseConnector } from './base'
import type { TaskStep, ExecutionResult } from '../../executor-service'

export class MockPaymentConnector extends BaseConnector {
  getName(): string {
    return 'mock-payment'
  }

  async execute(step: TaskStep): Promise<ExecutionResult> {
    const amount = (step.parameters?.amount as number) || 0
    
    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 500))
    
    return {
      success: true,
      result: {
        transaction_id: `mock_txn_${Date.now()}`,
        amount,
        currency: (step.parameters?.currency as string) || 'USD',
        status: 'completed',
        message: `Mock payment of $${amount} processed successfully`,
        timestamp: new Date().toISOString(),
      },
    }
  }

  validate(step: TaskStep): { valid: boolean; error?: string } {
    const baseValidation = super.validate(step)
    if (!baseValidation.valid) return baseValidation

    if (!step.parameters?.amount || typeof step.parameters.amount !== 'number') {
      return { valid: false, error: 'Amount is required and must be a number' }
    }

    if (step.parameters.amount <= 0) {
      return { valid: false, error: 'Amount must be greater than 0' }
    }

    return { valid: true }
  }
}
