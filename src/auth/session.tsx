import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { LoginResponse, Me } from '../api/contract.gen'

/**
 * Session state (07 §1): sign in, silent restore after reload via the refresh cookie, active company, effective
 * permissions. Permissions only decide what the UI shows; the API re-checks every call.
 */
type Status = 'restoring' | 'signed-out' | 'signed-in'

/** Outcome of step 1: signed in, or a 2-step challenge to answer with completeTwoFactor (07 §5). */
export type SignInResult = { status: 'authenticated' } | { status: 'two_factor_required'; challengeToken: string }

interface SessionValue {
  status: Status
  me: Me | null
  companyId: number | null
  /** The company requires 2-step and this sign-in has none: only Settings › Security is usable. */
  twoFactorBlocked: boolean
  /** The user chose Sign out: the next sign-in starts fresh instead of returning to the last page. */
  signedOutByUser: boolean
  can: (permission: string) => boolean
  signIn: (email: string, password: string) => Promise<SignInResult>
  completeTwoFactor: (challengeToken: string, answer: { code: string } | { recovery_code: string }) => Promise<void>
  /** After turning 2-step on or off: new access token (carries the second factor) and fresh /me. */
  reload: () => Promise<void>
  signOut: () => Promise<void>
  /** Make another company active (02 S0): remembers it and reloads the app at the landing page. */
  switchCompany: (companyId: number) => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)
const LAST_COMPANY = 'lf.lastCompany' // a remembered preference only; never a credential

function rememberCompany(id: number) {
  try { localStorage.setItem(LAST_COMPANY, String(id)) } catch { /* storage unavailable */ }
}
function rememberedCompany(): number | null {
  try { const v = localStorage.getItem(LAST_COMPANY); return v ? Number(v) : null } catch { return null }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>('restoring')
  const [me, setMe] = useState<Me | null>(null)
  const [twoFactorBlocked, setTwoFactorBlocked] = useState(false)
  const [signedOutByUser, setSignedOutByUser] = useState(false)

  const loadMe = useCallback(async (user?: Me) => {
    const base = user ?? (await api.request<{ data: Me }>('GET', '/me', { company: false })).data.data
    const active = base.companies.filter((c) => c.status === 'active')
    const preferred = rememberedCompany()
    const company = active.find((c) => c.company_id === preferred) ?? active[0]
    if (!company) {
      api.setCompany(null)
      setMe(base)
      setStatus('signed-in')
      return
    }
    api.setCompany(company.company_id)
    rememberCompany(company.company_id)
    const scoped = (await api.request<{ data: Me }>('GET', '/me')).data.data
    setMe(scoped)
    setStatus('signed-in')
  }, [])

  const endSession = useCallback(() => {
    api.setAccessToken(null)
    api.setCompany(null)
    queryClient.clear()
    setMe(null)
    setTwoFactorBlocked(false)
    setStatus('signed-out')
  }, [queryClient])

  useEffect(() => {
    api.onSessionEnded = endSession
    api.onTwoFactorRequired = () => setTwoFactorBlocked(true)
    let cancelled = false
    ;(async () => {
      if (await api.refresh()) {
        try { if (!cancelled) await loadMe() } catch { if (!cancelled) endSession() }
      } else if (!cancelled) {
        setStatus('signed-out')
      }
    })()
    return () => { cancelled = true }
  }, [loadMe, endSession])

  const finishSignIn = useCallback(async (r: LoginResponse) => {
    if (!r.access_token) throw new ApiError({ title: 'Sign-in did not complete. Try again.', status: 500, code: 'server_error' })
    api.setAccessToken(r.access_token)
    queryClient.clear()
    setTwoFactorBlocked(false)
    setSignedOutByUser(false)
    await loadMe(r.user ?? undefined)
  }, [loadMe, queryClient])

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const { data } = await api.request<{ data: LoginResponse }>('POST', '/auth/login', {
      body: { email, password, device_label: navigator.userAgent.slice(0, 120) }, company: false, noRefresh: true,
    })
    if (data.data.status === 'two_factor_required' && data.data.challenge_token) {
      return { status: 'two_factor_required', challengeToken: data.data.challenge_token }
    }
    await finishSignIn(data.data)
    return { status: 'authenticated' }
  }, [finishSignIn])

  const completeTwoFactor = useCallback(async (challengeToken: string, answer: { code: string } | { recovery_code: string }) => {
    const { data } = await api.request<{ data: LoginResponse }>('POST', '/auth/two-factor', {
      body: { challenge_token: challengeToken, ...answer }, company: false, noRefresh: true,
    })
    await finishSignIn(data.data)
  }, [finishSignIn])

  const reload = useCallback(async () => {
    if (!(await api.refresh())) { endSession(); return }
    setTwoFactorBlocked(false)
    queryClient.clear()
    await loadMe()
  }, [loadMe, endSession, queryClient])

  const signOut = useCallback(async () => {
    try {
      await api.request('POST', '/auth/logout', { company: false, noRefresh: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    } finally {
      setSignedOutByUser(true)
      endSession()
    }
  }, [endSession])

  // Switching company reloads all data (02 S0): remember the choice and start the app again at the landing page, so
  // no cached query, open form or page state of the previous company can survive. The session restores silently
  // from the refresh cookie and picks the remembered company.
  const switchCompany = useCallback(async (companyId: number) => {
    rememberCompany(companyId)
    window.location.assign('/')
  }, [])

  const value = useMemo<SessionValue>(() => ({
    status, me, companyId: api.getCompany(), twoFactorBlocked, signedOutByUser,
    can: (p) => (me?.permissions ?? []).includes(p),
    signIn, completeTwoFactor, reload, signOut, switchCompany,
  }), [status, me, twoFactorBlocked, signedOutByUser, signIn, completeTwoFactor, reload, signOut, switchCompany])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
