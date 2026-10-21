import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useSession } from '../auth/session'
import { lf } from '../ds'

/**
 * S1 Sign in (02: centered card with Logo, Field, Input, Button; generic error, throttle message with retry time).
 * When 2-step is on, a second step asks for the authenticator code, or a recovery code instead (07 §5).
 */
export function SignIn() {
  const { Logo, Field, Input, Button, Banner } = lf()
  const { status, signIn, completeTwoFactor } = useSession()
  const navigate = useNavigate()
  // After sign-in: back to the page that needed it, else the role's landing page (R-35, router '/').
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')

  if (status === 'signed-in') return <Navigate to={from} replace />

  function showError(err: unknown) {
    if (err instanceof ApiError && err.code === 'rate_limited') {
      const mins = Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60))
      setError(`Too many attempts from this device. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
    } else if (err instanceof ApiError && err.code === 'validation_failed') {
      setFieldErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0] ?? ''])))
    } else if (err instanceof ApiError) {
      setError(err.code === 'invalid_credentials' ? 'E-mail or password is incorrect' : (err.problem.detail ?? err.problem.title))
    } else {
      setError('Something went wrong. Try again.')
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    if (!challenge) return
    const value = code.trim()
    const fe: Record<string, string> = {}
    if (!useRecovery && !value) fe.code = 'Enter the code from your authenticator app'
    else if (!useRecovery && !/^\d{6}$/.test(value.replace(/\s/g, ''))) fe.code = 'The code has 6 digits'
    if (useRecovery && !value) fe.recovery_code = 'Enter a recovery code'
    setFieldErrors(fe)
    setError(null)
    if (Object.keys(fe).length) return
    setBusy(true)
    try {
      await completeTwoFactor(challenge, useRecovery ? { recovery_code: value } : { code: value.replace(/\s/g, '') })
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'two_factor_failed' && err.problem.detail) {
        // The challenge expired or was used up: back to step 1
        setChallenge(null)
        setPassword('')
        setError(err.problem.detail)
      } else if (err instanceof ApiError && err.code === 'two_factor_failed') {
        setError(useRecovery ? 'That recovery code is not valid or was already used' : 'That code is not valid. Check your authenticator app and try again.')
      } else {
        showError(err)
      }
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const fe: Record<string, string> = {}
    if (!email.trim()) fe.email = 'Enter your e-mail address'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = 'Enter a valid e-mail address'
    if (!password) fe.password = 'Enter your password'
    setFieldErrors(fe)
    setError(null)
    if (Object.keys(fe).length) return
    setBusy(true)
    try {
      const r = await signIn(email.trim(), password)
      if (r.status === 'two_factor_required') {
        setChallenge(r.challengeToken)
        setUseRecovery(false)
        setCode('')
        return
      }
      navigate(from, { replace: true })
    } catch (err) {
      showError(err)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-theme="light" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 14, padding: 16 }}>
      {challenge ? (
      <form onSubmit={submitCode} noValidate aria-labelledby="signin-title"
        style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '28px 28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: 'var(--navy-900)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', alignSelf: 'flex-start' }}><Logo /></div>
        <div>
          <h1 id="signin-title" style={{ margin: 0, font: '500 26px/32px var(--font-serif)' }}>2-step verification</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)' }}>
            {useRecovery ? 'Enter one of the recovery codes you saved. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>
        {error && <Banner tone="negative" title={error} />}
        {useRecovery ? (
          <Field label="Recovery code" required error={fieldErrors.recovery_code} htmlFor="signin-recovery">
            <Input id="signin-recovery" autoComplete="off" autoFocus mono value={code} invalid={!!fieldErrors.recovery_code}
              onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" maxLength={20} />
          </Field>
        ) : (
          <Field label="Authenticator code" required error={fieldErrors.code} htmlFor="signin-code">
            <Input id="signin-code" inputMode="numeric" autoComplete="one-time-code" autoFocus mono value={code} invalid={!!fieldErrors.code}
              onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={7} />
          </Field>
        )}
        <Button variant="primary" type="submit" block loading={busy} disabled={busy}>Verify and sign in</Button>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setUseRecovery((v) => !v); setCode(''); setFieldErrors({}); setError(null) }}>
            {useRecovery ? 'Use the authenticator code' : 'Use a recovery code'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setChallenge(null); setPassword(''); setError(null); setFieldErrors({}) }}>Back</Button>
        </div>
      </form>
      ) : (
      <form onSubmit={submit} noValidate aria-labelledby="signin-title"
        style={{ width: '100%', maxWidth: 400, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '28px 28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: 'var(--navy-900)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', alignSelf: 'flex-start' }}><Logo /></div>
        <div>
          <h1 id="signin-title" style={{ margin: 0, font: '500 26px/32px var(--font-serif)' }}>Sign in</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)' }}>Use the e-mail your company invited.</p>
        </div>
        {error && <Banner tone="negative" title={error} />}
        <Field label="Email" required error={fieldErrors.email} htmlFor="signin-email">
          <Input id="signin-email" type="email" autoComplete="username" value={email} invalid={!!fieldErrors.email}
            onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label="Password" required error={fieldErrors.password} htmlFor="signin-password">
          <Input id="signin-password" type="password" autoComplete="current-password" value={password} invalid={!!fieldErrors.password}
            onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button variant="primary" type="submit" block loading={busy} disabled={busy}>Sign in</Button>
      </form>
      )}
    </div>
  )
}
