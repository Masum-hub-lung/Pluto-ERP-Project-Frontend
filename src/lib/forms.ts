import { ApiError } from '../api/client'

/** The parts of React Hook Form's setError that applyProblemToForm needs (keeps it testable without RHF). */
export type SetFieldError<F extends string> = (name: F, error: { type: string; message: string }, options?: { shouldFocus: boolean }) => void

/**
 * Puts a 422's field errors (05 §3, keys are API dot paths such as `lines.1.quantity`) on the form's own fields and
 * focuses the first one. `fieldMap` maps API paths to form field names; otherwise a path is used as the form field
 * name when it matches one of `knownFields` (`*` matches one segment, e.g. `lines.*.quantity` for `lines.1.quantity`).
 * Errors without a matching field are returned for the summary.
 * Returns null when `error` is not a 422 with field errors.
 */
export function applyProblemToForm<F extends string>(
  error: unknown, setError: SetFieldError<F>, fieldMap: Partial<Record<string, F>> = {}, knownFields: readonly F[] = [],
): { applied: F[]; unmatched: string[] } | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null
  const entries = Object.entries(error.fieldErrors)
  if (entries.length === 0) return null
  const applied: F[] = []
  const unmatched: string[] = []
  for (const [path, messages] of entries) {
    const target = fieldMap[path] ?? (knownFields.some((k) => matches(k, path)) ? (path as F) : undefined)
    const message = messages[0] ?? 'Check this value'
    if (target) {
      setError(target, { type: 'server', message }, { shouldFocus: applied.length === 0 })
      applied.push(target)
    } else {
      unmatched.push(message)
    }
  }
  return { applied, unmatched }
}

function matches(pattern: string, path: string): boolean {
  const p = pattern.split('.')
  const s = path.split('.')
  return p.length === s.length && p.every((seg, i) => seg === '*' || seg === s[i])
}
