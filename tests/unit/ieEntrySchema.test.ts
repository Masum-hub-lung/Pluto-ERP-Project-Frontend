import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFile } from '../../src/api/attachments'
import { emptyIeEntry, ieEntrySchema, nextDate, toIeEntryInput } from '../../src/lib/ieEntrySchema'

test('nextDate steps by week, month, quarter and year, keeping month ends inside the month', () => {
  assert.equal(nextDate('2026-10-31', 'weekly'), '2026-11-07')
  assert.equal(nextDate('2026-10-31', 'monthly'), '2026-11-30')
  assert.equal(nextDate('2026-01-31', 'monthly'), '2026-02-28')
  assert.equal(nextDate('2026-11-30', 'quarterly'), '2027-02-28')
  assert.equal(nextDate('2028-02-29', 'yearly'), '2029-02-28')
  assert.equal(nextDate('', 'monthly'), '')
})

const base = { ...emptyIeEntry('2026-10-31'), amount: '2500', category_id: '3', money_account_id: '1' }
const messages = (r: ReturnType<typeof ieEntrySchema.safeParse>) => (r.success ? [] : r.error.issues.map((i) => i.message))

test('an entry needs an amount above zero, a category and an account (BR-054)', () => {
  assert.equal(ieEntrySchema.safeParse(base).success, true)
  assert.ok(messages(ieEntrySchema.safeParse({ ...base, amount: '0.00' })).includes('Enter an amount greater than zero'))
  assert.ok(messages(ieEntrySchema.safeParse({ ...base, category_id: '' })).includes('Choose a category'))
})

test('the recurrence is checked only when it is on', () => {
  assert.equal(ieEntrySchema.safeParse({ ...base, next_run_on: '' }).success, true)
  const r = ieEntrySchema.safeParse({ ...base, recurring: true, next_run_on: '2026-10-31', ends_type: 'after_count', ends_after_count: '' })
  assert.deepEqual(r.success ? [] : r.error.issues.map((i) => i.path.join('.')), ['next_run_on', 'ends_after_count'])
})

test('the API input keeps the amount as typed (trimmed) and links the uploads', () => {
  const i = toIeEntryInput('expense', { ...base, amount: ' 2500.50 ', payee_text: ' ', recurring: true, next_run_on: '2026-11-30' }, [7])
  assert.equal(i.amount, '2500.50')
  assert.deepEqual([i.category_id, i.money_account_id, i.payee_text, i.attachment_ids], [3, 1, null, [7]])
  assert.deepEqual(i.recurrence, { frequency: 'monthly', next_run_on: '2026-11-30', ends_type: 'never', ends_after_count: null, ends_on: null })
  assert.equal(toIeEntryInput('income', base, []).recurrence, null)
})

test('checkFile accepts JPG, PNG and PDF up to 10 MB before uploading (BR-051)', () => {
  const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type })
  assert.equal(checkFile(file('receipt.pdf', 'application/pdf', 1000)), null)
  assert.equal(checkFile(file('photo.JPG', '', 1000)), null)
  assert.match(checkFile(file('setup.exe', 'application/x-msdownload', 10)) ?? '', /not a JPG, PNG or PDF/)
  assert.match(checkFile(file('scan.pdf', 'application/pdf', 11 * 1024 * 1024)) ?? '', /11\.0 MB; files may be up to 10 MB/)
})
