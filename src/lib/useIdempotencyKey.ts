import { useCallback, useRef } from 'react'

/**
 * One Idempotency-Key per user action (BR-050, 05 §1): reuse `key` when retrying after a failure, call `reset()`
 * only after the action succeeded, so a double click or a retry never creates the record twice.
 */
export function useIdempotencyKey() {
  const ref = useRef(crypto.randomUUID())
  const reset = useCallback(() => { ref.current = crypto.randomUUID() }, [])
  return { get key() { return ref.current }, reset }
}
