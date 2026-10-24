import { useEffect, useRef, useState } from 'react'
import type { DocumentCalculation } from '../../api/contract.gen'

/**
 * Server-side totals for a document being edited (DEC-09, 08 §7; backlog P4.4-FE-02). Every change of `input`
 * waits 300 ms, cancels the request still running and asks the API again, so the totals panel always shows the
 * server's figures for the latest input — never numbers computed here. `input` null = not enough to calculate yet
 * (no party or no valid line): the last result is cleared and nothing is sent.
 */
export function useCalculate<I>(input: I | null, calculate: (input: I, signal: AbortSignal) => Promise<DocumentCalculation>, delayMs = 300) {
  const [result, setResult] = useState<DocumentCalculation | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const key = input === null ? null : JSON.stringify(input)
  const calc = useRef(calculate)
  calc.current = calculate

  useEffect(() => {
    if (key === null) {
      setResult(null)
      setPending(false)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setPending(true)
    const timer = setTimeout(() => {
      calc.current(JSON.parse(key) as I, ctrl.signal)
        .then((r) => { setResult(r); setError(null) })
        .catch((e: unknown) => { if (!ctrl.signal.aborted) setError(e) })
        .finally(() => { if (!ctrl.signal.aborted) setPending(false) })
    }, delayMs)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [key, delayMs])

  return { result, pending, error }
}
