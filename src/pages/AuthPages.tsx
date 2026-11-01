import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { CompanyCreate } from '../api/contract.gen'
import { acceptInvitation, forgotPassword, resetPassword, useCreateCompany, useInvitationPreview } from '../api/settings'
import { useToast } from '../app/toast'
import { useSession } from '../auth/session'
import { Logo } from '../components/Logo'
import { ds } from '../ds'
import { useIdempotencyKey } from '../lib/useIdempotencyKey'

type BusinessType = CompanyCreate['business_type']

/**
 * Signed-out pages (02 S2, S3; FR-003, FR-006; backlog P15.2-FE-11): forgot password (always the same answer, so it
 * never tells whether an e-mail has an account), reset from the e-mailed link (60 minutes, once), and accepting an
 * invitation — a new person sets name and password, someone who already uses Pluto confirms with their password —
 * which signs in and opens the company. Plus S0 "Create a company" for a signed-in user.
 */
function Frame({ title, intro, children, onSubmit }: { title: string; intro: ReactNode; children: ReactNode; onSubmit?: (e: FormEvent) => void }) {
  return (
    <div data-theme="light" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-sans)', fontSize: 14, padding: 16 }}>
      <form onSubmit={onSubmit ?? ((e) => e.preventDefault())} noValidate aria-labelledby="auth-title"
        style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-1)', padding: '28px 28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ alignSelf: 'flex-start' }}><Logo reversed={false} /></div>
        <div>
          <h1 id="auth-title" style={{ margin: 0, font: '500 26px/32px var(--font-serif)' }}>{title}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)' }}>{intro}</p>
        </div>
        {children}
      </form>
    </div>
  )
}

const problemText = (e: unknown) => (e instanceof ApiError ? (e.status === 429 ? 'Too many tries; wait a minute and try again.' : e.problem.detail ?? e.problem.title) : 'Something went wrong. Try again.')

export function ForgotPassword() {
  const { Field, Input, Button, Banner } = ds()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid e-mail'); return }
    setBusy(true)
    setError(null)
    try { await forgotPassword(email.trim()); setSent(true) } catch (err) { setError(problemText(err)) } finally { setBusy(false) }
  }
  return (
    <Frame title="Reset your password" intro={sent ? '' : 'We will e-mail you a link to choose a new password.'} onSubmit={submit}>
      {sent ? (
        <Banner tone="positive" title="Check your e-mail" data-testid="reset-sent">If {email.trim()} has a Pluto account, a link is on its way. It works once, for the next 60 minutes.</Banner>
      ) : (
        <>
          {error && <Banner tone="negative" title={error} />}
          <Field label="Email" required htmlFor="fp-email"><Input id="fp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
          <Button variant="primary" type="submit" block loading={busy} data-testid="send-reset">Send link</Button>
        </>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/sign-in')}>Back to sign in</Button>
    </Frame>
  )
}

export function ResetPassword() {
  const { Field, Input, Button, Banner } = ds()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const email = params.get('email') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { await resetPassword({ token, email, password, password_confirmation: confirm }); setDone(true) } catch (err) { setError(err) } finally { setBusy(false) }
  }
  if (!token || !email) return <Frame title="This link is not complete" intro="Open the link from the e-mail again, or ask for a new one."><Button variant="primary" onClick={() => navigate('/forgot-password')}>Ask for a new link</Button></Frame>
  return (
    <Frame title={done ? 'Password changed' : 'Choose a new password'} intro={done ? 'You were signed out everywhere; sign in with the new password.' : `For ${email}`} onSubmit={submit}>
      {done ? <Button variant="primary" block onClick={() => navigate('/sign-in')} data-testid="to-sign-in">Sign in</Button> : (
        <>
          {fe('token') && <Banner tone="negative" title={fe('token')!} action={<Button size="sm" onClick={() => navigate('/forgot-password')}>New link</Button>} />}
          {error && !(error instanceof ApiError && Object.keys(error.fieldErrors).length) ? <Banner tone="negative" title={problemText(error)} /> : null}
          <Field label="New password" required hint="At least 10 characters, not one that has leaked online" error={fe('password')} htmlFor="rp-password">
            <Input id="rp-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!fe('password')} autoFocus />
          </Field>
          <Field label="Confirm password" required error={fe('password_confirmation')} htmlFor="rp-confirm">
            <Input id="rp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button variant="primary" type="submit" block loading={busy} disabled={password.length < 10 || password !== confirm} data-testid="set-password">Set password</Button>
        </>
      )}
    </Frame>
  )
}

export function AcceptInvitation() {
  const { Field, Input, Button, Banner, Skeleton } = ds()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { signInWith, switchCompany } = useSession()
  const preview = useInvitationPreview(token)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  const inv = preview.data
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await acceptInvitation(token, inv?.existing_user ? { password } : { name: name.trim(), password, password_confirmation: confirm })
      await signInWith(r)
      const joined = r.user?.companies.find((c) => c.company_name === inv?.company_name)
      if (joined) await switchCompany(joined.company_id)
      else navigate('/')
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  if (preview.isPending) return <Frame title="Opening your invitation" intro=""><Skeleton height={80} /></Frame>
  if (!inv) {
    const gone = preview.error instanceof ApiError && preview.error.status === 410
    return <Frame title={gone ? 'This invitation is no longer valid' : 'Invitation not found'} intro={gone ? problemText(preview.error) : 'The link may be mistyped. Ask the person who invited you to send it again.'}>
      <Button variant="primary" onClick={() => navigate('/sign-in')}>Go to sign in</Button></Frame>
  }
  return (
    <Frame title={`Join ${inv.company_name}`} intro={<>You are invited as <strong>{inv.role_name}</strong> with {inv.email}.</>} onSubmit={submit}>
      {error && !(error instanceof ApiError && Object.keys(error.fieldErrors).length) ? <Banner tone="negative" title={problemText(error)} /> : null}
      {inv.existing_user ? (
        <Field label="Your Pluto password" required hint="You already use Pluto with this e-mail" error={fe('password')} htmlFor="ai-password">
          <Input id="ai-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!fe('password')} autoFocus />
        </Field>
      ) : (
        <>
          <Field label="Your name" required error={fe('name')} htmlFor="ai-name"><Input id="ai-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!fe('name')} autoFocus /></Field>
          <Field label="Choose a password" required hint="At least 10 characters" error={fe('password')} htmlFor="ai-password">
            <Input id="ai-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!fe('password')} />
          </Field>
          <Field label="Confirm password" required error={fe('password_confirmation')} htmlFor="ai-confirm">
            <Input id="ai-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </>
      )}
      <Button variant="primary" type="submit" block loading={busy} disabled={!password || (!inv.existing_user && (!name.trim() || password !== confirm))} data-testid="join-company">Join company</Button>
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>The invitation is valid until {new Date(inv.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</span>
    </Frame>
  )
}

const TYPES: Array<{ value: BusinessType; label: string }> = [{ value: 'private_limited', label: 'Private limited company' }, { value: 'sole_proprietorship', label: 'Sole proprietorship' },
  { value: 'partnership', label: 'Partnership' }, { value: 'public_limited', label: 'Public limited company' }]

/** S0 Create a company: the creator becomes its Owner; the chart, this financial year and the number series are set up. */
export function CreateCompany() {
  const { PageHeader, Card, Field, Input, Select, Button } = ds()
  const toast = useToast()
  const { switchCompany } = useSession()
  const create = useCreateCompany()
  const idem = useIdempotencyKey()
  const [f, setF] = useState({ legal_name: '', trading_name: '', business_type: 'private_limited' as BusinessType, fy_start_month: '7' })
  const [error, setError] = useState<unknown>(null)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldErrors[k]?.[0] : undefined)
  async function submit() {
    setError(null)
    try {
      const c = await create.mutateAsync({ idempotencyKey: idem.key, input: { legal_name: f.legal_name.trim(), trading_name: f.trading_name.trim() || null, business_type: f.business_type,
        fy_start_month: Number(f.fy_start_month) } })
      idem.reset()
      toast({ tone: 'positive', title: `${c.legal_name} is ready`, description: 'You are its Owner. Opening it now.' })
      await switchCompany(c.id)
    } catch (e) { setError(e) }
  }
  return (
    <>
      <PageHeader title="Create a company" description="A separate set of books. You become its Owner; the chart of accounts, this financial year and document numbering are set up for you." />
      <Card>
        <div style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
          {error && !(error instanceof ApiError && Object.keys(error.fieldErrors).length) ? <span role="alert" style={{ color: 'var(--negative)' }}>{problemText(error)}</span> : null}
          <Field label="Legal name" required error={fe('legal_name')} htmlFor="cc-legal"><Input id="cc-legal" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} autoFocus /></Field>
          <Field label="Trading name" htmlFor="cc-trading"><Input id="cc-trading" value={f.trading_name} onChange={(e) => setF({ ...f, trading_name: e.target.value })} /></Field>
          <Field label="Business type" required error={fe('business_type')} htmlFor="cc-type"><Select id="cc-type" options={TYPES} value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value as BusinessType })} /></Field>
          <Field label="Financial year starts in" hint="July for most Bangladeshi companies; it cannot change later" htmlFor="cc-fy">
            <Select id="cc-fy" value={f.fy_start_month} onChange={(e) => setF({ ...f, fy_start_month: e.target.value })}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2000, i, 1).toLocaleString('en-GB', { month: 'long' }) }))} />
          </Field>
          <div><Button variant="primary" loading={create.isPending} disabled={!f.legal_name.trim()} onClick={() => void submit()} data-testid="create-company">Create company</Button></div>
        </div>
      </Card>
    </>
  )
}
