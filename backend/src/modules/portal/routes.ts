/**
 * Hosteler portal — everything a logged-in resident can do.
 *
 * SECURITY: every query is scoped with ids from hostelerOf(req) (the verified
 * token + fresh DB lookup). Never trust hostelerId / orgId / hostelId from the
 * client. Records of other hostelers are reported as 404, never 403, so ids
 * can't be probed.
 *
 *   GET    /home                       dashboard + { today, currencySymbol, features: { mess, attendance } }
 *   PATCH  /profile                    { email?, permanentAddress?, guardianPhone? }
 *   POST   /profile/photo              multipart "file" (image ≤ 2 MB)
 *   GET    /profile/photo
 *   GET    /invoices, /invoices/:id
 *   GET    /payments, /payments/:id
 *   GET    /payment-info               hostel UPI ID / payee / hasQr + unpaid bills (oldest first)
 *   GET    /payment-qr                 the hostel's uploaded QR image
 *   GET    /payment-claims, POST /payment-claims (multipart: amount, utr, paidOn?, note?, file?)
 *   GET    /payment-claims/:id/screenshot
 *   GET    /notifications, POST /notifications/:id/read, POST /notifications/read-all
 *   GET    /mess/menu                  (plan: mess)
 *   GET    /mess/opt-outs?from&to      (plan: mess)
 *   POST   /mess/opt-outs              { date, meal }  (plan: mess)
 *   DELETE /mess/opt-outs              { date, meal }  (plan: mess)
 *   GET    /mess/feedback, POST /mess/feedback (plan: mess)
 *   GET    /complaints, POST /complaints, POST /complaints/:id/comments
 *   GET    /leaves, POST /leaves, DELETE /leaves/:id  (plan: attendance)
 *   GET    /notices
 *   GET    /documents, POST /documents, GET /documents/:id/file
 *   GET    /attendance?month=          (plan: attendance)
 *   GET    /gate-logs
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { hostelerOf, requireHosteler } from '../../middleware/auth.js'
import { AppError, badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js'
import { ah, dateStr, idParam, monthOf, monthStr, parse, todayStr } from '../../lib/http.js'
import { hostelerDues } from '../../lib/money.js'
import { previousBalance } from '../../lib/billing.js'
import { notifyStaff } from '../../lib/notify.js'
import { notificationHandlers } from '../notifications/routes.js'
import { PaymentClaim } from '../../models/PaymentClaim.js'
import { logActivity } from '../../lib/org.js'
import { hasModule, requirePlan, type Plan } from '../../lib/plans.js'
import { removeStoredFile, sendStoredFile, upload } from '../../lib/upload.js'
import { toApi } from '../../models/_base.js'
import { Bed } from '../../models/Bed.js'
import { DOCUMENT_TYPES, HDocument } from '../../models/Document.js'
import { Hostel } from '../../models/Hostel.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Invoice, invoiceStatus } from '../../models/Invoice.js'
import {
  Attendance,
  Complaint,
  GateLog,
  Leave,
  MEALS,
  MealOptOut,
  MessFeedback,
  MessMenu,
  Notice,
  type Meal,
} from '../../models/Operations.js'
import { Organization } from '../../models/Organization.js'
import { Payment } from '../../models/Payment.js'
import { Room } from '../../models/Room.js'
import { clock, hhmm } from './clock.js'

export const router = Router()

// every portal route: logged-in hosteler (own password set) on a plan with the portal
router.use(requireHosteler(), requirePlan('portal'))

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const PORTAL_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

/** Fields a hosteler must never see about themselves */
const HOSTELER_HIDDEN = ['passwordHash', 'tokenVersion', 'notes']

/** Last time (HH:mm, same day) a meal can be skipped / un-skipped — same as the frontend */
export const MEAL_CUTOFF: Record<Meal, string> = {
  breakfast: '07:00',
  lunch: '10:00',
  snacks: '15:00',
  dinner: '17:00',
}

const today = () => todayStr(clock.now())

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

async function loadMe(req: Request) {
  const { hostelerId, orgId } = hostelerOf(req)
  const me = await Hosteler.findOne({ _id: hostelerId, orgId })
  if (!me) throw unauthorized()
  return me
}

async function bedLabelOf(roomId: unknown, bedId: unknown): Promise<string | null> {
  if (!roomId) return null
  const [room, bed] = await Promise.all([
    Room.findById(roomId).select('number').lean(),
    bedId ? Bed.findById(bedId).select('label').lean() : null,
  ])
  if (!room) return null
  return bed ? `Room ${room.number} · Bed ${bed.label}` : `Room ${room.number}`
}

function withBalance<T extends { cancelled: boolean; total: number; paidAmount: number; dueDate: string }>(inv: T, t: string) {
  return { ...inv, balance: inv.cancelled ? 0 : Math.max(inv.total - inv.paidAmount, 0), status: invoiceStatus(inv, t) }
}

/** Org / hostel / hosteler header for printable invoices & receipts. */
async function printContext(orgId: string, hostelerId: string) {
  const [org, h] = await Promise.all([
    Organization.findById(orgId).select('name phone email settings').lean(),
    Hosteler.findById(hostelerId).select('name loginId phone hostelId roomId bedId').lean(),
  ])
  if (!h) throw unauthorized()
  const hostel = await Hostel.findById(h.hostelId).select('name address city phone upiId payeeName qrStorageKey').lean()
  return {
    organization: org ? { name: org.name, phone: org.phone, email: org.email, currencySymbol: org.settings?.currencySymbol ?? '₹' } : null,
    hostel: hostel
      ? { id: String(hostel._id), name: hostel.name, address: hostel.address, city: hostel.city, phone: hostel.phone, upiId: hostel.upiId, payeeName: hostel.payeeName, hasQr: !!hostel.qrStorageKey }
      : null,
    hosteler: { id: String(h._id), name: h.name, loginId: h.loginId, phone: h.phone, bed: await bedLabelOf(h.roomId, h.bedId) },
  }
}

/** Enforce portal-specific upload size (2 MB) and, optionally, image-only. Removes the stored file on rejection. */
function checkUpload(file: Express.Multer.File | undefined, opts: { imageOnly?: boolean } = {}): Express.Multer.File {
  if (!file) throw badRequest('Attach a file (field "file")')
  if (file.size > PORTAL_MAX_BYTES) {
    removeStoredFile(file.filename)
    throw new AppError(413, 'File must be 2 MB or smaller', 'FILE_TOO_LARGE')
  }
  if (opts.imageOnly && !IMAGE_TYPES.has(file.mimetype)) {
    removeStoredFile(file.filename)
    throw badRequest('Photo must be a JPG, PNG, WEBP or HEIC image')
  }
  return file
}

/** Meal skip lock rule — mirrors lockReason() in the frontend Mess page. */
function mealLockReason(date: string, meal: Meal, now: Date): string | null {
  const t = todayStr(now)
  if (date < t) return 'This date has passed'
  if (date === t && hhmm(now) >= MEAL_CUTOFF[meal]) return `Changes for ${meal} closed at ${MEAL_CUTOFF[meal]}`
  return null
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

router.get(
  '/home',
  ah(async (req, res) => {
    const { hostelerId, orgId, hostelId } = hostelerOf(req)
    const me = await Hosteler.findOne({ _id: hostelerId, orgId }).lean()
    if (!me) throw unauthorized()
    const t = today()
    const org = await Organization.findById(orgId).select('plan settings.currencySymbol').lean()
    const plan = (org?.plan ?? 'free') as Plan
    const hasMess = hasModule(plan, 'mess')
    const hasAttendance = hasModule(plan, 'attendance')
    const last7 = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6))

    const [hostel, bed, invoices, notices, openComplaints, menu, skips, attendance] = await Promise.all([
      Hostel.findById(hostelId).select('name phone').lean(),
      bedLabelOf(me.roomId, me.bedId),
      Invoice.find({ orgId, hostelerId, cancelled: false }).select('total paidAmount dueDate').lean(),
      Notice.find({ orgId, hostelId: { $in: [hostelId, null] } }).sort({ pinned: -1, createdAt: -1 }).limit(3).lean(),
      Complaint.find({ orgId, hostelerId, status: { $ne: 'resolved' } }).sort({ createdAt: -1 }).lean(),
      hasMess ? MessMenu.find({ orgId, hostelId, day: weekdayOf(t) }).lean() : [],
      hasMess ? MealOptOut.find({ orgId, hostelerId, date: t }).lean() : [],
      hasAttendance ? Attendance.find({ orgId, hostelerId, date: { $in: last7 } }).lean() : [],
    ])

    const pending = invoices.filter((i) => i.total - i.paidAmount > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    const nextDueDate = pending[0]?.dueDate ?? null
    const total = pending.reduce((a, i) => a + (i.total - i.paidAmount), 0)

    res.json({
      today: t,
      currencySymbol: org?.settings?.currencySymbol ?? '₹',
      features: { mess: hasMess, attendance: hasAttendance },
      hosteler: toApi(me, HOSTELER_HIDDEN),
      bed,
      hostel: hostel ? { id: String(hostel._id), name: hostel.name, phone: hostel.phone } : null,
      dues: { total, nextDueDate, overdue: nextDueDate !== null && nextDueDate < t, pendingInvoices: pending.length },
      todayMenu: hasMess
        ? MEALS.map((meal) => ({
            meal,
            items: menu.find((m) => m.meal === meal)?.items ?? '',
            skipped: skips.some((s) => s.meal === meal),
          }))
        : null,
      notices: notices.map((n) => toApi(n)),
      openComplaints: openComplaints.map((c) => toApi(c)),
      last7DaysAttendance: hasAttendance
        ? last7.map((date) => ({ date, status: attendance.find((a) => a.date === date)?.status ?? null }))
        : null,
    })
  }),
)

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

const profileSchema = z
  .object({
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(120)]).optional(),
    permanentAddress: z.string().trim().min(1, 'Address is required').max(500).optional(),
    guardianPhone: z
      .string()
      .trim()
      .refine((s) => {
        const d = s.replace(/\D/g, '')
        return d.length >= 10 && d.length <= 13
      }, 'Enter a valid phone number')
      .optional(),
  })
  .strict() // anything else (name, rent, status, hostelId…) is rejected

router.patch(
  '/profile',
  ah(async (req, res) => {
    const body = parse(profileSchema, req.body)
    const { hostelerId, orgId } = hostelerOf(req)
    const me = await Hosteler.findOneAndUpdate({ _id: hostelerId, orgId }, { $set: body }, { new: true, runValidators: true }).lean()
    if (!me) throw unauthorized()
    res.json({ hosteler: toApi(me, HOSTELER_HIDDEN) })
  }),
)

const PHOTO_URL = '/api/portal/profile/photo'

router.post(
  '/profile/photo',
  upload.single('file'),
  ah(async (req, res) => {
    const file = checkUpload(req.file, { imageOnly: true })
    const { hostelerId, orgId, hostelId } = hostelerOf(req)
    // NOTE: Hosteler has no field for the photo's storage key, so the profile
    // photo is kept as a 'photo' document uploaded by the hosteler (replacing
    // the previous unverified one).
    let replaced: string[] = []
    try {
      const me = await withTransaction(async (session) => {
        const old = await HDocument.find({ orgId, hostelerId, type: 'photo', uploadedBy: 'hosteler', verified: false })
          .select('storageKey')
          .session(session)
          .lean()
        replaced = old.map((d) => d.storageKey)
        if (old.length) await HDocument.deleteMany({ _id: { $in: old.map((d) => d._id) } }, { session })
        await HDocument.create(
          [
            {
              orgId,
              hostelId,
              hostelerId,
              type: 'photo',
              fileName: file.originalname.slice(0, 200),
              mimeType: file.mimetype,
              size: file.size,
              storageKey: file.filename,
              uploadedBy: 'hosteler',
              verified: false,
            },
          ],
          { session },
        )
        return Hosteler.findOneAndUpdate({ _id: hostelerId, orgId }, { photoUrl: PHOTO_URL }, { new: true, session }).lean()
      })
      if (!me) throw unauthorized()
      for (const k of replaced) removeStoredFile(k)
      res.status(201).json({ hosteler: toApi(me, HOSTELER_HIDDEN), photoUrl: PHOTO_URL })
    } catch (e) {
      removeStoredFile(file.filename)
      throw e
    }
  }),
)

router.get(
  '/profile/photo',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const doc = await HDocument.findOne({ orgId, hostelerId, type: 'photo', mimeType: { $in: [...IMAGE_TYPES] } })
      .sort({ createdAt: -1 })
      .lean()
    if (!doc) throw notFound('Photo')
    res.setHeader('Cache-Control', 'private, no-cache')
    sendStoredFile(res, doc.storageKey, doc.fileName, doc.mimeType)
  }),
)

/* ------------------------------------------------------------------ */
/* Fees                                                                */
/* ------------------------------------------------------------------ */

router.get(
  '/invoices',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const t = today()
    const items = await Invoice.find({ orgId, hostelerId }).sort({ month: -1, createdAt: -1 }).lean()
    res.json({ items: items.map((i) => toApi(withBalance(i, t))) })
  }),
)

router.get(
  '/invoices/:id',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const inv = await Invoice.findOne({ _id: idParam(req), orgId, hostelerId }).lean()
    if (!inv) throw notFound('Invoice')
    const payments = await Payment.find({ orgId, hostelerId, invoiceId: inv._id }).sort({ date: 1, createdAt: 1 }).lean()
    res.json({
      invoice: toApi(withBalance(inv, today())),
      payments: payments.map((p) => toApi(p)),
      previousBalance: await previousBalance(orgId, inv),
      ...(await printContext(orgId, hostelerId)),
    })
  }),
)

router.get(
  '/payments',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await Payment.find({ orgId, hostelerId }).sort({ date: -1, createdAt: -1 }).lean()
    const invIds = items.map((p) => p.invoiceId).filter(Boolean)
    const invs = await Invoice.find({ _id: { $in: invIds }, orgId, hostelerId }).select('number month').lean()
    const byId = new Map(invs.map((i) => [String(i._id), i]))
    res.json({
      items: items.map((p) => {
        const inv = p.invoiceId ? byId.get(String(p.invoiceId)) : undefined
        return toApi({ ...p, invoiceNumber: inv?.number ?? null, invoiceMonth: inv?.month ?? null })
      }),
    })
  }),
)

router.get(
  '/payments/:id',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const pay = await Payment.findOne({ _id: idParam(req), orgId, hostelerId }).lean()
    if (!pay) throw notFound('Payment')
    const inv = pay.invoiceId ? await Invoice.findOne({ _id: pay.invoiceId, orgId, hostelerId }).lean() : null
    res.json({
      payment: toApi(pay),
      invoice: inv ? toApi(withBalance(inv, today())) : null,
      ...(await printContext(orgId, hostelerId)),
    })
  }),
)

/* ---------------- Paying rent: UPI to the hostel, then report it ---------------- */

/** Where to pay: the hostel's UPI ID / payee name / QR, plus what is due (oldest first). */
router.get(
  '/payment-info',
  ah(async (req, res) => {
    const { hostelerId, orgId, hostelId } = hostelerOf(req)
    const hostel = await Hostel.findOne({ _id: hostelId, orgId }).select('name upiId payeeName qrStorageKey').lean()
    const open = await Invoice.find({ orgId, hostelerId, cancelled: false, $expr: { $gt: ['$total', '$paidAmount'] } })
      .sort({ dueDate: 1, month: 1 })
      .lean()
    const pending = await PaymentClaim.find({ orgId, hostelerId, status: 'pending' }).select('amount').lean()
    res.json({
      hostelName: hostel?.name ?? '',
      upiId: hostel?.upiId ?? '',
      payeeName: hostel?.payeeName ?? '',
      hasQr: !!hostel?.qrStorageKey,
      totalDue: open.reduce((a, i) => a + (i.total - i.paidAmount), 0),
      pendingVerification: pending.reduce((a, c) => a + c.amount, 0),
      bills: open.map((i) => ({
        id: String(i._id),
        number: i.number,
        month: i.month,
        dueDate: i.dueDate,
        total: i.total,
        paidAmount: i.paidAmount,
        balance: i.total - i.paidAmount,
        items: i.items,
      })),
    })
  }),
)

router.get(
  '/payment-qr',
  ah(async (req, res) => {
    const { orgId, hostelId } = hostelerOf(req)
    const hostel = await Hostel.findOne({ _id: hostelId, orgId }).lean()
    if (!hostel?.qrStorageKey) throw notFound('QR image')
    sendStoredFile(res, hostel.qrStorageKey, `${hostel.code}-upi-qr`, hostel.qrMimeType ?? 'image/png')
  }),
)

router.get(
  '/payment-claims',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await PaymentClaim.find({ orgId, hostelerId }).sort({ createdAt: -1 }).limit(50).lean()
    res.json({
      items: items.map((c) => ({ ...toApi(c, ['screenshotKey', 'screenshotMime', 'reviewedBy']), hasScreenshot: !!c.screenshotKey })),
    })
  }),
)

const claimSchema = z.object({
  amount: z.coerce.number().int('Amount must be a whole number').min(1, 'Amount must be at least 1'),
  utr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,30}$/, 'Enter the UPI transaction ID / UTR (6-30 letters or digits)'),
  paidOn: dateStr.optional(),
  note: z.string().trim().max(300).default(''),
})

/**
 * "I have paid": amount + UTR (+ optional screenshot, multipart field "file").
 * Nothing is marked paid until hostel staff verify it.
 */
router.post(
  '/payment-claims',
  upload.single('file'),
  ah(async (req, res) => {
    const file = req.file
    try {
      const { hostelerId, orgId, hostelId } = hostelerOf(req)
      const body = parse(claimSchema, req.body)
      if (file) checkUpload(file, { imageOnly: true })
      const t = today()
      const paidOn = body.paidOn ?? t
      if (paidOn > t) throw badRequest("Payment date can't be in the future")
      const dues = await hostelerDues(orgId, hostelerId)
      const pending = (await PaymentClaim.find({ orgId, hostelerId, status: 'pending' }).select('amount').lean()).reduce((a, c) => a + c.amount, 0)
      if (dues <= 0) throw badRequest('You have no unpaid bills')
      if (body.amount + pending > dues)
        throw badRequest(
          pending
            ? `You already reported ₹${pending.toLocaleString('en-IN')} that is waiting for verification. Total due is ₹${dues.toLocaleString('en-IN')}.`
            : `Amount can't be more than your total due (₹${dues.toLocaleString('en-IN')})`,
        )
      const me = await Hosteler.findById(hostelerId).select('name loginId').lean()
      const claim = await withTransaction(async (session) => {
        if (await PaymentClaim.exists({ orgId, utr: body.utr, status: { $in: ['pending', 'verified'] } }).session(session))
          throw conflict('This transaction ID was already submitted')
        const [c] = await PaymentClaim.create(
          [
            {
              orgId,
              hostelId,
              hostelerId,
              amount: body.amount,
              utr: body.utr,
              paidOn,
              note: body.note,
              screenshotKey: file?.filename ?? null,
              screenshotMime: file?.mimetype ?? null,
            },
          ],
          { session },
        )
        await notifyStaff(
          orgId,
          {
            type: 'payment_submitted',
            hostelId,
            title: `${me?.name ?? 'A hosteler'} paid ₹${body.amount.toLocaleString('en-IN')}`,
            body: `${me?.loginId ?? ''} reported a UPI payment (UTR ${body.utr}). Check your bank/UPI app and verify it.`,
            link: '/app/fees?tab=verify',
          },
          undefined,
          session,
        )
        return c!
      })
      res.status(201).json({ ...toApi(claim.toObject(), ['screenshotKey', 'screenshotMime', 'reviewedBy']), hasScreenshot: !!claim.screenshotKey })
    } catch (e) {
      if (file) removeStoredFile(file.filename)
      throw e
    }
  }),
)

router.get(
  '/payment-claims/:id/screenshot',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const c = await PaymentClaim.findOne({ _id: idParam(req), orgId, hostelerId }).lean()
    if (!c?.screenshotKey) throw notFound('Screenshot')
    sendStoredFile(res, c.screenshotKey, `payment-${c.utr}`, c.screenshotMime ?? 'image/png')
  }),
)

/* ---------------- Notifications ---------------- */

const notes = notificationHandlers((req) => ({ kind: 'hosteler', id: hostelerOf(req).hostelerId }))
router.get('/notifications', notes.list)
router.post('/notifications/read-all', notes.readAll)
router.post('/notifications/:id/read', notes.read)

/* ------------------------------------------------------------------ */
/* Mess (Pro plan)                                                     */
/* ------------------------------------------------------------------ */

const mess = Router()
mess.use(requirePlan('mess'))
router.use('/mess', mess)

mess.get(
  '/menu',
  ah(async (req, res) => {
    const { orgId, hostelId } = hostelerOf(req)
    const items = await MessMenu.find({ orgId, hostelId }).lean()
    const order = (m: string) => MEALS.indexOf(m as Meal)
    items.sort((a, b) => a.day - b.day || order(a.meal) - order(b.meal))
    res.json({ items: items.map((m) => toApi(m)), cutoffs: MEAL_CUTOFF })
  }),
)

mess.get(
  '/opt-outs',
  ah(async (req, res) => {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query)
    const { hostelerId, orgId } = hostelerOf(req)
    const from = q.from ?? today()
    const to = q.to ?? addDays(from, 13)
    if (to < from) throw badRequest('"to" must be on or after "from"')
    const items = await MealOptOut.find({ orgId, hostelerId, date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean()
    res.json({ items: items.map((o) => toApi(o)) })
  }),
)

const optOutSchema = z.object({ date: dateStr, meal: z.enum(MEALS) })

async function assertCanChangeMeal(req: Request, date: string, meal: Meal) {
  const me = await loadMe(req)
  if (!me.messOpted) throw new AppError(403, 'Only residents enrolled in the mess can skip meals', 'MESS_NOT_OPTED')
  const reason = mealLockReason(date, meal, clock.now())
  if (reason) throw badRequest(reason)
  return me
}

mess.post(
  '/opt-outs',
  ah(async (req, res) => {
    const body = parse(optOutSchema, req.body)
    const me = await assertCanChangeMeal(req, body.date, body.meal)
    const key = { orgId: me.orgId, hostelerId: me._id, date: body.date, meal: body.meal }
    const existing = await MealOptOut.findOne(key).lean()
    if (existing) return res.json({ optOut: toApi(existing) }) // idempotent
    const created = await MealOptOut.create({ ...key, hostelId: me.hostelId })
    return res.status(201).json({ optOut: created.toJSON() })
  }),
)

mess.delete(
  '/opt-outs',
  ah(async (req, res) => {
    // body (preferred) or query string — some clients can't send a DELETE body
    const body = parse(optOutSchema, { ...req.query, ...(req.body ?? {}) })
    const me = await assertCanChangeMeal(req, body.date, body.meal)
    const r = await MealOptOut.deleteOne({ orgId: me.orgId, hostelerId: me._id, date: body.date, meal: body.meal })
    if (!r.deletedCount) throw notFound('Skipped meal')
    res.json({ ok: true })
  }),
)

mess.get(
  '/feedback',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await MessFeedback.find({ orgId, hostelerId }).sort({ date: -1, createdAt: -1 }).limit(200).lean()
    res.json({ items: items.map((f) => toApi(f)) })
  }),
)

mess.post(
  '/feedback',
  ah(async (req, res) => {
    const body = parse(
      z.object({
        meal: z.enum(MEALS),
        rating: z.coerce.number().int().min(1).max(5),
        comment: z.string().trim().max(500).default(''),
        date: dateStr.optional(),
      }),
      req.body,
    )
    const { hostelerId, orgId, hostelId } = hostelerOf(req)
    const t = today()
    const date = body.date ?? t
    if (date > t) throw badRequest("You can't rate a meal that hasn't been served yet")
    const fb = await MessFeedback.create({ orgId, hostelId, hostelerId, date, meal: body.meal, rating: body.rating, comment: body.comment })
    res.status(201).json({ feedback: fb.toJSON() })
  }),
)

/* ------------------------------------------------------------------ */
/* Complaints                                                          */
/* ------------------------------------------------------------------ */

router.get(
  '/complaints',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await Complaint.find({ orgId, hostelerId }).sort({ createdAt: -1 }).lean()
    res.json({ items: items.map((c) => toApi(c)) })
  }),
)

const complaintSchema = z.object({
  category: z.enum(['electrical', 'plumbing', 'internet', 'cleaning', 'furniture', 'food', 'security', 'other']),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  title: z.string().trim().min(3, 'Give a short title (at least 3 characters)').max(120),
  description: z.string().trim().max(2000).default(''),
})

router.post(
  '/complaints',
  ah(async (req, res) => {
    const body = parse(complaintSchema, req.body)
    const me = await loadMe(req)
    const c = await withTransaction(async (session) => {
      const [c] = await Complaint.create(
        [{ ...body, orgId: me.orgId, hostelId: me.hostelId, hostelerId: me._id, roomId: me.roomId ?? null }],
        { session },
      )
      await logActivity(me.orgId, `${me.name} raised a complaint: ${body.title}`, 'complaint', me.hostelId, session)
      return c!
    })
    res.status(201).json({ complaint: c.toJSON() })
  }),
)

router.post(
  '/complaints/:id/comments',
  ah(async (req, res) => {
    const id = idParam(req)
    const body = parse(z.object({ text: z.string().trim().min(1, 'Write a comment').max(1000) }), req.body)
    const me = await loadMe(req)
    const c = await Complaint.findOneAndUpdate(
      { _id: id, orgId: me.orgId, hostelerId: me._id },
      { $push: { comments: { by: me.name, byKind: 'hosteler', text: body.text, at: new Date() } } },
      { new: true },
    )
    if (!c) throw notFound('Complaint')
    res.status(201).json({ complaint: c.toJSON() })
  }),
)

/* ------------------------------------------------------------------ */
/* Leave (Pro plan: "Attendance & leave")                              */
/* ------------------------------------------------------------------ */

router.get(
  '/leaves',
  requirePlan('attendance'),
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await Leave.find({ orgId, hostelerId }).sort({ createdAt: -1 }).lean()
    res.json({ items: items.map((l) => toApi(l)) })
  }),
)

const leaveSchema = z.object({
  from: dateStr,
  to: dateStr,
  destination: z.string().trim().min(1, 'Where are you going?').max(200),
  reason: z.string().trim().min(3, 'Please add a short reason').max(500),
})

router.post(
  '/leaves',
  requirePlan('attendance'),
  ah(async (req, res) => {
    const body = parse(leaveSchema, req.body)
    if (body.from < today()) throw badRequest("Start date can't be in the past")
    if (body.to < body.from) throw badRequest('End date must be on or after the start date')
    const me = await loadMe(req)
    const leave = await withTransaction(async (session) => {
      const overlap = await Leave.findOne({
        orgId: me.orgId,
        hostelerId: me._id,
        status: { $in: ['pending', 'approved'] },
        from: { $lte: body.to },
        to: { $gte: body.from },
      })
        .session(session)
        .lean()
      if (overlap) throw conflict(`Overlaps with your ${overlap.status} leave (${overlap.from} – ${overlap.to})`)
      const [l] = await Leave.create([{ ...body, orgId: me.orgId, hostelId: me.hostelId, hostelerId: me._id }], { session })
      await logActivity(me.orgId, `${me.name} requested leave ${body.from} – ${body.to}`, 'leave', me.hostelId, session)
      return l!
    })
    res.status(201).json({ leave: leave.toJSON() })
  }),
)

router.delete(
  '/leaves/:id',
  requirePlan('attendance'),
  ah(async (req, res) => {
    const id = idParam(req)
    const { hostelerId, orgId } = hostelerOf(req)
    const del = await Leave.findOneAndDelete({ _id: id, orgId, hostelerId, status: 'pending' })
    if (!del) {
      if (await Leave.exists({ _id: id, orgId, hostelerId })) throw conflict('Only pending leave requests can be cancelled')
      throw notFound('Leave')
    }
    res.json({ ok: true })
  }),
)

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

router.get(
  '/notices',
  ah(async (req, res) => {
    const { orgId, hostelId } = hostelerOf(req)
    const items = await Notice.find({ orgId, hostelId: { $in: [hostelId, null] } }).sort({ pinned: -1, createdAt: -1 }).limit(200).lean()
    res.json({ items: items.map((n) => toApi(n)) })
  }),
)

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

router.get(
  '/documents',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await HDocument.find({ orgId, hostelerId }).sort({ createdAt: -1 }).lean()
    res.json({ items: items.map((d) => toApi(d, ['storageKey'])) })
  }),
)

router.post(
  '/documents',
  upload.single('file'),
  ah(async (req, res) => {
    const file = checkUpload(req.file)
    try {
      const { type } = parse(z.object({ type: z.enum(DOCUMENT_TYPES) }), req.body)
      const me = await loadMe(req)
      const doc = await withTransaction(async (session) => {
        const [d] = await HDocument.create(
          [
            {
              orgId: me.orgId,
              hostelId: me.hostelId,
              hostelerId: me._id,
              type,
              fileName: file.originalname.slice(0, 200),
              mimeType: file.mimetype,
              size: file.size,
              storageKey: file.filename,
              uploadedBy: 'hosteler',
              verified: false,
            },
          ],
          { session },
        )
        await logActivity(me.orgId, `${me.name} uploaded a document (${type})`, 'document', me.hostelId, session)
        return d!
      })
      res.status(201).json({ document: doc.toJSON() })
    } catch (e) {
      removeStoredFile(file.filename)
      throw e
    }
  }),
)

router.get(
  '/documents/:id/file',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const doc = await HDocument.findOne({ _id: idParam(req), orgId, hostelerId }).lean()
    if (!doc) throw notFound('Document')
    sendStoredFile(res, doc.storageKey, doc.fileName, doc.mimeType, req.query.download === '1')
  }),
)

/* ------------------------------------------------------------------ */
/* Attendance & gate log                                               */
/* ------------------------------------------------------------------ */

router.get(
  '/attendance',
  requirePlan('attendance'),
  ah(async (req, res) => {
    const q = parse(z.object({ month: monthStr.optional() }), req.query)
    const month = q.month ?? monthOf(today())
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await Attendance.find({ orgId, hostelerId, date: { $gte: `${month}-01`, $lte: `${month}-31` } }).sort({ date: 1 }).lean()
    const summary = { present: 0, late: 0, leave: 0, absent: 0, total: items.length }
    for (const a of items) summary[a.status as 'present' | 'late' | 'leave' | 'absent']++
    res.json({ month, items: items.map((a) => toApi(a)), summary })
  }),
)

router.get(
  '/gate-logs',
  ah(async (req, res) => {
    const { hostelerId, orgId } = hostelerOf(req)
    const items = await GateLog.find({ orgId, hostelerId }).sort({ time: -1 }).limit(30).lean()
    res.json({ items: items.map((g) => toApi(g)) })
  }),
)
