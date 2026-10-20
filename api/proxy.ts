/**
 * Vercel Edge Function: forwards /api/* from the Vercel domain to the backend (backlog P0.6-FE-02).
 * vercel.json rewrites /api/:__path* → /api/proxy?__path=:__path*. Vercel also appends every captured segment as a
 * query parameter under its own name, so the segment is called __path and removed here (the API rejects unknown
 * query parameters with 422). The backend address comes from BACKEND_ORIGIN
 * (the current Cloudflare tunnel URL; scripts/point-backend.sh changes it), so a new tunnel needs no code change.
 * The browser only ever talks to the Vercel domain: the refresh cookie stays first-party (SameSite=Strict).
 * X-LF-Proxy-Secret proves to the backend that this proxy set X-Forwarded-For/-Host (backend P0.3-BE-02).
 */
export const config = { runtime: 'edge' }

/** Request headers never forwarded as sent: hop-by-hop, and the ones only this proxy may set. */
const DROP_REQUEST = ['host', 'connection', 'content-length', 'x-lf-proxy-secret', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-forwarded-port', 'forwarded', 'x-real-ip', 'x-vercel-trusted-oidc-idp-token']
/** fetch() already decoded the body, so these would make the browser decode it a second time. */
const DROP_RESPONSE = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']

export default async function handler(req: Request): Promise<Response> {
  const origin = process.env.BACKEND_ORIGIN
  if (!origin) return problem(503, 'backend_unconfigured', 'The backend address is not configured.')

  const inUrl = new URL(req.url)
  const path = (inUrl.searchParams.get('__path') ?? '').replace(/^\/+/, '')
  inUrl.searchParams.delete('__path') // removes every copy Vercel added
  const target = `${origin.replace(/\/+$/, '')}/api/${path}${inUrl.search}`

  const headers = new Headers()
  req.headers.forEach((v, k) => { if (!DROP_REQUEST.includes(k.toLowerCase())) headers.set(k, v) })
  const clientIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || ''
  if (clientIp) headers.set('x-forwarded-for', clientIp)
  headers.set('x-forwarded-host', inUrl.host)
  headers.set('x-forwarded-proto', 'https')
  headers.set('x-lf-proxy-secret', process.env.PROXY_SHARED_SECRET ?? '')

  let res: Response
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      redirect: 'manual',
      // @ts-expect-error streaming request bodies need duplex in the edge/undici fetch
      duplex: 'half',
    })
  } catch {
    return problem(502, 'backend_unreachable', 'The LedgerFlow server is offline. Try again in a minute.')
  }
  // Cloudflare answers 530 (or 502–504) when the tunnel behind BACKEND_ORIGIN is gone.
  if ([502, 503, 504, 530].includes(res.status) && !(res.headers.get('content-type') ?? '').includes('json')) {
    return problem(502, 'backend_unreachable', 'The LedgerFlow server is offline. Try again in a minute.')
  }

  const out = new Headers()
  res.headers.forEach((v, k) => { if (!DROP_RESPONSE.includes(k) && k !== 'set-cookie') out.set(k, v) })
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c) // keep every cookie separate
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out })
}

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title, status, code }),
    { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } })
}
