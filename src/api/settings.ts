import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  Backup, Branch, BranchInput, Company, CompanyCreate, CompanySettings, CompanySettingsUpdate, CompanyUpdate, Invitation, InvitationCreate, InvitationPublic,
  LoginResponse, Member, MemberUpdate, NotificationPreferences, NumberSequence, PageMeta, PermissionList, Role, RoleInput, Session, SignedUrl, TaxRule,
  TaxRuleInput, UserPreferences,
} from './contract.gen'

/**
 * Settings, users and security (K1–K15, S0, S2, S3; 05 Company, Users and roles, Me, Platform; backlog P15.2-FE-*).
 * Company-scoped keys hang off ['company', cid, …]; the user's own account (sessions, appearance) is not scoped.
 * Edits send If-Match with the version the page loaded (BR-049); a 409 keeps the user's input (ConflictBanner).
 */
const k = (...rest: unknown[]) => ['company', api.getCompany(), ...rest] as const
const list = <T>(r: { data: { data: T[]; meta: PageMeta } }) => r.data.data
const v = (version: number) => `W/"${version}"`

function useInvalidate() {
  const qc = useQueryClient()
  return (...keys: unknown[][]) => Promise.all(keys.map((key) => qc.invalidateQueries({ queryKey: key })))
}

// ---------------------------------------------------------------- company, locations, settings (K1–K7)

export function useCompany() {
  return useQuery({ queryKey: k('company-profile'), queryFn: async () => (await api.request<{ data: Company }>('GET', '/company')).data.data })
}

export function useUpdateCompany() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ input, version }: { input: CompanyUpdate; version: number }) =>
      (await api.request<{ data: Company }>('PATCH', '/company', { body: input, ifMatch: v(version) })).data.data,
    onSuccess: () => inv([...k('company-profile')]),
  })
}

export function useUploadLogo() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ file, version }: { file: File; version: number }) => {
      const body = new FormData()
      body.append('file', file)
      return (await api.request<{ data: Company }>('PUT', '/company/logo', { body, ifMatch: v(version) })).data.data
    },
    onSuccess: () => inv([...k('company-profile')]),
  })
}

export function useRemoveLogo() {
  const inv = useInvalidate()
  return useMutation({ mutationFn: async () => { await api.request<void>('DELETE', '/company/logo') }, onSuccess: () => inv([...k('company-profile')]) })
}

export function useSaveBranch() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, input, version, idempotencyKey }: { id?: number; input: BranchInput | Partial<BranchInput>; version?: number; idempotencyKey?: string }) =>
      (await api.request<{ data: Branch }>(id ? 'PATCH' : 'POST', id ? `/branches/${id}` : '/branches', { body: input, ifMatch: id ? v(version ?? 0) : undefined, idempotencyKey })).data.data,
    onSuccess: () => inv([...k('company-profile')], [...k('branches')]),
  })
}

export function useUpdateSettings() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ input, version }: { input: CompanySettingsUpdate; version: number }) =>
      (await api.request<{ data: CompanySettings }>('PATCH', '/company/settings', { body: input, ifMatch: v(version) })).data.data,
    onSuccess: () => inv([...k('company-settings')]),
  })
}

export function useNumberSequences() {
  return useQuery({ queryKey: k('number-sequences'), queryFn: async () => list(await api.request<{ data: NumberSequence[]; meta: PageMeta }>('GET', '/number-sequences')) })
}

export function useUpdateSequence() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, input, version }: { id: number; input: { prefix?: string; next_number?: number; padding?: number }; version: number }) =>
      (await api.request<{ data: NumberSequence }>('PATCH', `/number-sequences/${id}`, { body: input, ifMatch: v(version) })).data.data,
    onSuccess: () => inv([...k('number-sequences')]),
  })
}

export function useSaveTaxRule() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, input, version, idempotencyKey }: { id?: number; input: Partial<TaxRuleInput>; version?: number; idempotencyKey?: string }) =>
      (await api.request<{ data: TaxRule }>(id ? 'PATCH' : 'POST', id ? `/tax-rules/${id}` : '/tax-rules', { body: input, ifMatch: id ? v(version ?? 0) : undefined, idempotencyKey })).data.data,
    onSuccess: () => inv([...k('tax-rules')]),
  })
}

// ---------------------------------------------------------------- users, invitations, roles (K8–K11)

export function useMembers(f: { q?: string; status?: string; page?: number } = {}) {
  return useQuery({
    queryKey: k('members', f),
    queryFn: async () => (await api.request<{ data: Member[]; meta: PageMeta }>('GET', '/users', { query: { ...f, per_page: 50 } })).data,
    placeholderData: keepPreviousData,
    // Invitees join from their own browser: show who has joined every time the page opens.
    staleTime: 0, refetchOnMount: 'always',
  })
}

export function useMember(id: number) {
  return useQuery({ queryKey: k('members', 'one', id), queryFn: async () => (await api.request<{ data: Member }>('GET', `/users/${id}`)).data.data, enabled: id > 0 })
}

export function useUpdateMember() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, input, version }: { id: number; input: MemberUpdate; version: number }) =>
      (await api.request<{ data: Member }>('PATCH', `/users/${id}`, { body: input, ifMatch: v(version) })).data.data,
    onSuccess: () => inv([...k('members')], [...k('roles')]),
  })
}

export function useMemberStatus() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, action }: { id: number; action: 'deactivate' | 'reactivate' }) => (await api.request<{ data: Member }>('POST', `/users/${id}/${action}`)).data.data,
    onSuccess: () => inv([...k('members')], [...k('company-profile')]),
  })
}

export function useInvitations() {
  return useQuery({ queryKey: k('invitations'), queryFn: async () => list(await api.request<{ data: Invitation[]; meta: PageMeta }>('GET', '/invitations')) })
}

export function useInvite() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: InvitationCreate; idempotencyKey: string }) =>
      (await api.request<{ data: Invitation }>('POST', '/invitations', { body: input, idempotencyKey })).data.data,
    onSuccess: () => inv([...k('invitations')], [...k('company-profile')]),
  })
}

export function useInvitationAction() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, action }: { id: number; action: 'resend' | 'revoke' }) => {
      if (action === 'resend') await api.request('POST', `/invitations/${id}/resend`)
      else await api.request('DELETE', `/invitations/${id}`)
    },
    onSuccess: () => inv([...k('invitations')], [...k('company-profile')]),
  })
}

export function useRoles() {
  return useQuery({ queryKey: k('roles'), queryFn: async () => list(await api.request<{ data: Role[]; meta: PageMeta }>('GET', '/roles')) })
}

export function usePermissionCatalogue() {
  return useQuery({ queryKey: ['permissions'], queryFn: async () => (await api.request<{ data: PermissionList }>('GET', '/permissions')).data.data, staleTime: 60 * 60_000 })
}

export function useSaveRole() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, input, version, idempotencyKey }: { id?: number; input: RoleInput; version?: number; idempotencyKey?: string }) =>
      (await api.request<{ data: Role }>(id ? 'PUT' : 'POST', id ? `/roles/${id}` : '/roles', { body: input, ifMatch: id ? v(version ?? 0) : undefined, idempotencyKey })).data.data,
    onSuccess: () => inv([...k('roles')]),
  })
}

export function useDeleteRole() {
  const inv = useInvalidate()
  return useMutation({ mutationFn: async (id: number) => { await api.request('DELETE', `/roles/${id}`) }, onSuccess: () => inv([...k('roles')]) })
}

// ---------------------------------------------------------------- the user's own account (K12–K14)

export function useSessions() {
  return useQuery({ queryKey: ['me', 'sessions'], queryFn: async () => list(await api.request<{ data: Session[]; meta: PageMeta }>('GET', '/me/sessions', { company: false })) })
}

export function useSessionAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (target: number | 'others') => {
      if (target === 'others') await api.request('POST', '/me/sessions/revoke-others', { company: false })
      else await api.request('DELETE', `/me/sessions/${target}`, { company: false })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'sessions'] }),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { current_password: string; password: string; password_confirmation: string }) => {
      await api.request('PUT', '/me/password', { company: false, body: input })
    },
  })
}

export function usePreferences() {
  return useQuery({ queryKey: ['me', 'preferences'], queryFn: async () => (await api.request<{ data: UserPreferences }>('GET', '/me/preferences', { company: false })).data.data, staleTime: 5 * 60_000 })
}

export function useSavePreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UserPreferences) => (await api.request<{ data: UserPreferences }>('PUT', '/me/preferences', { company: false, body: input })).data.data,
    onSuccess: (p) => qc.setQueryData(['me', 'preferences'], p),
  })
}

export function useNotificationPreferences() {
  return useQuery({ queryKey: k('notification-preferences'), queryFn: async () => (await api.request<{ data: NotificationPreferences }>('GET', '/me/notification-preferences')).data.data })
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: NotificationPreferences) => (await api.request<{ data: NotificationPreferences }>('PUT', '/me/notification-preferences', { body: input })).data.data,
    onSuccess: (p) => qc.setQueryData(k('notification-preferences'), p),
  })
}

// ---------------------------------------------------------------- backups (K15)

export function useBackups(poll = false) {
  return useQuery({
    queryKey: k('backups'),
    queryFn: async () => list(await api.request<{ data: Backup[]; meta: PageMeta }>('GET', '/backups')),
    refetchInterval: poll ? 3000 : false,
  })
}

export function useBackupAction() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async (a: { kind: 'take'; idempotencyKey: string } | { kind: 'restore'; id: number; idempotencyKey: string } | { kind: 'download'; id: number }) => {
      if (a.kind === 'take') return (await api.request<{ data: Backup }>('POST', '/backups', { idempotencyKey: a.idempotencyKey })).data.data
      if (a.kind === 'restore') return (await api.request<{ data: Backup }>('POST', `/backups/${a.id}/restore`, { body: { confirmation: 'RESTORE' }, idempotencyKey: a.idempotencyKey })).data.data
      const url = (await api.request<{ data: SignedUrl }>('GET', `/backups/${a.id}/download`)).data.data
      window.location.assign(url.url)
      return null
    },
    onSuccess: () => inv([...k('backups')]),
  })
}

// ---------------------------------------------------------------- signed out: reset, invitations, new company (S0, S2, S3)

export async function forgotPassword(email: string) {
  await api.request('POST', '/auth/password/forgot', { company: false, noRefresh: true, body: { email } })
}

export async function resetPassword(input: { token: string; email: string; password: string; password_confirmation: string }) {
  await api.request('POST', '/auth/password/reset', { company: false, noRefresh: true, body: input })
}

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: async () => (await api.request<{ data: InvitationPublic }>('GET', `/invitations/${token}`, { company: false, noRefresh: true })).data.data,
    retry: false,
  })
}

export async function acceptInvitation(token: string, input: { name?: string; password: string; password_confirmation?: string }) {
  return (await api.request<{ data: LoginResponse }>('POST', `/invitations/${token}/accept`, { company: false, noRefresh: true, body: input })).data.data
}

export function useCreateCompany() {
  return useMutation({
    mutationFn: async ({ input, idempotencyKey }: { input: CompanyCreate; idempotencyKey: string }) =>
      (await api.request<{ data: Company }>('POST', '/companies', { company: false, body: input, idempotencyKey })).data.data,
  })
}
