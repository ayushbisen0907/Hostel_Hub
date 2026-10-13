/**
 * Hosteler portal API. See backend/src/modules/portal/routes.ts
 *
 * The server derives hostelerId / orgId / hostelId from the token — never send them.
 * Query keys all start with 'portal' so a logout / prefix invalidation clears them.
 */
import { useQuery } from '@tanstack/react-query'
import { ApiError, del, fetchFileUrl, get, patch, post, upload } from './client'
import { refreshHostelerMe } from './auth'
import { useHostelerSession } from './session'
import { useApiMutation } from './query'
import type {
  Complaint,
  ComplaintCategory,
  DocumentType,
  HDocument,
  Hosteler,
  ID,
  Invoice,
  LeaveRequest,
  ListResponse,
  Meal,
  Notice,
  Payment,
  Priority,
} from './types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AttendanceStatus = 'present' | 'late' | 'leave' | 'absent'
export type PayMethod = 'upi' | 'card' | 'netbanking'

export interface PortalHome {
  today: string
  currencySymbol: string
  features: { mess: boolean; attendance: boolean }
  hosteler: Hosteler
  bed: string | null
  hostel: { id: ID; name: string; phone: string } | null
  dues: { total: number; nextDueDate: string | null; overdue: boolean; pendingInvoices: number }
  /** null when the plan has no mess */
  todayMenu: { meal: Meal; items: string; skipped: boolean }[] | null
  notices: Notice[]
  openComplaints: Complaint[]
  /** null when the plan has no attendance */
  last7DaysAttendance: { date: string; status: AttendanceStatus | null }[] | null
}

export type PortalInvoice = Invoice & { balance: number; status: NonNullable<Invoice['status']> }
export type PortalPayment = Payment & { invoiceNumber: string | null; invoiceMonth: string | null }

export interface MessMenuItem {
  id: ID
  day: number
  meal: Meal
  items: string
}
export interface MealOptOut {
  id: ID
  date: string
  meal: Meal
}
export interface MessFeedback {
  id: ID
  date: string
  meal: Meal
  rating: number
  comment: string
  createdAt: string
}
export interface AttendanceRecord {
  id: ID
  date: string
  status: AttendanceStatus
}
export interface AttendanceMonth {
  month: string
  items: AttendanceRecord[]
  summary: Record<AttendanceStatus, number> & { total: number }
}
export interface GateLog {
  id: ID
  direction: 'in' | 'out'
  time: string
  note: string
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** The organization's plan doesn't include this part of the portal. */
export function isPlanError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 402 || e.code === 'PLAN_UPGRADE_REQUIRED')
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

export const portalKeys = {
  all: ['portal'] as const,
  me: ['portal', 'me'] as const,
  home: ['portal', 'home'] as const,
  photo: ['portal', 'photo'] as const,
  invoices: ['portal', 'invoices'] as const,
  payments: ['portal', 'payments'] as const,
  mess: ['portal', 'mess'] as const,
  messMenu: ['portal', 'mess', 'menu'] as const,
  optOuts: ['portal', 'mess', 'opt-outs'] as const,
  feedback: ['portal', 'mess', 'feedback'] as const,
  complaints: ['portal', 'complaints'] as const,
  leaves: ['portal', 'leaves'] as const,
  notices: ['portal', 'notices'] as const,
  documents: ['portal', 'documents'] as const,
  attendance: ['portal', 'attendance'] as const,
  gateLogs: ['portal', 'gate-logs'] as const,
}

const items = <T>(r: ListResponse<T>) => r.items

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

function useEnabled() {
  const s = useHostelerSession()
  return !!s && !s.mustChangePassword
}

/** Fresh profile from /portal/auth/me; also keeps the session's hosteler current. */
export function usePortalMe() {
  const enabled = useEnabled()
  return useQuery({ queryKey: portalKeys.me, queryFn: refreshHostelerMe, enabled })
}

export function usePortalHome() {
  const enabled = useEnabled()
  return useQuery({ queryKey: portalKeys.home, queryFn: () => get<PortalHome>('/portal/home'), enabled })
}

export function useMyInvoices() {
  return useQuery({ queryKey: portalKeys.invoices, queryFn: async () => items(await get<ListResponse<PortalInvoice>>('/portal/invoices')) })
}

export function useMyPayments() {
  return useQuery({ queryKey: portalKeys.payments, queryFn: async () => items(await get<ListResponse<PortalPayment>>('/portal/payments')) })
}

export function useMessMenu(enabled = true) {
  return useQuery({
    queryKey: portalKeys.messMenu,
    queryFn: () => get<{ items: MessMenuItem[]; cutoffs: Record<Meal, string> }>('/portal/mess/menu'),
    enabled,
  })
}

export function useMyOptOuts(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: [...portalKeys.optOuts, from, to],
    queryFn: async () => items(await get<ListResponse<MealOptOut>>('/portal/mess/opt-outs', { from, to })),
    enabled,
  })
}

export function useMyFeedback(enabled = true) {
  return useQuery({
    queryKey: portalKeys.feedback,
    queryFn: async () => items(await get<ListResponse<MessFeedback>>('/portal/mess/feedback')),
    enabled,
  })
}

export function useMyComplaints() {
  return useQuery({ queryKey: portalKeys.complaints, queryFn: async () => items(await get<ListResponse<Complaint>>('/portal/complaints')) })
}

export function useMyLeaves(enabled = true) {
  return useQuery({
    queryKey: portalKeys.leaves,
    queryFn: async () => items(await get<ListResponse<LeaveRequest>>('/portal/leaves')),
    enabled,
  })
}

export function useMyNotices() {
  return useQuery({ queryKey: portalKeys.notices, queryFn: async () => items(await get<ListResponse<Notice>>('/portal/notices')) })
}

export function useMyDocuments() {
  return useQuery({ queryKey: portalKeys.documents, queryFn: async () => items(await get<ListResponse<HDocument>>('/portal/documents')) })
}

export function useMyAttendance(month: string, enabled = true) {
  return useQuery({
    queryKey: [...portalKeys.attendance, month],
    queryFn: () => get<AttendanceMonth>('/portal/attendance', { month }),
    enabled,
  })
}

export function useMyGateLogs() {
  return useQuery({ queryKey: portalKeys.gateLogs, queryFn: async () => items(await get<ListResponse<GateLog>>('/portal/gate-logs')) })
}

/**
 * Object URL of the hosteler's profile photo (protected file), or null.
 * Keyed on updatedAt so a new upload is fetched again.
 */
export function useProfilePhoto(h: Pick<Hosteler, 'photoUrl' | 'updatedAt'> | null | undefined) {
  const has = !!h?.photoUrl
  const q = useQuery({
    queryKey: [...portalKeys.photo, h?.updatedAt ?? ''],
    queryFn: () => fetchFileUrl('/portal/profile/photo'),
    enabled: has,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
  return has ? (q.data ?? null) : null
}

/** Object URL for a protected document file (used for image thumbnails). */
export function useDocumentBlobUrl(id: ID, enabled: boolean) {
  return useQuery({
    queryKey: ['portal', 'documents', id, 'file'],
    queryFn: () => fetchFileUrl(documentFileUrl(id)),
    enabled,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  }).data
}

export const documentFileUrl = (id: ID) => `/portal/documents/${id}/file`

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export interface PayBody {
  invoiceId: ID
  amount: number
  method: PayMethod
  reference?: string
}

export const payInvoice = (body: PayBody) => post<{ payment: Payment; dues: number }>('/portal/pay', body)

export function usePayInvoice() {
  // errors are shown inside the payment sheet
  return useApiMutation(payInvoice, {
    invalidate: [portalKeys.home, portalKeys.invoices, portalKeys.payments],
    toastErrors: false,
  })
}

export function useToggleMeal() {
  return useApiMutation(
    ({ date, meal, skip }: { date: string; meal: Meal; skip: boolean }) =>
      skip ? post<unknown>('/portal/mess/opt-outs', { date, meal }) : del<unknown>('/portal/mess/opt-outs', { data: { date, meal } }),
    { invalidate: [portalKeys.optOuts, portalKeys.home] },
  )
}

export function useSendMessFeedback() {
  return useApiMutation(
    (body: { meal: Meal; rating: number; comment: string; date?: string }) => post<{ feedback: MessFeedback }>('/portal/mess/feedback', body),
    { invalidate: [portalKeys.feedback], success: 'Thanks for your feedback!' },
  )
}

export function useRaiseComplaint() {
  return useApiMutation(
    (body: { category: ComplaintCategory; priority: Priority; title: string; description: string }) =>
      post<{ complaint: Complaint }>('/portal/complaints', body),
    { invalidate: [portalKeys.complaints, portalKeys.home], success: 'Complaint raised. The warden has been notified.' },
  )
}

export function useCommentOnComplaint() {
  return useApiMutation(
    ({ id, text }: { id: ID; text: string }) => post<{ complaint: Complaint }>(`/portal/complaints/${id}/comments`, { text }),
    { invalidate: [portalKeys.complaints, portalKeys.home], success: 'Comment added' },
  )
}

export function useRequestLeave() {
  return useApiMutation(
    (body: { from: string; to: string; destination: string; reason: string }) => post<{ leave: LeaveRequest }>('/portal/leaves', body),
    { invalidate: [portalKeys.leaves], success: 'Leave request sent to the warden', toastErrors: false },
  )
}

export function useCancelLeave() {
  return useApiMutation((id: ID) => del<{ ok: true }>(`/portal/leaves/${id}`), {
    invalidate: [portalKeys.leaves],
    success: 'Leave request cancelled',
  })
}

export function useUpdateProfile() {
  return useApiMutation(
    (body: { email?: string; permanentAddress?: string; guardianPhone?: string }) => patch<{ hosteler: Hosteler }>('/portal/profile', body),
    {
      invalidate: [portalKeys.home],
      success: 'Details updated',
      toastErrors: false,
      onSuccess: () => void refreshHostelerMe().catch(() => undefined),
    },
  )
}

export function useUploadPhoto() {
  return useApiMutation((file: File) => upload<{ hosteler: Hosteler; photoUrl: string }>('/portal/profile/photo', file), {
    invalidate: [portalKeys.home, portalKeys.documents],
    success: 'Profile photo updated',
    onSuccess: () => void refreshHostelerMe().catch(() => undefined),
  })
}

export function useUploadDocument() {
  return useApiMutation(
    ({ file, type }: { file: File; type: DocumentType }) => upload<{ document: HDocument }>('/portal/documents', file, { type }),
    { invalidate: [portalKeys.documents] },
  )
}
