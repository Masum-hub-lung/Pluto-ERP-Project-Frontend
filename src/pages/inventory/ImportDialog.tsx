import { useRef, useState } from 'react'
import { IMPORT_TEMPLATE, useProductImport } from '../../api/stock'
import type { ImportResult } from '../../api/contract.gen'
import { useToast } from '../../app/toast'
import { ds } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { ProblemBanner } from '../../components/ProblemBanner'
import { ResponsiveDialog } from '../../components/ResponsiveDialog'

/**
 * D1 Import (02 #page-d1; C-05; backlog P11.2-FE-06): download the template, choose a CSV or XLSX file, check it (dry
 * run: every row's errors, nothing saved), then import — the API creates every row or none, and opening stock posts
 * dated the financial year's start (06 §11.2).
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { Button, Banner, DataTable } = ds()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [check, setCheck] = useState<ImportResult | null>(null)
  const [error, setError] = useState<unknown>(null)
  const run = useProductImport()
  const idem = useIdempotencyKey()

  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`﻿${IMPORT_TEMPLATE.join(',')}\n`], { type: 'text/csv' }))
    a.download = 'product-import-template.csv'
    a.click()
  }
  const go = async (dryRun: boolean) => {
    if (!file) return
    setError(null)
    try {
      const r = await run.mutateAsync({ file, dryRun, idempotencyKey: dryRun ? crypto.randomUUID() : idem.key })
      if (dryRun) { setCheck(r); return }
      idem.reset()
      if ((r.created_ids ?? []).length) {
        toast({ tone: 'positive', title: `${r.created_ids!.length} item${r.created_ids!.length === 1 ? '' : 's'} imported`, description: 'Opening stock, if any, is posted.' })
        onClose()
      } else {
        setCheck(r)
      }
    } catch (e) {
      setError(e)
    }
  }
  const errors = check?.errors ?? []
  const ready = !!check && errors.length === 0 && check.valid_rows > 0

  return (
    <ResponsiveDialog title="Import products" onClose={onClose} width={640} testId="import-dialog"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="secondary" disabled={!file} loading={run.isPending && !ready} onClick={() => void go(true)} data-testid="check-import">Check file</Button>
        <Button variant="primary" disabled={!ready} loading={run.isPending && ready} onClick={() => void go(false)} data-testid="run-import">
          {ready ? `Import ${check!.valid_rows} item${check!.valid_rows === 1 ? '' : 's'}` : 'Import'}
        </Button>
      </>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
          Fill the template (one item per row; name, unit and selling price are required), then check the file. Nothing is saved until every row is right.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="ghost" size="sm" icon="download" onClick={template} data-testid="import-template">Download template</Button>
          <Button variant="secondary" size="sm" icon="upload" onClick={() => fileRef.current?.click()}>Choose file</Button>
          <span style={{ color: 'var(--ink-muted)' }} data-testid="import-file">{file?.name ?? 'No file chosen'}</span>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" hidden data-testid="import-input"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCheck(null); e.target.value = '' }} />
        </div>
        <ProblemBanner error={error} />
        {check && (errors.length === 0
          ? <Banner tone="positive" title={`${check.valid_rows} of ${check.rows} rows are ready`}>Import them when you are ready.</Banner>
          : <Banner tone="warning" title={`${errors.length} problem${errors.length === 1 ? '' : 's'} in ${check.rows - check.valid_rows} row${check.rows - check.valid_rows === 1 ? '' : 's'}`}>
              Fix them in the file and check it again.
            </Banner>)}
        {errors.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: 280 }} data-testid="import-errors">
            <DataTable caption="Rows with problems" rows={errors.map((e, i) => ({ id: i, row: e.row, column: e.column ?? '', message: e.message }))}
              columns={[{ key: 'row', label: 'Row', align: 'right' }, { key: 'column', label: 'Column' }, { key: 'message', label: 'Problem' }]} />
          </div>
        )}
      </div>
    </ResponsiveDialog>
  )
}
