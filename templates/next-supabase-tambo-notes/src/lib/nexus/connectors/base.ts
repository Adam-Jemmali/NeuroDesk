/**
 * Base Connector Interface
 * All connectors implement this interface for consistent execution
 */

import type { TaskStep } from '../schema'
import type { ExecutionResult } from '../executor-service'

/**
 * Base interface for all connectors
 */
export interface Connector {
  /**
   * Execute the action
   */
  execute(step: TaskStep): Promise<ExecutionResult>

  /**
   * Validate parameters before execution
   */
  validate(step: TaskStep): { valid: boolean; error?: string }

  /**
   * Get connector name
   */
  getName(): string
}

/**
 * Base connector implementation
 */
export abstract class BaseConnector implements Connector {
  abstract execute(step: TaskStep): Promise<ExecutionResult>
  abstract getName(): string

  validate(step: TaskStep): { valid: boolean; error?: string } {
    if (!step.parameters) {
      return { valid: false, error: 'Parameters are required' }
    }
    return { valid: true }
  }
}
