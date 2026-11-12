import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ds } from '../ds'
import { useMediaQuery } from '../lib/useMediaQuery'
import './splitview.css'

/**
 * Split-view document lists (A+ redesign, PEP-479): on wide screens a row click opens a preview beside the list instead
 * of leaving it, so an accountant can run down the invoices and see each one's balance, lines and payments. The open
 * row is `?preview=<id>` in the URL (a refresh or a shared link keeps it). Narrower than WIDE, or from the preview's
 * "Open" button, the row opens its full page as before. Nothing here computes money: the preview shows the API's figures.
 */
export const WIDE = '(min-width: 1280px)'

type ListParams = { get: (k: string, f?: string) => string; set: (c: Record<string, string | null | undefined>) => void; params: URLSearchParams }

export function useSplit(lp: ListParams, fullPath: (id: number) => string) {
  const wide = useMediaQuery(WIDE)
  const navigate = useNavigate()
  const raw = Number(lp.get('preview')) || 0
  const keepPage = { page: lp.params.get('page') }
  return {
    wide,
    /** The row in the preview; 0 when closed or on a narrow screen. */
    id: wide ? raw : 0,
    open: (row: { id: number }) => (wide ? lp.set({ preview: String(row.id), ...keepPage }) : navigate(fullPath(row.id))),
    close: () => lp.set({ preview: null, ...keepPage }),
    full: (id: number) => navigate(fullPath(id)),
  }
}

export function SplitView({ list, preview }: { list: ReactNode; preview?: ReactNode }) {
  return (
    <div className={preview ? 'lf-split has-preview' : 'lf-split'}>
      <div className="lf-split-list">{list}</div>
      {preview}
    </div>
  )
}

export interface PreviewFact { label: string; value: ReactNode }
export interface PreviewLine { key: string | number; label: ReactNode; note?: ReactNode; value: ReactNode }
export interface PreviewEvent { key: string | number; text: ReactNode; tone?: 'brand' | 'muted' | 'negative' }

/** The preview panel: number and party, status, the headline figure, actions, facts, lines, history, link to the full page. */
export function DocPreview({ label, number, title, badge, figureLabel, figure, figureNote, actions, lines, linesTitle = 'Lines', facts, events, openLabel, onOpen, onClose, loading, error, testId }: {
  label: string; number?: ReactNode; title?: ReactNode; badge?: ReactNode; figureLabel?: string; figure?: ReactNode; figureNote?: ReactNode; actions?: ReactNode
  lines?: PreviewLine[]; linesTitle?: string; facts?: PreviewFact[]; events?: PreviewEvent[]; openLabel: string; onOpen: () => void; onClose: () => void
  loading?: boolean; error?: ReactNode; testId?: string
}) {
  const { IconButton, Button, Skeleton } = ds()
  return (
    <aside className="lf-preview" aria-label={label} data-testid={testId} aria-busy={loading || undefined}>
      <div className="lf-preview-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          {number && <span className="lf-preview-number lf-mono">{number}</span>}
          {loading ? <Skeleton width="70%" height={22} /> : title && <h2 className="lf-preview-title">{title}</h2>}
        </div>
        <div className="lf-preview-head-end">
          {!loading && badge}
          <IconButton icon="x" label="Close preview" size="sm" onClick={onClose} data-testid="close-preview" />
        </div>
      </div>
      {error ? <div>{error}</div> : loading ? <><Skeleton height={72} /><Skeleton height={120} /></> : <>
        {figure != null && (
          <div className="lf-preview-figure">
            {figureLabel && <span className="lf-label">{figureLabel}</span>}
            <span className="lf-num lf-preview-amount" data-testid="preview-figure">{figure}</span>
            {figureNote && <span className="lf-preview-note">{figureNote}</span>}
          </div>
        )}
        {actions && <div className="lf-preview-actions">{actions}</div>}
        {facts && facts.length > 0 && (
          <dl className="lf-preview-facts">{facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
        )}
        {lines && lines.length > 0 && (
          <section aria-label={linesTitle}>
            <h3 className="lf-preview-h3">{linesTitle}</h3>
            <ul className="lf-preview-lines">
              {lines.map((l) => (
                <li key={l.key}><span className="lf-preview-line-label">{l.label}{l.note && <span>{l.note}</span>}</span><span className="lf-num">{l.value}</span></li>
              ))}
            </ul>
          </section>
        )}
        {events && events.length > 0 && (
          <section aria-label="History">
            <h3 className="lf-preview-h3">History</h3>
            <ol className="lf-preview-events">
              {events.map((e) => <li key={e.key} className={e.tone ? `is-${e.tone}` : undefined}><span aria-hidden="true" /><span>{e.text}</span></li>)}
            </ol>
          </section>
        )}
      </>}
      <div className="lf-preview-foot">
        <Button variant="secondary" iconRight="arrow-right" block onClick={onOpen} data-testid="open-full">{openLabel}</Button>
      </div>
    </aside>
  )
}

/** "11 Nov 2026, 16:20" in Dhaka, for history lines (timestamps from the API). */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}
