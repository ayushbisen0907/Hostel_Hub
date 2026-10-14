/**
 * Hostelers (residents) — backend/src/modules/hostelers/routes.ts
 * plus the hosteler-scoped reads used on the profile page (attendance,
 * complaints, leaves; fees come from ./fees). Their query keys start with the resource name so
 * other screens' invalidations refresh them too.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { del, get, patch, post, upload } from './client'
import { useStaffSession } from './session'
import type { GateLogEntry } from './gate'
import type {
  Complaint,
  Hosteler,
  HostelerStatus,
  ID,
  LeaveRequest,
  ListResponse,
  Paginated,
  PaymentMode,
} from './types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** List / detail item: hosteler + room/bed labels, hostel name and outstanding dues. */
export interface HostelerRow extends Hosteler {
  roomNumber: string | null
  bedLabel: string | null
  hostelName: string | null
  dues: number
}

/** Hostel rules signature state (GET /hostelers/:id). */
export interface ConsentStatus {
  /** the current rules version is not signed yet */
  required: boolean
  /** current version of the hostel's rules (0 = the hostel has no rules) */
  rulesVersion: number
  /** latest version this hosteler signed (0 = never) */
  signedVersion: number
  signedAt: string | null
}

export interface HostelerDetail extends HostelerRow {
  consentStatus?: ConsentStatus
  depositCollected: number
  lastGateLog: GateLogEntry | null
  counts: { documents: number; invoices: number; payments: number; complaints: number; leaves: number; visitors: number }
}

export interface Credentials {
  loginId: string
  tempPassword: string
}

export type HostelerProfileFields = Pick<
  Hosteler,
  | 'name'
  | 'phone'
  | 'email'
  | 'gender'
  | 'dob'
  | 'permanentAddress'
  | 'bloodGroup'
  | 'occupation'
  | 'institution'
  | 'course'
  | 'guardianName'
  | 'guardianRelation'
  | 'guardianPhone'
  | 'idProofType'
  | 'idProofNumber'
>

export interface AdmitInput extends HostelerProfileFields {
  expectedCheckOut: string | null
  notes: string
  hostelId?: ID
  bedId: ID | null
  reserveOnly: boolean
  checkInDate: string
  monthlyRent: number
  securityDeposit?: number
  messOpted: boolean
  depositPayment: { amount: number; mode: PaymentMode; reference: string } | null
  generateFirstInvoice: boolean
  /** Deposit not collected now: on the first bill (default), the next monthly bill, or not billed. */
  depositOption?: DepositOption
}

export type DepositOption = 'collected' | 'first_bill' | 'next_bill'

export interface BillDepositResult {
  amount: number
  target: 'open' | 'next'
  invoiceNumber: string | null
  hosteler: HostelerRow
}

export type HostelerPatch = Partial<
  HostelerProfileFields & { expectedCheckOut: string | null; notes: string; monthlyRent: number; securityDeposit: number; messOpted: boolean }
>

export interface CheckOutInput {
  date: string
  deductions: { label: string; amount: number }[]
  adjustDuesFromDeposit: boolean
  depositHeld?: number
  depositRefund?: number
  note: string
}

export interface Settlement {
  hostelerId: ID
  name: string
  loginId: string
  bed: string | null
  checkIn: string
  checkOut: string
  days: number
  held: number
  dues: number
  adjusted: number
  deductions: { label: string; amount: number }[]
  totalDeductions: number
  refund: number
  toCollect: number
  notes: string
  /** full rent cycles completed by the check-out date */
  monthsStayed?: number
  /** the hostel's minimum stay for a deposit refund (0 = always refundable) */
  minStayMonths?: number
  depositForfeited?: boolean
  forfeitReason?: string | null
  remainingDues?: number
}

/** An unpaid bill in the check-out preview, with what the deposit covers. */
export interface PreviewBill {
  id: ID
  number: string
  month: string
  periodStart: string | null
  periodEnd: string | null
  dueDate: string
  total: number
  paidAmount: number
  balance: number
  /** part of the balance paid from a refundable deposit at check-out */
  adjustFromDeposit: number
  /** still to be collected */
  remaining: number
}

/** GET /hostelers/:id/check-out-preview — the settlement without deductions; nothing is saved. */
export interface CheckOutPreview {
  hostelerId: ID
  name: string
  loginId: string
  bed: string | null
  checkIn: string
  checkOut: string
  days: number
  monthsStayed: number
  minStayMonths: number
  depositForfeited: boolean
  forfeitReason: string | null
  held: number
  dues: number
  unpaidBills: PreviewBill[]
  adjusted: number
  remainingDues: number
  deductions: { label: string; amount: number }[]
  totalDeductions: number
  refund: number
  toCollect: number
  canCheckOut: boolean
  blockers: string[]
  moveOutRequest: { id: ID; moveOutDate: string; status: 'pending' | 'approved' } | null
}

export interface CheckOutPreviewParams {
  date: string
  adjustDuesFromDeposit: boolean
  depositHeld?: number
}

/** details of a 409 DUES_PENDING from POST /hostelers/:id/check-out */
export interface DuesPendingDetails {
  toCollect: number
  remainingDues: number
  depositForfeited: boolean
  unpaidBills: PreviewBill[]
  blockers: string[]
}

export interface HostelerListParams {
  status?: HostelerStatus | 'all'
  hostelId?: ID | 'all'
  q?: string
  occupation?: Hosteler['occupation']
  messOpted?: 'true' | 'false'
  hasDues?: 'true' | 'false'
  page?: number
  limit?: number
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export const hostelersApi = {
  list: (params: HostelerListParams = {}) => get<Paginated<HostelerRow>>('/hostelers', { ...params }),
  get: (id: ID) => get<HostelerDetail>(`/hostelers/${id}`),
  update: ({ id, ...body }: HostelerPatch & { id: ID }) => patch<HostelerRow>(`/hostelers/${id}`, body),
  admit: (body: AdmitInput) => post<{ hosteler: HostelerRow; credentials: Credentials }>('/hostelers', body),
  confirmCheckIn: ({ id, date }: { id: ID; date?: string }) => post<HostelerRow>(`/hostelers/${id}/confirm-check-in`, date ? { date } : {}),
  transfer: ({ id, bedId, updateRent }: { id: ID; bedId: ID; updateRent: boolean }) =>
    post<HostelerRow>(`/hostelers/${id}/transfer`, { bedId, updateRent }),
  checkOutPreview: (id: ID, p: CheckOutPreviewParams) =>
    get<CheckOutPreview>(`/hostelers/${id}/check-out-preview`, {
      date: p.date,
      adjustDuesFromDeposit: String(p.adjustDuesFromDeposit),
      depositHeld: p.depositHeld,
    }),
  checkOut: ({ id, ...body }: CheckOutInput & { id: ID }) =>
    post<{ settlement: Settlement; hosteler: HostelerRow }>(`/hostelers/${id}/check-out`, body),
  /** Put the outstanding security deposit on the latest bill now ('open') or on the next monthly bill ('next'). */
  billDeposit: ({ id, target }: { id: ID; target: 'open' | 'next' }) => post<BillDepositResult>(`/hostelers/${id}/bill-deposit`, { target }),
  resetPassword: (id: ID) => post<Credentials>(`/hostelers/${id}/reset-password`),
  remove: (id: ID) => del(`/hostelers/${id}`),
  uploadPhoto: ({ id, file }: { id: ID; file: File }) => upload<{ hosteler: HostelerRow; photoUrl: string }>(`/hostelers/${id}/photo`, file),

  /** Every page of a list (for CSV export). */
  listAll: async (params: Omit<HostelerListParams, 'page' | 'limit'>) => {
    const out: HostelerRow[] = []
    for (let page = 1; ; page++) {
      const r = await hostelersApi.list({ ...params, page, limit: 500 })
      out.push(...r.items)
      if (page >= r.pages) return out
    }
  },
}

/** The admin photo endpoint (works for staff- and portal-uploaded photos). */
export function hostelerPhotoPath(h: Pick<Hosteler, 'id' | 'photoUrl'>): string | null {
  return h.photoUrl ? `/hostelers/${h.id}/photo` : null
}

/** Invalidate after anything that changes a hosteler's stay / bed / money. */
export const HOSTELER_INVALIDATE = [
  ['hostelers'],
  ['hosteler'],
  ['rooms'],
  ['beds'],
  ['hostels'],
  ['dashboard'],
  ['invoices'],
  ['payments'],
  ['org'],
  ['gate-logs'],
  ['documents'],
]

/** Invalidate after a profile-only change. */
export const PROFILE_INVALIDATE = [['hostelers'], ['hosteler']]

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export function useHostelers(params: HostelerListParams, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['hostelers', params],
    queryFn: () => hostelersApi.list(params),
    enabled: !!staff && enabled,
    placeholderData: keepPreviousData,
  })
}

export function useHosteler(id: ID | null | undefined) {
  const staff = useStaffSession()
  return useQuery({ queryKey: ['hosteler', id], queryFn: () => hostelersApi.get(id!), enabled: !!staff && !!id })
}

/** Check-out settlement preview. Keyed under ['hosteler', id] so payments (FEES_INVALIDATE) refresh it. */
export function useCheckOutPreview(id: ID | null | undefined, params: CheckOutPreviewParams, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['hosteler', id, 'check-out-preview', params],
    queryFn: () => hostelersApi.checkOutPreview(id!, params),
    enabled: !!staff && !!id && !!params.date && enabled,
    placeholderData: keepPreviousData,
  })
}

/* ------------------------------------------------------------------ */
/* Hosteler-scoped reads from other modules                            */
/* ------------------------------------------------------------------ */

/** GET /attendance/register item */
export interface AttendanceRegisterRow {
  hostelerId: ID
  name: string
  loginId: string
  hostelId: ID
  roomNumber: string | null
  days: Record<string, 'present' | 'absent' | 'late' | 'leave'>
  present: number
  late: number
  absent: number
  leave: number
  percentage: number | null
}

export function useAttendanceRegister(month: string, hostelId: ID | undefined, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['attendance', 'register', { month, hostelId }],
    queryFn: () => get<{ month: string; days: string[]; items: AttendanceRegisterRow[] }>('/attendance/register', { month, hostelId }),
    enabled: !!staff && !!hostelId && enabled,
  })
}

export type ComplaintRow = Complaint & { hostelerName: string | null; roomNumber: string | null }
export type LeaveRow = LeaveRequest & { hostelerName: string; loginId: string; roomNumber: string | null }

/** The complaints API has no hosteler filter, so the list is filtered here. */
export function useHostelerComplaints(hostelerId: ID | undefined, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['complaints', { all: true }],
    queryFn: async () => (await get<ListResponse<ComplaintRow>>('/complaints')).items,
    enabled: !!staff && !!hostelerId && enabled,
    select: (items) => items.filter((c) => c.hostelerId === hostelerId),
  })
}

/** The leaves API has no hosteler filter, so the list is filtered here. */
export function useHostelerLeaves(hostelerId: ID | undefined, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['leaves', { all: true }],
    queryFn: async () => (await get<ListResponse<LeaveRow>>('/leaves')).items,
    enabled: !!staff && !!hostelerId && enabled,
    select: (items) => items.filter((l) => l.hostelerId === hostelerId),
  })
}
