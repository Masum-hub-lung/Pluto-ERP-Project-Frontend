/** Shared helpers for the end-to-end tests (run by scripts/run-e2e.sh). */
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { chromium } from 'playwright'

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8000'
export const PASSWORD = process.env.E2E_PASSWORD
if (!PASSWORD) throw new Error('Set E2E_PASSWORD (the password scripts/run-e2e.sh gave the test users)')
export const OWNER = 'owner@e2e.ledgerflow.test'
export const VIEWER = 'viewer@e2e.ledgerflow.test'
export const STORE = 'store@e2e.ledgerflow.test'

export const launch = () => chromium.launch()

/** A fresh browser context; collects page errors, console errors and (for diagnosis) non-2xx API answers. */
export async function newPage(browser, contextOptions = {}) {
  const context = await browser.newContext({ baseURL: BASE, ...contextOptions })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('response', async (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) console.log(`  [api] ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()} ${(await r.text().catch(() => '')).slice(0, 300)}`)
  })
  return { context, page, errors }
}

/** Step 1 of sign-in; waits for the customer list unless `expect2fa` (then the code step must appear). */
export async function signIn(page, email, { expect2fa = false } = {}) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  if (expect2fa) await page.getByRole('heading', { name: '2-step verification' }).waitFor()
  else await page.waitForURL(/\/customers/)
}

export async function signOut(page) {
  await page.getByTestId('profile-menu').click()
  await page.getByRole('menuitem', { name: /Sign out/ }).click()
  await page.waitForURL(/\/sign-in/)
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for a base32 secret, `offset` steps from now - what an authenticator app shows. */
export function totp(base32Secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of base32Secret.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + offset))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 0x0f
  const v = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(v % 1_000_000).padStart(6, '0')
}

/**
 * Runs one SQL statement on the E2E database (DB_* come from scripts/run-e2e.sh). Only for state the UI of this
 * release cannot set, such as the company-wide 2-step requirement (K14 Owner switch, Settings module).
 */
export function sql(statement) {
  const php = '$p=new PDO("mysql:host=".getenv("DB_HOST").";port=".getenv("DB_PORT").";dbname=".getenv("DB_DATABASE"),getenv("DB_USERNAME"),getenv("DB_PASSWORD"));$p->exec($argv[1]);'
  execFileSync('php', ['-r', php, statement], { stdio: 'inherit' })
}
