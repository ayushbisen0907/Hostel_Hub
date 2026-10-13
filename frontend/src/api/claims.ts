/**
 * Payment verification (backend/src/modules/claims/routes.ts, module 'fees').
 * Hostelers pay the hostel's UPI outside the app and report it; staff check
 * their bank and verify (amount actually received) or reject.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { get, post } from './client'
import { useApiMutation } from './query'
import { useCan } from './session'
import type { ID, InvoiceItem, Paginated, Payment, PaymentClaim, PaymentClaimStatus } from './types'

export type ClaimFilter = PaymentClaimStatus | 'all'

export interface ClaimListParams {
  status?: ClaimFilter
  hostelId?: ID | 'all'
  q?: string
  page?: number
  limit?: number
}

export interface ClaimOpenBill {
  id: ID
  number: string
  month: string
  total: number
  paidAmount: number
  balance: number
  dueDate: string
  items: InvoiceItem[]
}

export interface ClaimDetail extends PaymentClaim {
  /** total outstanding across all the hosteler's bills */
  dues: number
  /** unpaid bills, oldest first (payments are applied in this order) */
  openBills: ClaimOpenBill[]
  payments: Payment[]
}

export interface VerifyResult {
  claim: PaymentClaim
  applied: { invoiceId: ID; number: string; amount: number }[]
  remainingDues: number
}

export const claimsApi = {
  list: (p: ClaimListParams) => get<Paginated<PaymentClaim>>('/payment-claims', { ...p }),
  count: (hostelId?: ID | 'all') => get<{ pending: number }>('/payment-claims/count', { hostelId }),
  detail: (id: ID) => get<ClaimDetail>(`/payment-claims/${id}`),
  verify: ({ id, ...body }: { id: ID; receivedAmount: number; note?: string }) => post<VerifyResult>(`/payment-claims/${id}/verify`, body),
  reject: ({ id, reason }: { id: ID; reason: string }) => post<{ claim: PaymentClaim }>(`/payment-claims/${id}/reject`, { reason }),
}

export const screenshotUrl = (id: ID) => `/payment-claims/${id}/screenshot`

export function useClaims(params: ClaimListParams) {
  return useQuery({
    queryKey: ['payment-claims', 'list', params],
    queryFn: () => claimsApi.list(params),
    placeholderData: keepPreviousData,
  })
}

/** Pending payments waiting for verification (polled; only for roles with fees access). */
export function usePendingClaimCount(hostelId?: ID | 'all', opts: { poll?: number; enabled?: boolean } = {}) {
  const can = useCan()
  return useQuery({
    queryKey: ['payment-claims', 'count', { hostelId: hostelId ?? 'all' }],
    queryFn: async () => (await claimsApi.count(hostelId)).pending,
    enabled: can('fees') && (opts.enabled ?? true),
    refetchInterval: opts.poll ?? 60_000,
    refetchIntervalInBackground: false,
  })
}

export function useClaim(id: ID | null | undefined) {
  return useQuery({ queryKey: ['payment-claims', 'detail', id], queryFn: () => claimsApi.detail(id!), enabled: !!id })
}

const CLAIM_INVALIDATE = [
  ['payment-claims'],
  ['invoices'],
  ['invoice'],
  ['payments'],
  ['payment'],
  ['dues'],
  ['fees-summary'],
  ['dashboard'],
  ['hosteler'],
  ['hostelers'],
  ['notifications'],
  ['reports'],
]

export function useVerifyClaim(onSuccess?: (r: VerifyResult) => void) {
  return useApiMutation(claimsApi.verify, { invalidate: CLAIM_INVALIDATE, onSuccess: (r) => onSuccess?.(r) })
}

export function useRejectClaim(onSuccess?: () => void) {
  return useApiMutation(claimsApi.reject, { invalidate: CLAIM_INVALIDATE, success: 'Payment rejected — the hosteler was notified', onSuccess: () => onSuccess?.() })
}
