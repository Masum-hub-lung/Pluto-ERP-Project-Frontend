import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { ApprovalRequest, Notification, PageMeta } from './contract.gen'
import { useAccountingRefresh } from './accounting'

/**
 * Approvals and the notification bell (05 approvals, notifications; L3/L4; backlog P7.2-FE-01/08). The bell polls
 * the unread count every 60 s; deciding an approval posts or returns a voucher, so it refreshes accounting too.
 */
export interface ApprovalFacts { entry_type: string; entry_date: string; narration: string | null; lines: Array<{ ledger: string; debit: string; credit: string }> }
export const factsOf = (a: ApprovalRequest) => (a.facts ?? null) as unknown as ApprovalFacts | null

const k = (cid: number | null, ...rest: unknown[]) => ['company', cid, ...rest] as const

export function useApprovals(f: { status?: string; page?: number } = {}) {
  return useQuery({
    queryKey: k(api.getCompany(), 'approvals', f),
    queryFn: async ({ signal }) => (await api.request<{ data: ApprovalRequest[]; meta: PageMeta }>('GET', '/approvals', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useApproval(id: number | null) {
  return useQuery({
    queryKey: k(api.getCompany(), 'approvals', 'one', id),
    queryFn: async ({ signal }) => (await api.request<{ data: ApprovalRequest }>('GET', `/approvals/${id}`, { signal })).data.data,
    enabled: !!id && id > 0,
  })
}

export function useNotifications(f: { unread?: 'true' | 'false'; category?: string; page?: number; per_page?: number } = {}, poll = false) {
  return useQuery({
    queryKey: k(api.getCompany(), 'notifications', f),
    queryFn: async ({ signal }) => (await api.request<{ data: Notification[]; meta: PageMeta }>('GET', '/notifications', { query: { ...f }, signal })).data,
    refetchInterval: poll ? 60_000 : false,
    refetchIntervalInBackground: false,
  })
}

function useBellRefresh() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: k(api.getCompany(), 'notifications') })
}

export function useMarkRead() {
  const refresh = useBellRefresh()
  return useMutation({ mutationFn: async (id: number) => { await api.request<void>('POST', `/notifications/${id}/read`) }, onSuccess: refresh })
}

export function useMarkAllRead() {
  const refresh = useBellRefresh()
  return useMutation({ mutationFn: async () => { await api.request<void>('POST', '/notifications/read-all') }, onSuccess: refresh })
}

export function useDecideApproval() {
  const refresh = useAccountingRefresh()
  return useMutation({
    mutationFn: async ({ id, decision, comment, idempotencyKey }: { id: number; decision: 'approve' | 'reject'; comment?: string; idempotencyKey?: string }) =>
      (await api.request<{ data: ApprovalRequest }>('POST', `/approvals/${id}/${decision}`, { body: comment ? { comment } : {}, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}
