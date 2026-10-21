import { useEffect, useRef, type ReactNode } from 'react'
import { ds } from '../ds'
import './sheet.css'

/**
 * Phone bottom sheet (backlog P1.5-FE-03/04): full width from the bottom over a dimmed backdrop, long content scrolls
 * inside, actions stay above the home indicator. Closes on backdrop click and Esc (unless there is no onClose: then
 * only its own actions end it); traps focus and gives it back to whatever had it before.
 */
export function BottomSheet({ title, description, onClose, footer, children, testId }: {
  title: string; description?: string; onClose?: () => void; footer?: ReactNode; children?: ReactNode; testId?: string
}) {
  const { IconButton } = ds()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    const items = () => [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
    ;(items().find((el) => !el.closest('.lf-sheet-head')) ?? items()[0])?.focus()
    document.documentElement.classList.add('lf-scroll-locked')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current?.(); return }
      if (e.key !== 'Tab') return
      const all = items()
      if (!all.length) return
      const first = all[0]!, last = all[all.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('lf-scroll-locked')
      back?.focus?.()
    }
  }, [])

  return (
    <div className="lf-sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div ref={panel} className="lf-sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="lf-sheet-grip" aria-hidden />
        <div className="lf-sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="lf-sheet-title">{title}</h2>
            {description && <p className="lf-sheet-desc">{description}</p>}
          </div>
          {onClose && <IconButton icon="x" label="Close" onClick={onClose} />}
        </div>
        {children && <div className="lf-sheet-body">{children}</div>}
        {footer && <div className="lf-sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}
