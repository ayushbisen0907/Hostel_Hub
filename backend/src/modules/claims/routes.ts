/**
 * Payment verification (mounted at /api/payment-claims, module 'fees')
 *
 * Hostelers pay the hostel's UPI ID outside the app and submit the amount +
 * transaction ID (see portal routes). Staff confirm the money arrived:
 *
 *   GET  /api/payment-claims?status=pending|verified|rejected|all&hostelId=&q=
 *   GET  /api/payment-claims/count            { pending }
 *   GET  /api/payment-claims/:id              claim + hosteler + their open bills
 *   GET  /api/payment-claims/:id/screenshot
 *   POST /api/payment-claims/:id/verify       { receivedAmount, note? } -> applied to oldest bills first
 *   POST /api/payment-claims/:id/reject       { reason }
 */
import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { ah, escapeRegex, idParam, paginate, paginationQuery, parse } from '../../lib/http.js'
import { allocatePayment, hostelerDues } from '../../lib/money.js'
import { hostelScope, logActivity } from '../../lib/org.js'
import { notifyHostelers } from '../../lib/notify.js'
import { sendStoredFile } from '../../lib/upload.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Invoice } from '../../models/Invoice.js'
import { PaymentClaim } from '../../models/PaymentClaim.js'
import { Payment } from '../../models/Payment.js'
import { User } from '../../models/User.js'
import { toApi } from '../../models/_base.js'

export const router = Router()
router.use(requireStaff('fees')) // safe: mounted under its own prefix

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

async function decorate(orgId: string, claims: { hostelerId: unknown; screenshotKey?: string | null }[]) {
  const ids = [...new Set(claims.map((c) => String(c.hostelerId)))]
  const hs = await Hosteler.find({ orgId, _id: { $in: ids } }).select('name loginId phone hostelId status').lean()
  const map = new Map(hs.map((h) => [String(h._id), { id: String(h._id), name: h.name, loginId: h.loginId, phone: h.phone, status: h.status }]))
  return (c: Record<string, unknown> & { hostelerId: unknown; screenshotKey?: string | null }) => ({
    ...toApi(c as unknown as { _id: unknown }, ['screenshotKey', 'screenshotMime']),
    hasScreenshot: !!c.screenshotKey,
    hosteler: map.get(String(c.hostelerId)) ?? null,
  })
}

router.get(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(
      paginationQuery.extend({
        status: z.enum(['pending', 'verified', 'rejected', 'all']).default('pending'),
        q: z.string().trim().max(80).optional(),
        hostelerId: z.string().optional(),
      }),
      req.query,
    )
    const filter: Record<string, unknown> = { orgId, ...hostelScope(req.query) }
    if (q.status !== 'all') filter.status = q.status
    if (q.hostelerId) filter.hostelerId = q.hostelerId
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i')
      const hs = await Hosteler.find({ orgId, $or: [{ name: rx }, { loginId: rx }, { phone: rx }] }).select('_id').lean()
      filter.$or = [{ utr: rx }, { hostelerId: { $in: hs.map((h) => h._id) } }]
    }
    const [docs, total] = await Promise.all([
      PaymentClaim.find(filter)
        .sort(q.status === 'pending' ? { createdAt: 1 } : { createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      PaymentClaim.countDocuments(filter),
    ])
    const dec = await decorate(orgId, docs)
    res.json(paginate(docs.map(dec), total, q.page, q.limit))
  }),
)

router.get(
  '/count',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    res.json({ pending: await PaymentClaim.countDocuments({ orgId, status: 'pending', ...hostelScope(req.query) }) })
  }),
)

router.get(
  '/:id',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const claim = await PaymentClaim.findOne({ _id: idParam(req), orgId }).lean()
    if (!claim) throw notFound('Payment claim')
    const dec = await decorate(orgId, [claim])
    const openBills = await Invoice.find({ orgId, hostelerId: claim.hostelerId, cancelled: false, $expr: { $gt: ['$total', '$paidAmount'] } })
      .sort({ dueDate: 1, month: 1 })
      .select('number month total paidAmount dueDate items')
      .lean()
    const payments = claim.paymentIds.length ? await Payment.find({ orgId, _id: { $in: claim.paymentIds } }).lean() : []
    res.json({
      ...dec(claim),
      dues: await hostelerDues(orgId, claim.hostelerId),
      openBills: openBills.map((b) => ({ id: String(b._id), number: b.number, month: b.month, total: b.total, paidAmount: b.paidAmount, balance: b.total - b.paidAmount, dueDate: b.dueDate, items: b.items })),
      payments: payments.map((p) => toApi(p)),
    })
  }),
)

router.get(
  '/:id/screenshot',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const claim = await PaymentClaim.findOne({ _id: idParam(req), orgId }).lean()
    if (!claim?.screenshotKey) throw notFound('Screenshot')
    sendStoredFile(res, claim.screenshotKey, `payment-${claim.utr}`, claim.screenshotMime ?? 'image/png')
  }),
)

const verifySchema = z.object({
  receivedAmount: z.coerce.number().int().min(1).max(10_000_000),
  note: z.string().trim().max(300).default(''),
})

router.post(
  '/:id/verify',
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const body = parse(verifySchema, req.body)
    const id = idParam(req)
    const reviewer = await User.findById(userId).select('name').lean()
    const out = await withTransaction(async (session) => {
      // claim it atomically so two staff can't verify the same payment
      const existing = await PaymentClaim.findOne({ _id: id, orgId }).select('amount status').session(session)
      if (existing && existing.status === 'pending' && body.receivedAmount > existing.amount)
        throw badRequest(`Received amount can't be more than the ₹${existing.amount.toLocaleString('en-IN')} the hosteler reported`)
      const claim = await PaymentClaim.findOneAndUpdate(
        { _id: id, orgId, status: 'pending' },
        { status: 'verified', receivedAmount: body.receivedAmount, reviewedBy: userId, reviewedByName: reviewer?.name ?? '', reviewedAt: new Date() },
        { new: true, session },
      )
      if (!claim) {
        if (await PaymentClaim.exists({ _id: id, orgId }).session(session)) throw conflict('This payment was already reviewed')
        throw notFound('Payment claim')
      }
      const h = await Hosteler.findOne({ _id: claim.hostelerId, orgId }).session(session)
      if (!h) throw notFound('Hosteler')
      const { payments, applied } = await allocatePayment(
        orgId,
        {
          hostelerId: h._id,
          amount: body.receivedAmount,
          mode: 'upi',
          reference: claim.utr,
          date: claim.paidOn,
          note: body.note || `UPI payment verified${body.receivedAmount < claim.amount ? ` (claimed ${money(claim.amount)})` : ''}`,
          recordedBy: 'hosteler',
        },
        session,
      )
      claim.paymentIds = payments.map((p) => p._id)
      await claim.save({ session })
      const remaining = await hostelerDues(orgId, h._id, session)
      const partial = body.receivedAmount < claim.amount
      await notifyHostelers(
        orgId,
        [h._id],
        {
          type: 'payment_verified',
          hostelId: h.hostelId,
          title: `${money(body.receivedAmount)} received`,
          body: partial
            ? `Your hostel confirmed ${money(body.receivedAmount)} of the ${money(claim.amount)} you reported (UTR ${claim.utr}). Remaining due: ${money(remaining)}.`
            : `Your payment (UTR ${claim.utr}) is confirmed.${remaining > 0 ? ` Remaining due: ${money(remaining)}.` : ' All bills are paid.'}`,
          link: '/portal/fees',
        },
        session,
      )
      await logActivity(orgId, `UPI payment ${money(body.receivedAmount)} from ${h.name} verified`, 'payment', h.hostelId, session)
      return { claim, applied, remaining }
    })
    const dec = await decorate(orgId, [out.claim.toObject()])
    res.json({ claim: dec(out.claim.toObject()), applied: out.applied, remainingDues: out.remaining })
  }),
)

router.post(
  '/:id/reject',
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const body = parse(z.object({ reason: z.string().trim().min(3, 'Tell the hosteler why').max(300) }), req.body)
    const id = idParam(req)
    const reviewer = await User.findById(userId).select('name').lean()
    const claim = await withTransaction(async (session) => {
      const c = await PaymentClaim.findOneAndUpdate(
        { _id: id, orgId, status: 'pending' },
        { status: 'rejected', rejectReason: body.reason, reviewedBy: userId, reviewedByName: reviewer?.name ?? '', reviewedAt: new Date() },
        { new: true, session },
      )
      if (!c) {
        if (await PaymentClaim.exists({ _id: id, orgId }).session(session)) throw conflict('This payment was already reviewed')
        throw notFound('Payment claim')
      }
      await notifyHostelers(
        orgId,
        [c.hostelerId],
        {
          type: 'payment_rejected',
          hostelId: c.hostelId,
          title: 'Payment not confirmed',
          body: `Your hostel couldn't confirm ${money(c.amount)} (UTR ${c.utr}): ${body.reason}`,
          link: '/portal/fees',
        },
        session,
      )
      return c
    })
    const dec = await decorate(orgId, [claim.toObject()])
    res.json({ claim: dec(claim.toObject()) })
  }),
)

