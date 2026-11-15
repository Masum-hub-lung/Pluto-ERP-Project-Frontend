/**
 * Pluto plan modules (PEP-498). A company's plan may leave out LC management or LC finance; the API then answers
 * 403 module_not_in_plan, and the app hides those parts instead of offering them. `Me.modules` is the effective list
 * the server works out (plan + the company's exceptions). Without the field (an older API) everything is shown.
 */
export type ModuleKey = 'lc_management' | 'lc_finance'

export const MODULE_LABELS: Record<ModuleKey, string> = { lc_management: 'LC management', lc_finance: 'LC finance' }

/** Pseudo-permission for `can()`: `can(modulePermission('lc_finance'))` is true when the plan includes it. */
export const modulePermission = (m: ModuleKey) => `module:${m}`

export function hasModule(modules: readonly string[] | null | undefined, m: ModuleKey): boolean {
  if (!modules) return true
  if (m === 'lc_finance' && !modules.includes('lc_management')) return false
  return modules.includes(m)
}

/** The module a company permission belongs to (all `lc.*` permissions are LC management). */
export function moduleForPermission(permission: string): ModuleKey | null {
  return permission.startsWith('lc.') ? 'lc_management' : null
}

const FINANCE_PATHS = ['/lc/banks', '/lc/loans', '/lc/fx-revaluation']

/** The module an app path needs: LC finance pages live inside the LC portal (/lc/banks, /lc/loans, /lc/fx-revaluation). */
export function moduleForPath(path: string): ModuleKey | null {
  const p = path.split(/[?#]/)[0]!
  if (FINANCE_PATHS.some((f) => p === f || p.startsWith(`${f}/`))) return 'lc_finance'
  return p === '/lc' || p.startsWith('/lc/') ? 'lc_management' : null
}
