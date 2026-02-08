/**
 * Risk Assessor
 * Analyzes actions and determines risk levels and approval requirements
 */

import type { ActionType, SideEffect, RiskLevel } from './constants'
import {
  ACTION_TYPES,
  SIDE_EFFECTS,
  RISK_LEVELS,
  APPROVAL_REQUIRED_ACTIONS,
  APPROVAL_REQUIRED_SIDE_EFFECTS,
} from './constants'

export interface RiskAssessment {
  riskLevel: RiskLevel
  requiresApproval: boolean
  estimatedCost: number
  sideEffect: SideEffect
}

export class RiskAssessor {
  /**
   * Assess risk for an action type
   */
  static assessAction(
    actionType: ActionType,
    parameters?: Record<string, unknown>
  ): RiskAssessment {
    // Determine side effect based on action type
    const sideEffect = this.determineSideEffect(actionType, parameters)
    
    // Determine risk level
    const riskLevel = this.determineRiskLevel(actionType, sideEffect, parameters)
    
    // Check if approval is required
    const requiresApproval =
      APPROVAL_REQUIRED_ACTIONS.includes(actionType) ||
      APPROVAL_REQUIRED_SIDE_EFFECTS.includes(sideEffect)
    
    // Estimate cost (mock for now)
    const estimatedCost = this.estimateCost(actionType, parameters)

    return {
      riskLevel,
      requiresApproval,
      estimatedCost,
      sideEffect,
    }
  }

  /**
   * Determine side effect category
   */
  private static determineSideEffect(
    actionType: ActionType,
    parameters?: Record<string, unknown>
  ): SideEffect {
    switch (actionType) {
      case ACTION_TYPES.PAYMENT:
        return SIDE_EFFECTS.PAYMENT
      case ACTION_TYPES.MARKETPLACE_HIRE:
        return SIDE_EFFECTS.EXTERNAL_WRITE
      case ACTION_TYPES.DATA_UPDATE:
        // Check if it's destructive
        if (parameters?.destructive === true) {
          return SIDE_EFFECTS.DESTRUCTIVE
        }
        return SIDE_EFFECTS.EXTERNAL_WRITE
      case ACTION_TYPES.API_CALL:
        // Check if it's a write operation
        if (parameters?.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(parameters.method as string)) {
          return SIDE_EFFECTS.EXTERNAL_WRITE
        }
        return SIDE_EFFECTS.READ_ONLY
      case ACTION_TYPES.DATABASE_QUERY:
        // Check if it's a write operation
        if (parameters?.operation && ['INSERT', 'UPDATE', 'DELETE'].includes(parameters.operation as string)) {
          return SIDE_EFFECTS.EXTERNAL_WRITE
        }
        return SIDE_EFFECTS.READ_ONLY
      case ACTION_TYPES.FILE_OPERATION:
        // Check if it's destructive
        if (parameters?.operation && ['DELETE', 'OVERWRITE'].includes(parameters.operation as string)) {
          return SIDE_EFFECTS.DESTRUCTIVE
        }
        return SIDE_EFFECTS.EXTERNAL_WRITE
      case ACTION_TYPES.NOTIFICATION:
        return SIDE_EFFECTS.READ_ONLY
      default:
        return SIDE_EFFECTS.READ_ONLY
    }
  }

  /**
   * Determine risk level
   */
  private static determineRiskLevel(
    actionType: ActionType,
    sideEffect: SideEffect,
    parameters?: Record<string, unknown>
  ): RiskLevel {
    // High risk: payments, destructive operations, large costs
    if (
      actionType === ACTION_TYPES.PAYMENT ||
      sideEffect === SIDE_EFFECTS.DESTRUCTIVE ||
      sideEffect === SIDE_EFFECTS.PHYSICAL ||
      (parameters?.cost && Number(parameters.cost) > 1000)
    ) {
      return RISK_LEVELS.HIGH
    }

    // Medium risk: external writes, marketplace operations
    if (
      sideEffect === SIDE_EFFECTS.EXTERNAL_WRITE ||
      actionType === ACTION_TYPES.MARKETPLACE_HIRE ||
      (parameters?.cost && Number(parameters.cost) > 100)
    ) {
      return RISK_LEVELS.MEDIUM
    }

    // Low risk: read-only operations
    return RISK_LEVELS.LOW
  }

  /**
   * Estimate cost for an action (mock implementation)
   */
  private static estimateCost(actionType: ActionType, parameters?: Record<string, unknown>): number {
    // If cost is provided in parameters, use it
    if (parameters?.cost && typeof parameters.cost === 'number') {
      return parameters.cost
    }

    // Default cost estimates by action type
    switch (actionType) {
      case ACTION_TYPES.PAYMENT:
        return parameters?.amount ? Number(parameters.amount) : 0
      case ACTION_TYPES.MARKETPLACE_HIRE:
        return 50 // Mock hiring cost
      case ACTION_TYPES.API_CALL:
        return 0.01 // Minimal API call cost
      case ACTION_TYPES.DATA_UPDATE:
        return 0
      case ACTION_TYPES.NOTIFICATION:
        return 0
      case ACTION_TYPES.FILE_OPERATION:
        return 0
      case ACTION_TYPES.DATABASE_QUERY:
        return 0
      default:
        return 0
    }
  }
}
