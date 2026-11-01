import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { DashboardSummary, LensData, SearchResults } from './contract.gen'

/**
 * Dashboards (A1–A8; 05 GET /dashboard, GET /dashboard/lenses/{lens}; backlog P14.2-FE-01..03) and global search (L1,
 * L2; GET /search; P14.2-FE-04). The API caches dashboards for 60 s and drops the cache on any posting, so pages
 * refetch each time they open and every minute while open. Charts draw from the `*_pct` fields the API sends (0–100):
 * the SPA never scales money itself.
 */
export type DashboardPeriod = 'this_month' | 'this_quarter' | 'this_year'
export type Lens = LensData['lens']

const k = (...rest: unknown[]) => ['company', api.getCompany(), ...rest] as const

/** The rows of the A1 widgets, as the backend builds them (app/Queries/DashboardQuery.php). */
export interface MonthBar { month: string; label: string; revenue: string; expenses: string; net_profit: string; revenue_pct: string; expenses_pct: string }
export interface CashRow { id: number; name: string; account_type: string; bank_name: string | null; balance: string; share: string; last_reconciled_on: string | null }
export interface Bucket { key: string; label: string; amount: string; pct: string }
export interface Owed { total: string; overdue: string; advance: string; parties: number; as_of: string; buckets: Bucket[] }
export interface Upcoming { kind: string; id: number; number: string; party: string; party_id: number; due_date: string; amount: string; days: number; url: string }
export interface RecentTx { id: number; date: string; voucher_number: string; type: string; party: string | null; narration: string | null; amount: string; url: string }
export interface StockAlert { product_id: number; code: string; name: string; warehouse: string; unit: string | null; on_hand: string; reorder_level: string; status: string; total: number; url: string }
export interface DashBanner { kind: string; tone: 'warning' | 'info'; title: string; body: string | null; url: string | null }
export interface WidgetFailure { widget: string; ref: string; message: string }
export interface PeriodInfo { name: DashboardPeriod; date_from: string; date_to: string; label: string; prior_from: string; prior_to: string }

export const periodOf = (d: { period?: Record<string, unknown> } | undefined) => d?.period as unknown as PeriodInfo | undefined
export const monthsOf = (d: DashboardSummary | undefined) => (d?.revenue_vs_expenses ?? []) as unknown as MonthBar[]
export const cashOf = (d: DashboardSummary | undefined) => (d?.cash_position ?? []) as unknown as CashRow[]
export const owedOf = (d: DashboardSummary | undefined) => (d?.money_owed ?? {}) as unknown as { receivable?: Owed; payable?: Owed }
export const upcomingOf = (d: DashboardSummary | undefined) => (d?.upcoming_payments ?? []) as unknown as Upcoming[]
export const recentOf = (d: DashboardSummary | undefined) => (d?.recent_transactions ?? []) as unknown as RecentTx[]
export const alertsOf = (d: DashboardSummary | undefined) => (d?.inventory_alerts ?? []) as unknown as StockAlert[]
export const bannersOf = (d: DashboardSummary | undefined) => (d?.banners ?? []) as unknown as DashBanner[]
export const failuresOf = (d: { widget_errors?: Array<Record<string, unknown>> } | undefined) => (d?.widget_errors ?? []) as unknown as WidgetFailure[]

const live = { staleTime: 0, refetchOnMount: 'always' as const, refetchInterval: 60_000, refetchIntervalInBackground: false, placeholderData: keepPreviousData }

export function useDashboard(period: DashboardPeriod) {
  return useQuery({
    queryKey: k('dashboard', period),
    queryFn: async ({ signal }) => (await api.request<{ data: DashboardSummary }>('GET', '/dashboard', { query: { period }, signal })).data.data,
    ...live,
  })
}

export function useLens(lens: Lens, period: DashboardPeriod) {
  return useQuery({
    queryKey: k('dashboard', 'lens', lens, period),
    queryFn: async ({ signal }) => (await api.request<{ data: LensData }>('GET', `/dashboard/lenses/${lens}`, { query: { period }, signal })).data.data,
    ...live,
  })
}

/** GET /search; nothing is asked below 2 characters. `limit` per type (palette 5, results page 20). */
export function useSearch(q: string, opts: { type?: string; limit?: number } = {}) {
  const term = q.trim()
  return useQuery({
    queryKey: k('search', term, opts),
    queryFn: async ({ signal }) => (await api.request<{ data: SearchResults }>('GET', '/search', {
      query: { q: term, ...(opts.type ? { type: opts.type } : {}), ...(opts.limit ? { limit: String(opts.limit) } : {}) }, signal,
    })).data.data,
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/** Labels and icons of the search types (L1 tabs, L2 group headings). */
export const SEARCH_TYPES: Record<string, { label: string; icon: string }> = {
  party: { label: 'Customers and suppliers', icon: 'users' }, sales_invoice: { label: 'Sales invoices', icon: 'receipt-text' },
  purchase_bill: { label: 'Purchase bills', icon: 'shopping-cart' }, voucher: { label: 'Vouchers', icon: 'book-open-text' },
  ledger: { label: 'Ledgers', icon: 'scale' }, product: { label: 'Products', icon: 'package' }, letter_of_credit: { label: 'Letters of credit', icon: 'file-text' },
}
