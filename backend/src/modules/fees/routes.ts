/**
 * Fees: invoices, payments, dues, deposits (mounted at '/', so every route
 * carries its full path and its own auth middleware).
 *
 *   GET    /api/invoices                 ?month ?status ?hostelerId ?hostelId ?q ?page ?limit
 *   GET    /api/invoices/:id             everything the printable invoice needs
 *   POST   /api/invoices/generate        { month, hostelId? } -> { created, skipped }
 *   POST   /api/invoices                 custom invoice { hostelerId, month, items[], dueDate }
 *   PATCH  /api/invoices/:id             { items?, dueDate? }
 *   POST   /api/invoices/:id/late-fee    add / replace "Late fee (N days)" line
 *   POST   /api/invoices/:id/cancel      only when nothing has been paid against it
 *
 *   GET    /api/payments                 ?from ?to ?mode ?kind ?hostelerId ?hostelId ?q ?page ?limit
 *   GET    /api/payments/:id             receipt data
 *   POST   /api/payments                 record rent / deposit / advance
 *   DELETE /api/payments/:id             rolls back the invoice's paidAmount
 *
 *   GET    /api/dues                     ?hostelId — outstanding per hosteler
 *   GET    /api/deposits                 ?hostelId — security deposits held / refunded
 *   GET    /api/fees/summary             ?month ?hostelId
 */
import { Router } from 'express'
import mongoose, { Types } from 'mongoose'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { ah, dateStr, escapeRegex, idParam, money, monthStr, objectId, paginate, paginationQuery, parse, todayStr } from '../../lib/http.js'
import { createInvoice, deletePayment, recordPayment } from '../../lib/money.js'
import { assertHostel, getSettings, hostelScope, logActivity } from '../../lib/org.js'
import { toApi } from '../../models/_base.js'
import { Bed } from '../../models/Bed.js'
import { Hostel } from '../../models/Hostel.js'
import { Hosteler } from '../../models/Hosteler.js'
import { CHARGE_KEYS, Invoice, invoiceStatus, type ChargeKey, type InvoiceStatus } from '../../models/Invoice.js'
import { monthlyBillItems, previousBalance } from '../../lib/billing.js'
import { applyElectricityToBill } from '../../lib/electricity.js'
import { notifyHostelers } from '../../lib/notify.js'
import { Organization } from '../../models/Organization.js'
import { Payment, PAYMENT_MODES } from '../../models/Payment.js'
import { PaymentClaim } from '../../models/PaymentClaim.js'
import { Room } from '../../models/Room.js'

export const router = Router()

/** YYYY-MM with a real month (01-12). */
const validMonth = monthStr.refine((m) => { const n = Number(m.slice(5)); return n >= 1 && n <= 12 }, { message: 'Invalid month' })

const fees = requireStaff('fees')

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type Filter = Record<string, unknown>

function oid(v: string | Types.ObjectId, name = 'id'): Types.ObjectId {
  if (v instanceof Types.ObjectId) return v
  if (!mongoose.isValidObjectId(v)) throw badRequest(`Invalid ${name}`)
  return new Types.ObjectId(v)
}

/** `?hostelId=` as an ObjectId filter fragment (aggregation pipelines don't cast). */
function scopeOf(query: Record<string, unknown>): { hostelId?: Types.ObjectId } {
  const s = hostelScope(query)
  return s.hostelId ? { hostelId: oid(s.hostelId, 'hostelId') } : {}
}

/** Whole days from `from` to `to` (YYYY-MM-DD). */
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
function daysOverdue(dueDate: string, today = todayStr()) {
  return Math.max(daysBetween(dueDate, today), 0)
}

function dueDateFor(month: string, dueDay: number) {
  const d = Math.min(Math.max(dueDay || 1, 1), 28)
  return `${month}-${String(d).padStart(2, '0')}`
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)

/** Mongo filter equivalent of invoiceStatus() so status filtering paginates correctly. */
function statusFilter(status: InvoiceStatus, today: string): Filter {
  const open = { cancelled: false, $expr: { $lt: ['$paidAmount', '$total'] } }
  switch (status) {
    case 'cancelled':
      return { cancelled: true }
    case 'paid':
      return { cancelled: false, $expr: { $gte: ['$paidAmount', '$total'] } }
    case 'overdue':
      return { ...open, dueDate: { $lt: today } }
    case 'partial':
      return { ...open, dueDate: { $gte: today }, paidAmount: { $gt: 0 } }
    case 'unpaid':
      return { ...open, dueDate: { $gte: today }, paidAmount: { $lte: 0 } }
  }
}

type InvoiceLike = { _id: unknown; cancelled: boolean; total: number; paidAmount: number; dueDate: string }

function invoiceOut<T extends InvoiceLike>(inv: T, today: string) {
  return {
    ...toApi(inv),
    status: invoiceStatus(inv, today),
    balance: inv.cancelled ? 0 : Math.max(inv.total - inv.paidAmount, 0),
  }
}

/** Hosteler summaries (with room/bed label) keyed by id. */
async function hostelerInfo(orgId: Types.ObjectId, ids: unknown[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))]
  const hs = await Hosteler.find({ orgId, _id: { $in: unique } })
    .select('name phone loginId guardianName guardianPhone email status hostelId roomId bedId')
    .lean()
  const [beds, rooms] = await Promise.all([
    Bed.find({ orgId, _id: { $in: hs.map((h) => h.bedId).filter(Boolean) } }).select('label roomId').lean(),
    Room.find({ orgId, _id: { $in: hs.map((h) => h.roomId).filter(Boolean) } }).select('number').lean(),
  ])
  const bedMap = new Map(beds.map((b) => [String(b._id), b]))
  const roomMap = new Map(rooms.map((r) => [String(r._id), r]))
  return new Map(
    hs.map((h) => {
      const bed = h.bedId ? bedMap.get(String(h.bedId)) : undefined
      const room = bed ? roomMap.get(String(h.roomId)) : undefined
      return [
        String(h._id),
        {
          id: String(h._id),
          name: h.name,
          phone: h.phone,
          loginId: h.loginId,
          email: h.email,
          guardianName: h.guardianName,
          guardianPhone: h.guardianPhone,
          status: h.status,
          hostelId: String(h.hostelId),
          roomLabel: bed && room ? `Room ${room.number} · Bed ${bed.label}` : 'Not allotted',
        },
      ] as const
    }),
  )
}

async function hostelNames(orgId: Types.ObjectId, ids: unknown[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))]
  const hs = await Hostel.find({ orgId, _id: { $in: unique } }).select('name').lean()
  return new Map(hs.map((h) => [String(h._id), h.name]))
}

/** Hostel + organization blocks for printable invoices / receipts. */
async function hostelAndOrg(orgId: Types.ObjectId, hostelId: unknown) {
  const [hostel, org] = await Promise.all([
    Hostel.findOne({ _id: hostelId, orgId }).select('name address city phone code upiId payeeName').lean(),
    Organization.findById(orgId).select('name ownerName email phone settings').lean(),
  ])
  return {
    hostel: hostel
      ? { id: String(hostel._id), name: hostel.name, address: hostel.address, city: hostel.city, phone: hostel.phone, code: hostel.code, upiId: hostel.upiId, payeeName: hostel.payeeName }
      : null,
    organization: org
      ? {
          id: String(org._id),
          name: org.name,
          ownerName: org.ownerName,
          email: org.email,
          phone: org.phone,
          currencySymbol: org.settings?.currencySymbol ?? '₹',
        }
      : null,
  }
}

/** Hosteler ids in the org whose name / phone / login id match `q`. */
async function matchHostelers(orgId: Types.ObjectId, q: string) {
  const rx = new RegExp(escapeRegex(q), 'i')
  const hs = await Hosteler.find({ orgId, $or: [{ name: rx }, { loginId: rx }, { phone: rx }] }).select('_id').lean()
  return hs.map((h) => h._id)
}

/**
 * Atomically sets items/total/dueDate, refusing (409) if payments already
 * exceed the new total — checked inside the same update so a concurrent
 * payment can't slip in between.
 */
async function applyInvoiceChange(orgId: Types.ObjectId, id: string, set: { items?: { key?: ChargeKey; label: string; amount: number }[]; dueDate?: string }) {
  const $set: Filter = {}
  let guard: Filter = {}
  if (set.items) {
    const total = sum(set.items, (i) => Number(i.amount || 0))
    $set.items = set.items
    $set.total = total
    guard = { $expr: { $lte: ['$paidAmount', total] } }
  }
  if (set.dueDate) $set.dueDate = set.dueDate
  const inv = await Invoice.findOneAndUpdate({ _id: id, orgId, cancelled: false, ...guard }, { $set }, { new: true, runValidators: true }).lean()
  if (inv) return inv
  const exists = await Invoice.findOne({ _id: id, orgId }).lean()
  if (!exists) throw notFound('Invoice')
  if (exists.cancelled) throw badRequest('Invoice is cancelled')
  throw conflict(`Total can't be less than the amount already paid (₹${exists.paidAmount})`)
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

const itemSchema = z.object({ key: z.enum(CHARGE_KEYS).default('other'), label: z.string().trim().min(1).max(120), amount: money })
const itemsSchema = z.array(itemSchema).min(1, 'Add at least one line item').max(50)

const invoiceListQuery = paginationQuery.extend({
  month: validMonth.optional(),
  status: z.enum(['paid', 'partial', 'unpaid', 'overdue', 'cancelled']).optional(),
  hostelerId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
})

router.get(
  '/invoices',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const query = parse(invoiceListQuery, req.query)
    const today = todayStr()
    const filter: Filter = { orgId, ...scopeOf(req.query) }
    if (query.month) filter.month = query.month
    if (query.hostelerId) filter.hostelerId = oid(query.hostelerId)
    if (query.status) Object.assign(filter, statusFilter(query.status, today))
    if (query.q) {
      const ids = await matchHostelers(orgId, query.q)
      filter.$or = [{ number: new RegExp(escapeRegex(query.q), 'i') }, { hostelerId: { $in: ids } }]
    }

    const [docs, total, agg] = await Promise.all([
      Invoice.find(filter)
        .sort({ month: -1, createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Invoice.countDocuments(filter),
      // totals over the whole (unpaginated) result, ignoring cancelled invoices
      Invoice.aggregate<{ total: number; paid: number; balance: number }>([
        { $match: { ...filter, cancelled: query.status === 'cancelled' } },
        {
          $group: {
            _id: null,
            total: { $sum: '$total' },
            paid: { $sum: { $min: ['$paidAmount', '$total'] } },
            balance: { $sum: { $max: [{ $subtract: ['$total', '$paidAmount'] }, 0] } },
          },
        },
      ]),
    ])
    const [info, hostels] = await Promise.all([
      hostelerInfo(orgId, docs.map((d) => d.hostelerId)),
      hostelNames(orgId, docs.map((d) => d.hostelId)),
    ])
    const items = docs.map((d) => {
      const h = info.get(String(d.hostelerId))
      return {
        ...invoiceOut(d, today),
        hosteler: h ? { id: h.id, name: h.name, phone: h.phone, loginId: h.loginId } : null,
        roomLabel: h?.roomLabel ?? 'Not allotted',
        hostelName: hostels.get(String(d.hostelId)) ?? '',
      }
    })
    const t = agg[0] ?? { total: 0, paid: 0, balance: 0 }
    res.json({
      ...paginate(items, total, query.page, query.limit),
      totals: query.status === 'cancelled' ? { total: 0, paid: 0, balance: 0 } : { total: t.total, paid: t.paid, balance: t.balance },
    })
  }),
)

router.post(
  '/invoices/generate',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const body = parse(z.object({ month: validMonth, hostelId: z.union([objectId, z.literal('all')]).optional() }), req.body)
    const hostelId = body.hostelId && body.hostelId !== 'all' ? oid(body.hostelId) : undefined
    if (hostelId) await assertHostel(orgId, hostelId)
    const { settings } = await getSettings(orgId)
    const dueDate = dueDateFor(body.month, settings.rentDueDay)

    // The "already billed" check runs inside the transaction: concurrent
    // generate calls conflict on the org's invoice counter, and the retried
    // transaction sees what the other call committed — so it stays idempotent.
    const result = await withTransaction(async (session) => {
      const eligible = await Hosteler.find({
        orgId,
        status: 'active',
        ...(hostelId ? { hostelId } : {}),
        checkInDate: { $lte: `${body.month}-31` },
      })
        .select('hostelId monthlyRent messOpted depositToBill')
        .session(session)
        .lean()
      const billedIds = await Invoice.distinct('hostelerId', {
        orgId,
        month: body.month,
        cancelled: false,
        hostelerId: { $in: eligible.map((h) => h._id) },
      }).session(session)
      const billed = new Set(billedIds.map(String))
      const targets = eligible.filter((h) => !billed.has(String(h._id)))
      const hostelDocs = await Hostel.find({ orgId, _id: { $in: [...new Set(targets.map((h) => String(h.hostelId)))] } })
        .select('charges name')
        .session(session)
        .lean()
      const chargesByHostel = new Map(hostelDocs.map((x) => [String(x._id), x.charges]))
      const monthLabel = new Date(`${body.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      for (const h of targets) {
        const items = monthlyBillItems(h, chargesByHostel.get(String(h.hostelId)), settings.messMonthlyCharge)
        if (h.depositToBill > 0) {
          items.push({ key: 'deposit', label: 'Security deposit', amount: h.depositToBill })
          await Hosteler.updateOne({ _id: h._id }, { $set: { depositToBill: 0 } }, { session })
        }
        let inv = await createInvoice(orgId, { hostelerId: h._id, month: body.month, items, dueDate }, session)
        // electricity readings entered before the bill existed
        if (await applyElectricityToBill(orgId, h._id, body.month, session)) inv = (await Invoice.findById(inv._id).session(session))!
        await notifyHostelers(
          orgId,
          [h._id],
          {
            type: 'bill_generated',
            hostelId: h.hostelId,
            title: `${monthLabel} bill: ₹${inv.total.toLocaleString('en-IN')}`,
            body: `Your bill ${inv.number} is ready. Due by ${dueDate}. Pay to the hostel's UPI and report the transaction ID in the app.`,
            link: '/portal/fees',
          },
          session,
        )
      }
      if (targets.length)
        await logActivity(orgId, `${targets.length} invoice${targets.length === 1 ? '' : 's'} generated for ${body.month}`, 'payment', hostelId ?? null, session)
      return { created: targets.length, skipped: eligible.length - targets.length }
    })
    res.json({ month: body.month, dueDate, ...result })
  }),
)

router.post(
  '/invoices',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const body = parse(z.object({ hostelerId: objectId, month: validMonth, items: itemsSchema, dueDate: dateStr }), req.body)
    const inv = await withTransaction((session) => createInvoice(orgId, body, session))
    res.status(201).json({
      ...inv.toJSON(),
      status: invoiceStatus(inv, todayStr()),
      balance: Math.max(inv.total - inv.paidAmount, 0),
    })
  }),
)

router.get(
  '/invoices/:id',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const inv = await Invoice.findOne({ _id: idParam(req), orgId }).lean()
    if (!inv) throw notFound('Invoice')
    const [payments, info, ho] = await Promise.all([
      Payment.find({ orgId, invoiceId: inv._id }).sort({ date: 1, createdAt: 1 }).lean(),
      hostelerInfo(orgId, [inv.hostelerId]),
      hostelAndOrg(orgId, inv.hostelId),
    ])
    const today = todayStr()
    res.json({
      ...invoiceOut(inv, today),
      daysOverdue: invoiceStatus(inv, today) === 'overdue' ? daysOverdue(inv.dueDate, today) : 0,
      payments: payments.map((p) => toApi(p)),
      previousBalance: await previousBalance(orgId, inv),
      hosteler: info.get(String(inv.hostelerId)) ?? null,
      ...ho,
    })
  }),
)

router.patch(
  '/invoices/:id',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const id = idParam(req)
    const body = parse(z.object({ items: itemsSchema.optional(), dueDate: dateStr.optional() }), req.body)
    if (!body.items && !body.dueDate) throw badRequest('Nothing to update')
    const inv = await applyInvoiceChange(orgId, id, body)
    res.json(invoiceOut(inv, todayStr()))
  }),
)

const LATE_FEE_RX = /^Late fee \(\d+ days?\)$/

router.post(
  '/invoices/:id/late-fee',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const id = idParam(req)
    const inv = await Invoice.findOne({ _id: id, orgId }).lean()
    if (!inv) throw notFound('Invoice')
    const today = todayStr()
    if (invoiceStatus(inv, today) !== 'overdue') throw badRequest('This invoice is not overdue')
    const { settings } = await getSettings(orgId)
    const days = daysOverdue(inv.dueDate, today)
    const fee = days * (settings.lateFeePerDay ?? 0)
    if (fee <= 0) throw badRequest('Set a late fee per day in Settings first')
    const kept = inv.items.filter((it) => it.key !== 'late_fee' && !LATE_FEE_RX.test(it.label))
    const replaced = kept.length !== inv.items.length
    const items = [
      ...kept.map((it) => ({ key: it.key ?? ('other' as const), label: it.label, amount: it.amount })),
      { key: 'late_fee' as const, label: `Late fee (${days} day${days === 1 ? '' : 's'})`, amount: fee },
    ]
    const updated = await applyInvoiceChange(orgId, id, { items })
    res.json({ ...invoiceOut(updated, today), lateFee: fee, days, replaced })
  }),
)

router.post(
  '/invoices/:id/cancel',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const id = idParam(req)
    // `paidAmount <= 0` in the filter makes this atomic with recordPayment's guarded $inc
    const inv = await Invoice.findOneAndUpdate(
      { _id: id, orgId, cancelled: false, paidAmount: { $lte: 0 } },
      { $set: { cancelled: true } },
      { new: true },
    ).lean()
    if (!inv) {
      const exists = await Invoice.findOne({ _id: id, orgId }).lean()
      if (!exists) throw notFound('Invoice')
      if (exists.cancelled) throw conflict('Invoice is already cancelled')
      throw conflict('Payments are recorded against this invoice. Delete them first to cancel it.')
    }
    await logActivity(orgId, `Invoice ${inv.number} cancelled`, 'payment', inv.hostelId)
    res.json(invoiceOut(inv, todayStr()))
  }),
)

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

const paymentListQuery = paginationQuery.extend({
  from: dateStr.optional(),
  to: dateStr.optional(),
  mode: z.enum(PAYMENT_MODES).optional(),
  kind: z.enum(['rent', 'deposit', 'advance']).optional(),
  hostelerId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
})

router.get(
  '/payments',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const query = parse(paymentListQuery, req.query)
    const filter: Filter = { orgId, ...scopeOf(req.query) }
    if (query.from || query.to) filter.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) }
    if (query.mode) filter.mode = query.mode
    if (query.kind) filter.kind = query.kind
    if (query.hostelerId) filter.hostelerId = oid(query.hostelerId)
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i')
      const ids = await matchHostelers(orgId, query.q)
      filter.$or = [{ receiptNo: rx }, { reference: rx }, { hostelerId: { $in: ids } }]
    }
    const [docs, total, byModeAgg] = await Promise.all([
      Payment.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Payment.countDocuments(filter),
      Payment.aggregate<{ _id: string; amount: number; count: number }>([
        { $match: filter },
        { $group: { _id: '$mode', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ])
    const [info, invs, hostels] = await Promise.all([
      hostelerInfo(orgId, docs.map((d) => d.hostelerId)),
      Invoice.find({ orgId, _id: { $in: docs.map((d) => d.invoiceId).filter(Boolean) } }).select('number month').lean(),
      hostelNames(orgId, docs.map((d) => d.hostelId)),
    ])
    const invMap = new Map(invs.map((i) => [String(i._id), i]))
    const items = docs.map((d) => {
      const h = info.get(String(d.hostelerId))
      const inv = d.invoiceId ? invMap.get(String(d.invoiceId)) : undefined
      return {
        ...toApi(d),
        hosteler: h ? { id: h.id, name: h.name, phone: h.phone, loginId: h.loginId } : null,
        roomLabel: h?.roomLabel ?? 'Not allotted',
        invoice: inv ? { id: String(inv._id), number: inv.number, month: inv.month } : null,
        hostelName: hostels.get(String(d.hostelId)) ?? '',
      }
    })
    const byMode = Object.fromEntries(PAYMENT_MODES.map((m) => [m, 0])) as Record<string, number>
    for (const g of byModeAgg) byMode[g._id] = g.amount
    res.json({
      ...paginate(items, total, query.page, query.limit),
      totals: { amount: sum(byModeAgg, (g) => g.amount), count: sum(byModeAgg, (g) => g.count), byMode },
    })
  }),
)

router.get(
  '/payments/:id',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const pay = await Payment.findOne({ _id: idParam(req), orgId }).lean()
    if (!pay) throw notFound('Payment')
    const [inv, info, ho] = await Promise.all([
      pay.invoiceId ? Invoice.findOne({ _id: pay.invoiceId, orgId }).lean() : null,
      hostelerInfo(orgId, [pay.hostelerId]),
      hostelAndOrg(orgId, pay.hostelId),
    ])
    res.json({
      ...toApi(pay),
      hosteler: info.get(String(pay.hostelerId)) ?? null,
      invoice: inv ? invoiceOut(inv, todayStr()) : null,
      ...ho,
    })
  }),
)

const paymentBody = z.object({
  hostelerId: objectId,
  invoiceId: objectId.nullish(),
  amount: z.coerce.number().int('Amount must be a whole number').min(1, 'Amount must be at least 1').max(10_000_000),
  mode: z.enum(PAYMENT_MODES),
  reference: z.string().trim().max(100).default(''),
  date: dateStr.default(() => todayStr()),
  note: z.string().trim().max(500).optional(),
  kind: z.enum(['deposit', 'advance']).optional(),
})

router.post(
  '/payments',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const body = parse(paymentBody, req.body)
    const pay = await withTransaction((session) => recordPayment(orgId, { ...body, recordedBy: 'staff' }, session))
    res.status(201).json(pay.toJSON())
  }),
)

router.delete(
  '/payments/:id',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const id = idParam(req)
    const pay = await withTransaction(async (session) => {
      if (await PaymentClaim.exists({ orgId, paymentIds: id }).session(session))
        throw conflict("This payment came from a hosteler's verified UPI report and can't be deleted")
      const p = await deletePayment(orgId, id, session)
      await logActivity(orgId, `Receipt ${p.receiptNo} (₹${p.amount.toLocaleString('en-IN')}) deleted`, 'payment', p.hostelId, session)
      return p
    })
    res.json({ ok: true, id: String(pay._id) })
  }),
)

/* ------------------------------------------------------------------ */
/* Dues / deposits / summary                                           */
/* ------------------------------------------------------------------ */

router.get(
  '/dues',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const today = todayStr()
    const open = await Invoice.find({ orgId, ...scopeOf(req.query), cancelled: false, $expr: { $lt: ['$paidAmount', '$total'] } })
      .sort({ dueDate: 1, month: 1 })
      .lean()
    const byHosteler = new Map<string, typeof open>()
    for (const inv of open) {
      const k = String(inv.hostelerId)
      const list = byHosteler.get(k)
      if (list) list.push(inv)
      else byHosteler.set(k, [inv])
    }
    const info = await hostelerInfo(orgId, [...byHosteler.keys()])
    const items = [...byHosteler.entries()]
      .map(([hid, invs]) => {
        const h = info.get(hid)
        const oldest = invs[0]!.dueDate
        return {
          hostelerId: hid,
          hosteler: h ? { id: h.id, name: h.name, phone: h.phone, loginId: h.loginId, status: h.status } : null,
          name: h?.name ?? '',
          phone: h?.phone ?? '',
          guardianName: h?.guardianName ?? '',
          guardianPhone: h?.guardianPhone ?? '',
          roomLabel: h?.roomLabel ?? 'Not allotted',
          hostelId: String(invs[0]!.hostelId),
          amount: sum(invs, (i) => i.total - i.paidAmount),
          oldestDueDate: oldest,
          daysOverdue: daysOverdue(oldest, today),
          overdue: oldest < today,
          invoices: invs.map((i) => ({
            id: String(i._id),
            number: i.number,
            month: i.month,
            total: i.total,
            paidAmount: i.paidAmount,
            balance: i.total - i.paidAmount,
            dueDate: i.dueDate,
            status: invoiceStatus(i, today),
          })),
        }
      })
      .sort((a, b) => b.amount - a.amount)
    res.json({
      items,
      totals: {
        amount: sum(items, (i) => i.amount),
        hostelers: items.length,
        overdueAmount: sum(
          open.filter((i) => i.dueDate < today),
          (i) => i.total - i.paidAmount,
        ),
      },
    })
  }),
)

router.get(
  '/deposits',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const scope = scopeOf(req.query)
    const hs = await Hosteler.find({ orgId, ...scope }).select('securityDeposit depositRefunded status checkInDate checkOutDate').lean()
    const [info, collectedAgg] = await Promise.all([
      hostelerInfo(orgId, hs.map((h) => h._id)),
      Payment.aggregate<{ _id: Types.ObjectId; amount: number }>([
        { $match: { orgId, ...scope, kind: 'deposit' } },
        { $group: { _id: '$hostelerId', amount: { $sum: '$amount' } } },
      ]),
    ])
    const collectedBy = new Map(collectedAgg.map((g) => [String(g._id), g.amount]))
    const items = hs.map((h) => {
      const hid = String(h._id)
      const i = info.get(hid)
      const collected = collectedBy.get(hid) ?? 0
      const out = h.status === 'checked_out'
      const refundRecorded = out && h.depositRefunded !== null && h.depositRefunded !== undefined
      // older records may lack a deposit receipt for checked-out hostelers — fall back to the agreed deposit
      const basis = refundRecorded && collected === 0 ? h.securityDeposit : collected
      const refunded = out ? h.depositRefunded ?? 0 : 0
      return {
        hostelerId: hid,
        hosteler: i ? { id: i.id, name: i.name, phone: i.phone, loginId: i.loginId } : null,
        roomLabel: i?.roomLabel ?? 'Not allotted',
        status: h.status,
        checkInDate: h.checkInDate,
        checkOutDate: h.checkOutDate ?? null,
        agreed: h.securityDeposit,
        collected: basis,
        held: out ? 0 : collected,
        pending: out ? 0 : Math.max(h.securityDeposit - collected, 0),
        refunded,
        refundRecorded,
        deducted: out ? Math.max(basis - refunded, 0) : 0,
      }
    })
    const held = items.filter((r) => r.status !== 'checked_out' && (r.collected > 0 || r.agreed > 0)).sort((a, b) => b.held - a.held)
    const checkedOut = items
      .filter((r) => r.status === 'checked_out')
      .sort((a, b) => (b.checkOutDate ?? '').localeCompare(a.checkOutDate ?? ''))
    res.json({
      items: [...held, ...checkedOut],
      held,
      checkedOut,
      totals: {
        held: sum(items, (r) => r.held),
        pending: sum(items, (r) => r.pending),
        refunded: sum(items, (r) => r.refunded),
        deducted: sum(items, (r) => r.deducted),
      },
    })
  }),
)

router.get(
  '/fees/summary',
  fees,
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const { month } = parse(z.object({ month: validMonth.default(() => todayStr().slice(0, 7)) }), { month: req.query.month })
    const scope = scopeOf(req.query)
    const today = todayStr()
    const [monthInv, overdue, received] = await Promise.all([
      Invoice.find({ orgId, ...scope, month, cancelled: false }).select('total paidAmount').lean(),
      Invoice.find({ orgId, ...scope, ...statusFilter('overdue', today) }).select('total paidAmount').lean(),
      Payment.aggregate<{ amount: number }>([
        { $match: { orgId, ...scope, kind: { $ne: 'deposit' }, date: { $gte: `${month}-01`, $lte: `${month}-31` } } },
        { $group: { _id: null, amount: { $sum: '$amount' } } },
      ]),
    ])
    const billed = sum(monthInv, (i) => i.total)
    const collected = sum(monthInv, (i) => Math.min(i.paidAmount, i.total))
    res.json({
      month,
      billed,
      collected,
      outstanding: sum(monthInv, (i) => Math.max(i.total - i.paidAmount, 0)),
      invoiceCount: monthInv.length,
      overdueCount: overdue.length,
      overdueAmount: sum(overdue, (i) => Math.max(i.total - i.paidAmount, 0)),
      received: received[0]?.amount ?? 0,
      collectionRate: billed ? Math.round((collected / billed) * 100) : 0,
    })
  }),
)
