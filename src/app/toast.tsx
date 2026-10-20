import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { lf } from '../ds'

/** Toasts using the design's Toast component (L-states), stacked bottom-right, auto-dismissed after 6 s. */
interface ToastItem { id: number; tone: 'positive' | 'negative' | 'info' | 'warning'; title: string; description?: string }
const ToastContext = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {})
let next = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = next++
    setItems((xs) => [...xs, { ...t, id }])
    setTimeout(() => dismiss(id), 6000)
  }, [dismiss])
  const { Toast } = lf()
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" style={{ position: 'fixed', right: 24, bottom: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 50 }}>
        {items.map((t) => <Toast key={t.id} tone={t.tone} title={t.title} description={t.description} onDismiss={() => dismiss(t.id)} />)}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
