import { useMutation } from '@tanstack/react-query'
import { api } from './client'
import type { RecoveryCodes, TwoFactorSetup } from './contract.gen'

/** 2-step verification endpoints (K14, 05 Auth tag). None is company-scoped. */
export function useStartTwoFactor() {
  return useMutation({ mutationFn: async () => (await api.request<{ data: TwoFactorSetup }>('POST', '/me/two-factor', { company: false })).data.data })
}

export function useConfirmTwoFactor() {
  return useMutation({
    mutationFn: async (code: string) => (await api.request<{ data: RecoveryCodes }>('POST', '/me/two-factor/confirm', { company: false, body: { code } })).data.data,
  })
}

export function useDisableTwoFactor() {
  return useMutation({
    mutationFn: async (password: string) => { await api.request<void>('DELETE', '/me/two-factor', { company: false, body: { password } }) },
  })
}
