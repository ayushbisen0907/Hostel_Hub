/**
 * Metered electricity — backend/src/modules/electricity/routes.ts (module 'rooms').
 *
 * Each month staff enter the units used per room (hostel.electricityBasis =
 * 'room', split equally among the room's hostelers) or per bed ('bed').
 * Amount = units × hostel.electricityRate, added to each hosteler's bill.
 */
import { useQuery } from '@tanstack/react-query'
import { get, put } from './client'
import { useApiMutation } from './query'
import { useStaffSession } from './session'
import type { ID } from './types'

export type ElectricityBasis = 'room' | 'bed'

export interface ElectricityOccupant {
  id: ID
  name: string
  loginId: string
  /** already has a bill for this month (so a reading is added to it right away) */
  billed: boolean
}

export interface ElectricityReading {
  id: ID
  units: number
  rate: number
  amount: number
  splits: { hostelerId: ID; name: string; amount: number }[]
  enteredByName: string
  updatedAt: string | null
}

export interface ElectricityRow {
  roomId: ID
  roomNumber: string
  floor: number
  /** set when the hostel meters each bed */
  bedId: ID | null
  bedLabel: string | null
  beds: number
  occupants: ElectricityOccupant[]
  reading: ElectricityReading | null
}

export interface ElectricitySheet {
  hostel: { id: ID; name: string; rate: number; basis: ElectricityBasis }
  month: string
  rows: ElectricityRow[]
  totals: { units: number; amount: number }
}

export interface ReadingInput {
  roomId: ID
  bedId?: ID | null
  /** null / 0 removes the reading */
  units: number | null
}

export interface SaveReadingsResult extends ElectricitySheet {
  billsUpdated: number
  hostelersAffected: number
  warnings: string[]
}

export const electricityApi = {
  sheet: (hostelId: ID, month: string) => get<ElectricitySheet>('/electricity', { hostelId, month }),
  save: (body: { hostelId: ID; month: string; readings: ReadingInput[] }) => put<SaveReadingsResult>('/electricity', body),
}

export function useElectricitySheet(hostelId: ID | null, month: string) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['electricity', hostelId, month],
    queryFn: () => electricityApi.sheet(hostelId!, month),
    enabled: !!staff && !!hostelId && /^\d{4}-\d{2}$/.test(month),
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

/** The success toast is shown by the caller (it includes the bill count and warnings). */
export function useSaveReadings(onSuccess?: (r: SaveReadingsResult) => void) {
  return useApiMutation(electricityApi.save, {
    invalidate: ELECTRICITY_INVALIDATE,
    onSuccess: (r) => onSuccess?.(r),
  })
}
