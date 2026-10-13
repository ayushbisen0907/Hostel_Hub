/**
 * Visitor register (Basic & Pro).
 * Backend: backend/src/modules/visitors/routes.ts
 */
import { useQuery } from '@tanstack/react-query'
import { get, post } from './client'
import { useApiMutation } from './query'
import type { ID, Paginated } from './types'

export interface Visitor {
  id: ID
  hostelId: ID
  hostelerId: ID
  name: string
  phone: string
  relation: string
  purpose: string
  idProof: string
  inTime: string
  outTime: string | null
  createdAt: string
  hostelerName: string
  roomNumber: string | null
}

export interface VisitorStats {
  inside: number
  today: number
  thisMonth: number
  completed: number
  avgDurationMinutes: number | null
}

export interface VisitorQuery {
  hostelId: ID | 'all'
  q?: string
  from?: string
  to?: string
  inside?: 'true' | 'false'
  page?: number
  limit?: number
}

export const fetchVisitors = (params: VisitorQuery) => get<Paginated<Visitor>>('/visitors', { ...params })

export function useVisitors(params: VisitorQuery) {
  return useQuery({
    queryKey: ['visitors', 'list', params],
    queryFn: () => fetchVisitors(params),
    placeholderData: (prev) => prev,
  })
}

export function useVisitorStats(hostelId: ID | 'all') {
  return useQuery({
    queryKey: ['visitors', 'stats', { hostelId }],
    queryFn: () => get<VisitorStats>('/visitors/stats', { hostelId }),
  })
}

export function useCreateVisitor() {
  return useApiMutation(
    (body: { hostelerId: ID; name: string; phone?: string; relation?: string; purpose?: string; idProof?: string }) =>
      post<Visitor>('/visitors', body),
    { invalidate: [['visitors']], success: (v) => `${v.name} checked in` },
  )
}

export function useCheckOutVisitor() {
  return useApiMutation((id: ID) => post<Visitor>(`/visitors/${id}/check-out`), {
    invalidate: [['visitors']],
    success: (v) => `${v.name} checked out`,
  })
}
