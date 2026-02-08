'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { nexusApi } from '@/lib/nexus-api-client'
import { Navbar } from '@/components/Navbar'

export default function NexusAuthPage() {
  const router = useRouter()
  const [isSignIn, setIsSignIn] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (isSignIn) {
        // #region debug log
        fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:24',message:'Login attempt',data:{email,hasPassword:!!password},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
        await nexusApi.login(email, password)
        // #region debug log
        fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:27',message:'Login successful, redirecting',data:{email},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
      } else {
        if (!username.trim()) {
          setError('Username is required')
          setLoading(false)
          return
        }
        await nexusApi.register(email, password, username)
      }

      // Redirect to app
      setLoading(false)
      router.push('/app')
    } catch (err) {
      // #region debug log
      fetch('http://127.0.0.1:7242/ingest/9353c3bf-5155-4137-ab4e-87ab9c69d738',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:40',message:'Login error',data:{error:err instanceof Error ? err.message : String(err),errorType:err instanceof Error ? err.constructor.name : typeof err},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      let errorMessage = 'An error occurred'
      if (err instanceof Error) {
        errorMessage = err.message
        // Handle network errors
        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('ERR_')) {
          errorMessage = 'Cannot connect to server. Please make sure the backend is running on http://localhost:8000'
        }
      } else if (typeof err === 'string') {
        errorMessage = err
      }
      setError(errorMessage)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="nl-card p-8">
            <h1 className="text-2xl font-bold mb-6 text-center text-neutral-100">
              {isSignIn ? 'Sign In to NEXUS' : 'Register for NEXUS'}
            </h1>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isSignIn && (
                <div className="space-y-2">
                  <label htmlFor="username" className="block text-sm font-medium text-neutral-200">
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required={!isSignIn}
                    className="w-full px-3 py-2 bg-neutral-900/50 border border-neutral-700 rounded-md text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-colors"
                    placeholder="johndoe"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-neutral-200">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-neutral-900/50 border border-neutral-700 rounded-md text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-neutral-200">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isSignIn ? undefined : 8}
                  className="w-full px-3 py-2 bg-neutral-900/50 border border-neutral-700 rounded-md text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-colors"
                  placeholder="••••••••"
                />
                {!isSignIn && (
                  <p className="text-xs text-neutral-400">Password must be at least 6 characters long</p>
                )}
              </div>

              {error && (
                <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/50 rounded-md p-3">
                  {String(error)}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-white/10 border border-white/30 text-white rounded-md hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {loading ? 'Loading...' : isSignIn ? 'Sign In' : 'Register'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignIn(!isSignIn)
                  setError(null)
                }}
                className="text-sm text-white/70 hover:text-white transition-colors"
              >
                {isSignIn ? "Don't have an account? Register" : 'Already have an account? Sign in'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
