/**
 * NEXUS Tools for Tambo
 * Replaces brain simulation tools with NEXUS backend API tools
 */
import { TamboTool } from '@tambo-ai/react'
import { z } from 'zod'
import { nexusApi, type NexusTask } from './nexus-api-client'

/**
 * Submit a task to NEXUS backend
 */
export const submitTaskTool: TamboTool = {
  name: 'submit_task',
  description: 'Submit a task to the NEXUS backend for execution. The task will be parsed, planned, and executed by appropriate agents.',
  tool: async ({ userMessage }: { userMessage: string }) => {
    try {
      const task = await nexusApi.submitTask(userMessage)
      return {
        success: true,
        task_id: task.id,
        status: task.status,
        message: `Task "${task.title}" has been submitted. Status: ${task.status}`,
        task,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit task',
      }
    }
  },
  inputSchema: z.object({
    userMessage: z.string().describe('The user message describing the task to execute'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    task_id: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    task: z.any().optional(),
    error: z.string().optional(),
  }),
}

/**
 * List all tasks for the current user
 */
export const listTasksTool: TamboTool = {
  name: 'list_tasks',
  description: 'List all tasks for the current user, showing their status and results.',
  tool: async (_params: {}) => {
    try {
      const tasks = await nexusApi.listTasks()
      return {
        success: true,
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          created_at: t.created_at,
          completed_at: t.completed_at,
        })),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list tasks',
      }
    }
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    count: z.number().optional(),
    tasks: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
}

/**
 * Get details of a specific task
 */
export const getTaskTool: TamboTool = {
  name: 'get_task',
  description: 'Get detailed information about a specific task including its status, result, and execution details.',
  tool: async ({ taskId }: { taskId: string }) => {
    try {
      const task = await nexusApi.getTask(taskId)
      return {
        success: true,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          result: task.result,
          error_message: task.error_message,
          created_at: task.created_at,
          started_at: task.started_at,
          completed_at: task.completed_at,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get task',
      }
    }
  },
  inputSchema: z.object({
    taskId: z.string().describe('The task ID to retrieve'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    task: z.any().optional(),
    error: z.string().optional(),
  }),
}

/**
 * Approve a pending task
 */
export const approveTaskTool: TamboTool = {
  name: 'approve_task',
  description: 'Approve a pending task that requires approval before execution.',
  tool: async ({ taskId, notes }: { taskId: string; notes?: string }) => {
    try {
      const task = await nexusApi.approveTask(taskId, notes)
      return {
        success: true,
        task_id: task.id,
        status: task.status,
        message: `Task "${task.title}" has been approved and will now execute.`,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to approve task',
      }
    }
  },
  inputSchema: z.object({
    taskId: z.string().describe('The task ID to approve'),
    notes: z.string().optional().describe('Optional notes for the approval'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    task_id: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
}

/**
 * Get spending summary
 */
export const getSpendingTool: TamboTool = {
  name: 'get_spending',
  description: 'Get the current spending summary showing daily and monthly budget usage.',
  tool: async (_params: {}) => {
    try {
      const spending = await nexusApi.getSpending()
      return {
        success: true,
        daily: {
          spent: spending.daily_spent,
          limit: spending.daily_limit,
          remaining: spending.daily_limit - spending.daily_spent,
        },
        monthly: {
          spent: spending.monthly_spent,
          limit: spending.monthly_limit,
          remaining: spending.monthly_limit - spending.monthly_spent,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get spending',
      }
    }
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    daily: z.object({
      spent: z.number(),
      limit: z.number(),
      remaining: z.number(),
    }).optional(),
    monthly: z.object({
      spent: z.number(),
      limit: z.number(),
      remaining: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
}

/**
 * Stream events (SSE) - informational tool
 * Note: SSE is handled separately via EventSource, this is just for documentation
 */
export const streamEventsTool: TamboTool = {
  name: 'stream_events',
  description: 'Get information about the real-time event stream. Events are automatically streamed via Server-Sent Events (SSE) when connected.',
  tool: async (_params: {}) => {
    return {
      success: true,
      message: 'Event streaming is handled automatically via SSE. Connect to /api/v1/events/stream to receive real-time updates.',
      event_types: [
        'task_created',
        'status_changed',
        'agent_started',
        'agent_completed',
        'approval_needed',
        'task_completed',
      ],
    }
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    event_types: z.array(z.string()),
  }),
}

// Export all NEXUS tools
export const nexusTools: TamboTool[] = [
  submitTaskTool,
  listTasksTool,
  getTaskTool,
  approveTaskTool,
  getSpendingTool,
  streamEventsTool,
]
