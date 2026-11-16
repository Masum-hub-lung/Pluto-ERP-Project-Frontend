import { useLocation } from 'react-router-dom'
import { useSession } from '../auth/session'
import { ResponsiveDialog } from '../components/ResponsiveDialog'
import { ds } from '../ds'
import { helpFor, SUPPORT, whatsappLink } from '../lib/help'

/** PEP-510: the "?" button's panel: how to use the current page, the main shortcuts, and how to reach Pluto support. */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  const { Button } = ds()
  const { pathname } = useLocation()
  const { me, companyId } = useSession()
  const company = me?.companies.find((c) => c.company_id === companyId)?.company_name
  const topic = helpFor(pathname)
  const wa = whatsappLink(company, pathname)
  return (
    <ResponsiveDialog title={topic.title} description="How to use this page" onClose={onClose} testId="help-panel"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div style={{ display: 'grid', gap: 16 }}>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, lineHeight: '22px' }} data-testid="help-steps">
          {topic.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        {topic.tip && <p style={{ margin: 0, padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--brand-soft)', fontSize: 14 }}><strong>Tip:</strong> {topic.tip}</p>}
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>Anywhere: <kbd>Ctrl K</kbd> search · <kbd>Alt S</kbd> invoice · <kbd>Alt P</kbd> bill · <kbd>Ctrl S</kbd> save · <kbd>F1</kbd> this help</p>
        {(wa || SUPPORT.email) && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 8 }} data-testid="help-support">
            <strong>Still stuck? Ask Pluto support</strong>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {wa && <a className="lf-btn lf-btn-primary lf-btn-sm" href={wa} target="_blank" rel="noopener noreferrer" data-testid="help-whatsapp">Message on WhatsApp</a>}
              {SUPPORT.email && <a className="lf-btn lf-btn-secondary lf-btn-sm" href={`mailto:${SUPPORT.email}?subject=${encodeURIComponent(`Pluto help: ${company ?? ''}`)}`}>E-mail support</a>}
            </div>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  )
}
