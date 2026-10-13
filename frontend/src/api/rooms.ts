/**
 * Rooms & beds — backend/src/modules/rooms/routes.ts
 */
import { useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './client'
import { useStaffSession } from './session'
import type { HostelerStatus, ID, ListResponse, Room } from './types'

export interface RoomBed {
  id: ID
  label: string
  hostelerId: ID | null
  hosteler: { id: ID; name: string; status: HostelerStatus } | null
}

/** GET /rooms item: the room with its beds (sorted by label) and occupants. */
export interface RoomWithBeds extends Room {
  beds: RoomBed[]
  createdAt?: string
}

export interface RoomInput {
  hostelId: ID
  number: string
  floor: number
  type: Room['type']
  sharing: number
  rentPerBed: number
  status: Room['status']
  amenities: string[]
}

export type RoomPatch = Partial<Omit<RoomInput, 'hostelId'>>

export interface BulkRoomsInput extends Omit<RoomInput, 'number'> {
  numbers?: string[]
  from?: number
  to?: number
}

export interface BulkRoomsResult {
  created: number
  skipped: string[]
  items: RoomWithBeds[]
}

/** GET /beds/vacant item */
export interface VacantBed {
  id: ID
  label: string
  roomId: ID
  hostelId: ID
  room: { id: ID; number: string; floor: number; type: Room['type']; sharing: number; rentPerBed: number; hostelId: ID }
}

export interface RoomListParams {
  hostelId?: ID | 'all'
  floor?: number
  status?: Room['status']
  type?: Room['type']
  vacant?: boolean
}

export const roomsApi = {
  list: async (params: RoomListParams = {}) =>
    (await get<ListResponse<RoomWithBeds>>('/rooms', { ...params, vacant: params.vacant ? 'true' : undefined })).items,
  get: (id: ID) => get<RoomWithBeds>(`/rooms/${id}`),
  create: (body: RoomInput) => post<RoomWithBeds>('/rooms', body),
  bulk: (body: BulkRoomsInput) => post<BulkRoomsResult>('/rooms/bulk', body),
  update: ({ id, ...body }: RoomPatch & { id: ID }) => patch<RoomWithBeds>(`/rooms/${id}`, body),
  remove: (id: ID) => del<{ ok: true }>(`/rooms/${id}`),
  vacantBeds: async (hostelId?: ID | 'all') => (await get<ListResponse<VacantBed>>('/beds/vacant', { hostelId })).items,
}

/** Query keys every room/bed change should refresh. */
export const ROOM_INVALIDATE = [['rooms'], ['beds'], ['hostels'], ['org'], ['dashboard']]

export function useRooms(params: RoomListParams = {}) {
  const staff = useStaffSession()
  return useQuery({ queryKey: ['rooms', params], queryFn: () => roomsApi.list(params), enabled: !!staff })
}

/** Vacant beds in active rooms (any staff role). `hostelId` 'all' / undefined = every hostel. */
export function useVacantBeds(hostelId: ID | 'all' | undefined, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['beds', 'vacant', hostelId ?? 'all'],
    queryFn: () => roomsApi.vacantBeds(hostelId),
    enabled: !!staff && enabled,
  })
}
