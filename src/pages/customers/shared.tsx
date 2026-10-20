import { ApiError } from '../../api/client'
import { lf } from '../../ds'

/** Problem details shown with the request id, so support can trace it (05 §3). */
export function ErrorBanner({ error }: { error: unknown }) {
  const { Banner } = lf()
  const p = error instanceof ApiError ? error.problem : null
  return (
    <Banner tone="negative" title={p ? p.title : 'Something went wrong'}>
      {p?.detail ? `${p.detail} ` : ''}{p?.request_id ? `Reference ${p.request_id.slice(0, 8)}.` : ''}
    </Banner>
  )
}
