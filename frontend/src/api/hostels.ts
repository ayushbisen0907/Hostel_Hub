/**
 * Hostel CRUD (backend/src/modules/hostels/routes.ts). Listing lives in
 * common.ts (useHostels). Owner / manager only.
 */
import { del, get, patch, post, upload } from './client'
import { useApiMutation } from './query'
import type { Hostel, HostelCharges, HostelType, ID } from './types'

export interface HostelInput {
  name: string
  type: HostelType
  address: string
  city: string
  phone: string
  /** optional hosteler-ID prefix (2-8 letters/digits); blank = auto */
  code?: string
  /** where hostelers pay rent (required when creating) */
  upiId: string
  payeeName: string
  charges?: HostelCharges
  /** ₹ per unit (0 = electricity not charged) */
  electricityRate?: number
  electricityBasis?: 'room' | 'bed'
  /** 0–90 days (default 30) */
  noticePeriodDays?: number
  /** 0 = always refundable, else 1–12 months */
  depositMinStayMonths?: number
  /** ≤ 10000 chars; a change asks every active hosteler to sign again */
  rulesText?: string
}

export const hostelsApi = {
  create: (body: HostelInput) => post<Hostel>('/hostels', body),
  update: ({ id, ...body }: Partial<HostelInput> & { id: ID }) => patch<Hostel>(`/hostels/${id}`, body),
  remove: (id: ID) => del<{ ok: true }>(`/hostels/${id}`),
  /** UPI QR image (≤ 2 MB) */
  uploadQr: ({ id, file }: { id: ID; file: File }) => upload<Hostel>(`/hostels/${id}/qr`, file, {}, 'put'),
  removeQr: (id: ID) => del<Hostel>(`/hostels/${id}/qr`),
  /** Suggested rules built from the hostel's and the organization's settings (nothing is saved). */
  defaultRules: (id: ID) => get<{ rulesText: string }>(`/hostels/${id}/default-rules`),
}

export const hostelQrUrl = (id: ID) => `/hostels/${id}/qr`

// counts and usage appear in the org, dashboard, reports and room screens
const INVALIDATE = [['hostels'], ['org'], ['dashboard'], ['reports'], ['rooms']]

/** Errors are not toasted: the form shows them inline (e.g. 409 code taken). */
export function useCreateHostel(onSuccess?: (h: Hostel) => void) {
  return useApiMutation(hostelsApi.create, { invalidate: INVALIDATE, success: (h) => `${h.name} added`, onSuccess: (h) => onSuccess?.(h), toastErrors: false })
}

/** Errors are not toasted: the form shows them inline. */
export function useUpdateHostel(onSuccess?: (h: Hostel) => void) {
  return useApiMutation(hostelsApi.update, { invalidate: INVALIDATE, success: 'Hostel updated', onSuccess: (h) => onSuccess?.(h), toastErrors: false })
}

export function useDeleteHostel() {
  return useApiMutation(hostelsApi.remove, { invalidate: INVALIDATE })
}

/** Errors are not toasted: the hostel form shows them inline. */
export function useUploadHostelQr() {
  return useApiMutation(hostelsApi.uploadQr, { invalidate: [['hostels']], toastErrors: false })
}

export function useRemoveHostelQr() {
  return useApiMutation(hostelsApi.removeQr, { invalidate: [['hostels']], toastErrors: false })
}
