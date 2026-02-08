'use client'

import { useState } from 'react'
import type { Approval } from '@/lib/nexus/schema'

interface ApprovalItemProps {
  approval: Approval
  onAction: (approvalId: string, action: 'approve' | 'reject', notes?: string) => Promise<void>
}

export function ApprovalItem({ approval, onAction }: ApprovalItemProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  console.log('[ApprovalItem] Rendering approval:', approval.id, approval.status, approval.reason)

  const handleApprove = async () => {
    setIsProcessing(true)
    setError(null)
    setSuccess(false)
    try {
      console.log('[ApprovalItem] Approving:', approval.id)
      await onAction(approval.id, 'approve', reviewNotes || undefined)
      setReviewNotes('')
      setShowNotes(false)
      setSuccess(true)
      // Clear success message after 2 seconds
      setTimeout(() => setSuccess(false), 2000)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to approve'
      console.error('[ApprovalItem] Failed to approve:', errorMessage)
      setError(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    setIsProcessing(true)
    setError(null)
    setSuccess(false)
    try {
      console.log('[ApprovalItem] Rejecting:', approval.id)
      await onAction(approval.id, 'reject', reviewNotes || undefined)
      setReviewNotes('')
      setShowNotes(false)
      setSuccess(true)
      // Clear success message after 2 seconds
      setTimeout(() => setSuccess(false), 2000)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reject'
      console.error('[ApprovalItem] Failed to reject:', errorMessage)
      setError(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="p-4 bg-neutral-900/50 border border-neutral-800/60 rounded-lg w-full">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-neutral-400 uppercase">
              {approval.approval_type}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              PENDING
            </span>
          </div>
          <h3 className="text-sm font-semibold text-neutral-100 mb-1">
            {approval.reason}
          </h3>
          <p className="text-xs text-neutral-400">
            Requested {new Date(approval.requested_at).toLocaleString()}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-xs">
          Action completed successfully!
        </div>
      )}

      {showNotes && (
        <div className="mb-3">
          <textarea
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Add review notes (optional)..."
            className="w-full px-3 py-2 text-sm bg-neutral-900/50 border border-neutral-700/50 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-white/30"
            rows={2}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleApprove}
          disabled={isProcessing}
          className="px-3 py-1.5 text-xs font-semibold bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isProcessing ? 'Processing...' : 'Approve'}
        </button>
        <button
          onClick={handleReject}
          disabled={isProcessing}
          className="px-3 py-1.5 text-xs font-semibold bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isProcessing ? 'Processing...' : 'Reject'}
        </button>
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="px-3 py-1.5 text-xs font-semibold bg-neutral-800/50 border border-neutral-700/50 text-neutral-400 rounded-lg hover:bg-neutral-800/70 transition-all"
        >
          {showNotes ? 'Hide Notes' : 'Add Notes'}
        </button>
      </div>
    </div>
  )
}
