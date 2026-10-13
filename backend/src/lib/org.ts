import type { ClientSession, Types } from 'mongoose'
import { Organization } from '../models/Organization.js'
import { Hostel } from '../models/Hostel.js'
import { Activity } from '../models/Operations.js'
import { badRequest, notFound } from './errors.js'

type Id = string | Types.ObjectId

/** Atomically reserve the next invoice number, e.g. INV-1001 */
export async function nextInvoiceNumber(orgId: Id, session?: ClientSession) {
  const org = await Organization.findByIdAndUpdate(orgId, { $inc: { invoiceSeq: 1 } }, { new: true, session })
  if (!org) throw notFound('Organization')
  return `INV-${org.invoiceSeq}`
}

/** Atomically reserve the next receipt number, e.g. RCPT-5001 */
export async function nextReceiptNumber(orgId: Id, session?: ClientSession) {
  const org = await Organization.findByIdAndUpdate(orgId, { $inc: { receiptSeq: 1 } }, { new: true, session })
  if (!org) throw notFound('Organization')
  return `${org.settings?.receiptPrefix || 'RCPT'}-${org.receiptSeq}`
}

export async function getSettings(orgId: Id) {
  const org = await Organization.findById(orgId).select('settings plan').lean()
  if (!org) throw notFound('Organization')
  return { settings: org.settings!, plan: org.plan }
}

/** Make sure a hostel belongs to the org; returns it. */
export async function assertHostel(orgId: Id, hostelId: Id | undefined | null, session?: ClientSession) {
  if (!hostelId) throw badRequest('hostelId is required')
  const hostel = await Hostel.findOne({ _id: hostelId, orgId }).session(session ?? null)
  if (!hostel) throw notFound('Hostel')
  return hostel
}

/**
 * Optional `?hostelId=` filter used by list endpoints (the top-bar hostel
 * switcher in the app). Returns a mongo filter fragment.
 */
export function hostelScope(query: Record<string, unknown>): { hostelId?: string } {
  const h = query.hostelId
  return typeof h === 'string' && h && h !== 'all' ? { hostelId: h } : {}
}

export async function logActivity(
  orgId: Id,
  message: string,
  kind: 'checkin' | 'checkout' | 'payment' | 'complaint' | 'leave' | 'document' | 'room' | 'general' = 'general',
  hostelId: Id | null = null,
  session?: ClientSession,
) {
  await Activity.create([{ orgId, hostelId, kind, message }], { session })
}
