# Phase 0.1 — Repo Audit & Conversion Plan

## 1. Current Folder Structure

```
src/
├── app/
│   ├── api/
│   │   ├── nexus/          # NEXUS Execution Mode APIs (already exists)
│   │   ├── sessions/        # Session management
│   │   └── tambo/           # Tambo API proxy
│   ├── app/
│   │   └── page.tsx         # Main chat UI (Neural Assistant)
│   ├── auth/
│   │   └── page.tsx         # Authentication page
│   ├── splash/
│   │   └── page.tsx         # Splash screen
│   └── layout.tsx           # Root layout
├── components/
│   ├── nexus/               # NEXUS components (already exists)
│   ├── BrainMap.tsx         # Brain visualization (to replace)
│   ├── Waveform.tsx         # Waveform display (to replace)
│   ├── SignalMeters.tsx     # Signal meters (to replace)
│   ├── SimulationControls.tsx # Controls (to replace)
│   └── Navbar.tsx           # Navigation (needs rebranding)
├── lib/
│   ├── brain/               # Brain simulation logic (to replace)
│   │   ├── regions.ts
│   │   └── sim.ts
│   ├── nexus/               # NEXUS logic (already exists)
│   ├── tambo-tools.ts       # Tambo tools (needs conversion)
│   ├── supabaseClient.ts    # Supabase client
│   └── supabaseServer.ts    # Supabase server client
└── hooks/
    └── useNexusEvents.ts    # NEXUS SSE hook
```

## 2. Tambo Tool-Calling Implementation

**Location:** `src/lib/tambo-tools.ts`

**Current Tools:**
1. `stimulate_region` — Stimulates brain regions with intensity/frequency
2. `analyze_patterns` — Analyzes brain wave patterns
3. `save_session` — Saves brain state to Supabase
4. `load_session` — Loads brain state from Supabase

**Implementation Pattern:**
- Tools use `TamboTool` type from `@tambo-ai/react`
- Tools access brain state via `setBrainStateAccessors()` callback pattern
- Tools are registered in `src/app/app/page.tsx` via `tamboTools` array
- Tools use Supabase client for persistence

**Key Files:**
- `src/lib/tambo-tools.ts` — Tool definitions
- `src/app/app/page.tsx:32` — Tool registration: `tools={tamboTools}`
- `src/app/app/page.tsx:350` — State accessor setup: `setBrainStateAccessors(getBrainState, updateStateFromBrainState, fetchSessions)`

## 3. Supabase Usage

**Client-Side:** `src/lib/supabaseClient.ts`
- Creates Supabase client with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Used for auth and client-side queries

**Server-Side:** `src/lib/supabaseServer.ts`
- Creates server client with cookie/header handling
- Used in API routes for authenticated requests

**Tables:**
- `sessions` — Stores brain simulation sessions (to be repurposed for NEXUS)
- `nexus_runs`, `task_plans`, `task_steps`, `approvals`, `audit_logs` — NEXUS tables (already exist)

**Usage Points:**
- Auth: `src/app/auth/page.tsx`
- Sessions API: `src/app/api/sessions/route.ts`
- NEXUS APIs: `src/app/api/nexus/*/route.ts`

## 4. Chat UI Location

**Main Chat Interface:** `src/app/app/page.tsx`

**Key Sections:**
- Line 846-866: Chat container with "Neural Assistant" header
- Line 135-918: `AppContent` component with:
  - Left: Brain visualization (BrainMap, Waveform, SignalMeters)
  - Right: Chat interface using Tambo components
- Line 921-1006: `AppPage` — Wraps with `TamboProvider`

**Tambo Components Used:**
- `ScrollableMessageContainer` — Message display
- `ThreadContent`, `ThreadContentMessages` — Thread rendering
- `MessageInput` and sub-components — Input UI

## 5. Environment Variables

**Location:** `.env.local` (not in repo)

**Current Variables:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
- `NEXT_PUBLIC_TAMBO_API_KEY` — Tambo API key
- `NEXT_PUBLIC_TAMBO_API_URL` — Optional Tambo API URL
- `TAMBO_API_KEY` — Server-side Tambo key (for proxy)

**Loading:**
- Client-side: Direct access via `process.env.NEXT_PUBLIC_*`
- Server-side: `process.env.*` in API routes
- No central env validation (handled per-component)

## 6. Minimal Changes to Convert to NEXUS Command Center

### A. Replace Brain Tools with NEXUS Tools

**File:** `src/lib/tambo-tools.ts`

**Replace:**
- `stimulate_region` → `nexus_execute_command` (calls FastAPI backend)
- `analyze_patterns` → `nexus_get_status` (queries FastAPI backend)
- `save_session` → Keep (repurpose for NEXUS session state)
- `load_session` → Keep (repurpose for NEXUS session state)

**New Tool Pattern:**
```typescript
export const nexusExecuteCommand: TamboTool = {
  name: 'nexus_execute_command',
  description: 'Execute a command in the NEXUS system via FastAPI backend',
  tool: async ({ command, parameters }) => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_FASTAPI_URL}/api/nexus/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, parameters })
    })
    return await response.json()
  },
  inputSchema: z.object({
    command: z.string(),
    parameters: z.record(z.unknown()).optional()
  })
}
```

### B. Update UI Components

**Files to Modify:**
1. `src/app/app/page.tsx`:
   - Remove BrainMap, Waveform, SignalMeters, SimulationControls imports
   - Replace with NEXUS dashboard components (or remove left column)
   - Update chat header from "Neural Assistant" to "Nexus Assistant"

2. `src/components/Navbar.tsx`:
   - Change "NeuroDesk" → "NEXUS Command Center"
   - Change "Neural Simulation Lab" → "Command & Control Interface"
   - Update icon (optional: replace brain icon with command center icon)

3. `src/app/layout.tsx`:
   - Update title/description metadata

### C. Add FastAPI Integration

**New File:** `src/lib/nexus-api-client.ts`
```typescript
const FASTAPI_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || 'http://localhost:8000'

export async function callNexusAPI(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${FASTAPI_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  })
  return response.json()
}
```

**New Env Var:**
- `NEXT_PUBLIC_FASTAPI_URL` — FastAPI backend URL

### D. Remove Brain Simulation Code

**Files to Delete/Archive:**
- `src/lib/brain/` — Entire directory
- `src/components/BrainMap.tsx`
- `src/components/Waveform.tsx`
- `src/components/SignalMeters.tsx`
- `src/components/SimulationControls.tsx`

**Files to Update:**
- `src/lib/tambo-tools.ts` — Remove brain state accessors, replace with FastAPI calls
- `src/app/app/page.tsx` — Remove brain state management, simplify to chat-only or add NEXUS dashboard

### E. Update System Prompt

**File:** `src/lib/tambo/systemPrompt.ts`
- Change from brain simulation context to NEXUS command center context

## Summary: Files to Edit

1. **`src/lib/tambo-tools.ts`** — Replace 4 brain tools with NEXUS tools
2. **`src/app/app/page.tsx`** — Remove brain UI, update chat header
3. **`src/components/Navbar.tsx`** — Rebrand to NEXUS
4. **`src/app/layout.tsx`** — Update metadata
5. **`src/lib/tambo/systemPrompt.ts`** — Update system prompt
6. **Create:** `src/lib/nexus-api-client.ts` — FastAPI client utility

## Summary: Files to Delete

1. `src/lib/brain/` (entire directory)
2. `src/components/BrainMap.tsx`
3. `src/components/Waveform.tsx`
4. `src/components/SignalMeters.tsx`
5. `src/components/SimulationControls.tsx`

## Summary: New Environment Variable

- `NEXT_PUBLIC_FASTAPI_URL` — FastAPI backend URL (default: `http://localhost:8000`)
