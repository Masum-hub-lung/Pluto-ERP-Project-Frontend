import * as React from 'react'

/**
 * The existing LedgerFlow design system (ds/ledgerflow/components/bundle.js) is a React component library that
 * reads `window.React` and publishes `window.LedgerFlow`. The app shares its React instance with the bundle,
 * loads the bundle once, then renders the designed components directly.
 */
type C<P = Record<string, unknown>> = React.ComponentType<P & { children?: React.ReactNode }>

export interface LedgerFlowLibrary {
  Button: C<{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: string; iconRight?: string; loading?: boolean;
    kbd?: string; block?: boolean; type?: 'button' | 'submit'; disabled?: boolean; onClick?: (e: React.MouseEvent) => void; 'data-testid'?: string }>
  IconButton: C<{ icon: string; label: string; variant?: string; size?: 'sm' | 'md'; onClick?: (e: React.MouseEvent) => void }>
  Icon: C<{ name: string; size?: number }>
  Badge: C<{ tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'accent' | 'brand'; dot?: boolean }>
  Amount: C<{ value: string | number; currency?: string; decimals?: number; drcr?: boolean; size?: 'sm' | 'md' | 'lg' }>
  Field: C<{ label?: string; hint?: string; error?: string; required?: boolean; term?: string; htmlFor?: string }>
  Input: C<React.InputHTMLAttributes<HTMLInputElement> & { icon?: string; prefix?: string; suffix?: React.ReactNode; invalid?: boolean;
    align?: 'right'; mono?: boolean; size?: 'sm' | 'md' }>
  Select: C<React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<string | { value: string; label: string }>; invalid?: boolean }>
  Segmented: C<{ options: Array<string | { value: string; label: string; icon?: string }>; value?: string; onChange?: (v: string) => void; size?: 'sm' | 'md' }>
  Tabs: C<{ items: Array<{ value: string; label: string; count?: number }>; value?: string; onChange?: (v: string) => void }>
  Card: C<{ title?: string; subtitle?: string; actions?: React.ReactNode; footer?: React.ReactNode; padding?: 'none' | 'sm' | 'md' }>
  DataTable: C<{ columns: DataColumn[]; rows: Array<Record<string, unknown>>; onRowClick?: (row: any) => void; rowActions?: (row: any) => React.ReactNode;
    emptyState?: React.ReactNode; loading?: boolean; caption?: string }>
  Pagination: C<{ page: number; pageCount: number; total?: number; pageSize?: number; onChange?: (p: number) => void }>
  PageHeader: C<{ eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }>
  Banner: C<{ tone?: 'info' | 'positive' | 'negative' | 'warning'; title?: string; action?: React.ReactNode; onDismiss?: () => void }>
  Toast: C<{ tone?: 'positive' | 'negative' | 'info' | 'warning'; title: string; description?: string; onDismiss?: () => void }>
  Dialog: C<{ open?: boolean; title: string; description?: string; tone?: 'negative' | 'warning' | 'info'; footer?: React.ReactNode; onClose?: () => void; width?: number }>
  EmptyState: C<{ icon?: string; title: string; description?: string; action?: React.ReactNode; secondary?: React.ReactNode }>
  Skeleton: C<{ width?: number | string; height?: number }>
  Menu: C<{ items: Array<MenuItem | '-'>; style?: React.CSSProperties }>
  /** Keeps its own on/off state after mount: remount (key) to reset it. */
  Switch: C<{ label?: string; checked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean }>
  Logo: C<{ compact?: boolean; reversed?: boolean }>
  Sidebar: C<{ compact?: boolean; company: { name: string; meta: string }; user: { name: string; role: string } }>
  NavSection: C<{ label?: string }>
  NavItem: C<{ icon: string; label: string; active?: boolean; open?: boolean; count?: number; onClick?: () => void }>
  NavSubItem: C<{ label: string; active?: boolean; onClick?: () => void }>
  Topbar: C<{ breadcrumbs: string[]; company?: string; fy?: string; notifications?: number; user?: string; onCreateItem?: (label: string) => void }>
}

export interface DataColumn {
  key: string
  label: string
  type?: 'amount'
  mono?: boolean
  align?: 'right'
  width?: number
  render?: (value: any, row: any) => React.ReactNode
}

export interface MenuItem { icon?: string; label: string; description?: string; danger?: boolean; onClick?: () => void; heading?: string }

declare global {
  interface Window { React: typeof React; LedgerFlow?: LedgerFlowLibrary }
}

let loading: Promise<LedgerFlowLibrary> | null = null

export function loadDesignSystem(src = '/ds/ledgerflow/components/bundle.js'): Promise<LedgerFlowLibrary> {
  if (window.LedgerFlow) return Promise.resolve(window.LedgerFlow)
  window.React = React
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => (window.LedgerFlow ? resolve(window.LedgerFlow) : reject(new Error('LedgerFlow design system did not load')))
    s.onerror = () => reject(new Error('LedgerFlow design system could not be fetched'))
    document.head.appendChild(s)
  })
  return loading
}

/** The loaded component library (main.tsx renders only after loadDesignSystem() resolved). */
export function lf(): LedgerFlowLibrary {
  if (!window.LedgerFlow) throw new Error('Design system not loaded')
  return window.LedgerFlow
}
