import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Ledger, Lookup, LookupInput, PageMeta, Product, ProductInput, StockMovement, TaxRule, UnitInput, Warehouse, WarehouseInput } from './contract.gen'

/**
 * Inventory masters data access (05 Inventory tag, backlog P3.2-FE-01): units, tax rules, product categories, stock
 * groups, warehouses and products. Keys sit under ['company', cid, …] (08 §8). Lookups are cached for 5 minutes;
 * product mutations refresh products, warehouse mutations refresh warehouses (and products, whose stock levels
 * list every warehouse), tree mutations refresh their tree.
 */
export type TreeKind = 'product-categories' | 'stock-groups'
export interface StockMovementFilters {
  q?: string; movement_type?: string; warehouse_id?: number; product_id?: number; date_from?: string; date_to?: string; sort?: string; page?: number; per_page?: number
}
export interface ProductListFilters {
  q?: string; item_type?: string; category_id?: number; warehouse_id?: number; stock_status?: string; active?: string
  sort?: string; page?: number; per_page?: number
}

const keys = {
  units: (cid: number | null) => ['company', cid, 'units'] as const,
  taxRules: (cid: number | null) => ['company', cid, 'tax-rules'] as const,
  tree: (cid: number | null, kind: TreeKind) => ['company', cid, kind] as const,
  warehouses: (cid: number | null) => ['company', cid, 'warehouses'] as const,
  warehouse: (cid: number | null, id: number) => ['company', cid, 'warehouses', id] as const,
  products: (cid: number | null) => ['company', cid, 'products'] as const,
  productList: (cid: number | null, f: ProductListFilters) => ['company', cid, 'products', 'list', f] as const,
  product: (cid: number | null, id: number) => ['company', cid, 'products', id] as const,
}

const LOOKUP = 5 * 60_000
const notFoundRetry = (n: number, e: unknown) => (e as { status?: number }).status !== 404 && n < 2

// ---------------------------------------------------------------- units and tax rules

export function useUnits() {
  return useQuery({
    queryKey: keys.units(api.getCompany()),
    queryFn: async () => (await api.request<{ data: Lookup[]; meta: PageMeta }>('GET', '/units', { query: { per_page: 100 } })).data.data,
    staleTime: LOOKUP,
  })
}

/** D2 "Add unit…" (POST /units): the new unit appears in the select straight away. */
export function useCreateUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UnitInput) => (await api.request<{ data: Lookup }>('POST', '/units', { body: input })).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.units(api.getCompany()) }),
  })
}

/** Read only until Settings K6 (P15) can create them. */
export function useTaxRules() {
  return useQuery({
    queryKey: keys.taxRules(api.getCompany()),
    queryFn: async () => (await api.request<{ data: TaxRule[]; meta: PageMeta }>('GET', '/tax-rules')).data.data,
    staleTime: LOOKUP,
  })
}

// ---------------------------------------------------------------- category and stock-group trees

/** The whole tree, parent-first (the API flattens it), for the D5/D6 pages and the D2 selects. */
export function useTree(kind: TreeKind) {
  return useQuery({
    queryKey: keys.tree(api.getCompany(), kind),
    queryFn: async () => (await api.request<{ data: Lookup[]; meta: PageMeta }>('GET', `/${kind}`, { query: { per_page: 100 } })).data.data,
    staleTime: LOOKUP,
  })
}

export function useTreeMutations(kind: TreeKind) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: keys.tree(api.getCompany(), kind) })
  return {
    create: useMutation({
      mutationFn: async (input: LookupInput) => (await api.request<{ data: Lookup }>('POST', `/${kind}`, { body: input })).data.data,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, input }: { id: number; input: Partial<LookupInput> }) =>
        (await api.request<{ data: Lookup }>('PATCH', `/${kind}/${id}`, { body: input })).data.data,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => { await api.request<void>('DELETE', `/${kind}/${id}`) },
      onSuccess: refresh,
    }),
  }
}

export const useCategories = () => useTree('product-categories')
export const useCategoryMutations = () => useTreeMutations('product-categories')
export const useStockGroups = () => useTree('stock-groups')
export const useStockGroupMutations = () => useTreeMutations('stock-groups')

// ---------------------------------------------------------------- warehouses

export function useWarehouses() {
  return useQuery({
    queryKey: keys.warehouses(api.getCompany()),
    queryFn: async () => (await api.request<{ data: Warehouse[]; meta: PageMeta }>('GET', '/warehouses')).data.data,
    staleTime: LOOKUP,
  })
}

export function useWarehouse(id: number) {
  return useQuery({
    queryKey: keys.warehouse(api.getCompany(), id),
    queryFn: async ({ signal }) => {
      const r = await api.request<{ data: Warehouse }>('GET', `/warehouses/${id}`, { signal })
      return { warehouse: r.data.data, etag: r.meta.etag }
    },
    retry: notFoundRetry,
    enabled: id > 0,
  })
}

/**
 * Inventory ledgers (code and name) for the D7 "Ledger" column. The chart (GET /ledgers by kind) needs
 * accounting.view, so roles without it get no codes (`enabled` false) and the column is hidden.
 */
export function useInventoryLedgers(enabled: boolean) {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'ledgers', 'inventory'],
    queryFn: async () => (await api.request<{ data: Ledger[]; meta: PageMeta }>('GET', '/ledgers', { query: { kind: 'inventory', per_page: 100 } })).data.data,
    staleTime: LOOKUP,
    enabled,
  })
}

function useWarehouseRefresh() {
  const qc = useQueryClient()
  return () => {
    const cid = api.getCompany()
    void qc.invalidateQueries({ queryKey: keys.warehouses(cid) })
    void qc.invalidateQueries({ queryKey: keys.products(cid) })
    void qc.invalidateQueries({ queryKey: ['company', cid, 'ledgers'] }) // a new warehouse may create a 1301-NN ledger
  }
}

export function useCreateWarehouse() {
  const refresh = useWarehouseRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: WarehouseInput; idempotencyKey: string }) =>
      (await api.request<{ data: Warehouse }>('POST', '/warehouses', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useUpdateWarehouse() {
  const refresh = useWarehouseRefresh()
  return useMutation({
    mutationFn: async ({ id, input, version }: { id: number; input: Partial<WarehouseInput>; version: number }) =>
      (await api.request<{ data: Warehouse }>('PATCH', `/warehouses/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

// ---------------------------------------------------------------- products

export function useProducts(f: ProductListFilters) {
  return useQuery({
    queryKey: keys.productList(api.getCompany(), f),
    queryFn: async ({ signal }) => (await api.request<{ data: Product[]; meta: PageMeta }>('GET', '/products', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: keys.product(api.getCompany(), id),
    queryFn: async ({ signal }) => {
      const r = await api.request<{ data: Product }>('GET', `/products/${id}`, { signal })
      return { product: r.data.data, etag: r.meta.etag }
    },
    retry: notFoundRetry,
    enabled: id > 0,
  })
}

function useProductRefresh() {
  const qc = useQueryClient()
  return () => {
    const cid = api.getCompany()
    void qc.invalidateQueries({ queryKey: keys.products(cid) })
    // Counts on the category/stock-group pages and warehouse figures include products.
    void qc.invalidateQueries({ queryKey: keys.tree(cid, 'product-categories') })
    void qc.invalidateQueries({ queryKey: keys.tree(cid, 'stock-groups') })
    void qc.invalidateQueries({ queryKey: keys.warehouses(cid) })
  }
}

export function useCreateProduct() {
  const refresh = useProductRefresh()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: ProductInput; idempotencyKey: string }) =>
      (await api.request<{ data: Product }>('POST', '/products', { body: input, idempotencyKey })).data.data,
    onSuccess: refresh,
  })
}

export function useUpdateProduct(id: number) {
  const refresh = useProductRefresh()
  return useMutation({
    mutationFn: async ({ input, version }: { input: Partial<ProductInput>; version: number }) =>
      (await api.request<{ data: Product }>('PATCH', `/products/${id}`, { body: input, ifMatch: `W/"${version}"` })).data.data,
    onSuccess: refresh,
  })
}

export function useDeleteProduct(id: number) {
  const refresh = useProductRefresh()
  return useMutation({
    mutationFn: async () => { await api.request<void>('DELETE', `/products/${id}`) },
    onSuccess: refresh,
  })
}

// ---------------------------------------------------------------- stock ledger

/** GET /stock-movements (D9): newest first; unit cost and value only come back with inventory.view_costs (BR-052). */
export function useStockMovements(f: StockMovementFilters) {
  return useQuery({
    queryKey: ['company', api.getCompany(), 'stock-movements', f],
    queryFn: async ({ signal }) => (await api.request<{ data: StockMovement[]; meta: PageMeta }>('GET', '/stock-movements', { query: { ...f }, signal })).data,
    placeholderData: keepPreviousData,
  })
}
