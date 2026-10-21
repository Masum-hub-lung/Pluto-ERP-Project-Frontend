import { lf } from '../ds'
import { StillLoading } from './StillLoading'

/** L9 loading (02 #page-l9): placeholder shapes of the page that is on its way, so the layout does not jump. */
export function PageSkeleton({ template }: { template: 'list' | 'form' | 'detail' | 'report' }) {
  const { Skeleton } = lf()
  const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: '16px 20px', display: 'grid', gap: 12 } as const
  const rows = (n: number) => Array.from({ length: n }, (_, i) => <Skeleton key={i} height={14} width={`${90 - (i % 3) * 15}%`} />)
  return (
    <div role="status" aria-label="Loading" data-testid="page-skeleton" style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}><Skeleton width="55%" height={28} /><Skeleton width="80%" height={14} /></div>
      {template === 'list' && <div style={card}><Skeleton height={36} width="40%" />{rows(8)}</div>}
      {template === 'form' && [3, 4, 2].map((n, i) => <div key={i} style={card}><Skeleton height={18} width="30%" />{rows(n)}</div>)}
      {template === 'detail' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {[0, 1, 2].map((i) => <div key={i} style={card}><Skeleton height={14} width="40%" /><Skeleton height={26} width="60%" /></div>)}
          </div>
          <div style={card}>{rows(5)}</div>
        </>
      )}
      {template === 'report' && <div style={card}><Skeleton height={220} />{rows(6)}</div>}
      <StillLoading />
    </div>
  )
}
