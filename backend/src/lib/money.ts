/**
 * Core money operations shared by fees, check-in, check-out and the
 * hosteler portal. All functions accept an optional session so callers can
 * run them inside a transaction (see withTransaction in config/db.ts).
 */
import type { ClientSession, Types } from 'mongoose'
import { Invoice, type ChargeKey } from '../models/Invoice.js'
import { Payment, PAYMENT_MODES } from '../models/Payment.js'
import { Hosteler } from '../models/Hosteler.js'
import { badRequest, conflict, notFound } from './errors.js'
import { logActivity, nextInvoiceNumber, nextReceiptNumber } from './org.js'

type Id = string | Types.ObjectId
export type PaymentMode = (typeof PAYMENT_MODES)[number]

export interface InvoiceItemInput {
  key?: ChargeKey
  label: string
  amount: number
  ref?: string | null
}

export async function createInvoice(
  orgId: Id,
  input: { hostelerId: Id; month: string; items: InvoiceItemInput[]; dueDate: string; periodStart?: string | null; periodEnd?: string | null },
  session?: ClientSession,
) {
  const h = await Hosteler.findOne({ _id: input.hostelerId, orgId }).session(session ?? null)
  if (!h) throw notFound('Hosteler')
  if (!input.items.length) throw badRequest('Add at least one line item')
  const total = input.items.reduce((a, i) => a + Number(i.amount || 0), 0)
  const number = await nextInvoiceNumber(orgId, session)
  const [inv] = await Invoice.create(
    [
      {
        orgId,
        hostelId: h.hostelId,
        hostelerId: h._id,
        number,
        month: input.month,
        items: input.items,
        total,
        dueDate: input.dueDate,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
      },
    ],
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
 * Returns the main receipt (see recordPaymentDocs for all of them).
 */
export async function recordPayment(orgId: Id, input: RecordPaymentInput, session?: ClientSession) {
  const docs = await recordPaymentDocs(orgId, input, session)
  return docs.find((d) => d.kind !== 'deposit') ?? docs[0]!
}

/**
 * Like recordPayment, but returns every receipt created. When a bill includes
 * a "Security deposit" line, money paid on that bill goes to the deposit first
 * and is recorded as a separate deposit receipt (so it counts as deposit held,
 * not rent income); the rest is a rent receipt.
 */
export async function recordPaymentDocs(orgId: Id, input: RecordPaymentInput, session?: ClientSession) {
  const amount = Math.round(Number(input.amount))
  if (!(amount >= 1)) throw badRequest('Amount must be at least 1')
  const h = await Hosteler.findOne({ _id: input.hostelerId, orgId }).session(session ?? null)
  if (!h) throw notFound('Hosteler')

  let kind: 'rent' | 'deposit' | 'advance' = input.kind ?? 'advance'
  let depositPart = 0
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
    const depositLines = inv.items.filter((i) => i.key === 'deposit').reduce((a, i) => a + i.amount, 0)
    if (depositLines > 0) {
      const alreadyPaid = (await Payment.find({ orgId, invoiceId: inv._id, kind: 'deposit' }).select('amount').session(session ?? null).lean()).reduce(
        (a, p) => a + p.amount,
        0,
      )
      depositPart = Math.min(amount, Math.max(depositLines - alreadyPaid, 0))
    }
  }

  const parts: { kind: 'rent' | 'deposit' | 'advance'; amount: number; note: string }[] = []
  if (depositPart > 0) parts.push({ kind: 'deposit', amount: depositPart, note: `Security deposit${input.note ? ` · ${input.note}` : ''}` })
  if (amount - depositPart > 0) parts.push({ kind, amount: amount - depositPart, note: input.note ?? (kind === 'deposit' ? 'Security deposit' : '') })

  const docs = []
  for (const part of parts) {
    const receiptNo = await nextReceiptNumber(orgId, session)
    const [pay] = await Payment.create(
      [
        {
          orgId,
          hostelId: h.hostelId,
          hostelerId: h._id,
          invoiceId: input.invoiceId ?? null,
          kind: part.kind,
          receiptNo,
          amount: part.amount,
          mode: input.mode,
          reference: input.reference ?? '',
          date: input.date,
          note: part.note,
          recordedBy: input.recordedBy ?? 'staff',
        },
      ],
      { session },
    )
    docs.push(pay!)
  }
  await logActivity(orgId, `₹${amount.toLocaleString('en-IN')} received from ${h.name}`, 'payment', h.hostelId, session)
  return docs
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

/**
 * Applies a received amount to the hosteler's unpaid bills, OLDEST FIRST
 * (by due date, then month), creating one Payment per bill touched.
 * Refuses amounts larger than the total outstanding. Use inside a transaction.
 */
export async function allocatePayment(
  orgId: Id,
  input: Omit<RecordPaymentInput, 'invoiceId' | 'kind'>,
  session?: ClientSession,
) {
  let remaining = Math.round(Number(input.amount))
  if (!(remaining >= 1)) throw badRequest('Amount must be at least 1')
  const open = await Invoice.find({ orgId, hostelerId: input.hostelerId, cancelled: false, $expr: { $gt: ['$total', '$paidAmount'] } })
    .sort({ dueDate: 1, month: 1, createdAt: 1 })
    .session(session ?? null)
  const dues = open.reduce((a, i) => a + (i.total - i.paidAmount), 0)
  if (dues <= 0) throw badRequest('This hosteler has no unpaid bills')
  if (remaining > dues) throw badRequest(`Amount is more than the total due (₹${dues.toLocaleString('en-IN')})`)
  const payments = []
  const applied: { invoiceId: string; number: string; amount: number }[] = []
  for (const inv of open) {
    if (remaining <= 0) break
    const part = Math.min(remaining, inv.total - inv.paidAmount)
    payments.push(...(await recordPaymentDocs(orgId, { ...input, invoiceId: inv._id, amount: part }, session)))
    applied.push({ invoiceId: String(inv._id), number: inv.number, amount: part })
    remaining -= part
  }
  return { payments, applied }
}
