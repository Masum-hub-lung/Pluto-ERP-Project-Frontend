import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { SalesInvoice } from '../../api/contract.gen'
import { downloadInvoicePdf, fetchInvoicePdf, useInvoice, usePostInvoice, type InvoiceVariant } from '../../api/sales'
import { useToast } from '../../app/toast'
import { useSession } from '../../auth/session'
import { ds } from '../../ds'
import { useIdempotencyKey } from '../../lib/useIdempotencyKey'
import { PHONE, useMediaQuery } from '../../lib/useMediaQuery'
import { PostDialog } from '../../components/document/PostDialog'
import { PageSkeleton } from '../../components/PageSkeleton'
import { ProblemBanner } from '../../components/ProblemBanner'
import { NotFound } from '../../components/states'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

/**
 * E4 Invoice preview (Sal-Preview.dc.html; backlog P5.2-FE-05): the A4 PDF exactly as the customer gets it. The PDF
 * endpoint needs the Bearer token, so it is fetched into a blob URL and shown in an <iframe>. Bar: back to the draft
 * (or the details), Invoice / Delivery challan, Download, Print (opens the PDF in a new tab for the browser's print),
 * and Post for a draft. Phone browsers do not show a PDF inside a page, so phones get an "Open the PDF" card instead.
 */
export function InvoicePreview() {
  const id = Number(useParams().id)
  const invoice = useInvoice(id)
  if (invoice.error instanceof ApiError && invoice.error.status === 404) return <NotFound what="this invoice" back="/sales/invoices" backLabel="Sales invoices" />
  if (invoice.error) return <ProblemBanner error={invoice.error} onRetry={() => void invoice.refetch()} />
  if (!invoice.data) return <PageSkeleton template="detail" />
  return <Preview inv={invoice.data} />
}

function Preview({ inv }: { inv: SalesInvoice }) {
  const { Button, Segmented, Badge, Skeleton, EmptyState } = ds()
  const phone = useMediaQuery(PHONE)
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useSession()
  const post = usePostInvoice(inv.id)
  const postIdem = useIdempotencyKey()
  const [variant, setVariant] = useState<InvoiceVariant>('invoice')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [posting, setPosting] = useState(false)

  // Re-fetch when the variant or the invoice version changes (posting adds the posted state to the PDF).
  useEffect(() => {
    const ctrl = new AbortController()
    let objectUrl: string | null = null
    setUrl(null); setError(null)
    fetchInvoicePdf(inv.id, variant, ctrl.signal)
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) })
      .catch((e: unknown) => { if (!ctrl.signal.aborted) setError(e) })
    return () => { ctrl.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [inv.id, inv.version, variant, attempt])

  const back = inv.status === 'draft' && can('sales.edit') ? `/sales/invoices/${inv.id}/edit` : `/sales/invoices/${inv.id}`
  const download = () => downloadInvoicePdf(inv.id, inv.number, variant).catch((e: unknown) => setError(e))
  const print = () => { if (url) window.open(url, '_blank', 'noopener') }

  async function doPost(confirmBackdated: boolean) {
    const r = await post.mutateAsync({ body: { confirm_backdated: confirmBackdated || undefined }, idempotencyKey: postIdem.key })
    postIdem.reset()
    setPosting(false)
    toast({ tone: 'positive', title: `${r.number} posted`, description: 'Stock and the customer balance are updated.' })
    navigate(`/sales/invoices/${r.id}`)
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }} data-testid="preview-bar">
        <Button variant="ghost" icon="arrow-left" onClick={() => navigate(back)}>{inv.status === 'draft' ? 'Back to edit' : 'Back to invoice'}</Button>
        <Badge tone="accent">Preview</Badge>
        <strong className="lf-code" data-testid="preview-number">{inv.number}</strong>
        <InvoiceStatusBadge invoice={inv} />
        <span style={{ flex: 1 }} />
        <Segmented size="sm" value={variant} onChange={(v) => setVariant(v as InvoiceVariant)}
          options={[{ value: 'invoice', label: 'Invoice' }, { value: 'challan', label: 'Delivery challan' }]} />
        <Button variant="secondary" icon="download" onClick={() => void download()} data-testid="preview-download">PDF</Button>
        <Button variant="secondary" icon="printer" disabled={!url} onClick={print} data-testid="preview-print">Print</Button>
        {inv.status === 'draft' && can('sales.create') && <Button variant="primary" icon="check" onClick={() => setPosting(true)} data-testid="preview-post">Post invoice</Button>}
      </div>
      <ProblemBanner error={error} onRetry={() => setAttempt((n) => n + 1)} />
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken, var(--surface))', overflow: 'hidden' }}>
        {url && phone
          ? <div style={{ padding: 16 }} data-testid="preview-phone">
              <EmptyState icon="file-text" title={`${variant === 'challan' ? 'Delivery challan' : 'Invoice'} ${inv.number} is ready`}
                description="Your phone shows PDFs in its own viewer. Open it there, or download it." action={<Button variant="primary" onClick={print}>Open the PDF</Button>} />
            </div>
          : url
          ? <iframe title={`${variant === 'challan' ? 'Delivery challan' : 'Invoice'} ${inv.number}`} src={url} data-testid="preview-pdf"
              style={{ display: 'block', width: '100%', height: 'calc(100vh - 220px)', minHeight: 480, border: 0 }} />
          : !error && <div style={{ padding: 24 }}><Skeleton height={480} /></div>}
      </div>
      {posting && <PostDialog title={`Post ${inv.number}?`} number={inv.number} total={inv.total} loading={post.isPending} onPost={doPost} onClose={() => setPosting(false)} />}
    </>
  )
}
