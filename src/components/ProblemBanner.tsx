import { ApiError } from '../api/client'
import { ds } from '../ds'

/**
 * L11 error state (02 #page-l11, 08 §7): any API failure as one negative banner — the problem title and detail,
 * plus "Reference: <request id>" so support can trace it. Connection, offline-server and rate-limit cases get
 * plain words instead of codes. Renders nothing when there is no error.
 */
export function ProblemBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { Banner, Button } = ds()
  if (!error) return null
  const p = error instanceof ApiError ? error.problem : null
  let title = p?.title ?? 'Something went wrong'
  let body = p?.detail ?? ''
  if (p?.code === 'network_error') {
    title = 'You seem to be offline'
    body = 'Check your internet connection, then try again.'
  } else if (p?.code === 'backend_unreachable') {
    title = 'The Pluto server is offline'
    body = 'Try again in a minute. Nothing you typed has been lost.'
  } else if (p?.status === 429) {
    const wait = error instanceof ApiError ? error.retryAfter : null
    title = 'Too many requests'
    body = wait ? `Please wait ${wait} seconds, then try again.` : 'Please wait a moment, then try again.'
  }
  const ref = p?.request_id ? `Reference: ${p.request_id.slice(0, 8)}` : ''
  return (
    <Banner tone="negative" title={title} action={onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button> : undefined}>
      {[body, ref].filter(Boolean).join(' · ')}
    </Banner>
  )
}
