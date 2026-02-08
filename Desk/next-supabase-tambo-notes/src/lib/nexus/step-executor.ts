/**
 * Step Executor
 * Executes steps using appropriate connectors
 */

import type { TaskStep, ExecutionResult } from './executor-service'
import { MockPaymentConnector } from './connectors/mock-payment'
import { MockMarketplaceConnector } from './connectors/mock-marketplace'
import { MockApiConnector } from './connectors/mock-api'
import type { Connector } from './connectors/base'

export class StepExecutor {
  private static connectors: Map<string, Connector> = new Map([
    ['payment', new MockPaymentConnector()],
    ['marketplace_hire', new MockMarketplaceConnector()],
    ['api_call', new MockApiConnector()],
  ])

  /**
   * Execute a step using the appropriate connector
   */
  static async execute(step: TaskStep): Promise<ExecutionResult> {
    const connector = this.getConnector(step.action_type)
    
    if (!connector) {
      return {
        success: false,
        error: `No connector available for action type: ${step.action_type}`,
      }
    }

    // Validate step
    const validation = connector.validate(step)
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Validation failed',
      }
    }

    // Execute using connector
    return connector.execute(step)
  }

  /**
   * Get connector for action type
   */
  private static getConnector(actionType: string): Connector | null {
    // Map action types to connectors
    switch (actionType) {
      case 'payment':
        return this.connectors.get('payment') || null
      case 'marketplace_hire':
        return this.connectors.get('marketplace_hire') || null
      case 'api_call':
        return this.connectors.get('api_call') || null
      default:
        return null
    }
  }

  /**
   * Register a new connector
   */
  static registerConnector(actionType: string, connector: Connector): void {
    this.connectors.set(actionType, connector)
  }
}
