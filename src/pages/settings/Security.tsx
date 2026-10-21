import { useState, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { useConfirmTwoFactor, useDisableTwoFactor, useStartTwoFactor } from '../../api/me'
import type { TwoFactorSetup } from '../../api/contract.gen'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'
import { ds } from '../../ds'
import { SettingsLayout } from './SettingsLayout'

type Step = null | { kind: 'setup'; setup: TwoFactorSetup } | { kind: 'codes'; codes: string[] } | { kind: 'disable' }

/**
 * K14 Security, 2-step verification row (07 §5, FR-004). The design's other rows (password, company-wide
 * requirement, idle sign-out, sessions) belong to the Settings module and are not in this release.
 */
export function Security() {
  const { Card, Switch, Button, Banner, Field, Input, Badge } = ds()
  const { me, twoFactorBlocked, reload } = useSession()
  const toast = useToast()
  const start = useStartTwoFactor()
  const confirm = useConfirmTwoFactor()
  const disable = useDisableTwoFactor()
  const [step, setStep] = useState<Step>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [switchKey, setSwitchKey] = useState(0)
  const enabled = !!me?.two_factor_enabled

  const close = () => { setStep(null); setCode(''); setPassword(''); setError(null); setSwitchKey((k) => k + 1) }

  async function toggle(on: boolean) {
    setError(null)
    if (!on) { setStep({ kind: 'disable' }); return }
    try {
      setStep({ kind: 'setup', setup: await start.mutateAsync() })
    } catch (e) {
      toast({ tone: 'negative', title: e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not start the set-up' })
      setSwitchKey((k) => k + 1)
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    const c = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(c)) { setError('Enter the 6-digit code from your authenticator app'); return }
    try {
      const r = await confirm.mutateAsync(c)
      setCode('')
      setError(null)
      setStep({ kind: 'codes', codes: r.recovery_codes })
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'two_factor_failed' ? 'That code is not valid. Check the time on your phone and try the newest code.'
        : e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Something went wrong. Try again.')
      setCode('')
    }
  }

  async function finishSetup() {
    await reload()
    close()
    toast({ tone: 'positive', title: '2-step verification is on', description: 'New sign-ins will ask for a code from your authenticator app.' })
  }

  async function submitDisable(e: FormEvent) {
    e.preventDefault()
    if (!password) { setError('Enter your password'); return }
    try {
      await disable.mutateAsync(password)
      await reload()
      close()
      toast({ tone: 'info', title: '2-step verification is off' })
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'invalid_credentials' ? 'The password is not correct'
        : e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Something went wrong. Try again.')
      setPassword('')
    }
  }

  return (
    <SettingsLayout current="Security" eyebrow="Settings › You" title="Security" description="Sign-in protection for your account and the company.">
      {twoFactorBlocked && !enabled && (
        <Banner tone="warning" title="Your company requires 2-step verification">Turn it on below to keep working in this company.</Banner>
      )}
      {twoFactorBlocked && enabled && (
        <Banner tone="warning" title="Sign in again with your authenticator code">Your company requires 2-step verification for this sign-in.</Banner>
      )}
      <Card title="Sign-in">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="se-row">
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>2-step verification
                {enabled ? <Badge tone="positive" dot>On</Badge> : <Badge tone="neutral">Off</Badge>}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Code from an authenticator app at each new sign-in</span>
            </span>
            <span data-testid="two-factor-switch">
              <Switch key={`${enabled}-${switchKey}`} checked={enabled} label={enabled ? 'On' : 'Off'} disabled={start.isPending} onChange={(v) => void toggle(v)} />
            </span>
          </div>
        </div>
      </Card>

      {step?.kind === 'setup' && (
        <ResponsiveDialog testId="two-factor-setup" title="Turn on 2-step verification" description="Scan the code with an authenticator app (for example Google Authenticator or Microsoft Authenticator), then enter the 6-digit code it shows."
          onClose={close} width={520}
          footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={confirm.isPending} disabled={confirm.isPending} onClick={(e) => void submitCode(e as unknown as FormEvent)}>Turn on</Button></>}>
          <form onSubmit={submitCode} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <img alt="QR code for your authenticator app" width={176} height={176} data-testid="two-factor-qr"
                src={`data:image/svg+xml;base64,${btoa(step.setup.qr_svg)}`} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 8 }} />
              <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Can’t scan? Enter this key in the app:</span>
                <code data-testid="two-factor-secret" style={{ font: '500 14px/20px var(--font-mono)', wordBreak: 'break-all' }}>{secretOf(step.setup.otpauth_uri).replace(/(.{4})/g, '$1 ').trim()}</code>
              </div>
            </div>
            {error && <Banner tone="negative" title={error} />}
            <Field label="Code from the app" required htmlFor="tfa-code">
              <Input id="tfa-code" inputMode="numeric" autoComplete="one-time-code" mono value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={7} autoFocus />
            </Field>
          </form>
        </ResponsiveDialog>
      )}

      {step?.kind === 'codes' && (
        <ResponsiveDialog title="Save your recovery codes" description="If you lose your phone, each of these codes signs you in once. They are shown only now."
          width={520} footer={<Button variant="primary" onClick={() => void finishSetup()}>I’ve saved them</Button>}>
          <ol data-testid="recovery-codes" style={{ margin: 0, padding: '12px 16px 12px 36px', columns: 2, font: '500 14px/24px var(--font-mono)', background: 'var(--surface-sunken, var(--paper))', borderRadius: 'var(--radius-sm)' }}>
            {step.codes.map((c) => <li key={c}>{c}</li>)}
          </ol>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Button size="sm" icon="download" onClick={() => download(step.codes)}>Download as text</Button>
          </div>
        </ResponsiveDialog>
      )}

      {step?.kind === 'disable' && (
        <ResponsiveDialog title="Turn off 2-step verification?" tone="warning" description="Signing in will need only your password. Enter it to confirm."
          onClose={close}
          footer={<><Button variant="ghost" onClick={close}>Keep it on</Button>
            <Button variant="danger" loading={disable.isPending} disabled={disable.isPending} onClick={(e) => void submitDisable(e as unknown as FormEvent)}>Turn off</Button></>}>
          <form onSubmit={submitDisable} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {error && <Banner tone="negative" title={error} />}
            <Field label="Password" required htmlFor="tfa-password">
              <Input id="tfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
          </form>
        </ResponsiveDialog>
      )}
    </SettingsLayout>
  )
}

function secretOf(uri: string): string {
  try { return new URL(uri).searchParams.get('secret') ?? '' } catch { return '' }
}

function download(codes: string[]) {
  const blob = new Blob([`Pluto recovery codes\n\n${codes.join('\n')}\n\nEach code works once.\n`], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'pluto-recovery-codes.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
