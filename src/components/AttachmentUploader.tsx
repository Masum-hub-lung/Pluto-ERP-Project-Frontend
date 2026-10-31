import { useRef, useState } from 'react'
import type { Attachment } from '../api/contract.gen'
import { ACCEPTED_FILES, checkFile, openAttachment, useAttachments, useDeleteAttachment, useUploadAttachment, type AttachableType } from '../api/attachments'
import { useToast } from '../app/toast'
import { ds } from '../ds'
import { useIdempotencyKey } from '../lib/useIdempotencyKey'
import { ProblemBanner } from './ProblemBanner'

/**
 * Files on a record (FR-066; BR-051; backlog P13.2-FE-01): a drop zone or "Choose file", a progress bar per upload,
 * and the list with Open (5-minute signed link) and Remove. Type and size are checked before uploading; the server
 * sniffs the content again (415 / 413 shown as the API words them).
 *  - With `recordId`: the record's files (Attachments tabs on E5, F4, H13).
 *  - Without (`pending`): uploads for an entry still being written (I3/I6); `onChange` gets the uploaded files, whose
 *    ids go in the entry's attachment_ids.
 */
export function AttachmentUploader({ type, recordId = null, canEdit = true, pending, onChange, compact = false, testId = 'attachments' }: {
  type: AttachableType; recordId?: number | null; canEdit?: boolean; pending?: Attachment[]; onChange?: (files: Attachment[]) => void; compact?: boolean; testId?: string
}) {
  const { Button, IconButton, Icon, EmptyState } = ds()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const list = useAttachments(type, recordId)
  const upload = useUploadAttachment()
  const remove = useDeleteAttachment()
  const idem = useIdempotencyKey()
  const [progress, setProgress] = useState<{ name: string; fraction: number }[]>([])
  const [error, setError] = useState<unknown>(null)
  const [refused, setRefused] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const files = recordId ? list.data ?? [] : pending ?? []

  const add = async (chosen: File[]) => {
    setError(null)
    const bad = chosen.map(checkFile).filter((m): m is string => !!m)
    setRefused(bad)
    const good = chosen.filter((f) => !checkFile(f))
    const done: Attachment[] = []
    for (const f of good) {
      setProgress((p) => [...p, { name: f.name, fraction: 0 }])
      try {
        const a = await upload.mutateAsync({ file: f, type, id: recordId, idempotencyKey: idem.key,
          onProgress: (fraction) => setProgress((p) => p.map((x) => (x.name === f.name ? { ...x, fraction } : x))) })
        idem.reset()
        done.push(a)
      } catch (e) {
        setError(e)
      } finally {
        setProgress((p) => p.filter((x) => x.name !== f.name))
      }
    }
    if (done.length) {
      if (!recordId) onChange?.([...(pending ?? []), ...done])
      toast({ tone: 'positive', title: done.length === 1 ? `${done[0].original_name} attached` : `${done.length} files attached` })
    }
  }

  const drop = async (a: Attachment) => {
    setError(null)
    try {
      await remove.mutateAsync({ id: a.id, type, recordId })
      if (!recordId) onChange?.((pending ?? []).filter((x) => x.id !== a.id))
      toast({ tone: 'positive', title: `${a.original_name} removed` })
    } catch (e) {
      setError(e)
    }
  }

  const open = async (a: Attachment) => {
    try { await openAttachment(a.id) } catch (e) { setError(e) }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid={testId}>
      <ProblemBanner error={error ?? list.error} onRetry={list.error ? () => void list.refetch() : undefined} />
      {refused.length > 0 && <ul role="alert" style={{ margin: 0, paddingLeft: 18, color: 'var(--negative)', fontSize: 14 }}>{refused.map((m) => <li key={m}>{m} Only JPG, PNG or PDF up to 10 MB.</li>)}</ul>}
      {canEdit && (
        <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void add(Array.from(e.dataTransfer.files)) }}
          style={{ border: `1px dashed ${over ? 'var(--accent, var(--ink))' : 'var(--line)'}`, borderRadius: 'var(--radius-md)', padding: compact ? 12 : 18, display: 'flex',
            flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'center', background: over ? 'var(--surface-sunken, var(--surface))' : undefined }} data-testid={`${testId}-drop`}>
          <Icon name="paperclip" size={18} />
          <span style={{ color: 'var(--ink-muted)' }}>Drop a receipt here, or</span>
          <Button variant="secondary" size="sm" icon="upload" onClick={() => input.current?.click()} data-testid={`${testId}-choose`}>Choose file</Button>
          <span style={{ color: 'var(--ink-muted)', fontSize: 13, flexBasis: '100%', textAlign: 'center' }}>JPG, PNG or PDF, up to 10 MB</span>
          <input ref={input} type="file" multiple accept={ACCEPTED_FILES} hidden data-testid={`${testId}-input`}
            onChange={(e) => { const chosen = Array.from(e.target.files ?? []); e.target.value = ''; void add(chosen) }} />
        </div>
      )}
      {progress.map((p) => (
        <div key={p.name} style={{ display: 'grid', gap: 4 }} aria-live="polite">
          <span style={{ fontSize: 13 }}>Uploading {p.name}… {Math.round(p.fraction * 100)} %</span>
          <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.round(p.fraction * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${p.name}`}>
            <div style={{ width: `${p.fraction * 100}%`, height: '100%', background: 'var(--accent, var(--ink))', transition: 'width 120ms linear' }} />
          </div>
        </div>
      ))}
      {files.length === 0 && progress.length === 0 && !compact && (recordId ? !list.isPending : true) && (
        <EmptyState icon="paperclip" title="No files yet" description={canEdit ? 'Attach the bill, receipt or any document that supports this entry.' : 'Files attached here show up for everyone who can see the record.'} />
      )}
      {files.length === 0 && compact && !canEdit && (recordId ? !list.isPending : true) && <span style={{ color: 'var(--ink-muted)' }}>No files attached.</span>}
      {files.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }} data-testid={`${testId}-list`}>
          {files.map((a) => (
            <li key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', minWidth: 0 }}>
              <Icon name={a.mime_type === 'application/pdf' ? 'file-text' : 'image'} size={18} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <button type="button" className="lf-link" onClick={() => void open(a)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink)', font: 'inherit',
                  textDecoration: 'underline', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{a.original_name}</button>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{(a.size_bytes / 1024 < 1024 ? `${Math.max(1, Math.round(a.size_bytes / 1024))} KB` : `${(a.size_bytes / 1048576).toFixed(1)} MB`)} · {a.uploaded_by.name}</span>
              </div>
              <IconButton icon="external-link" label={`Open ${a.original_name}`} onClick={() => void open(a)} />
              {canEdit && <IconButton icon="trash-2" label={`Remove ${a.original_name}`} onClick={() => void drop(a)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
