import { NextRequest, NextResponse } from 'next/server'

// Use TAMBO_API_KEY if available, otherwise fallback to NEXT_PUBLIC_TAMBO_API_KEY for server-side use
// Note: In production, TAMBO_API_KEY should be set (server-side only, no NEXT_PUBLIC_ prefix)
const TAMBO_API_KEY = process.env.TAMBO_API_KEY || process.env.NEXT_PUBLIC_TAMBO_API_KEY
const TAMBO_API_URL = process.env.TAMBO_API_URL || 'https://api.tambo.co'

// Log API key status at module load (only in development)
if (process.env.NODE_ENV === 'development' && typeof process !== 'undefined') {
  const hasTamboKey = !!process.env.TAMBO_API_KEY
  const hasPublicKey = !!process.env.NEXT_PUBLIC_TAMBO_API_KEY
  const finalKey = TAMBO_API_KEY
  
  console.log('[Tambo Proxy] Module loaded - API key status:', {
    hasTAMBO_API_KEY: hasTamboKey,
    hasNEXT_PUBLIC_TAMBO_API_KEY: hasPublicKey,
    usingFallback: !hasTamboKey && hasPublicKey,
    finalKeyLength: finalKey?.length || 0,
    finalKeyPrefix: finalKey ? `${finalKey.substring(0, 12)}...` : '[MISSING]',
  })
  
  if (!finalKey) {
    console.error('[Tambo Proxy] ⚠️  WARNING: No API key found!')
    console.error('[Tambo Proxy] Set either TAMBO_API_KEY or NEXT_PUBLIC_TAMBO_API_KEY in .env.local')
  } else if (hasTamboKey && hasPublicKey && process.env.TAMBO_API_KEY !== process.env.NEXT_PUBLIC_TAMBO_API_KEY) {
    console.warn('[Tambo Proxy] ⚠️  WARNING: TAMBO_API_KEY and NEXT_PUBLIC_TAMBO_API_KEY have different values!')
    console.warn('[Tambo Proxy] They should be the same. Using TAMBO_API_KEY for server-side requests.')
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, params, 'GET')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, params, 'POST')
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, params, 'PUT')
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, params, 'PATCH')
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, params, 'DELETE')
}

async function handleRequest(
  request: NextRequest,
  params: Promise<{ path: string[] }>,
  method: string
) {
  // Check for server-side API key - try both TAMBO_API_KEY and NEXT_PUBLIC_TAMBO_API_KEY as fallback
  const serverApiKey = process.env.TAMBO_API_KEY || process.env.NEXT_PUBLIC_TAMBO_API_KEY
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:49',message:'API_KEY_CHECK',data:{hasTAMBO_API_KEY:!!process.env.TAMBO_API_KEY,hasNEXT_PUBLIC:!!process.env.NEXT_PUBLIC_TAMBO_API_KEY,hasServerApiKey:!!serverApiKey,keyLength:serverApiKey?.length||0},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  if (!serverApiKey) {
    console.error('[Tambo Proxy] TAMBO_API_KEY is missing from server environment')
    console.error('[Tambo Proxy] Set TAMBO_API_KEY in .env.local (server-side, no NEXT_PUBLIC_ prefix)')
    return NextResponse.json(
      { error: 'Tambo API key not configured on server. Set TAMBO_API_KEY in .env.local' },
      { status: 500 }
    )
  }

  // Log API key status (first few chars only for debugging)
  if (process.env.NODE_ENV === 'development') {
    const keyPreview = serverApiKey.substring(0, 8) + '...'
    console.log('[Tambo Proxy] API key status:', {
      hasKey: !!serverApiKey,
      keyLength: serverApiKey.length,
      keyPreview,
      apiUrl: TAMBO_API_URL,
      usingFallback: !process.env.TAMBO_API_KEY && !!process.env.NEXT_PUBLIC_TAMBO_API_KEY,
    })
  }

  const { path } = await params
  const pathSegments = path || []
  const tamboPath = pathSegments.join('/')
  const url = new URL(request.url)
  const searchParams = url.searchParams.toString()
  
  // Build Tambo API URL - handle both with and without trailing slash
  const baseUrl = TAMBO_API_URL.endsWith('/') ? TAMBO_API_URL.slice(0, -1) : TAMBO_API_URL
  const tamboPathWithSlash = tamboPath.startsWith('/') ? tamboPath : `/${tamboPath}`
  const tamboUrl = `${baseUrl}${tamboPathWithSlash}${searchParams ? `?${searchParams}` : ''}`

  // Log request details
  console.log(`[Tambo Proxy] ${method} ${tamboPath}`, {
    hasQuery: !!searchParams,
    url: tamboUrl.replace(serverApiKey, '[REDACTED]'),
  })

  try {
    // Get request body if present
    let body: string | undefined
    const contentType = request.headers.get('content-type')
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        body = await request.text()
      } catch {
        // No body
      }
    }

    // Forward request to Tambo API
    // Use the same auth pattern as the official Tambo SDK
    // Trim the API key to remove any whitespace that might cause issues
    const trimmedApiKey = serverApiKey.trim()
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${trimmedApiKey}`,
      'Content-Type': contentType || 'application/json',
      'Accept': 'application/json',
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:109',message:'FORWARDING_REQUEST',data:{method,path:tamboPath,hasAuth:!!headers.Authorization,authHeaderLength:headers.Authorization.length,apiKeyPrefix:trimmedApiKey.substring(0,12),originalLength:serverApiKey.length,trimmedLength:trimmedApiKey.length},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

    // Forward relevant headers from client
    const clientHeaders = Object.fromEntries(
      Array.from(request.headers.entries()).filter(([key]) =>
        ['x-tambo-react-version', 'user-agent', 'accept'].includes(key.toLowerCase())
      )
    )
    Object.assign(headers, clientHeaders)

    // Log request in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[Tambo Proxy] Forwarding request:', {
        method,
        url: tamboUrl.replace(serverApiKey, '[REDACTED]'),
        hasAuth: !!headers.Authorization,
        contentType: headers['Content-Type'],
      })
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:125',message:'FETCHING_TAMBO_API',data:{method,url:tamboUrl.replace(serverApiKey||'','[REDACTED]'),hasAuth:!!headers.Authorization,hasBody:!!body},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const response = await fetch(tamboUrl, {
      method,
      headers,
      body,
    })

    const responseContentType = response.headers.get('content-type') || ''
    const statusCode = response.status
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:132',message:'TAMBO_API_RESPONSE',data:{statusCode,contentType:responseContentType,isStreaming:responseContentType.includes('text/event-stream')||responseContentType.includes('stream')},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

    // Log response details
    console.log(`[Tambo Proxy] Response: ${statusCode}`, {
      contentType: responseContentType,
      isStreaming: responseContentType.includes('text/event-stream') || responseContentType.includes('stream'),
    })

    // Handle auth errors with detailed diagnostics
    if (statusCode === 401 || statusCode === 403) {
      // Try to get error message from Tambo API
      let errorText = ''
      let errorJson: any = null
      try {
        const text = await response.text()
        errorText = text.substring(0, 500)
        try {
          errorJson = JSON.parse(text)
        } catch {
          // Not JSON
        }
      } catch {
        // Ignore
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:158',message:'AUTH_ERROR_403',data:{statusCode,url:tamboPath,hasApiKey:!!serverApiKey,apiKeyLength:serverApiKey?.length||0,apiKeyPrefix:serverApiKey?.substring(0,12)||'[NONE]',usingFallback:!process.env.TAMBO_API_KEY&&!!process.env.NEXT_PUBLIC_TAMBO_API_KEY,errorJson},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      console.error('[Tambo Proxy] Auth error (403/401) - detailed diagnostics:', {
        status: statusCode,
        url: tamboPath,
        tamboApiUrl: TAMBO_API_URL,
        hasApiKey: !!serverApiKey,
        apiKeyLength: serverApiKey?.length || 0,
        apiKeyPrefix: serverApiKey?.substring(0, 12) || '[NONE]',
        usingFallback: !process.env.TAMBO_API_KEY && !!process.env.NEXT_PUBLIC_TAMBO_API_KEY,
        errorResponse: errorText,
        errorJson,
      })

      // Provide helpful error message
      const errorMessage = errorJson?.error || errorText || 'Authentication failed'
      return NextResponse.json(
        { 
          error: errorMessage,
          details: 'Check that TAMBO_API_KEY or NEXT_PUBLIC_TAMBO_API_KEY is set correctly in .env.local. Both should have the same value. Restart the dev server after changing .env.local.',
        },
        { status: statusCode }
      )
    }

    // Handle streaming responses
    if (responseContentType.includes('text/event-stream') || responseContentType.includes('stream')) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:179',message:'STREAMING_RESPONSE_START',data:{hasBody:!!response.body,statusCode,contentType:responseContentType,path:tamboPath},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      if (!response.body) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:181',message:'STREAMING_RESPONSE_NO_BODY',data:{statusCode,contentType:responseContentType},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        console.error('[Tambo Proxy] Streaming response has no body')
        return NextResponse.json(
          { error: 'Streaming response failed' },
          { status: 500 }
        )
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/tambo/[...path]/route.ts:188',message:'STREAMING_RESPONSE_RETURNING',data:{statusCode,contentType:responseContentType},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return new NextResponse(response.body, {
        status: statusCode,
        headers: {
          'Content-Type': responseContentType,
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // Handle JSON responses
    if (responseContentType.includes('application/json')) {
      const json = await response.json()
      
      if (statusCode >= 400) {
        console.error('[Tambo Proxy] Error response:', {
          status: statusCode,
          error: JSON.stringify(json).substring(0, 300),
        })
      }

      return NextResponse.json(json, { status: statusCode })
    }

    // Handle other response types
    const text = await response.text()
    
    if (statusCode >= 400) {
      console.error('[Tambo Proxy] Error response:', {
        status: statusCode,
        contentType: responseContentType,
        preview: text.substring(0, 300),
      })
    }

    return new NextResponse(text, {
      status: statusCode,
      headers: {
        'Content-Type': responseContentType,
      },
    })
  } catch (error) {
    console.error('[Tambo Proxy] Request failed:', {
      error: error instanceof Error ? error.message : String(error),
      url: tamboPath,
      method,
    })

    return NextResponse.json(
      {
        error: 'Failed to proxy request to Tambo API',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
