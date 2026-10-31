import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Attachment, AttachmentUpload, SignedUrl } from './contract.gen'

/**
 * Attachments (FR-066; backlog P13.2-FE-01): a record's files, upload with progress, a 5-minute signed link to open
 * one, remove. A voucher still being written takes pending uploads (no id) that POST /ie-entries links. The server
 * sniffs the content and enforces BR-051 (JPG, PNG or PDF up to 10 MB); checkFile() only saves a pointless upload.
 */
const cid = () => api.getCompany()

export type AttachableType = AttachmentUpload['attachable_type']

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const ACCEPTED_FILES = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf'

/** BR-051 before upload, by type and size; the server checks the content again. Returns the message, or null. */
export function checkFile(f: File): string | null {
  const ok = ['image/jpeg', 'image/png', 'application/pdf'].includes(f.type) || /\.(jpe?g|png|pdf)$/i.test(f.name)
  if (!ok) return `${f.name} is not a JPG, PNG or PDF.`
  if (f.size > MAX_FILE_BYTES) return `${f.name} is ${(f.size / 1048576).toFixed(1)} MB; files may be up to 10 MB.`
  return null
}

const key = (type: AttachableType, id: number) => ['company', cid(), 'attachments', type, id]

export function useAttachments(type: AttachableType, id: number | null) {
  return useQuery({
    queryKey: key(type, id ?? 0),
    queryFn: async ({ signal }) => (await api.request<{ data: Attachment[] }>('GET', '/attachments', { query: { attachable_type: type, attachable_id: id }, signal })).data.data,
    enabled: !!id,
  })
}

export function useUploadAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, type, id, onProgress, idempotencyKey }: { file: File; type: AttachableType; id: number | null; onProgress?: (f: number) => void; idempotencyKey: string }) => {
      const body = new FormData()
      body.append('file', file)
      body.append('attachable_type', type)
      if (id) body.append('attachable_id', String(id))
      return (await api.request<{ data: Attachment }>('POST', '/attachments', { body, idempotencyKey, onUploadProgress: onProgress })).data.data
    },
    onSuccess: (_a, v) => {
      if (v.id) void qc.invalidateQueries({ queryKey: key(v.type, v.id) })
      void qc.invalidateQueries({ queryKey: ['company', cid(), 'income-expenses'] })
    },
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: number; type?: AttachableType; recordId?: number | null }) => { await api.request('DELETE', `/attachments/${id}`) },
    onSuccess: (_a, v) => {
      if (v.type && v.recordId) void qc.invalidateQueries({ queryKey: key(v.type, v.recordId) })
      void qc.invalidateQueries({ queryKey: ['company', cid(), 'income-expenses'] })
    },
  })
}

/** Opens the file in a new tab through its short-lived signed link (no token needed: the signature is the key). */
export async function openAttachment(id: number) {
  const tab = window.open('', '_blank') // opened before the await, so the browser does not block it
  try {
    const link = (await api.request<{ data: SignedUrl }>('GET', `/attachments/${id}/url`)).data.data.url
    if (tab) tab.location.href = link
    else window.location.assign(link)
  } catch (e) {
    tab?.close()
    throw e
  }
}
