import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

/**
 * Phone navigation drawer (backlog P1.5-FE-01, motion P1.6-FE-03): slides in from the left over a dimmed backdrop.
 * Closes on backdrop click, Esc and swipe-left; traps focus while open and gives it back to the menu button; locks
 * page scrolling. It stays mounted so it can slide out again; `inert` keeps it out of tab order while closed.
 * Styles: .lf-navdrawer* in app/shell.css.
 */
export function NavDrawer({ open, onClose, returnFocus, header, children }: {
  open: boolean
  onClose: () => void
  returnFocus: RefObject<HTMLElement | null>
  header?: ReactNode
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ x: number; y: number; dx: number } | null>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open) {
      wasOpen.current = true
      focusables(panel.current)[0]?.focus()
    } else if (wasOpen.current) {
      wasOpen.current = false
      returnFocus.current?.focus()
    }
    document.documentElement.classList.toggle('lf-scroll-locked', open)
    return () => document.documentElement.classList.remove('lf-scroll-locked')
  }, [open, returnFocus])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab') return
      const items = focusables(panel.current)
      if (!items.length) return
      const first = items[0]!, last = items[items.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (!panel.current?.contains(document.activeElement)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Swipe-left closes: the panel follows the finger, then either closes or springs back.
  const setDrag = (dx: number | null) => {
    const el = panel.current
    if (!el) return
    el.style.transition = dx === null ? '' : 'none'
    el.style.transform = dx === null ? '' : `translateX(${dx}px)`
  }

  return (
    <div className="lf-navdrawer" id="lf-navdrawer" data-open={open} inert={!open} aria-hidden={!open}>
      <div className="lf-navdrawer-backdrop" onClick={onClose} aria-hidden />
      <div ref={panel} className="lf-navdrawer-panel" role="dialog" aria-modal="true" aria-label="Main menu"
        onTouchStart={(e) => { const t = e.touches[0]!; swipe.current = { x: t.clientX, y: t.clientY, dx: 0 } }}
        onTouchMove={(e) => {
          const s = swipe.current
          if (!s) return
          const t = e.touches[0]!
          const dx = t.clientX - s.x
          if (s.dx === 0 && Math.abs(t.clientY - s.y) > Math.abs(dx)) { swipe.current = null; return } // vertical scroll
          s.dx = Math.min(0, dx)
          setDrag(s.dx)
        }}
        onTouchEnd={() => {
          const s = swipe.current
          swipe.current = null
          setDrag(null)
          if (s && s.dx < -60) onClose()
        }}>
        {header && <div className="lf-navdrawer-head">{header}</div>}
        <div className="lf-navdrawer-body">{children}</div>
      </div>
    </div>
  )
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null || el === document.activeElement)
}
