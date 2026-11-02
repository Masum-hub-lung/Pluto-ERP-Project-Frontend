/**
 * Error tracking (owner decision 1 Nov 2026; backlog P17.2-FE-02): Sentry for React, loaded only when VITE_SENTRY_DSN is
 * set (Vercel env), so builds without it carry no Sentry code path at runtime. Financial data stays out: no personal
 * data, no request or response bodies, and URLs lose their query strings (search terms, filters, ids of documents).
 * Source maps are uploaded privately at build time and deleted from the bundle (vite.config.ts).
 */
type Event = { request?: unknown; user?: unknown; extra?: unknown; breadcrumbs?: Array<{ data?: Record<string, unknown>; message?: string }>; [k: string]: unknown }

/** Removes the query string and fragment from a URL-like string (display only; pure, unit-tested). */
export function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, '')
}

/** Drops everything that may hold names, amounts or tokens from an event before it leaves the browser. */
export function scrubEvent<T extends Event>(event: T): T {
  delete event.request
  delete event.user
  delete event.extra
  for (const b of event.breadcrumbs ?? []) {
    if (b.data) {
      for (const k of ['url', 'to', 'from']) if (typeof b.data[k] === 'string') b.data[k] = stripQuery(b.data[k] as string)
      delete b.data.body
      delete b.data.response
    }
  }
  return event
}

export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? import.meta.env.MODE,
      release: import.meta.env.VITE_RELEASE as string | undefined,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: (event) => scrubEvent(event as unknown as Event) as unknown as typeof event,
      beforeBreadcrumb: (b) => {
        if (b.data && typeof b.data.url === 'string') b.data.url = stripQuery(b.data.url)
        return b
      },
    })
  })
}
