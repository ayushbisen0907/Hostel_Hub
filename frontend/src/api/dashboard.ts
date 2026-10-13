/**
 * Dashboard (backend/src/modules/dashboard/routes.ts) plus the few writes the
 * dashboard's quick actions make (leave decisions, quick expense, quick notice).
 */
import { useQuery } from '@tanstack/react-query'
import { get, post } from './client'
import { useApiMutation } from './query'
import { expensesApi } from './expenses'
import type { Activity, HostelerStatus, ID, LeaveRequest, Meal, Notice, Priority } from './types'

export interface DashboardHosteler {
  id: ID
  name: string
  phone: string
  status: HostelerStatus
  hostelId: ID
  roomId: ID | null
  bedId: ID | null
  roomNumber: string | null
  bedLabel: string | null
  checkInDate: string
  expectedCheckOut: string | null
}

export interface DashboardData {
  occupancy: { total: number; occupied: number; vacant: number; rate: number }
  hostelers: { active: number; reserved: number }
  thisMonth: { month: string; billed: number; collected: number; outstanding: number; rate: number }
  totalDues: number
  openComplaints: number
  highPriorityComplaints: number
  maintenanceBeds: number
  mess: { meal: Meal; date: string; members: number; expected: number }
  /** org-wide counts (ignore the hostel filter) for the setup checklist */
  setup: { rooms: number; hostelers: number; invoices: number }
  pendingLeaves: { count: number; items: (LeaveRequest & { hostelerName: string | null })[] }
  upcomingCheckIns: DashboardHosteler[]
  expectedCheckOuts: (DashboardHosteler & { overdue: boolean })[]
  topDues: (DashboardHosteler & { dues: number })[]
  recentActivity: Activity[]
  last6Months: { month: string; collected: number; expenses: number }[]
}

export interface DashboardParams {
  hostelId: ID | 'all'
  meal: Meal
  date: string
}

export const dashboardApi = {
  get: (p: DashboardParams) => get<DashboardData>('/dashboard', { ...p }),
  approveLeave: (id: ID) => post<LeaveRequest>(`/leaves/${id}/approve`),
  rejectLeave: (id: ID) => post<LeaveRequest>(`/leaves/${id}/reject`),
  createNotice: (body: { hostelId: ID | null; title: string; body: string; priority: Priority; pinned: boolean }) =>
    post<Notice>('/notices', body),
}

export function useDashboard(params: DashboardParams) {
  return useQuery({ queryKey: ['dashboard', params], queryFn: () => dashboardApi.get(params) })
}

const LEAVE_INVALIDATE = [['dashboard'], ['leaves'], ['attendance']]

export function useDecideLeave() {
  return useApiMutation(
    ({ id, decision }: { id: ID; decision: 'approve' | 'reject'; name: string }) =>
      decision === 'approve' ? dashboardApi.approveLeave(id) : dashboardApi.rejectLeave(id),
    {
      invalidate: LEAVE_INVALIDATE,
      success: (_d, v) => `Leave ${v.decision === 'approve' ? 'approved' : 'rejected'} for ${v.name}`,
    },
  )
}

export function useQuickNotice(onSuccess?: () => void) {
  return useApiMutation(dashboardApi.createNotice, {
    invalidate: [['notices'], ['dashboard']],
    success: 'Notice posted',
    onSuccess: () => onSuccess?.(),
  })
}

export function useQuickExpense(onSuccess?: () => void) {
  return useApiMutation(expensesApi.create, {
    invalidate: [['expenses'], ['expenses-summary'], ['dashboard'], ['reports']],
    success: 'Expense added',
    onSuccess: () => onSuccess?.(),
  })
}
