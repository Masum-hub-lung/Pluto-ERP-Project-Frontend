import type { ErrorCode } from './contract.gen'

/**
 * HTTP client for /api/v1 (08 §5, 07 §3).
 * - The access token lives only in this module's memory; it is never written to storage.
 * - On 401 token_expired the client refreshes once (the HttpOnly cookie is sent by the browser) and retries;
 *   concurrent requests share a single refresh.
 * - Every error is turned into an ApiError carrying the problem+json `code`, field `errors` and `request_id`.
 */
export interface Problem {
  type?: string
  title: string
  status: number
  /** Plus the Vercel /api proxy's own answers when the backend is unreachable or not configured (api/proxy.ts). */
  code: ErrorCode | 'network_error' | 'backend_unreachable' | 'backend_unconfigured'
  detail?: string
  request_id?: string
  errors?: Record<string, string[]>
  [extra: string]: unknown
}

export class ApiError extends Error {
  constructor(public readonly problem: Problem, public readonly headers?: Headers) {
    super(problem.detail || problem.title)
  }
  get status() { return this.problem.status }
  get code() { return this.problem.code }
  /** Field errors keyed by API field name (Laravel dot paths). */
  get fieldErrors(): Record<string, string[]> { return this.problem.errors ?? {} }
  get retryAfter(): number | null {
    const v = this.headers?.get('Retry-After')
    return v ? Number(v) : null
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined | null>
  body?: unknown
  headers?: Record<string, string>
  /** Sent as Idempotency-Key; reuse the same value when retrying the same user action (BR-050). */
  idempotencyKey?: string
  /** Version check (BR-049), usually `W/"<version>"`. Sent as X-If-Match: Vercel's edge would turn a standard If-Match
   *  into 412 once the edit succeeds (new ETag); the backend reads X-If-Match as If-Match. */
  ifMatch?: string
  /** Company-scoped call: sends X-Company-Id (default true when a company is selected). */
  company?: boolean
  /** Internal: do not try to refresh on 401. */
  noRefresh?: boolean
  signal?: AbortSignal
}

export interface ResponseMeta { status: number; etag: string | null; headers: Headers }

type Fetch = typeof fetch

export class ApiClient {
  private accessToken: string | null = null
  private companyId: number | null = null
  private refreshing: Promise<boolean> | null = null
  /** Called when the session cannot be renewed (refresh failed): the app returns to sign-in. */
  onSessionEnded: (() => void) | null = null
  /** Called when the company requires 2-step and this sign-in was made without it (403 two_factor_required_by_company). */
  onTwoFactorRequired: (() => void) | null = null

  constructor(private readonly baseUrl = '/api/v1', private readonly fetchImpl: Fetch = (...a) => fetch(...a)) {}

  setAccessToken(token: string | null) { this.accessToken = token }
  hasAccessToken() { return this.accessToken !== null }
  setCompany(id: number | null) { this.companyId = id }
  getCompany() { return this.companyId }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<{ data: T; meta: ResponseMeta }> {
    const res = await this.send(method, path, opts)
    if (res.status === 401 && !opts.noRefresh) {
      const problem = await readProblem(res)
      if (problem.code === 'token_expired' && (await this.refresh())) {
        return this.request<T>(method, path, { ...opts, noRefresh: true })
      }
      if (problem.code === 'token_expired' || problem.code === 'token_invalid' || problem.code === 'unauthenticated') {
        this.accessToken = null
        this.onSessionEnded?.()
      }
      throw new ApiError(problem, res.headers)
    }
    if (!res.ok) {
      const problem = await readProblem(res)
      // On a company-scoped call this means "this sign-in has no second factor". On DELETE /me/two-factor
      // (not company-scoped) it only means 2-step cannot be turned off, which the page reports itself.
      if (problem.code === 'two_factor_required_by_company' && (opts.company ?? true) && this.companyId !== null) this.onTwoFactorRequired?.()
      throw new ApiError(problem, res.headers)
    }
    const meta: ResponseMeta = { status: res.status, etag: res.headers.get('ETag'), headers: res.headers }
    if (res.status === 204) return { data: undefined as T, meta }
    return { data: (await res.json()) as T, meta }
  }

  /** Renews the access token from the refresh cookie. Shared by concurrent callers. */
  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const res = await this.fetchImpl(this.baseUrl + '/auth/refresh', {
            method: 'POST', credentials: 'same-origin',
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          })
          if (!res.ok) { this.accessToken = null; return false }
          const body = (await res.json()) as { data: { access_token: string } }
          this.accessToken = body.data.access_token
          return true
        } catch {
          return false
        } finally {
          setTimeout(() => { this.refreshing = null }, 0)
        }
      })()
    }
    return this.refreshing
  }

  private send(method: string, path: string, opts: RequestOptions): Promise<Response> {
    const url = new URL(this.baseUrl + path, globalThis.location?.origin ?? 'http://localhost')
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`
    if ((opts.company ?? true) && this.companyId !== null) headers['X-Company-Id'] = String(this.companyId)
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
    if (opts.ifMatch) headers['X-If-Match'] = opts.ifMatch
    let body: string | undefined
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const target = url.origin === (globalThis.location?.origin ?? url.origin) ? url.pathname + url.search : url.toString()
    return this.fetchImpl(target, { method, headers, body, credentials: 'same-origin', signal: opts.signal }).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      throw new ApiError({ title: 'The server could not be reached. Check your connection and try again.', status: 0, code: 'network_error' })
    })
  }
}

async function readProblem(res: Response): Promise<Problem> {
  try {
    const body = (await res.clone().json()) as Partial<Problem>
    if (body && typeof body.code === 'string') return { title: body.title ?? res.statusText, status: res.status, ...body } as Problem
  } catch { /* not JSON */ }
  return { title: 'Something went wrong; quote the request id', status: res.status, code: 'server_error', request_id: res.headers.get('X-Request-Id') ?? undefined }
}

export const api = new ApiClient()
