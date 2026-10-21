import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../../src/api/client'
import { applyProblemToForm } from '../../src/lib/forms'

const v422 = (errors: Record<string, string[]>) =>
  new ApiError({ title: 'The request has invalid fields', status: 422, code: 'validation_failed', errors })

function recorder() {
  const calls: Array<{ name: string; message: string; focus?: boolean }> = []
  return { calls, setError: (name: string, e: { message: string }, o?: { shouldFocus: boolean }) => { calls.push({ name, message: e.message, focus: o?.shouldFocus }) } }
}

test('maps API fields to form fields, focuses only the first, and returns the rest for the summary', () => {
  const { calls, setError } = recorder()
  const r = applyProblemToForm(v422({ mobile: ['Enter a mobile number'], payment_term_id: ['Choose a term'], ledger_id: ['Not allowed'] }),
    setError, { payment_term_id: 'terms' }, ['mobile'])
  assert.deepEqual(calls, [
    { name: 'mobile', message: 'Enter a mobile number', focus: true },
    { name: 'terms', message: 'Choose a term', focus: false },
  ])
  assert.deepEqual(r, { applied: ['mobile', 'terms'], unmatched: ['Not allowed'] })
})

test('nested dot paths match wildcard field patterns', () => {
  const { calls, setError } = recorder()
  const r = applyProblemToForm(v422({ 'lines.1.quantity': ['Must be more than 0'], 'lines.1.discount': ['Too high'] }), setError, {}, ['lines.*.quantity'])
  assert.deepEqual(calls.map((c) => c.name), ['lines.1.quantity'])
  assert.deepEqual(r?.unmatched, ['Too high'])
})

test('anything but a 422 with field errors is left to the caller', () => {
  const { calls, setError } = recorder()
  assert.equal(applyProblemToForm(new ApiError({ title: 'x', status: 409, code: 'version_conflict' }), setError), null)
  assert.equal(applyProblemToForm(v422({}), setError), null)
  assert.equal(applyProblemToForm(new Error('boom'), setError), null)
  assert.equal(calls.length, 0)
})
