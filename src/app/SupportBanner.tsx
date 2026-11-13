import { useEffect, useState } from 'react'
import { endSupportAccess } from '../api/platformConsole'
import { leaveSupportView, useSession } from '../auth/session'
import { ds } from '../ds'

/**
 * Read-only support view (K17; PEP-485): while a platform admin looks at a customer's company, every page says so,
 * with the end time and "End visit". The API refuses any change (support_read_only); when the time runs out the app
 * goes back to the admin's own company.
 */
export function SupportBanner() {
  const { Button, Icon } = ds()
  const { me } = useSession()
  const s = me?.support_access
  const [ending, setEnding] = useState(false)
  useEffect(() => {
    if (!s) return
    const left = new Date(s.expires_at).getTime() - Date.now()
    const t = setTimeout(() => leaveSupportView(), Math.max(0, left) + 1000)
    return () => clearTimeout(t)
  }, [s])
  if (!s) return null
  const until = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(s.expires_at))
  async function end() {
    setEnding(true)
    try { await endSupportAccess(s!.company_id) } finally { leaveSupportView() }
  }
  return (
    <div className="lf-support-banner" role="status" data-testid="support-banner">
      <Icon name="eye" size={18} />
      <span className="lf-support-text"><strong>Read-only support view of {s.company_name}</strong><span>Until {until} · {s.reason} · nothing can be changed</span></span>
      <Button size="sm" variant="secondary" loading={ending} onClick={() => void end()} data-testid="end-support">End visit</Button>
    </div>
  )
}
