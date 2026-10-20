import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient, ApiError } from '../../src/api/client'

type Call = { url: string; init: RequestInit }
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers } })
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => json(status, { type: 'x', title: code, status, code, request_id: 'r-1', ...extra })

function client(handler: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const c = new ApiClient('/api/v1', (async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return handler(call, calls.length)
  }) as typeof fetch)
  return { c, calls }
}
const header = (c: Call, h: string) => (c.init.headers as Record<string, string>)[h]

test('sends bearer token, company, idempotency key and If-Match', async () => {
  const { c, calls } = client(() => json(200, { data: { id: 1 } }, { ETag: 'W/"2"' }))
  c.setAccessToken('tok')
  c.setCompany(7)
  const r = await c.request<{ data: { id: number } }>('PATCH', '/parties/1', { body: { name: 'x' }, ifMatch: 'W/"1"', idempotencyKey: 'k-1', query: { type: 'customer', q: '' } })
  assert.equal(r.data.data.id, 1)
  assert.equal(r.meta.etag, 'W/"2"')
  assert.equal(calls[0]!.url, '/api/v1/parties/1?type=customer') // empty q dropped
  assert.equal(header(calls[0]!, 'Authorization'), 'Bearer tok')
  assert.equal(header(calls[0]!, 'X-Company-Id'), '7')
  assert.equal(header(calls[0]!, 'If-Match'), 'W/"1"')
  assert.equal(header(calls[0]!, 'Idempotency-Key'), 'k-1')
  assert.equal(calls[0]!.init.body, '{"name":"x"}')
})

test('omits empty query values and the company header when not company-scoped', async () => {
  const { c, calls } = client(() => json(200, { data: [] }))
  c.setCompany(7)
  await c.request('GET', '/parties', { query: { type: 'customer', q: '', status: undefined, page: 2 } })
  assert.equal(calls[0]!.url, '/api/v1/parties?type=customer&page=2')
  await c.request('GET', '/me', { company: false })
  assert.equal(header(calls[1]!, 'X-Company-Id'), undefined)
})

test('an expired token is refreshed once and the request retried', async () => {
  const { c, calls } = client((call) => {
    if (call.url.endsWith('/auth/refresh')) return json(200, { data: { access_token: 'new', token_type: 'Bearer', expires_in: 900 } })
    return header(call, 'Authorization') === 'Bearer new' ? json(200, { data: 'ok' }) : problem(401, 'token_expired')
  })
  c.setAccessToken('old')
  const r = await c.request<{ data: string }>('GET', '/me')
  assert.equal(r.data.data, 'ok')
  assert.deepEqual(calls.map((x) => x.url), ['/api/v1/me', '/api/v1/auth/refresh', '/api/v1/me'])
  assert.equal((calls[1]!.init.headers as Record<string, string>)['X-Requested-With'], 'XMLHttpRequest')
})

test('concurrent requests share a single refresh', async () => {
  let refreshes = 0
  const { c } = client(async (call) => {
    if (call.url.endsWith('/auth/refresh')) { refreshes++; await new Promise((r) => setTimeout(r, 10)); return json(200, { data: { access_token: 'new' } }) }
    return header(call, 'Authorization') === 'Bearer new' ? json(200, { data: 1 }) : problem(401, 'token_expired')
  })
  c.setAccessToken('old')
  await Promise.all([c.request('GET', '/a'), c.request('GET', '/b'), c.request('GET', '/c')])
  assert.equal(refreshes, 1)
})

test('when refresh fails the session ends and the 401 is raised', async () => {
  const { c } = client((call) => (call.url.endsWith('/auth/refresh') ? problem(401, 'refresh_token_invalid') : problem(401, 'token_expired')))
  let ended = 0
  c.onSessionEnded = () => { ended++ }
  c.setAccessToken('old')
  await assert.rejects(c.request('GET', '/me'), (e: unknown) => e instanceof ApiError && e.code === 'token_expired')
  assert.equal(ended, 1)
  assert.equal(c.hasAccessToken(), false)
})

test('problem details become ApiError with field errors and Retry-After', async () => {
  const { c } = client(() => problem(422, 'validation_failed', { errors: { mobile: ['Mobile numbers have 11 digits starting 01'] } }))
  await assert.rejects(c.request('POST', '/parties', { body: {} }), (e: unknown) => {
    assert.ok(e instanceof ApiError)
    assert.equal(e.status, 422)
    assert.deepEqual(e.fieldErrors, { mobile: ['Mobile numbers have 11 digits starting 01'] })
    assert.equal(e.problem.request_id, 'r-1')
    return true
  })
  const { c: c2 } = client(() => problem(429, 'rate_limited', {}))
  const throttled = client(() => new Response(JSON.stringify({ title: 't', status: 429, code: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '840' } }))
  await assert.rejects(throttled.c.request('POST', '/auth/login', { noRefresh: true }), (e: unknown) => e instanceof ApiError && e.retryAfter === 840)
  await assert.rejects(c2.request('GET', '/x'), (e: unknown) => e instanceof ApiError && e.code === 'rate_limited')
})

test('non-JSON failures and network errors are still typed', async () => {
  const { c } = client(() => new Response('<html>bad gateway</html>', { status: 502 }))
  await assert.rejects(c.request('GET', '/x'), (e: unknown) => e instanceof ApiError && e.code === 'server_error' && e.status === 502)
  const offline = new ApiClient('/api/v1', (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch)
  await assert.rejects(offline.request('GET', '/x'), (e: unknown) => e instanceof ApiError && e.code === 'network_error')
})

test('a company 2-step requirement calls onTwoFactorRequired; a wrong 2-step code does not end the session', async () => {
  const { c } = client((call) => call.url.includes('/parties') || (call.url.endsWith('/me/two-factor') && call.init.method === 'DELETE')
    ? problem(403, 'two_factor_required_by_company')
    : problem(401, 'two_factor_failed'))
  let required = 0
  let ended = 0
  c.onTwoFactorRequired = () => { required++ }
  c.onSessionEnded = () => { ended++ }
  c.setAccessToken('tok')
  c.setCompany(7)
  await assert.rejects(c.request('GET', '/parties'), (e: unknown) => e instanceof ApiError && e.code === 'two_factor_required_by_company')
  assert.equal(required, 1)
  // Refusing to turn 2-step off (not company-scoped) is not a sign-in problem
  await assert.rejects(c.request('DELETE', '/me/two-factor', { company: false, body: { password: 'x' } }), (e: unknown) => e instanceof ApiError && e.code === 'two_factor_required_by_company')
  assert.equal(required, 1)
  await assert.rejects(c.request('POST', '/me/two-factor/confirm', { body: { code: '000000' } }), (e: unknown) => e instanceof ApiError && e.code === 'two_factor_failed')
  assert.equal(ended, 0)
  assert.equal(c.hasAccessToken(), true)
})
