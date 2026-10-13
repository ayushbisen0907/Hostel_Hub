/**
 * Attendance & leave (Pro plan).
 * Backend: backend/src/modules/attendance/routes.ts
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, put } from './client'
import { toastError, useApiMutation } from './query'
import type { ID, LeaveRequest } from './types'

/* ---------------- types ---------------- */

export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'late'
export type LeaveStatus = LeaveRequest['status']

export interface RosterItem {
  hostelerId: ID
  name: string
  loginId: string
  hostelId: ID
  roomId: ID | null
  roomNumber: string | null
  phone: string
  guardianName: string
  guardianRelation: string
  guardianPhone: string
  status: AttendanceStatus | null
  onApprovedLeave: boolean
}

export interface RosterResponse {
  date: string
  items: RosterItem[]
  summary: { total: number; present: number; late: number; absent: number; leave: number; unmarked: number }
}

export interface RegisterRow {
  hostelerId: ID
  name: string
  loginId: string
  hostelId: ID
  roomNumber: string | null
  /** 'YYYY-MM-DD' -> status; unmarked days are missing */
  days: Record<string, AttendanceStatus>
  present: number
  late: number
  absent: number
  leave: number
  percentage: number | null
}

export interface RegisterResponse {
  month: string
  days: string[]
  items: RegisterRow[]
}

export interface Leave extends LeaveRequest {
  hostelerName: string
  loginId: string
  hostelerPhone: string
  roomNumber: string | null
}

type Scope = ID | 'all'

/* ---------------- attendance ---------------- */

const rosterKey = (hostelId: Scope, date: string) => ['attendance', 'day', { hostelId, date }] as const

export function useAttendance(hostelId: Scope, date: string) {
  return useQuery({
    queryKey: rosterKey(hostelId, date),
    queryFn: () => get<RosterResponse>('/attendance', { hostelId, date }),
  })
}

function summarize(items: RosterItem[]): RosterResponse['summary'] {
  const n = (s: AttendanceStatus) => items.filter((i) => i.status === s).length
  return {
    total: items.length,
    present: n('present'),
    late: n('late'),
    absent: n('absent'),
    leave: n('leave'),
    unmarked: items.filter((i) => !i.status).length,
  }
}

/**
 * Marks one or more hostelers for a date. The roster updates instantly
 * (optimistic) and rolls back if the server refuses.
 */
export function useMarkAttendance(hostelId: Scope, date: string) {
  const qc = useQueryClient()
  const key = rosterKey(hostelId, date)
  return useMutation({
    mutationFn: async ({ hostelerIds, status }: { hostelerIds: ID[]; status: AttendanceStatus }) => {
      await Promise.all(hostelerIds.map((hostelerId) => put('/attendance', { hostelerId, date, status })))
      return hostelerIds.length
    },
    onMutate: async ({ hostelerIds, status }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<RosterResponse>(key)
      if (prev) {
        const ids = new Set(hostelerIds)
        const items = prev.items.map((i) => (ids.has(i.hostelerId) ? { ...i, status } : i))
        qc.setQueryData<RosterResponse>(key, { ...prev, items, summary: summarize(items) })
      }
      return { prev }
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toastError(e)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  })
}

export function useMarkAllPresent() {
  return useApiMutation(
    (body: { date: string; hostelId?: ID }) => post<{ count: number }>('/attendance/mark-all-present', body),
    {
      invalidate: [['attendance']],
      success: (r) => (r.count ? `${r.count} hostelers marked (approved leaves set to Leave)` : 'Everyone already has attendance for this day'),
    },
  )
}

export function useAttendanceRegister(hostelId: Scope, month: string) {
  return useQuery({
    queryKey: ['attendance', 'register', { hostelId, month }],
    queryFn: () => get<RegisterResponse>('/attendance/register', { hostelId, month }),
  })
}

/* ---------------- leaves ---------------- */

/** All leaves in scope (newest first); filter by status on the client so tab counts stay in sync. */
export function useLeaves(hostelId: Scope) {
  return useQuery({
    queryKey: ['leaves', 'list', { hostelId }],
    queryFn: async () => (await get<{ items: Leave[] }>('/leaves', { hostelId })).items,
  })
}

/** Approved leaves covering today. */
export function useCurrentLeaves(hostelId: Scope) {
  return useQuery({
    queryKey: ['leaves', 'current', { hostelId }],
    queryFn: async () => (await get<{ items: Leave[] }>('/leaves/current', { hostelId })).items,
  })
}

// leaves change attendance (leave flag), mess headcount and the dashboard
const LEAVE_INVALIDATE = [['leaves'], ['attendance'], ['mess'], ['dashboard'], ['activities']]

export function useCreateLeave() {
  return useApiMutation(
    (body: { hostelerId: ID; from: string; to: string; reason: string; destination?: string; approve?: boolean }) =>
      post<LeaveRequest>('/leaves', body),
    {
      invalidate: LEAVE_INVALIDATE,
      success: (l) => (l.status === 'approved' ? 'Leave added and approved' : 'Leave request added'),
    },
  )
}

export function useDecideLeave() {
  return useApiMutation(
    ({ id, action }: { id: ID; action: 'approve' | 'reject'; name?: string }) => post<LeaveRequest>(`/leaves/${id}/${action}`),
    {
      invalidate: LEAVE_INVALIDATE,
      success: (l, v) => `Leave ${l.status}${v.name ? ` for ${v.name}` : ''}`,
    },
  )
}
