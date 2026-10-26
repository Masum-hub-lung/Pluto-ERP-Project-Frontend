import type { VoucherPreview } from '../../api/contract.gen'
import { ds } from '../../ds'
import { formatTaka } from '../../lib/format'

/**
 * BalanceStatus (H9–H12, 08 §7): the server's verdict on the voucher being typed — balanced, or out of balance by the
 * difference it reports — with the totals, the amount in words and its warnings (back-dated, funds, approval).
 */
export function BalanceStatus({ result, pending, error }: { result: VoucherPreview | null; pending: boolean; error: unknown }) {
  const { Badge, Skeleton, Banner } = ds()
  if (!result && pending) return <div data-testid="balance-status"><Skeleton height={60} /></div>
  if (!result) {
    return <div data-testid="balance-status" style={{ color: 'var(--ink-muted)' }}>{error ? 'Could not check the balance; it is checked again when you save.' : 'Add lines to see the totals.'}</div>
  }
  return (
    <div data-testid="balance-status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        {result.balanced
          ? <Badge tone="positive" dot>Balanced</Badge>
          : <Badge tone="negative" dot>Out of balance by ৳ {formatTaka(result.difference)}</Badge>}
        <span className="lf-num" style={{ display: 'flex', gap: 16 }}>
          <span data-testid="total-debit">Dr {formatTaka(result.total_debit)}</span>
          <span data-testid="total-credit">Cr {formatTaka(result.total_credit)}</span>
        </span>
      </div>
      <em style={{ color: 'var(--ink-muted)' }}>{result.amount_in_words}</em>
      {result.warnings.map((w, i) => (
        <Banner key={`${w.code}-${i}`} tone={w.code === 'INSUFFICIENT_FUNDS' ? 'negative' : 'warning'} title={w.code === 'APPROVAL_REQUIRED' ? 'Needs approval' : w.code === 'BACKDATED' ? 'Back-dated' : w.code === 'INSUFFICIENT_FUNDS' ? 'More than the account holds' : w.code}>{w.message}</Banner>
      ))}
    </div>
  )
}
