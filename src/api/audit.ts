import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from './client'
import type { AuditLog, PageMeta } from './contract.gen'

/** Record types accepted by GET /audit-logs (backend AuditableTypes). */
export type AuditableType = 'party' | 'product' | 'warehouse' | 'stock_adjustment' | 'stock_transfer' | 'purchase_order' | 'purchase_bill'
  | 'purchase_return' | 'debit_note' | 'quotation' | 'sales_invoice' | 'sales_return' | 'credit_note' | 'journal_entry' | 'ledger'
  | 'money_account' | 'letter_of_credit' | 'branch'

/** Activity of one record, newest first, 25 per page; `fetchNextPage()` loads older entries ("Show more"). */
export function useAuditLog(type: AuditableType, id: number) {
  const cid = api.getCompany()
  return useInfiniteQuery({
    queryKey: ['company', cid, 'audit-logs', type, id],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => (await api.request<{ data: AuditLog[]; meta: PageMeta }>('GET', '/audit-logs',
      { query: { auditable_type: type, auditable_id: id, page: pageParam }, signal })).data,
    getNextPageParam: (last) => (last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
    enabled: id > 0,
  })
}
