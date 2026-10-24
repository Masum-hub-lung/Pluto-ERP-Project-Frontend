import type { ReactNode } from 'react'
import { ds } from '../ds'
import { PHONE, useMediaQuery } from '../lib/useMediaQuery'
import { BottomSheet } from './BottomSheet'

/**
 * The design system's Dialog, or a full-width bottom sheet below 640 px (backlog P1.5-FE-04). Same props as Dialog;
 * use it for every dialog so phones get the thumb-friendly layout (primary action on top, full width).
 */
export function ResponsiveDialog({ title, description, tone, footer, onClose, width, children, testId }: {
  title: string; description?: string; tone?: 'negative' | 'warning' | 'info'; footer?: ReactNode; onClose?: () => void; width?: number
  children?: ReactNode; testId?: string
}) {
  const { Dialog } = ds()
  const phone = useMediaQuery(PHONE)
  if (phone) return <BottomSheet title={title} description={description} onClose={onClose} footer={footer} testId={testId}>{children}</BottomSheet>
  return <Dialog title={title} description={description} tone={tone} footer={footer} onClose={onClose} width={width}><div data-testid={testId}>{children}</div></Dialog>
}
