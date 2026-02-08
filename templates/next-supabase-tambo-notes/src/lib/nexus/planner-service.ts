/**
 * Planner Service
 * Generates structured task plans from user messages using LLM
 */

import type { TaskPlan, TaskStep } from './schema'
import type { ActionType } from './constants'
import { RiskAssessor } from './risk-assessor'

const TAMBO_API_KEY = process.env.TAMBO_API_KEY
const TAMBO_API_URL = process.env.TAMBO_API_URL || 'https://api.tambo.co'

export interface PlanStep {
  step_number: number
  action_type: ActionType
  description: string
  parameters?: Record<string, unknown>
}

export interface GeneratedPlan {
  steps: PlanStep[]
  estimated_total_cost: number
  overall_risk: 'low' | 'medium' | 'high'
  summary: string
}

export class PlannerService {
  /**
   * Generate a task plan from a user message
   */
  static async generatePlan(userMessage: string): Promise<GeneratedPlan> {
    // For MVP, we'll use a simple structured approach
    // In production, this would call an LLM via Tambo API
    
    // Mock plan generation - in real implementation, this would call LLM
    const plan = await this.callLLMForPlan(userMessage)
    
    return plan
  }

  /**
   * Call LLM to generate plan (mock implementation for MVP)
   * TODO: Replace with actual Tambo API call
   */
  private static async callLLMForPlan(userMessage: string): Promise<GeneratedPlan> {
    // Mock implementation - parse simple intents
    // In production, this would make a request to Tambo API
    
    const lowerMessage = userMessage.toLowerCase()
    
    // Simple intent detection for MVP
    if (lowerMessage.includes('payment') || lowerMessage.includes('pay') || lowerMessage.includes('buy')) {
      return {
        steps: [
          {
            step_number: 1,
            action_type: 'payment' as ActionType,
            description: 'Process payment transaction',
            parameters: {
              amount: this.extractAmount(userMessage) || 100,
              currency: 'USD',
            },
          },
        ],
        estimated_total_cost: this.extractAmount(userMessage) || 100,
        overall_risk: 'high' as const,
        summary: 'Payment transaction plan',
      }
    }

    if (lowerMessage.includes('hire') || lowerMessage.includes('contractor') || lowerMessage.includes('freelancer')) {
      return {
        steps: [
          {
            step_number: 1,
            action_type: 'marketplace_hire' as ActionType,
            description: 'Hire contractor from marketplace',
            parameters: {
              role: this.extractRole(userMessage) || 'developer',
              budget: 500,
            },
          },
        ],
        estimated_total_cost: 500,
        overall_risk: 'high' as const,
        summary: 'Marketplace hiring plan',
      }
    }

    // Default: simple API call
    return {
      steps: [
        {
          step_number: 1,
          action_type: 'api_call' as ActionType,
          description: 'Execute API call based on user request',
          parameters: {
            endpoint: '/api/execute',
            method: 'POST',
          },
        },
      ],
      estimated_total_cost: 0.01,
      overall_risk: 'low' as const,
      summary: 'Standard API execution plan',
    }
  }

  /**
   * Extract amount from message (simple regex)
   */
  private static extractAmount(message: string): number | null {
    const match = message.match(/\$?(\d+(?:\.\d{2})?)/)
    return match ? parseFloat(match[1]) : null
  }

  /**
   * Extract role from message
   */
  private static extractRole(message: string): string | null {
    const roles = ['developer', 'designer', 'writer', 'marketer', 'consultant']
    for (const role of roles) {
      if (message.toLowerCase().includes(role)) {
        return role
      }
    }
    return null
  }

  /**
   * Convert generated plan to database format
   */
  static convertToTaskSteps(plan: GeneratedPlan, planId: string): Omit<TaskStep, 'id' | 'executed_at'>[] {
    return plan.steps.map((step) => {
      const assessment = RiskAssessor.assessAction(step.action_type, step.parameters)
      
      return {
        plan_id: planId,
        step_number: step.step_number,
        action_type: step.action_type,
        description: step.description,
        parameters: step.parameters || null,
        estimated_cost: assessment.estimatedCost,
        requires_approval: assessment.requiresApproval,
        risk_level: assessment.riskLevel,
        side_effect: assessment.sideEffect,
        status: 'pending',
        result: null,
        error_message: null,
      }
    })
  }
}
