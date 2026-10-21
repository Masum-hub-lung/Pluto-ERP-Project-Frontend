import { lf } from '../ds'

/** L6 confirmation (02 #page-l6): one question, a cancel and a confirm button; `loading` blocks double clicks. */
export function ConfirmDialog({ title, description, confirmLabel, cancelLabel = 'Cancel', tone = 'warning', loading, onConfirm, onClose, children }: {
  title: string; description?: string; confirmLabel: string; cancelLabel?: string; tone?: 'negative' | 'warning' | 'info'
  loading?: boolean; onConfirm: () => void; onClose: () => void; children?: React.ReactNode
}) {
  const { Dialog, Button } = lf()
  return (
    <Dialog title={title} description={description} tone={tone} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
        <Button variant={tone === 'info' ? 'primary' : 'danger'} loading={loading} disabled={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      {children}
    </Dialog>
  )
}
