/**
 * Staff directory, salary payments and the activity feed.
 * Backend: backend/src/modules/staff/routes.ts
 */
import { useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './client'
import { useApiMutation } from './query'
import type { Activity, ID, PaymentMode } from './types'

/** Directory roles (not the same as login roles). */
export type DirectoryRole = 'manager' | 'warden' | 'accountant' | 'cook' | 'security' | 'cleaner'
export const DIRECTORY_ROLES: DirectoryRole[] = ['manager', 'warden', 'accountant', 'cook', 'security', 'cleaner']

export interface StaffMember {
  id: ID
  orgId: ID
  hostelId: ID
  name: string
  phone: string
  role: DirectoryRole
  salary: number
  joinDate: string
  active: boolean
  createdAt: string
  /** a salary expense exists for the requested month */
  paidThisMonth: boolean
}

export interface StaffListResponse {
  month: string
  items: StaffMember[]
}

export interface StaffInput {
  hostelId: ID
  name: string
  phone: string
  role: DirectoryRole
  salary: number
  joinDate: string
  active: boolean
}

export interface PaySalariesResult {
  month: string
  created: number
  skipped: number
  total: number
}

/* ---------------- queries ---------------- */

export function useStaffList(params: { hostelId: ID | 'all'; month?: string; active?: 'true' | 'false' }) {
  return useQuery({
    queryKey: ['staff', params],
    queryFn: () => get<StaffListResponse>('/staff', params),
  })
}

export function useActivities(params: { hostelId: ID | 'all'; limit?: number }) {
  return useQuery({
    queryKey: ['activities', params],
    queryFn: async () => (await get<{ items: Activity[] }>('/activities', params)).items,
  })
}

/* ---------------- mutations ---------------- */

// assignee lists in complaints read the staff directory too
const INVALIDATE = [['staff'], ['complaints', 'assignees']]

export function useCreateStaff() {
  return useApiMutation((body: StaffInput) => post<StaffMember>('/staff', body), {
    invalidate: INVALIDATE,
    success: (s) => `${s.name} added`,
  })
}

export function useUpdateStaff() {
  return useApiMutation(
    ({ id, body }: { id: ID; body: Partial<StaffInput>; success?: string }) => patch<StaffMember>(`/staff/${id}`, body),
    { invalidate: INVALIDATE, success: (_s, v) => v.success ?? 'Staff details updated' },
  )
}

export function useDeleteStaff() {
  return useApiMutation((id: ID) => del(`/staff/${id}`), { invalidate: INVALIDATE, success: 'Staff member deleted' })
}

export function usePaySalaries() {
  return useApiMutation(
    (body: { month: string; mode: PaymentMode; staffIds?: ID[] }) => post<PaySalariesResult>('/staff/pay-salaries', body),
    {
      invalidate: [['staff'], ['expenses'], ['dashboard'], ['reports'], ['activities']],
      success: (r) =>
        r.created
          ? `${r.created} salary payment${r.created === 1 ? '' : 's'} recorded`
          : 'Nothing to pay – everyone selected is already paid',
    },
  )
}
