/**
 * Reports (backend/src/modules/reports/routes.ts). Pro plan, roles with the
 * `reports` permission (owner, manager, accountant).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { get } from './client'
import type { HostelType, HostelerStatus, ID } from './types'
import type { ExpenseCategory } from './expenses'

export interface PnlReport {
  months: { month: string; income: number; expenses: number; net: number; deposits: number }[]
  byCategory: { category: ExpenseCategory; amount: number; count: number }[]
  totals: { income: number; expenses: number; deposits: number; net: number }
}

export interface CollectionReport {
  months: { month: string; invoices: number; billed: number; collected: number; pending: number; rate: number }[]
  totals: { invoices: number; billed: number; collected: number; pending: number; rate: number }
}

interface OccRow {
  rooms: number
  beds: number
  occupied: number
  vacant: number
  rate: number
}

export interface OccupancyReport {
  total: { total: number; occupied: number; vacant: number; rate: number }
  byHostel: (OccRow & { hostelId: ID; name: string; type: HostelType; maintenance: number })[]
  byRoomType: (OccRow & { type: 'ac' | 'non-ac'; avgRent: number })[]
  bySharing: (OccRow & { sharing: number })[]
}

export type AgingBucket = 'notdue' | '1-30' | '31-60' | '60+'

export interface DuesAgingReport {
  asOf: string
  totalDues: number
  buckets: { key: AgingBucket; label: string; count: number; amount: number; hostelers: number }[]
  hostelers: {
    hosteler: { id: ID; name: string; phone: string; status: HostelerStatus; loginId: string } | null
    total: number
    oldestDays: number
    buckets: Record<AgingBucket, number>
  }[]
  invoices: {
    invoiceId: ID
    number: string
    month: string
    dueDate: string
    balance: number
    daysOverdue: number
    bucket: AgingBucket
    hostelId: ID
    hosteler: { id: ID; name: string; phone: string; status: HostelerStatus; loginId: string } | null
  }[]
}

export const reportsApi = {
  pnl: (p: { months: number; hostelId: ID | 'all' }) => get<PnlReport>('/reports/pnl', { ...p }),
  collection: (p: { months: number; hostelId: ID | 'all' }) => get<CollectionReport>('/reports/collection', { ...p }),
  occupancy: (p: { hostelId: ID | 'all' }) => get<OccupancyReport>('/reports/occupancy', { ...p }),
  duesAging: (p: { hostelId: ID | 'all' }) => get<DuesAgingReport>('/reports/dues-aging', { ...p }),
}

export function usePnlReport(months: number, hostelId: ID | 'all') {
  return useQuery({
    queryKey: ['reports', 'pnl', { months, hostelId }],
    queryFn: () => reportsApi.pnl({ months, hostelId }),
    placeholderData: keepPreviousData,
  })
}

export function useCollectionReport(months: number, hostelId: ID | 'all') {
  return useQuery({
    queryKey: ['reports', 'collection', { months, hostelId }],
    queryFn: () => reportsApi.collection({ months, hostelId }),
    placeholderData: keepPreviousData,
  })
}

export function useOccupancyReport(hostelId: ID | 'all') {
  return useQuery({ queryKey: ['reports', 'occupancy', { hostelId }], queryFn: () => reportsApi.occupancy({ hostelId }) })
}

export function useDuesAgingReport(hostelId: ID | 'all') {
  return useQuery({ queryKey: ['reports', 'dues-aging', { hostelId }], queryFn: () => reportsApi.duesAging({ hostelId }) })
}
