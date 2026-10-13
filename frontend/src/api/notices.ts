/**
 * Notice board (every plan).
 * Backend: backend/src/modules/notices/routes.ts
 */
import { useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './client'
import { useApiMutation } from './query'
import type { ID, Notice, Priority } from './types'

export interface NoticeInput {
  hostelId: ID | null
  title: string
  body: string
  priority: Priority
  pinned: boolean
}

/** Notices of `hostelId` plus all-hostel notices ('all' = every notice). Pinned first, newest first. */
export function useNotices(hostelId: ID | 'all') {
  return useQuery({
    queryKey: ['notices', { hostelId }],
    queryFn: async () => (await get<{ items: Notice[] }>('/notices', { hostelId })).items,
  })
}

export function useCreateNotice() {
  return useApiMutation((body: NoticeInput) => post<Notice>('/notices', body), {
    invalidate: [['notices'], ['portal']],
    success: 'Notice posted',
  })
}

export function useUpdateNotice() {
  return useApiMutation(
    ({ id, body }: { id: ID; body: Partial<NoticeInput>; success?: string }) => patch<Notice>(`/notices/${id}`, body),
    { invalidate: [['notices'], ['portal']], success: (_n, v) => v.success ?? 'Notice updated' },
  )
}

export function useDeleteNotice() {
  return useApiMutation((id: ID) => del(`/notices/${id}`), { invalidate: [['notices'], ['portal']], success: 'Notice deleted' })
}
