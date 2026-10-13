/**
 * Monthly bill line items and carried-forward balances.
 *
 * Unpaid amounts are never copied into a new bill (that would count them
 * twice). Each month's bill keeps its own lines; what is still unpaid from
 * older bills is shown as "previous balance", and any payment is applied to
 * the OLDEST unpaid bill first (see allocatePayment in money.ts).
 */
import type { ClientSession, Types } from 'mongoose'
import { Invoice, type ChargeKey } from '../models/Invoice.js'

type Id = string | Types.ObjectId

export interface BillItem {
  key: ChargeKey
  label: string
  amount: number
}

interface HostelCharges {
  mess?: number | null
  electricity?: number | null
  water?: number | null
  internet?: number | null
  laundry?: number | null
  maintenance?: number | null
  others?: { label: string; amount: number }[] | null
}

/**
 * Everything else (water, internet, cleaning, maintenance…) is included in the
 * room rent, so electricity is the only extra monthly charge besides mess.
 * (The other charge fields still exist in the schema for older data but are not billed.)
 */
const FIXED: { key: 'electricity'; label: string }[] = [{ key: 'electricity', label: 'Electricity' }]

/**
 * Lines for one hosteler's monthly bill: room rent (includes water, internet, cleaning…),
 * mess fees (if opted) and electricity (if the hostel charges it).
 * `fallbackMess` = organization-wide mess charge, used when the hostel has none set.
 */
export function monthlyBillItems(
  hosteler: { monthlyRent: number; messOpted: boolean },
  charges: HostelCharges | null | undefined,
  fallbackMess = 0,
): BillItem[] {
  const c = charges ?? {}
  const items: BillItem[] = [{ key: 'rent', label: 'Room rent', amount: hosteler.monthlyRent }]
  const mess = c.mess && c.mess > 0 ? c.mess : fallbackMess
  if (hosteler.messOpted && mess > 0) items.push({ key: 'mess', label: 'Mess fees', amount: mess })
  for (const f of FIXED) {
    const amount = Number(c[f.key] ?? 0)
    if (amount > 0) items.push({ key: f.key, label: f.label, amount })
  }
  return items
}

/** Unpaid balance of a hosteler's bills older than `invoice` (by due date, then month). */
export async function previousBalance(
  orgId: Id,
  invoice: { _id: unknown; hostelerId: unknown; dueDate: string; month: string },
  session?: ClientSession,
) {
  const older = await Invoice.find({
    orgId,
    hostelerId: invoice.hostelerId,
    cancelled: false,
    _id: { $ne: invoice._id },
    $expr: { $gt: ['$total', '$paidAmount'] },
    $or: [{ dueDate: { $lt: invoice.dueDate } }, { dueDate: invoice.dueDate, month: { $lt: invoice.month } }],
  })
    .select('number month total paidAmount dueDate')
    .sort({ dueDate: 1, month: 1 })
    .session(session ?? null)
    .lean()
  return {
    amount: older.reduce((a, i) => a + (i.total - i.paidAmount), 0),
    invoices: older.map((i) => ({ id: String(i._id), number: i.number, month: i.month, balance: i.total - i.paidAmount, dueDate: i.dueDate })),
  }
}
