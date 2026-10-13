/**
 * Gate in/out log — backend/src/modules/gate/routes.ts
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { get, post } from './client'
import { useStaffSession } from './session'
import type { ID, ListResponse, Paginated } from './types'

export type GateDirection = 'in' | 'out'

export interface GateLogEntry {
  id: ID
  orgId?: ID
  hostelId: ID
  hostelerId: ID
  direction: GateDirection
  /** ISO date-time */
  time: string
  note: string
  createdAt?: string
}

/** GET /gate-logs item */
export interface GateLogRow extends GateLogEntry {
  hostelerName: string | null
  hostelerLoginId: string | null
  roomNumber: string | null
  bedLabel: string | null
  late: boolean
}

/** GET /gate-logs/outside item */
export interface OutsideRow {
  hosteler: { id: ID; name: string; loginId: string; phone: string; roomNumber: string | null; bedLabel: string | null }
  log: { id: ID; direction: GateDirection; time: string; note: string }
  since: string
}

export interface GateLogParams {
  date?: string
  direction?: GateDirection
  hostelerId?: ID
  hostelId?: ID | 'all'
  page?: number
  limit?: number
}

export const gateApi = {
  list: (params: GateLogParams) => get<Paginated<GateLogRow>>('/gate-logs', { ...params }),
  outside: async (hostelId?: ID | 'all') => (await get<ListResponse<OutsideRow>>('/gate-logs/outside', { hostelId })).items,
  create: (body: { hostelerId: ID; direction: GateDirection; note: string }) => post<GateLogEntry & { late: boolean }>('/gate-logs', body),
}

export const GATE_INVALIDATE = [['gate-logs'], ['hosteler'], ['dashboard']]

export function useGateLogs(params: GateLogParams, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['gate-logs', params],
    queryFn: () => gateApi.list(params),
    enabled: !!staff && enabled,
    placeholderData: keepPreviousData,
  })
}

export function useOutside(hostelId: ID | 'all') {
  const staff = useStaffSession()
  return useQuery({ queryKey: ['gate-logs', 'outside', hostelId], queryFn: () => gateApi.outside(hostelId), enabled: !!staff })
}
