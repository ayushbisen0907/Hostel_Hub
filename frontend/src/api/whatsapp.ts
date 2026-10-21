/**
 * WhatsApp bill messages through Pabbly Chatflow (backend/src/lib/whatsapp.ts): from HostelHub's
 * number, or the hostel's own number once HostelHub has connected it. Each hostel switches them
 * on or off. Starter plan and up.
 *
 *   GET  /hostels/:id/whatsapp        { enabled, ready, sender, number, templateText }
 *   PUT  /hostels/:id/whatsapp        { enabled }
 *   POST /hostels/:id/whatsapp/test   { phone }
 *   GET  /invoices/:id/whatsapp       messages of a bill, newest first
 *   POST /invoices/:id/whatsapp       send the bill again
 */
import { useQuery } from '@tanstack/react-query'
import { get, post, put } from './client'
import { useApiMutation } from './query'
import type { ID } from './types'

export type WhatsAppStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface HostelWhatsApp {
  enabled: boolean
  /** a number is available to send from */
  ready: boolean
  /** 'own' = the hostel's own number (connected by HostelHub), 'default' = HostelHub's number */
  sender: 'own' | 'default' | null
  /** the number messages go out from, e.g. +91 96913 03358 ('' if not shown) */
  number: string
  /** the approved Chatflow template ({{1}}…{{7}}) */
  templateText: string
}

export interface WhatsAppMessageRow {
  id: ID
  status: WhatsAppStatus
  auto: boolean
  to: string
  attempts: number
  error: string
  sentAt: string | null
  createdAt: string
}

/** Latest message of a bill, as included in invoice lists. */
export interface InvoiceWhatsApp {
  status: WhatsAppStatus
  error: string
  sentAt: string | null
}

export const whatsappKey = (hostelId: ID) => ['hostels', hostelId, 'whatsapp'] as const

export function useHostelWhatsApp(hostelId: ID | null) {
  return useQuery({ queryKey: whatsappKey(hostelId ?? ''), queryFn: () => get<HostelWhatsApp>(`/hostels/${hostelId}/whatsapp`), enabled: !!hostelId })
}

/** Errors are not toasted: the dialog shows them inline. */
export function useSaveHostelWhatsApp() {
  return useApiMutation(
    ({ hostelId, enabled }: { hostelId: ID; enabled: boolean }) => put<HostelWhatsApp>(`/hostels/${hostelId}/whatsapp`, { enabled }),
    { invalidate: [['hostels']], success: (w) => (w.enabled ? 'Bills will now be sent on WhatsApp' : 'WhatsApp bill messages turned off'), toastErrors: false },
  )
}

/** Errors are not toasted: the dialog shows them inline. */
export function useTestHostelWhatsApp() {
  return useApiMutation(
    ({ hostelId, phone }: { hostelId: ID; phone: string }) => post<{ ok: true; to: string; messageId: string }>(`/hostels/${hostelId}/whatsapp/test`, { phone }),
    { success: (r) => `Test message sent to +${r.to}`, toastErrors: false },
  )
}

export function useResendBillWhatsApp() {
  return useApiMutation((invoiceId: ID) => post<WhatsAppMessageRow>(`/invoices/${invoiceId}/whatsapp`), {
    invalidate: [['invoices']],
    success: (m) => (m.status === 'sent' ? 'Bill sent on WhatsApp' : m.status === 'failed' ? `WhatsApp failed: ${m.error}` : 'WhatsApp message queued — it will be retried'),
  })
}
