import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Announcement } from '../api/contract.gen'
import { ds } from '../ds'

/**
 * PEP-513: messages from the software owner to every company ("Update tonight 11 pm", "New: LC items"), shown at the
 * top of every page until the person closes them. Not company data: no X-Company-Id. Refreshed every 5 minutes.
 */
const key = ['announcements'] as const

export function useAnnouncements() {
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => (await api.request<{ data: Announcement[] }>('GET', '/announcements', { company: false, signal })).data.data,
    staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false,
  })
}

export function AnnouncementBanner() {
  const { Banner } = ds()
  const qc = useQueryClient()
  const q = useAnnouncements()
  const dismiss = useMutation({
    mutationFn: async (id: number) => { await api.request('POST', `/announcements/${id}/dismiss`, { company: false }) },
    onMutate: (id) => qc.setQueryData<Announcement[]>(key, (all) => (all ?? []).filter((a) => a.id !== id)),
  })
  if (!q.data?.length) return null
  return (
    <div style={{ display: 'grid', gap: 8, marginBottom: 16 }} data-testid="announcements">
      {q.data.map((a) => (
        <div key={a.id} data-testid={`announcement-${a.id}`}>
          <Banner tone={a.tone === 'success' ? 'positive' : a.tone} title={a.title} onDismiss={() => dismiss.mutate(a.id)}>{a.body}</Banner>
        </div>
      ))}
    </div>
  )
}
