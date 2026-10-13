/**
 * Complaints (every plan).
 * Backend: backend/src/modules/complaints/routes.ts
 */
import { useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './client'
import { useApiMutation } from './query'
import type { Complaint, ComplaintCategory, ComplaintStatus, ID, Priority } from './types'

/* ---------------- types ---------------- */

export interface ComplaintItem extends Complaint {
  hostelerName: string | null
  hostelerPhone: string | null
  roomNumber: string | null
  assignedStaffName: string | null
}

export interface ComplaintStats {
  open: number
  inProgress: number
  resolvedThisMonth: number
  resolvedTotal: number
  avgResolutionHours: number | null
}

export interface Assignee {
  id: ID
  name: string
  role: string
  hostelId: ID
  active: boolean
}

export interface ComplaintFilters {
  hostelId: ID | 'all'
  status?: ComplaintStatus
  category?: ComplaintCategory
  priority?: Priority
  q?: string
}

/* ---------------- queries ---------------- */

export function useComplaints(filters: ComplaintFilters) {
  return useQuery({
    queryKey: ['complaints', 'list', filters],
    queryFn: async () => (await get<{ items: ComplaintItem[] }>('/complaints', { ...filters })).items,
    placeholderData: (prev) => prev,
  })
}

export function useComplaint(id: ID | null, initialData?: ComplaintItem) {
  return useQuery({
    queryKey: ['complaints', 'detail', id],
    queryFn: () => get<ComplaintItem>(`/complaints/${id}`),
    enabled: !!id,
    initialData,
  })
}

/** Same key the sidebar badge uses (AdminLayout) when unscoped. */
export function useComplaintStats(hostelId: ID | 'all') {
  return useQuery({
    queryKey: hostelId === 'all' ? ['complaints', 'stats'] : ['complaints', 'stats', { hostelId }],
    queryFn: () => get<ComplaintStats>('/complaints/stats', { hostelId }),
  })
}

/** Staff a complaint in `hostelId` can be assigned to (works for wardens too). */
export function useAssignees(hostelId: ID | null) {
  return useQuery({
    queryKey: ['complaints', 'assignees', hostelId],
    queryFn: async () => (await get<{ items: Assignee[] }>('/complaints/assignees', { hostelId, includeInactive: 'true' })).items,
    enabled: !!hostelId,
    staleTime: 60_000,
  })
}

/* ---------------- mutations ---------------- */

const INVALIDATE = [['complaints'], ['dashboard'], ['activities']]

export function useCreateComplaint() {
  return useApiMutation(
    (body: {
      hostelId: ID
      hostelerId?: ID | null
      roomId?: ID | null
      category: ComplaintCategory
      title: string
      description?: string
      priority?: Priority
    }) => post<ComplaintItem>('/complaints', body),
    { invalidate: INVALIDATE, success: 'Complaint logged' },
  )
}

export type ComplaintPatch = Partial<{
  status: ComplaintStatus
  priority: Priority
  assignedStaffId: ID | null
  title: string
  description: string
}>

export function useUpdateComplaint() {
  return useApiMutation(
    ({ id, body }: { id: ID; body: ComplaintPatch; success?: string }) => patch<ComplaintItem>(`/complaints/${id}`, body),
    { invalidate: INVALIDATE, success: (_r, v) => v.success ?? 'Complaint updated' },
  )
}

export function useAddComplaintComment() {
  return useApiMutation(
    ({ id, text }: { id: ID; text: string }) => post<ComplaintItem>(`/complaints/${id}/comments`, { text }),
    { invalidate: [['complaints']] },
  )
}

export function useDeleteComplaint() {
  return useApiMutation((id: ID) => del(`/complaints/${id}`), { invalidate: INVALIDATE, success: 'Complaint deleted' })
}
