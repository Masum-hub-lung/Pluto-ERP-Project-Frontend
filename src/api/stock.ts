import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  CountSheetPreview, ImportResult, PageMeta, StockAdjustment, StockAdjustmentInput, StockLevel, StockTransfer, StockTransferInput, TransferReceive,
} from './contract.gen'
import { documentApi } from './trade'

/**
 * Inventory completion data access (05 Inventory; backlog P11.2): stock adjustments (D10) and transfers (D11) through the
 * shared document hooks (PATCH updates), a warehouse's stock (D8), the count-sheet preview and the product import (D1).
 * The inventory reports (D12–D14) use useReport('inventory/…') from api/reports. Posting a stock document refreshes products, warehouses,
 * movements, warehouse stock and reports.
 */
export const stockAdjustments = documentApi<StockAdjustment, StockAdjustmentInput>('stock-adjustments', 'PATCH')
export const stockTransfers = documentApi<StockTransfer, StockTransferInput>('stock-transfers', 'PATCH')

/** One line of an adjustment as the API returns it (unit_cost and value only with inventory.view_costs). */
export interface AdjustmentLine {
  id: number; line_no: number; product_id: number; product_code: string; product_name: string; unit: string | null
  system_qty: string; counted_qty: string; difference_qty: string; unit_cost?: string; value?: string
}

/** One line of a transfer (available: the source's quantity on hand while a draft; unit_cost with inventory.view_costs). */
export interface TransferLine {
  id: number; line_no: number; product_id: number; product_code: string; product_name: string; unit: string | null
  quantity: string; received_quantity: string | null; available?: string; unit_cost?: string | null
}

export type { StockAdjustment, StockAdjustmentInput, StockTransfer, StockTransferInput, TransferReceive }

/** GET /warehouses/{id}/stock (D8). */
export function useWarehouseStock(id: number, f: { q?: string; below_reorder?: string; sort?: string; page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'warehouse-stock', id, f],
    queryFn: async ({ signal }) => (await api.request<{ data: StockLevel[]; meta: PageMeta }>('GET', `/warehouses/${id}/stock`, { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
    enabled: id > 0,
  })
}

/** One count-sheet line matched to a product. */
export interface CountSheetLine { row: number; product_id: number; product_code: string; product_name: string; unit: string | null; counted_qty: string; is_active: boolean }

/** POST /stock-adjustments/count-sheet: the CSV matched to products; nothing is saved. */
export function useCountSheet() {
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData()
      body.append('file', file)
      return (await api.request<{ data: CountSheetPreview }>('POST', '/stock-adjustments/count-sheet', { body })).data.data as unknown as Omit<CountSheetPreview, 'lines'> & { lines: CountSheetLine[] }
    },
  })
}

/** POST /products/import (D1): dry run first, then the real import (all rows or none). */
export function useProductImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, dryRun, idempotencyKey }: { file: File; dryRun: boolean; idempotencyKey: string }) => {
      const body = new FormData()
      body.append('file', file)
      return (await api.request<{ data: ImportResult }>('POST', '/products/import', { body, query: { dry_run: dryRun ? 'true' : undefined }, idempotencyKey })).data.data
    },
    onSuccess: (r) => {
      if (!r.dry_run && (r.created_ids ?? []).length) {
        const cid = api.getCompany()
        for (const k of ['products', 'warehouses', 'stock-movements', 'warehouse-stock', 'product-categories', 'stock-groups']) void qc.invalidateQueries({ queryKey: ['company', cid, k] })
      }
    },
  })
}

/** The columns of the import template (D1 Import): the first row of the CSV the user downloads. */
export const IMPORT_TEMPLATE = [
  'Name', 'Type', 'Code', 'Category', 'Unit', 'Barcode', 'Selling price', 'Wholesale price', 'Purchase cost', 'Tax rule', 'Stock group',
  'Preferred supplier', 'Warehouse', 'Opening qty', 'Opening cost', 'Reorder level', 'Reorder qty',
]
