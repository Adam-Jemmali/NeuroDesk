'use client'

import { useState } from 'react'

export type ExecutionMode = 'simulation' | 'execution'

interface ModeToggleProps {
  mode: ExecutionMode
  onModeChange: (mode: ExecutionMode) => void
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onModeChange('simulation')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          mode === 'simulation'
            ? 'bg-white/20 border border-white/40 text-white'
            : 'bg-neutral-800/30 border border-neutral-700/30 text-neutral-400 hover:text-neutral-300'
        }`}
      >
        SIMULATION
      </button>
      <button
        onClick={() => onModeChange('execution')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          mode === 'execution'
            ? 'bg-white/20 border border-white/40 text-white'
            : 'bg-neutral-800/30 border border-neutral-700/30 text-neutral-400 hover:text-neutral-300'
        }`}
      >
        EXECUTION
      </button>
    </div>
  )
}
