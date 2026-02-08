'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Navbar } from '@/components/Navbar'
import { SessionsList } from '@/components/SessionsList'
import { BrainMap } from '@/components/BrainMap'
import { Waveform } from '@/components/Waveform'
import { SignalMeters } from '@/components/SignalMeters'
import { SimulationControls } from '@/components/SimulationControls'
import { SupabaseError } from '@/components/SupabaseError'
import { TamboError } from '@/components/TamboError'
import { SetupRequired } from '@/components/SetupRequired'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { StreamingError } from '@/components/StreamingError'
import { TamboProvider, useTamboThread } from '@tambo-ai/react'
import { MCPTransport } from '@tambo-ai/react/mcp'
import { ScrollableMessageContainer } from '@tambo-ai/ui-registry/components/scrollable-message-container'
import { ThreadContent, ThreadContentMessages } from '@tambo-ai/ui-registry/components/thread-content'
import {
  MessageInput,
  MessageInputError,
  MessageInputFileButton,
  MessageInputMcpPromptButton,
  MessageInputMcpResourceButton,
  MessageInputSubmitButton,
  MessageInputTextarea,
  MessageInputToolbar,
} from '@tambo-ai/ui-registry/components/message-input'
import { useUserContextKey } from '@/lib/useUserContextKey'
import { nexusTools } from '@/lib/nexus-tools'
import { nexusApi } from '@/lib/nexus-api-client'
import { toolEvents } from '@/lib/tool-events'
import type { BrainState } from '@/lib/brain/sim'
import { BRAIN_REGIONS, type RegionId } from '@/lib/brain/regions'
import { generateWaveformSamples, calculateSignals, stimulateRegion, computeDominantWave } from '@/lib/brain/sim'
import { ModeToggle, type ExecutionMode } from '@/components/nexus/ModeToggle'
import { ApprovalQueue } from '@/components/nexus/ApprovalQueue'
import { NexusConnectionStatus } from '@/components/nexus/NexusConnectionStatus'
import { AuditLogViewer } from '@/components/nexus/AuditLogViewer'
import { AgentStatus } from '@/components/nexus/AgentStatus'

interface ExtendedBrainState extends Omit<BrainState, 'regions'> {
  regions?: Record<string, { x: number; y: number; label: string; active?: boolean; activity?: number }>
  waveInfo?: { data?: number[]; frequency?: number; amplitude?: number }
  signals?: Record<string, number>
}

interface Session {
  id: string
  title: string
  state: ExtendedBrainState
  created_at: string
}

const MCP_DEMO_URL =
  process.env.NEXT_PUBLIC_MCP_DEMO_URL || 'https://everything-mcp.tambo.co/mcp'

// Execution Mode Input Component
function ExecutionModeInput({ onPlanCreated }: { onPlanCreated: (runId: string) => void }) {
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Not authenticated')
      }

      const response = await fetch('/api/nexus/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          user_message: message,
          mode: 'execution',
        }),
      })

      if (!response.ok) {
        const { error: errorData } = await response.json()
        throw new Error(errorData || 'Failed to create plan')
      }

      const { run_id, approvals } = await response.json()
      onPlanCreated(run_id)
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Describe what you want to execute..."
        className="w-full px-4 py-3 text-sm bg-neutral-900/50 border border-neutral-700/50 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-white/30 resize-none"
        rows={3}
        disabled={isSubmitting}
      />
      {error && (
        <div className="text-xs text-red-400 px-2">{error}</div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">
          Execution Mode: Your request will be planned and require approval for high-risk actions
        </span>
        <button
          type="submit"
          disabled={!message.trim() || isSubmitting}
          className="px-4 py-2 text-sm font-semibold bg-white/20 border border-white/40 text-white rounded-lg hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSubmitting ? 'Planning...' : 'Submit'}
        </button>
      </div>
    </form>
  )
}

function AppContent() {
  const router = useRouter()
  const { thread, sendThreadMessage } = useTamboThread()
  const [streamingError, setStreamingError] = useState<Error | null>(null)

  // Monitor for streaming errors
  useEffect(() => {
    if (streamingError) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:60', message: 'STREAMING_ERROR_DETECTED', data: { error: streamingError.message, name: streamingError.name, stack: streamingError.stack?.substring(0, 200) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
      // #endregion
    }
  }, [streamingError])

  const [loading, setLoading] = useState(true)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>()
  const [currentState, setCurrentState] = useState<ExtendedBrainState>(() => {
    const initialRegions: Record<RegionId, number> = {
      frontal: 0,
      parietal: 0,
      occipital: 0,
      temporal: 0,
      cerebellum: 0,
      brainstem: 0,
    }

    const initialWave = {
      type: 'alpha' as const,
      freqHz: 10,
      amp: 50,
    }

    const brainState: BrainState = {
      regions: initialRegions,
      wave: initialWave,
      updatedAt: new Date().toISOString(),
    }

    const signals = calculateSignals(brainState)
    const waveData = generateWaveformSamples(initialWave, 200)

    return {
      ...brainState,
      regions: Object.fromEntries(
        Object.entries(BRAIN_REGIONS).map(([id, region]) => [
          id,
          { x: region.x, y: region.y, label: region.label, active: false },
        ])
      ) as Record<string, { x: number; y: number; label: string; active?: boolean }>,
      waveInfo: { data: waveData, frequency: initialWave.freqHz, amplitude: initialWave.amp },
      signals,
    }
  })
  const previousMessageCountRef = useRef<number>(0)
  const [activeTab, setActiveTab] = useState<'waveform' | 'analysis'>('waveform')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('simulation')
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [showApprovals, setShowApprovals] = useState(false)
  const [showAuditLog, setShowAuditLog] = useState(false)

  useEffect(() => {
    console.log('[Page] State changed - showApprovals:', showApprovals, 'showAuditLog:', showAuditLog)
  }, [showApprovals, showAuditLog])

  // Check NEXUS authentication
  useEffect(() => {
    let cancelled = false

    async function checkNexusAuth() {
      try {
        const token = nexusApi.getAccessToken()
        if (!token) {
          if (!cancelled) {
            router.replace('/nexus-auth')
          }
          return
        }

        // Verify token is valid by calling /me
        try {
          await nexusApi.getCurrentUser()
          if (!cancelled) {
            setLoading(false)
            setSessionReady(true)
          }
        } catch (error) {
          // Token invalid, clear it and redirect
          nexusApi.logout()
          if (!cancelled) {
            router.replace('/nexus-auth')
          }
        }
      } catch (error) {
        if (!cancelled) {
          router.replace('/nexus-auth')
        }
      }
    }

    checkNexusAuth()

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        setLoading(false)
      }
    }, 3000)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [router])

  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    if (!supabase) return

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session || !session.access_token) {
        setSessionsError('Couldn\'t load sessions')
        return
      }

      setSessionsError(null)
      const response = await fetch('/api/sessions', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 401) {
          router.replace('/auth')
          return
        }
        throw new Error('Failed to fetch sessions')
      }

      const { sessions: fetchedSessions } = await response.json()
      setSessions(fetchedSessions || [])
    } catch (error) {
      // Only set error if we're not redirecting
      if (error instanceof Error && !error.message.includes('redirect')) {
        setSessionsError('Couldn\'t load sessions')
      }
    }
  }, [router])

  // Helper to convert UI state to BrainState
  const getBrainState = useCallback((): BrainState => {
    const regions: Record<RegionId, number> = Object.fromEntries(
      Object.entries(BRAIN_REGIONS).map(([id]) => {
        const regionData = currentState.regions?.[id]
        let activation = 0
        if (regionData && typeof regionData === 'object' && 'active' in regionData) {
          activation = regionData.active ? 50 : 0
        } else if (typeof regionData === 'number') {
          activation = regionData
        }
        return [id, activation]
      })
    ) as Record<RegionId, number>

    return {
      regions,
      wave: currentState.wave || { type: 'alpha', freqHz: 10, amp: 50 },
      updatedAt: currentState.updatedAt || new Date().toISOString(),
    }
  }, [currentState])

  // Helper to update state from BrainState
  const updateStateFromBrainState = useCallback((brainState: BrainState) => {
    const signals = calculateSignals(brainState)
    const waveData = generateWaveformSamples(brainState.wave, 200)

    const extendedState: ExtendedBrainState = {
      ...brainState,
      regions: Object.fromEntries(
        Object.entries(BRAIN_REGIONS).map(([id, region]) => {
          const activation = brainState.regions[id as RegionId] || 0
          // Store activity as 0-1 value for BrainMap color intensity
          const activity = Math.min(1, Math.max(0, activation / 100))
          return [
            id,
            {
              x: region.x,
              y: region.y,
              label: region.label,
              active: activation > 0,
              activity, // Store 0-1 value for color intensity
            },
          ]
        })
      ) as Record<string, { x: number; y: number; label: string; active?: boolean; activity?: number }>,
      waveInfo: {
        data: waveData,
        frequency: brainState.wave.freqHz,
        amplitude: brainState.wave.amp,
      },
      signals,
    }
    setCurrentState(extendedState)
  }, [])


  // Listen to tool execution events for immediate UI updates
  useEffect(() => {
    if (!sessionReady) return

    const unsubscribeStimulate = toolEvents.on('stimulate_region', () => {
      // State is already updated by the tool, just trigger re-render
      // The BrainMap and Waveform will update automatically via props
    })

    const unsubscribeSave = toolEvents.on('save_session', () => {
      // Refresh sessions list
      fetchSessions()
    })

    const unsubscribeLoad = toolEvents.on('load_session', () => {
      // State is already updated by the tool, just trigger re-render
      fetchSessions()
    })

    return () => {
      unsubscribeStimulate()
      unsubscribeSave()
      unsubscribeLoad()
    }
  }, [sessionReady, fetchSessions])

  const loadSession = useCallback(async (sessionId: string) => {
    if (!supabase) return

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session || !session.access_token) {
        return
      }

      const response = await fetch(`/api/sessions?id=${sessionId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 401) {
          router.replace('/auth')
          return
        }
        throw new Error('Failed to load session')
      }

      const { session: sessionData } = await response.json()
      if (sessionData?.state) {
        const loadedState = sessionData.state as BrainState
        updateStateFromBrainState(loadedState)
        setSelectedSessionId(sessionId)
      }
    } catch (error) {
      // Error loading session - user will see it in UI
    }
  }, [updateStateFromBrainState, router])

  const saveSession = useCallback(async (title: string) => {
    if (!supabase) return

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session || !session.access_token) {
        return
      }

      // Extract BrainState from current state
      const stateToSave: BrainState = {
        regions: Object.fromEntries(
          Object.entries(BRAIN_REGIONS).map(([id]) => {
            const regionData = currentState.regions?.[id]
            let activation = 0
            if (regionData && typeof regionData === 'object' && 'active' in regionData) {
              activation = regionData.active ? 50 : 0
            } else if (typeof regionData === 'number') {
              activation = regionData
            }
            return [id, activation]
          })
        ) as Record<RegionId, number>,
        wave: currentState.wave || { type: 'alpha', freqHz: 10, amp: 50 },
        updatedAt: new Date().toISOString(),
      }

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          title,
          state: stateToSave,
        }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          router.replace('/auth')
          return
        }
        throw new Error('Failed to save session')
      }

      await fetchSessions()
    } catch (error) {
      // Silently fail - user will see error in UI if needed
    }
  }, [currentState, fetchSessions, router])

  useEffect(() => {
    if (!loading && sessionReady && supabase) {
      // Only fetch sessions when session is ready and we have access token
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) {
          fetchSessions()
        }
      })
    }
  }, [loading, sessionReady, fetchSessions, supabase])

  useEffect(() => {
    if (!thread || loading || !thread.messages) return

    const currentMessageCount = thread.messages.length
    const previousMessageCount = previousMessageCountRef.current

    if (currentMessageCount > previousMessageCount) {
      const lastMessage = thread.messages[thread.messages.length - 1]
      if (lastMessage?.role === 'assistant') {
        // Refresh sessions list after tool execution
        fetchSessions()
      }
    }

    previousMessageCountRef.current = currentMessageCount
  }, [thread?.messages, loading, fetchSessions, sessionReady, getBrainState, updateStateFromBrainState])

  const handleRegionClick = (regionId: string) => {
    setCurrentState((prev) => {
      const regionKey = regionId as RegionId
      // Extract numeric activation from UI state
      const regionData = prev.regions?.[regionKey]
      let currentActivation = 0
      if (regionData && typeof regionData === 'object' && 'active' in regionData) {
        currentActivation = regionData.active ? 50 : 0
      } else if (typeof regionData === 'number') {
        currentActivation = regionData
      }
      const newActivation = currentActivation > 0 ? 0 : 50 // Toggle between 0 and 50

      // Build updated regions map from BrainState format
      const updatedRegions: Record<RegionId, number> = {
        frontal: 0,
        parietal: 0,
        occipital: 0,
        temporal: 0,
        cerebellum: 0,
        brainstem: 0,
      }
      // Preserve existing activations
      Object.entries(BRAIN_REGIONS).forEach(([id]) => {
        const existingData = prev.regions?.[id]
        if (id === regionKey) {
          updatedRegions[id as RegionId] = newActivation
        } else if (existingData && typeof existingData === 'object' && 'active' in existingData) {
          updatedRegions[id as RegionId] = existingData.active ? 50 : 0
        } else if (typeof existingData === 'number') {
          updatedRegions[id as RegionId] = existingData
        }
      })

      const updatedWave = {
        ...prev.wave,
        type: prev.wave?.type || 'alpha',
        freqHz: prev.wave?.freqHz || 10,
        amp: prev.wave?.amp || 50,
      }

      const brainState: BrainState = {
        regions: updatedRegions,
        wave: updatedWave,
        updatedAt: new Date().toISOString(),
      }

      const signals = calculateSignals(brainState)
      const waveData = generateWaveformSamples(updatedWave, 200)

      return {
        ...brainState,
        regions: Object.fromEntries(
          Object.entries(BRAIN_REGIONS).map(([id, region]) => [
            id,
            {
              x: region.x,
              y: region.y,
              label: region.label,
              active: updatedRegions[id as RegionId] > 0,
            },
          ])
        ) as Record<string, { x: number; y: number; label: string; active?: boolean }>,
        waveInfo: { data: waveData, frequency: updatedWave.freqHz, amplitude: updatedWave.amp },
        signals,
      }
    })
  }

  if (!supabase) {
    return <SupabaseError />
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'var(--nl-bg-gradient)' }}>
      <Navbar />
      <main className="h-[calc(100vh-72px)] px-6 py-6">
        <div className="max-w-[1400px] mx-auto h-full">
          <div className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-6 h-full min-w-0">
            {/* Left Column - Simulation Panels (60-65%) */}
            <div className="flex flex-col gap-6 overflow-y-auto">
              {/* A) Brain Activity Map Card */}
              <div className="nl-card p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <div>
                      <h2 className="text-lg font-bold text-neutral-100">Brain Activity Map</h2>
                      <p className="text-sm text-neutral-400 mt-0.5">Click regions to view details.</p>
                    </div>
                  </div>
                  {/* Badge */}
                  <div className="nl-pill bg-white/10 border border-white/30 text-white">
                    {(currentState.wave?.type?.toUpperCase() || 'ALPHA')} • {currentState.waveInfo?.frequency?.toFixed(1) || '10.0'}Hz
                  </div>
                </div>
                <BrainMap
                  regions={currentState.regions || {}}
                  onRegionClick={handleRegionClick}
                />
              </div>

              {/* B) Tabs Row */}
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('waveform')}
                  className={`nl-pill px-4 py-2 text-sm font-semibold transition-all ${activeTab === 'waveform'
                    ? 'bg-white/20 border-white/40 text-white'
                    : 'bg-neutral-800/30 border-neutral-700/30 text-neutral-400 hover:text-neutral-300'
                    }`}
                >
                  EEG Waveform
                </button>
                <button
                  onClick={() => setActiveTab('analysis')}
                  className={`nl-pill px-4 py-2 text-sm font-semibold transition-all ${activeTab === 'analysis'
                    ? 'bg-white/20 border-white/40 text-white'
                    : 'bg-neutral-800/30 border-neutral-700/30 text-neutral-400 hover:text-neutral-300'
                    }`}
                >
                  Signal Analysis
                </button>
              </div>

              {/* C) Waveform Card */}
              {activeTab === 'waveform' && (
                <div className="nl-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                      <span className="text-sm font-semibold text-neutral-100">
                        LIVE | {(currentState.wave?.type?.toUpperCase() || 'ALPHA')} WAVE
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-neutral-400">
                      {currentState.waveInfo?.frequency?.toFixed(1) || '10.0'} Hz  {currentState.waveInfo?.amplitude || '50'}% Amp
                    </div>
                  </div>
                  <Waveform
                    data={currentState.waveInfo?.data}
                    frequency={currentState.waveInfo?.frequency}
                    amplitude={currentState.waveInfo?.amplitude}
                  />
                </div>
              )}

              {/* Signal Analysis Tab */}
              {activeTab === 'analysis' && (
                <div className="nl-card p-6">
                  <SignalMeters
                    signals={currentState.signals}
                    wave={currentState.wave}
                  />
                </div>
              )}

              {/* D) Simulation Controls Card */}
              <SimulationControls
                currentState={currentState}
                onStimulate={async (region, intensity, frequency) => {
                  const brainState = getBrainState()
                  const regionId = region as RegionId
                  const currentActivation = brainState.regions[regionId] || 0
                  const newActivation = stimulateRegion(currentActivation, intensity * 100, frequency)

                  // Calculate dominant wave type based on frequency
                  const waveType = computeDominantWave(frequency)

                  const updatedState: BrainState = {
                    ...brainState,
                    regions: {
                      ...brainState.regions,
                      [regionId]: newActivation,
                    },
                    wave: {
                      type: waveType,
                      freqHz: frequency,
                      amp: intensity * 100,
                    },
                    updatedAt: new Date().toISOString(),
                  }

                  // Update state which will trigger waveform update
                  updateStateFromBrainState(updatedState)

                  // Force waveform to regenerate with new frequency
                  // The Waveform component will pick up the new frequency from currentState.waveInfo
                }}
                onSaveSession={async (title) => {
                  const brainState = getBrainState()
                  if (!supabase) return

                  const { data: { session } } = await supabase.auth.getSession()
                  if (!session) return

                  const response = await fetch('/api/sessions', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${session.access_token}`,
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                      title: title || 'Untitled Session',
                      state: brainState,
                    }),
                  })

                  if (response.ok) {
                    fetchSessions()
                  }
                }}
                onReset={() => {
                  const defaultState: BrainState = {
                    regions: Object.fromEntries(
                      Object.keys(BRAIN_REGIONS).map(id => [id, 0])
                    ) as Record<RegionId, number>,
                    wave: { type: 'alpha', freqHz: 10, amp: 50 },
                    updatedAt: new Date().toISOString(),
                  }
                  updateStateFromBrainState(defaultState)
                }}
              />

              {/* Sessions List */}
              <div className="nl-card overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-800/60">
                  <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Sessions</h3>
                </div>
                {sessionsError ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="text-center">
                      <p className="text-red-400 mb-4 text-sm">{sessionsError}</p>
                      <button
                        onClick={fetchSessions}
                        className="nl-pill bg-white/20 border-white/40 text-white hover:bg-white/30"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : (
                  <SessionsList
                    sessions={sessions}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={loadSession}
                  />
                )}
              </div>

              {/* Execution Mode Components */}
              {executionMode === 'execution' && (
                <>
                  {/* Connection Status Indicator */}
                  <NexusConnectionStatus />
                  
                  {/* Agent Status */}
                  {currentRunId && (
                    <AgentStatus runId={currentRunId} />
                  )}

                  {/* Approval Queue Toggle */}
                  <div className="nl-card p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-neutral-100">NEXUS Controls</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            console.log('[Page] Toggling approvals, current:', showApprovals)
                            setShowApprovals(!showApprovals)
                          }}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            showApprovals
                              ? 'bg-white/20 border border-white/40 text-white'
                              : 'bg-neutral-800/30 border border-neutral-700/30 text-neutral-400 hover:text-neutral-300'
                          }`}
                        >
                          Approvals
                        </button>
                        <button
                          onClick={() => {
                            console.log('[Page] Toggling audit log, current:', showAuditLog)
                            setShowAuditLog(!showAuditLog)
                          }}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            showAuditLog
                              ? 'bg-white/20 border border-white/40 text-white'
                              : 'bg-neutral-800/30 border border-neutral-700/30 text-neutral-400 hover:text-neutral-300'
                          }`}
                        >
                          Audit Log
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Approval Queue */}
                  {showApprovals ? (
                    <div className="nl-card overflow-hidden mt-4" style={{ display: 'block', visibility: 'visible', zIndex: 10 }}>
                      <div className="px-6 py-4 border-b border-neutral-800/60">
                        <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Approval Queue</h3>
                      </div>
                      <div className="p-4 min-h-[200px] max-h-[600px] overflow-y-auto">
                        <ApprovalQueue />
                      </div>
                    </div>
                  ) : null}

                  {/* Audit Log Viewer */}
                  {showAuditLog ? (
                    <div className="mt-4" style={{ display: 'block', visibility: 'visible', zIndex: 10 }}>
                      <AuditLogViewer runId={currentRunId || undefined} limit={20} />
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* Right Column - Nexus Assistant (35-40%) */}
            <div className="neurodesk-chat nl-card flex flex-col h-[calc(100vh-72px)] min-w-0 overflow-hidden">
              {/* Header */}
              <div className="p-6 border-b border-neutral-800/60 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <h2 className="text-lg font-bold text-neutral-100">Nexus Assistant</h2>
                  </div>
                  <ModeToggle mode={executionMode} onModeChange={setExecutionMode} />
                </div>

                {/* Info Bar */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-white/10 border border-white/30">
                  <svg className="w-4 h-4 text-white flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-white/90 leading-relaxed">
                    This is the command interface for the NEXUS Command Center. Use Simulation mode for testing or Execution mode for real operations.

                  </p>
                </div>
              </div>

              {/* Chat Messages Area - flex-1 min-h-0 for proper scrolling */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <ScrollableMessageContainer className="flex-1 min-h-0 p-4">
                  <ThreadContent variant="default" className="h-full">
                    <ThreadContentMessages className="h-full" />
                  </ThreadContent>
                </ScrollableMessageContainer>

                {/* Streaming Error Display */}
                {streamingError && (
                  <div className="px-4 pb-2">
                    <StreamingError
                      error={streamingError}
                      onRetry={() => setStreamingError(null)}
                    />
                  </div>
                )}

                {/* Input Bar - Pinned to bottom */}
                <div className="p-4 border-t border-neutral-800/60 flex-shrink-0">
                  {executionMode === 'execution' ? (
                    <ExecutionModeInput
                      onPlanCreated={(runId) => {
                        setCurrentRunId(runId)
                        setShowApprovals(true)
                      }}
                    />
                  ) : (
                    <MessageInput>
                      <MessageInputTextarea placeholder="Ask about neural patterns..." />
                      <MessageInputToolbar>
                        <MessageInputFileButton />
                        <MessageInputMcpPromptButton />
                        <MessageInputMcpResourceButton />
                        <MessageInputSubmitButton />
                      </MessageInputToolbar>
                      <MessageInputError />
                    </MessageInput>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function AppPage() {
  const userContextKey = useUserContextKey('nexus')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Follow official Tambo template pattern: use NEXT_PUBLIC_TAMBO_API_KEY directly
  // See: https://docs.tambo.co/getting-started/integrate
  // Documentation: https://docs.tambo.co/getting-started/integrate
  const tamboApiKey = process.env.NEXT_PUBLIC_TAMBO_API_KEY
  // Use custom URL if provided, otherwise let Tambo SDK use default (https://api.tambo.co)
  // According to docs, no proxy route needed - connect directly to Tambo API
  const tamboUrl = process.env.NEXT_PUBLIC_TAMBO_API_URL // undefined = use default

  // Log configuration in development - right before client creation
  if (process.env.NODE_ENV === 'development') {
    console.log('[Tambo Config] Client configuration (before TamboAI instantiation):', {
      hasApiKey: !!tamboApiKey,
      apiKeyLength: tamboApiKey?.length || 0,
      apiKeyPreview: tamboApiKey ? `${tamboApiKey.substring(0, 8)}...` : '[MISSING]',
      tamboUrl: tamboUrl || '[NOT SET - using default]',
      hasSupabase: !!supabaseUrl && !!supabaseAnonKey,
    })

    if (!tamboApiKey) {
      console.error('[Tambo Config] ERROR: NEXT_PUBLIC_TAMBO_API_KEY is missing.')
      console.error('[Tambo Config] Set NEXT_PUBLIC_TAMBO_API_KEY in .env.local')
      console.error('[Tambo Config] Get your API key from: https://tambo.co/dashboard')
    } else {
      // Validate URL if provided
      if (tamboUrl) {
        try {
          new URL(tamboUrl)
          console.log('[Tambo Config] ✓ Custom Tambo URL is valid:', tamboUrl)
        } catch (urlError) {
          console.error('[Tambo Config] ERROR: Invalid tamboUrl format:', tamboUrl)
        }
      } else {
        // #region agent log
        if (typeof window !== 'undefined') {
          fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/page.tsx:960',message:'TAMBO_URL_DEFAULT',data:{tamboUrl:'[NOT SET - using default]',hasApiKey:!!tamboApiKey},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        }
        // #endregion
        console.log('[Tambo Config] Using default Tambo API URL (https://api.tambo.co)')
      }
    }
  }

  const missingVars = {
    tambo: !tamboApiKey,
    supabase: !supabaseUrl || !supabaseAnonKey,
  }

  if (missingVars.tambo || missingVars.supabase) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <SetupRequired missingVars={missingVars} />
      </div>
    )
  }

  // Only include MCP servers if explicitly configured (skip default demo server to avoid conflicts)
  const mcpServers = process.env.NEXT_PUBLIC_MCP_DEMO_URL
    ? [{ url: MCP_DEMO_URL, transport: MCPTransport.HTTP as const }]
    : []

  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'app/page.tsx:747', message: 'BEFORE_TAMBO_PROVIDER', data: { hasApiKey: !!tamboApiKey, toolsCount: nexusTools.length, toolNames: nexusTools.map(t => t.name) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
  }
  // #endregion

  return (
    <ErrorBoundary>
      <TamboProvider
        apiKey={tamboApiKey!}
        {...(tamboUrl && { tamboUrl })}
        tools={nexusTools}
        mcpServers={mcpServers}
        contextKey={userContextKey}
      >
        <AppContent />
      </TamboProvider>
    </ErrorBoundary>
  )
}
