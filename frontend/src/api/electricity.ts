/**
 * Metered electricity by period — backend/src/modules/electricity/routes.ts (module 'rooms').
 *
 * A reading is a meter (a room, or a bed when the hostel meters each bed) +
 * the period it covers (fromDate–toDate, inclusive) + the units used.
 * Amount = units × hostel rate, shared among everyone who stayed on that meter
 * during the period in proportion to the days each stayed. Each share is added
 * to the hosteler's current bill (or their next bill if they have none yet).
 */
import { useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './client'
import { useApiMutation } from './query'
import { useStaffSession } from './session'
import type { ID } from './types'

export type ElectricityBasis = 'room' | 'bed'

export interface ElectricityOccupant {
  id: ID
  name: string
  loginId: string
  checkInDate: string
}

export interface LastReading {
  id: ID
  fromDate: string
  toDate: string
  units: number
  amount: number
}

export interface ElectricityMeter {
  roomId: ID
  roomNumber: string
  floor: number
  /** set when the hostel meters each bed */
  bedId: ID | null
  bedLabel: string | null
  beds: number
  occupants: ElectricityOccupant[]
  lastReading: LastReading | null
  /** default "from" for the next reading (day after the last one, else first move-in); null = nobody ever stayed */
  suggestedFrom: string | null
}

export interface ElectricityOverview {
  hostel: { id: ID; name: string; rate: number; basis: ElectricityBasis }
  /** server's today (YYYY-MM-DD) — the latest allowed "to" date */
  today: string
  meters: ElectricityMeter[]
}

export interface ReadingSplit {
  hostelerId: ID
  name: string
  days: number
  amount: number
  /** bill the share was added to; null = waiting for the hosteler's next bill */
  invoiceId: ID | null
  invoiceNumber: string | null
}

export interface ElectricityReading {
  id: ID
  hostelId: ID
  roomId: ID
  bedId: ID | null
  roomNumber: string
  bedLabel: string | null
  fromDate: string
  toDate: string
  month: string
  units: number
  rate: number
  amount: number
  totalDays: number
  splits: ReadingSplit[]
  enteredByName: string
  createdAt: string
  updatedAt: string
}

export interface ReadingInput {
  roomId: ID
  bedId?: ID | null
  fromDate: string
  toDate: string
  units: number
}

export interface ReadingPreview {
  rate: number
  amount: number
  periodDays: number
  totalDays: number
  shares: { hostelerId: ID; name: string; days: number; amount: number }[]
}

export interface SaveReadingResult {
  reading: ElectricityReading
  billsUpdated: number
  waitingForNextBill: number
  warnings: string[]
}

export const electricityApi = {
  overview: (hostelId: ID) => get<ElectricityOverview>('/electricity', { hostelId }),
  readings: (p: { hostelId: ID; roomId?: ID; bedId?: ID | null }) =>
    get<{ items: ElectricityReading[] }>('/electricity/readings', { hostelId: p.hostelId, roomId: p.roomId, bedId: p.bedId ?? undefined }),
  preview: (body: ReadingInput) => post<ReadingPreview>('/electricity/preview', body),
  create: (body: ReadingInput) => post<SaveReadingResult>('/electricity/readings', body),
  update: ({ id, ...body }: { id: ID; fromDate?: string; toDate?: string; units?: number }) => patch<SaveReadingResult>(`/electricity/readings/${id}`, body),
  remove: (id: ID) => del<{ ok: true; id: ID }>(`/electricity/readings/${id}`),
}

export function useElectricity(hostelId: ID | null) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['electricity', hostelId],
    queryFn: () => electricityApi.overview(hostelId!),
    enabled: !!staff && !!hostelId,
  })
}

export function useMeterReadings(hostelId: ID, roomId: ID, bedId: ID | null, enabled = true) {
  return useQuery({
    queryKey: ['electricity', hostelId, 'readings', roomId, bedId],
    queryFn: () => electricityApi.readings({ hostelId, roomId, bedId }),
    enabled,
  })
}

/** Live split preview (nothing saved). Pass null to disable. */
export function useReadingPreview(input: ReadingInput | null) {
  return useQuery({
    queryKey: ['electricity', 'preview', input],
    queryFn: () => electricityApi.preview(input!),
    enabled: !!input,
    staleTime: 10_000,
    retry: false,
  })
}

/** Readings change bills, dues and every screen that shows them. */
export const ELECTRICITY_INVALIDATE = [
  ['electricity'],
  ['invoices'],
  ['invoice'],
  ['dues'],
  ['fees-summary'],
  ['dashboard'],
  ['hosteler'],
  ['hostelers'],
  ['portal'],
  ['reports'],
]

/** The success toast is shown by the caller (it includes the bill counts and warnings). */
export function useCreateReading(onSuccess?: (r: SaveReadingResult) => void) {
  return useApiMutation(electricityApi.create, { invalidate: ELECTRICITY_INVALIDATE, onSuccess: (r) => onSuccess?.(r) })
}

export function useUpdateReading(onSuccess?: (r: SaveReadingResult) => void) {
  return useApiMutation(electricityApi.update, { invalidate: ELECTRICITY_INVALIDATE, onSuccess: (r) => onSuccess?.(r) })
}

export function useDeleteReading() {
  return useApiMutation(electricityApi.remove, { invalidate: ELECTRICITY_INVALIDATE, success: 'Reading deleted — bills updated' })
}

/** "Saved — 2 bills updated · 1 waiting for the next bill" (+ warnings) for a toast. */
export function savedMessage(r: SaveReadingResult, verb = 'Saved'): string {
  const parts = [`${r.billsUpdated} bill${r.billsUpdated === 1 ? '' : 's'} updated`]
  if (r.waitingForNextBill) parts.push(`${r.waitingForNextBill} share${r.waitingForNextBill === 1 ? '' : 's'} added to the next bill`)
  return `${verb} — ${parts.join(' · ')}`
}
