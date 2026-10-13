/**
 * Core money operations shared by fees, check-in, check-out and the
 * hosteler portal. All functions accept an optional session so callers can
 * run them inside a transaction (see withTransaction in config/db.ts).
 */
import type { ClientSession, Types } from 'mongoose'
import { Invoice } from '../models/Invoice.js'
import { Payment, PAYMENT_MODES } from '../models/Payment.js'
import { Hosteler } from '../models/Hosteler.js'
import { badRequest, conflict, notFound } from './errors.js'
import { logActivity, nextInvoiceNumber, nextReceiptNumber } from './org.js'

type Id = string | Types.ObjectId
export type PaymentMode = (typeof PAYMENT_MODES)[number]

export interface InvoiceItemInput {
  label: string
  amount: number
}

export async function createInvoice(
  orgId: Id,
  input: { hostelerId: Id; month: string; items: InvoiceItemInput[]; dueDate: string },
  session?: ClientSession,
) {
  const h = await Hosteler.findOne({ _id: input.hostelerId, orgId }).session(session ?? null)
  if (!h) throw notFound('Hosteler')
  if (!input.items.length) throw badRequest('Add at least one line item')
  const total = input.items.reduce((a, i) => a + Number(i.amount || 0), 0)
  const number = await nextInvoiceNumber(orgId, session)
  const [inv] = await Invoice.create(
    [{ orgId, hostelId: h.hostelId, hostelerId: h._id, number, month: input.month, items: input.items, total, dueDate: input.dueDate }],
    { session },
  )
  return inv!
}

export interface RecordPaymentInput {
  hostelerId: Id
  invoiceId?: Id | null
  amount: number
  mode: PaymentMode
  reference?: string
  date: string
  note?: string
  /** deposit = security deposit; advance = no invoice. Ignored when invoiceId is given (always 'rent'). */
  kind?: 'deposit' | 'advance'
  recordedBy?: 'staff' | 'hosteler'
}

/**
 * Records a payment and, if it's against an invoice, increases the invoice's
 * paidAmount — refusing to overpay. Use inside a transaction.
 */
export async function recordPayment(orgId: Id, input: RecordPaymentInput, session?: ClientSession) {
  const amount = Math.round(Number(input.amount))
  if (!(amount >= 1)) throw badRequest('Amount must be at least 1')
  const h = await Hosteler.findOne({ _id: input.hostelerId, orgId }).session(session ?? null)
  if (!h) throw notFound('Hosteler')

  let kind: 'rent' | 'deposit' | 'advance' = input.kind ?? 'advance'
  if (input.invoiceId) {
    kind = 'rent'
    // atomic "paidAmount + amount <= total" guard against concurrent overpayment
    const inv = await Invoice.findOneAndUpdate(
      {
        _id: input.invoiceId,
        orgId,
        hostelerId: h._id,
        cancelled: false,
        $expr: { $lte: [{ $add: ['$paidAmount', amount] }, '$total'] },
      },
      { $inc: { paidAmount: amount } },
      { new: true, session },
    )
    if (!inv) {
      const exists = await Invoice.findOne({ _id: input.invoiceId, orgId, hostelerId: h._id }).session(session ?? null)
      if (!exists) throw notFound('Invoice')
      if (exists.cancelled) throw badRequest('Invoice is cancelled')
      throw conflict(`Amount is more than the balance (₹${exists.total - exists.paidAmount})`)
    }
  }

  const receiptNo = await nextReceiptNumber(orgId, session)
  const [pay] = await Payment.create(
    [
      {
        orgId,
        hostelId: h.hostelId,
        hostelerId: h._id,
        invoiceId: input.invoiceId ?? null,
        kind,
        receiptNo,
        amount,
        mode: input.mode,
        reference: input.reference ?? '',
        date: input.date,
        note: input.note ?? (kind === 'deposit' ? 'Security deposit' : ''),
        recordedBy: input.recordedBy ?? 'staff',
      },
    ],
    { session },
  )
  await logActivity(orgId, `₹${amount.toLocaleString('en-IN')} received from ${h.name}`, 'payment', h.hostelId, session)
  return pay!
}

/** Deletes a payment and rolls back the invoice's paidAmount. Use inside a transaction. */
export async function deletePayment(orgId: Id, paymentId: Id, session?: ClientSession) {
  const pay = await Payment.findOneAndDelete({ _id: paymentId, orgId }, { session })
  if (!pay) throw notFound('Payment')
  if (pay.invoiceId) {
    await Invoice.updateOne({ _id: pay.invoiceId, orgId }, { $inc: { paidAmount: -pay.amount } }, { session })
  }
  return pay
}

/** Outstanding balance across all non-cancelled invoices of a hosteler. */
export async function hostelerDues(orgId: Id, hostelerId: Id, session?: ClientSession) {
  const invs = await Invoice.find({ orgId, hostelerId, cancelled: false }).select('total paidAmount').session(session ?? null).lean()
  return invs.reduce((a, i) => a + Math.max(i.total - i.paidAmount, 0), 0)
}
