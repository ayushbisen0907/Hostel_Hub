/**
 * Move-out (notice) requests — backend/src/modules/moveOut/routes.ts
 *
 *  - Portal: a hosteler asks for a move-out date (≥ today + the hostel's notice period).
 *  - Staff ('checkin'): approve (optional note) or reject (reason required).
 *    The actual check-out stays on the Check-out page and marks the request 'completed'.
 */
import { useQuery } from '@tanstack/react-query'
import { del, get, post } from './client'
import { useApiMutation } from './query'
import { useHostelerSession, useStaffSession } from './session'
import { notificationsKey } from './notifications'
import type { HostelerStatus, ID, ListResponse } from './types'

export type MoveOutStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed'

export interface MoveOutRequest {
  id: ID
  hostelId: ID
  hostelerId: ID
  moveOutDate: string
  reason: string
  status: MoveOutStatus
  /** staff note on approval / reason for rejection */
  response: string
  decidedByName: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Staff list item */
export interface MoveOutRequestRow extends MoveOutRequest {
  hosteler: { id: ID; name: string; loginId: string; phone: string; status: HostelerStatus } | null
  roomNumber: string | null
  bedLabel: string | null
  hostelName: string | null
}

export interface PortalMoveOut {
  items: MoveOutRequest[]
  /** the pending / approved request, if any (one at a time) */
  active: MoveOutRequest | null
  noticePeriodDays: number
  /** deposit is refunded only after this many months of stay (0 = always refundable) */
  depositMinStayMonths?: number
  /** earliest date that can be requested (today + notice period) */
  earliestDate: string
  today: string
}

export const MOVE_OUT_STATUS_LABEL: Record<MoveOutStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Checked out',
}

/* ---------------- staff ---------------- */

export type MoveOutListStatus = MoveOutStatus | 'all'

export const moveOutKey = ['move-out-requests'] as const

const STAFF_INVALIDATE = [['move-out-requests'], ['hosteler'], ['hostelers'], ['dashboard'], notificationsKey]

export function useMoveOutRequests(params: { status?: MoveOutListStatus; hostelId?: ID | 'all' }, opts: { enabled?: boolean } = {}) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: [...moveOutKey, params],
    queryFn: () => get<ListResponse<MoveOutRequestRow>>('/move-out-requests', { ...params }),
    enabled: !!staff && opts.enabled !== false,
  })
}

export function useApproveMoveOut() {
  return useApiMutation(({ id, response }: { id: ID; response: string }) => post<MoveOutRequest>(`/move-out-requests/${id}/approve`, { response }), {
    invalidate: STAFF_INVALIDATE,
    success: 'Move-out approved. The hosteler has been notified.',
  })
}

export function useRejectMoveOut() {
  return useApiMutation(({ id, response }: { id: ID; response: string }) => post<MoveOutRequest>(`/move-out-requests/${id}/reject`, { response }), {
    invalidate: STAFF_INVALIDATE,
    success: 'Move-out request rejected. The hosteler has been notified.',
  })
}

/* ---------------- portal ---------------- */

export const portalMoveOutKey = ['portal', 'move-out'] as const

export function useMyMoveOut(enabled = true) {
  const s = useHostelerSession()
  return useQuery({
    queryKey: portalMoveOutKey,
    queryFn: () => get<PortalMoveOut>('/portal/move-out'),
    enabled: enabled && !!s && !s.mustChangePassword && !s.consentRequired,
  })
}

/** Errors are not toasted: the form shows them inline. */
export function useRequestMoveOut() {
  return useApiMutation((body: { moveOutDate: string; reason: string }) => post<MoveOutRequest>('/portal/move-out', body), {
    invalidate: [portalMoveOutKey, ['portal', 'me'], ['portal', 'home']],
    success: 'Move-out request sent to the hostel office',
    toastErrors: false,
  })
}

export function useCancelMoveOut() {
  return useApiMutation((id: ID) => del<MoveOutRequest>(`/portal/move-out/${id}`), {
    invalidate: [portalMoveOutKey, ['portal', 'me'], ['portal', 'home']],
    success: 'Move-out request cancelled',
  })
}
