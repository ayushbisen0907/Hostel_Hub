/**
 * Fees: invoices, payments, dues, deposits and the monthly summary
 * (backend/src/modules/fees/routes.ts), plus the printable invoice / receipt
 * data for both staff and hostelers (backend/src/modules/portal/routes.ts).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './client'
import { useApiMutation } from './query'
import { useSession } from './session'
import type { Hosteler, HostelerStatus, ID, Invoice, InvoiceItem, InvoiceStatus, Paginated, Payment, PaymentMode } from './types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface HostelerRef {
  id: ID
  name: string
  phone: string
  loginId: string
}

/** Invoice with the computed fields every endpoint adds. */
export type InvoiceWithStatus = Invoice & { balance: number; status: InvoiceStatus }

export interface InvoiceRow extends InvoiceWithStatus {
  hosteler: HostelerRef | null
  roomLabel: string
  hostelName: string
}

export interface InvoiceList extends Paginated<InvoiceRow> {
  totals: { total: number; paid: number; balance: number }
}

export interface PrintHostel {
  id: ID
  name: string
  address: string
  city: string
  phone: string
  code?: string
  /** where hostelers pay rent */
  upiId?: string
  payeeName?: string
}

/** Unpaid balance of the hosteler's bills older than this one (shown as "previous balance"). */
export interface PreviousBalance {
  amount: number
  invoices: { id: ID; number: string; month: string; periodStart?: string | null; periodEnd?: string | null; balance: number; dueDate: string }[]
}

export interface PrintOrg {
  id?: ID
  name: string
  ownerName?: string
  email: string
  phone: string
  currencySymbol: string
}

export interface FeesHosteler extends HostelerRef {
  email: string
  guardianName: string
  guardianPhone: string
  status: HostelerStatus
  hostelId: ID
  roomLabel: string
}

export interface InvoiceDetail extends InvoiceWithStatus {
  daysOverdue: number
  payments: Payment[]
  previousBalance: PreviousBalance
  hosteler: FeesHosteler | null
  hostel: PrintHostel | null
  organization: PrintOrg | null
}

export interface PaymentRow extends Payment {
  hosteler: HostelerRef | null
  roomLabel: string
  invoice: { id: ID; number: string; month: string } | null
  hostelName: string
}

export interface PaymentList extends Paginated<PaymentRow> {
  totals: { amount: number; count: number; byMode: Record<PaymentMode, number> }
}

export interface PaymentDetail extends Payment {
  hosteler: FeesHosteler | null
  invoice: InvoiceWithStatus | null
  hostel: PrintHostel | null
  organization: PrintOrg | null
}

export interface DueInvoice {
  id: ID
  number: string
  month: string
  periodStart?: string | null
  periodEnd?: string | null
  total: number
  paidAmount: number
  balance: number
  dueDate: string
  status: InvoiceStatus
}

export interface DueRow {
  hostelerId: ID
  hosteler: (HostelerRef & { status: HostelerStatus }) | null
  name: string
  phone: string
  guardianName: string
  guardianPhone: string
  roomLabel: string
  hostelId: ID
  amount: number
  oldestDueDate: string
  daysOverdue: number
  overdue: boolean
  invoices: DueInvoice[]
}

export interface DuesResponse {
  items: DueRow[]
  totals: { amount: number; hostelers: number; overdueAmount: number }
}

export interface DepositRow {
  hostelerId: ID
  hosteler: HostelerRef | null
  roomLabel: string
  status: HostelerStatus
  checkInDate: string
  checkOutDate: string | null
  agreed: number
  collected: number
  held: number
  pending: number
  refunded: number
  refundRecorded: boolean
  deducted: number
}

export interface DepositsResponse {
  items: DepositRow[]
  held: DepositRow[]
  checkedOut: DepositRow[]
  totals: { held: number; pending: number; refunded: number; deducted: number }
}

export interface FeesSummary {
  month: string
  billed: number
  collected: number
  outstanding: number
  invoiceCount: number
  overdueCount: number
  overdueAmount: number
  received: number
  collectionRate: number
}

/** POST /invoices/generate: bills created for every rent cycle that is due (per hosteler's check-in date). */
export interface GenerateResult {
  created: number
  /** active hostelers checked */
  hostelers: number
  skipped: number
  errors: string[]
}

export type LateFeeResult = InvoiceWithStatus & { lateFee: number; days: number; replaced: boolean }

/** GET /hostelers row (used by the hosteler pickers on this page). */
export type HostelerListItem = Hosteler & {
  roomNumber: string | null
  bedLabel: string | null
  hostelName: string | null
  dues: number
}

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

export interface InvoiceListParams {
  hostelId?: ID | 'all'
  month?: string
  status?: InvoiceStatus | ''
  hostelerId?: ID
  q?: string
  page?: number
  limit?: number
}

export interface PaymentListParams {
  hostelId?: ID | 'all'
  from?: string
  to?: string
  mode?: PaymentMode | ''
  kind?: Payment['kind'] | ''
  hostelerId?: ID
  q?: string
  page?: number
  limit?: number
}

/* ------------------------------------------------------------------ */
/* Raw calls                                                           */
/* ------------------------------------------------------------------ */

export const feesApi = {
  invoices: (p: InvoiceListParams) => get<InvoiceList>('/invoices', { ...p }),
  invoice: (id: ID) => get<InvoiceDetail>(`/invoices/${id}`),
  generate: (body: { hostelId?: ID | 'all' }) => post<GenerateResult>('/invoices/generate', body),
  createInvoice: (body: { hostelerId: ID; month: string; items: InvoiceItem[]; dueDate: string }) =>
    post<InvoiceWithStatus>('/invoices', body),
  updateInvoice: ({ id, ...body }: { id: ID; items?: InvoiceItem[]; dueDate?: string }) => patch<InvoiceWithStatus>(`/invoices/${id}`, body),
  addLateFee: (id: ID) => post<LateFeeResult>(`/invoices/${id}/late-fee`),
  cancelInvoice: (id: ID) => post<InvoiceWithStatus>(`/invoices/${id}/cancel`),

  payments: (p: PaymentListParams) => get<PaymentList>('/payments', { ...p }),
  payment: (id: ID) => get<PaymentDetail>(`/payments/${id}`),
  recordPayment: (body: {
    hostelerId: ID
    invoiceId?: ID | null
    amount: number
    mode: PaymentMode
    reference?: string
    date?: string
    note?: string
    kind?: 'deposit' | 'advance'
  }) => post<Payment>('/payments', body),
  deletePayment: (id: ID) => del<{ ok: true; id: ID }>(`/payments/${id}`),

  dues: (hostelId?: ID | 'all') => get<DuesResponse>('/dues', { hostelId }),
  deposits: (hostelId?: ID | 'all') => get<DepositsResponse>('/deposits', { hostelId }),
  summary: (p: { month: string; hostelId?: ID | 'all' }) => get<FeesSummary>('/fees/summary', { ...p }),

  searchHostelers: (p: { q?: string; hostelId?: ID | 'all'; status?: 'all' | 'active'; limit?: number }) =>
    get<Paginated<HostelerListItem>>('/hostelers', { ...p }),
  hosteler: (id: ID) => get<HostelerListItem>(`/hostelers/${id}`),
}

/** Fetch every page of a paginated list (for CSV exports). */
export async function fetchAllPages<T, P extends { page?: number; limit?: number }>(
  fn: (p: P) => Promise<Paginated<T>>,
  params: P,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= 200; page++) {
    const res = await fn({ ...params, page, limit: 500 })
    out.push(...res.items)
    if (page >= res.pages) break
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function useInvoices(params: InvoiceListParams, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['invoices', params],
    queryFn: () => feesApi.invoices(params),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

export function usePayments(params: PaymentListParams, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['payments', params],
    queryFn: () => feesApi.payments(params),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

export function useDues(hostelId: ID | 'all') {
  return useQuery({ queryKey: ['dues', { hostelId }], queryFn: () => feesApi.dues(hostelId) })
}

export function useDeposits(hostelId: ID | 'all') {
  return useQuery({ queryKey: ['deposits', { hostelId }], queryFn: () => feesApi.deposits(hostelId) })
}

export function useFeesSummary(month: string, hostelId: ID | 'all') {
  return useQuery({
    queryKey: ['fees-summary', { month, hostelId }],
    queryFn: () => feesApi.summary({ month, hostelId }),
    placeholderData: keepPreviousData,
  })
}

/** Hosteler search for pickers (all statuses, so checked-out hostelers with dues can still pay). */
export function useHostelerSearch(q: string, hostelId: ID | 'all', enabled = true) {
  const params = { q: q.trim(), hostelId, status: 'all' as const, limit: 20 }
  return useQuery({
    queryKey: ['hostelers', 'picker', params],
    queryFn: async () => (await feesApi.searchHostelers(params)).items,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useFeesHosteler(id: ID | null | undefined) {
  return useQuery({ queryKey: ['hosteler', id], queryFn: () => feesApi.hosteler(id!), enabled: !!id })
}

/** Open (unpaid / partial / overdue) invoices of one hosteler, oldest due first. */
export function useOpenInvoices(hostelerId: ID | null | undefined) {
  return useQuery({
    queryKey: ['invoices', { hostelerId, open: true }],
    queryFn: async () => {
      const res = await feesApi.invoices({ hostelerId: hostelerId!, limit: 500 })
      return res.items.filter((i) => i.status !== 'cancelled' && i.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    },
    enabled: !!hostelerId,
  })
}

/** Security deposit already collected from a hosteler. */
export function useDepositCollected(hostelerId: ID | null | undefined) {
  return useQuery({
    queryKey: ['payments', { hostelerId, kind: 'deposit', totals: true }],
    queryFn: async () => (await feesApi.payments({ hostelerId: hostelerId!, kind: 'deposit', limit: 1 })).totals.amount,
    enabled: !!hostelerId,
  })
}

/* ------------------------------------------------------------------ */
/* Printable invoice / receipt (staff or hosteler)                     */
/* ------------------------------------------------------------------ */

export interface PrintParty {
  name: string
  phone: string
  email: string
  /** room / bed, or a status line */
  place: string
}

export interface PrintContext {
  organization: { name: string; email: string; phone: string } | null
  hostel: { name: string; address: string; city: string; phone: string } | null
  hosteler: PrintParty | null
}

export interface PrintInvoice extends PrintContext {
  invoice: InvoiceWithStatus
  payments: Payment[]
  previousBalance: PreviousBalance
  /** the hostel's UPI details (null if the hostel has none) */
  payTo: { upiId: string; payeeName: string; hasQr?: boolean } | null
}

export interface PrintReceipt extends PrintContext {
  payment: Payment
  invoice: InvoiceWithStatus | null
}

interface PortalCtx {
  organization: { name: string; phone: string; email: string; currencySymbol: string } | null
  hostel: { id: ID; name: string; address: string; city: string; phone: string; upiId?: string; payeeName?: string } | null
  hosteler: { id: ID; name: string; loginId: string; phone: string; bed: string | null } | null
}

const NO_PREVIOUS: PreviousBalance = { amount: 0, invoices: [] }

function payTo(h: { upiId?: string; payeeName?: string; hasQr?: boolean } | null | undefined) {
  return h?.upiId ? { upiId: h.upiId, payeeName: h.payeeName ?? '', hasQr: h.hasQr } : null
}

function staffParty(h: FeesHosteler | null): PrintParty | null {
  if (!h) return null
  return {
    name: h.name,
    phone: h.phone,
    email: h.email,
    place: h.status === 'checked_out' ? 'Checked out' : h.roomLabel === 'Not allotted' ? 'Bed not allotted' : h.roomLabel,
  }
}

function portalParty(h: PortalCtx['hosteler']): PrintParty | null {
  return h ? { name: h.name, phone: h.phone, email: '', place: h.bed ?? 'Bed not allotted' } : null
}

export function usePrintInvoice(id: ID | undefined) {
  const kind = useSession((s) => s.session?.kind)
  return useQuery({
    queryKey: ['invoice', id, kind],
    enabled: !!id && !!kind,
    queryFn: async (): Promise<PrintInvoice> => {
      if (kind === 'hosteler') {
        const r = await get<PortalCtx & { invoice: InvoiceWithStatus; payments: Payment[]; previousBalance?: PreviousBalance }>(`/portal/invoices/${id}`)
        return {
          invoice: r.invoice,
          payments: r.payments,
          previousBalance: r.previousBalance ?? NO_PREVIOUS,
          payTo: payTo(r.hostel),
          organization: r.organization,
          hostel: r.hostel,
          hosteler: portalParty(r.hosteler),
        }
      }
      const { payments, hosteler, hostel, organization, previousBalance, ...invoice } = await feesApi.invoice(id!)
      return {
        invoice,
        payments,
        previousBalance: previousBalance ?? NO_PREVIOUS,
        payTo: payTo(hostel),
        organization,
        hostel,
        hosteler: staffParty(hosteler),
      }
    },
  })
}

export function usePrintReceipt(id: ID | undefined) {
  const kind = useSession((s) => s.session?.kind)
  return useQuery({
    queryKey: ['payment', id, kind],
    enabled: !!id && !!kind,
    queryFn: async (): Promise<PrintReceipt> => {
      if (kind === 'hosteler') {
        const r = await get<PortalCtx & { payment: Payment; invoice: InvoiceWithStatus | null }>(`/portal/payments/${id}`)
        return { payment: r.payment, invoice: r.invoice, organization: r.organization, hostel: r.hostel, hosteler: portalParty(r.hosteler) }
      }
      const { hosteler, hostel, organization, invoice, ...payment } = await feesApi.payment(id!)
      return { payment, invoice, organization, hostel, hosteler: staffParty(hosteler) }
    },
  })
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/** Everything a money change can affect. */
export const FEES_INVALIDATE = [
  ['invoices'],
  ['invoice'],
  ['payments'],
  ['payment'],
  ['dues'],
  ['deposits'],
  ['fees-summary'],
  ['dashboard'],
  ['hosteler'],
  ['hostelers'],
  ['reports'],
]

export function useRecordPayment(onSuccess?: (p: Payment) => void) {
  return useApiMutation(feesApi.recordPayment, { invalidate: FEES_INVALIDATE, onSuccess: (p) => onSuccess?.(p) })
}

export function useDeletePayment() {
  return useApiMutation(feesApi.deletePayment, { invalidate: FEES_INVALIDATE })
}

export function useGenerateInvoices(onSuccess?: (r: GenerateResult) => void) {
  return useApiMutation(feesApi.generate, { invalidate: FEES_INVALIDATE, onSuccess: (r) => onSuccess?.(r) })
}

export function useCreateInvoice(onSuccess?: (inv: InvoiceWithStatus) => void) {
  return useApiMutation(feesApi.createInvoice, { invalidate: FEES_INVALIDATE, onSuccess: (inv) => onSuccess?.(inv) })
}

export function useUpdateInvoice(onSuccess?: (inv: InvoiceWithStatus) => void) {
  return useApiMutation(feesApi.updateInvoice, {
    invalidate: FEES_INVALIDATE,
    success: (inv) => `${inv.number} updated`,
    onSuccess: (inv) => onSuccess?.(inv),
  })
}

export function useAddLateFee() {
  return useApiMutation(feesApi.addLateFee, { invalidate: FEES_INVALIDATE })
}

export function useCancelInvoice() {
  return useApiMutation(feesApi.cancelInvoice, { invalidate: FEES_INVALIDATE, success: (inv) => `${inv.number} cancelled` })
}
