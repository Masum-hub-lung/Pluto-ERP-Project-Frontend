import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useVoucher } from '../../api/accounting'
import { useMoneyAccounts } from '../../api/money'
import { dhakaToday } from '../../api/platform'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { emptyVoucher, fromVoucher, type VoucherKind } from '../../lib/voucherForm'
import { VoucherEditor } from '../../components/voucher/VoucherEditor'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { Forbidden, NotFound } from '../../components/states'
import { canEnter, VOUCHER_TYPES } from './common'

/**
 * /accounting/vouchers/new/:type (H9–H12; backlog P7.2-FE-05/06): a blank voucher of that type, or a copy of
 * another voucher with today's date (`?from=<id>`, H13 Duplicate).
 */
export function VoucherNew() {
  const type = useParams().type as VoucherKind
  const [params] = useSearchParams()
  const { can } = useSession()
  const from = Number(params.get('from')) || 0
  const source = useVoucher(from)
  const accounts = useMoneyAccounts()
  if (!VOUCHER_TYPES.some((t) => t.value === type)) return <NotFound what="this kind of voucher" back="/accounting/vouchers" backLabel="Vouchers" />
  if (!canEnter(can, type)) return <Forbidden permission={type === 'journal' ? 'accounting.create' : 'banking.create'} what={`${type} vouchers`} />
  if (from) {
    if (source.error) return <ProblemBanner error={source.error} onRetry={() => void source.refetch()} />
    if (!source.data || accounts.isPending) return <PageSkeleton template="form" />
    const p = source.data.payment as { money_account?: { id: number } } | null
    const ledgerId = accounts.data?.find((a) => a.id === p?.money_account?.id)?.ledger_id
    return <VoucherEditor key={`dup-${from}`} initial={{ ...fromVoucher(source.data, ledgerId, dhakaToday()), type }} />
  }
  return <VoucherEditor key={type} initial={emptyVoucher(type, dhakaToday())} />
}

/** /accounting/vouchers/:id/edit: drafts and rejected vouchers only (PUT /vouchers/{id}). */
export function VoucherEdit() {
  const { Banner, Button } = ds()
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { can } = useSession()
  const q = useVoucher(id)
  const accounts = useMoneyAccounts()
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound what="this voucher" back="/accounting/vouchers" backLabel="Vouchers" />
  if (q.error) return <ProblemBanner error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data || accounts.isPending) return <PageSkeleton template="form" />
  const v = q.data
  const type = v.entry_type as VoucherKind
  if (!VOUCHER_TYPES.some((t) => t.value === type) || !['draft', 'rejected'].includes(v.status)) {
    return <Banner tone="info" title={`${v.voucher_number} cannot be edited`} action={<Button variant="secondary" onClick={() => navigate(`/accounting/vouchers/${v.id}`)}>Open it</Button>}>
      Only drafts and rejected vouchers change. A posted voucher is reversed instead.</Banner>
  }
  if (!canEnter(can, type, 'edit')) return <Forbidden permission={type === 'journal' ? 'accounting.edit' : 'banking.edit'} what={`${type} vouchers`} />
  const p = v.payment as { money_account?: { id: number } } | null
  const ledgerId = accounts.data?.find((a) => a.id === p?.money_account?.id)?.ledger_id
  return <VoucherEditor key={v.version} voucher={v} initial={fromVoucher(v, ledgerId)} />
}
