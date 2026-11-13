import type { DocumentCalculation, PostingCheck } from '../../api/contract.gen'

/** Pure helpers of the Checks before posting panel (PEP-480): order, verdict line, blocking checks. They count rows; nothing is decided here. */

export type CheckStatus = PostingCheck['status']

const ORDER: Record<CheckStatus, number> = { block: 0, warn: 1, pass: 2 }
export const CHECK_ICON: Record<CheckStatus, string> = { block: 'circle-alert', warn: 'triangle-alert', pass: 'circle-check' }
/** Said before each label for screen readers and shown as a small tag, so the status never rests on colour alone. */
export const CHECK_STATUS_TEXT: Record<CheckStatus, string> = { block: 'Stops posting', warn: 'Needs attention', pass: 'Passed' }

const things = (n: number) => (n === 1 ? '1 thing' : `${n} things`)

/** Checks ordered for reading: what stops posting first, then what needs attention, then what passed (server order within each). */
export function sortChecks(checks: PostingCheck[]): PostingCheck[] {
  return checks.map((c, i) => ({ c, i })).sort((a, b) => ORDER[a.c.status] - ORDER[b.c.status] || a.i - b.i).map((x) => x.c)
}

/** The one-line verdict over a set of checks; it counts rows only, the wording of each check is the server's. */
export function checksSummary(checks: PostingCheck[]): { status: CheckStatus; text: string; detail: string } {
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length
  const [block, warn, pass] = [count('block'), count('warn'), count('pass')]
  if (block) {
    return { status: 'block', text: `${things(block)} will stop posting`,
      detail: warn ? `${warn} more ${warn === 1 ? 'needs' : 'need'} attention` : 'Fix it, then post' }
  }
  if (warn) return { status: 'warn', text: `${things(warn)} ${warn === 1 ? 'needs' : 'need'} attention`, detail: 'You can still post' }
  return { status: 'pass', text: 'Ready to post', detail: pass === 1 ? '1 check passed' : `All ${pass} checks passed` }
}

/** The checks that will make the server refuse the post (shown again in the PostDialog). */
export function blockingChecks(calc: DocumentCalculation | null | undefined): PostingCheck[] {
  return (calc?.checks ?? []).filter((c) => c.status === 'block')
}
