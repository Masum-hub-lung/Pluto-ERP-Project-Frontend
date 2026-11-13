import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DocumentCalculation, PostingCheck } from '../../src/api/contract.gen'
import { blockingChecks, checksSummary, sortChecks } from '../../src/components/document/checks'

const c = (key: PostingCheck['key'], status: PostingCheck['status'], line_no?: number): PostingCheck => ({ key, status, label: `${key} ${status}`, line_no })

test('checks are ordered block, warn, pass and keep the server order inside each', () => {
  const sorted = sortChecks([c('period_open', 'pass'), c('credit_limit', 'warn'), c('stock', 'block', 2), c('backdated', 'pass'), c('stock', 'block', 1)])
  assert.deepEqual(sorted.map((x) => `${x.key}:${x.line_no ?? ''}`), ['stock:2', 'stock:1', 'credit_limit:', 'period_open:', 'backdated:'])
})

test('the verdict line names the worst status and counts its rows', () => {
  assert.deepEqual(checksSummary([c('period_open', 'pass'), c('backdated', 'pass')]), { status: 'pass', text: 'Ready to post', detail: 'All 2 checks passed' })
  assert.equal(checksSummary([c('period_open', 'pass')]).detail, '1 check passed')
  assert.deepEqual(checksSummary([c('credit_limit', 'warn'), c('party_overdue', 'warn'), c('period_open', 'pass')]),
    { status: 'warn', text: '2 things need attention', detail: 'You can still post' })
  assert.equal(checksSummary([c('credit_limit', 'warn')]).text, '1 thing needs attention')
  assert.deepEqual(checksSummary([c('stock', 'block', 1), c('credit_limit', 'warn')]),
    { status: 'block', text: '1 thing will stop posting', detail: '1 more needs attention' })
  assert.equal(checksSummary([c('stock', 'block'), c('period_open', 'block')]).text, '2 things will stop posting')
})

test('blocking checks of a calculation; none without checks', () => {
  assert.deepEqual(blockingChecks(null), [])
  assert.deepEqual(blockingChecks({} as DocumentCalculation), [])
  assert.deepEqual(blockingChecks({ checks: [c('period_open', 'pass'), c('stock', 'block', 1)] } as DocumentCalculation).map((x) => x.key), ['stock'])
})
