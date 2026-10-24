import type { ReactNode } from 'react'
import { ds } from '../../ds'

/**
 * Sticky footer of a document editor (02 interaction rules; backlog P4.4-FE-04): an optional status on the left,
 * then Cancel · Save draft · Preview (optional) · the primary action (e.g. "Save and post"). Buttons show `busy`
 * and are disabled while a request runs, so a double click sends one request.
 */
export function DocumentFooter({ onCancel, onSaveDraft, onPreview, primary, busy, status, saveLabel = 'Save draft' }: {
  onCancel: () => void; onSaveDraft?: () => void; onPreview?: () => void; primary?: { label: string; onClick: () => void; testId?: string }
  busy?: boolean; status?: ReactNode; saveLabel?: string
}) {
  const { Button } = ds()
  return (
    <div className="lf-form-footer" style={{ position: 'sticky', bottom: 0, zIndex: 5, margin: '0 -24px -48px', padding: '12px 24px', background: 'var(--surface)',
      borderTop: '1px solid var(--line)', boxShadow: '0 -4px 12px rgba(19,32,47,.05)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      {status}
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      {onPreview && <Button variant="ghost" icon="eye" onClick={onPreview}>Preview</Button>}
      {onSaveDraft && <Button variant={primary ? 'secondary' : 'primary'} kbd="Ctrl S" loading={busy && !primary} disabled={busy} onClick={onSaveDraft} data-testid="save-draft">{saveLabel}</Button>}
      {primary && <Button variant="primary" icon="check" loading={busy} disabled={busy} onClick={primary.onClick} data-testid={primary.testId}>{primary.label}</Button>}
    </div>
  )
}
