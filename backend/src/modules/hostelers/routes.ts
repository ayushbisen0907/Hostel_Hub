/**
 * Hostelers (residents), mounted at /api/hostelers
 *
 *   GET    /                      list (status, hostelId, q, occupation, messOpted, hasDues; paginated)
 *   GET    /:id                   hosteler + room/bed + dues + counts
 *   PATCH  /:id                   profile fields only (no credentials / bed / status / loginId)
 *   POST   /                      admission / check-in (module 'checkin') -> returns temp credentials once
 *   POST   /:id/confirm-check-in  reserved -> active
 *   POST   /:id/transfer          move to another vacant bed
 *   GET    /:id/check-out-preview ?date= settlement preview (dues, unpaid bills, forfeiture, canCheckOut, blockers)
 *   POST   /:id/check-out         settlement, frees bed, closes portal account (409 DUES_PENDING while dues remain)
 *   GET    /:id/consents          signed hostel-rules consents, newest first (with signature)
 *   POST   /:id/reset-password    new temporary password (returned once)
 *   POST   /:id/photo             multipart "file" (image ≤ 2 MB) -> profile photo (a 'photo' document)
 *   GET    /:id/photo             the latest 'photo' document (image)
 *   DELETE /:id                   owner / manager only; cascades
 *
 * Note: operations inside a transaction run sequentially (a session must not
 * run concurrent operations).
 */
import path from 'node:path'
import { Router } from 'express'
import mongoose, { type ClientSession, type Types } from 'mongoose'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { formatLoginId, generateTempPassword, hashPassword } from '../../lib/auth.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { ah, dateStr, escapeRegex, idParam, money, objectId, paginate, paginationQuery, parse, phone, todayStr } from '../../lib/http.js'
import { recordPayment } from '../../lib/money.js'
import { billHostelerNow, cycleIndexOf } from '../../lib/rentCycle.js'
import { closeStay, ensureStay, moveStay, openStay } from '../../lib/stays.js'
import { RoomStay } from '../../models/RoomStay.js'
import { assertHostel, getSettings, hostelScope, logActivity } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { removeStoredFile, sendStoredFile, upload } from '../../lib/upload.js'
import { toApi } from '../../models/_base.js'
import { Bed } from '../../models/Bed.js'
import { HDocument } from '../../models/Document.js'
import { Hostel } from '../../models/Hostel.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Invoice } from '../../models/Invoice.js'
import { Payment, PAYMENT_MODES } from '../../models/Payment.js'
import { Room } from '../../models/Room.js'
import { MoveOutRequest } from '../../models/MoveOutRequest.js'
import { RulesConsent } from '../../models/RulesConsent.js'
import { Attendance, Complaint, GateLog, Leave, MealOptOut, MessFeedback, Visitor } from '../../models/Operations.js'

export const router = Router()

const HIDDEN = ['passwordHash', 'tokenVersion']
const oid = (v: string | Types.ObjectId) => new mongoose.Types.ObjectId(String(v))

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().trim().max(max)
const optionalPhone = z.union([z.literal(''), phone])
const email = z.union([z.literal(''), z.string().trim().toLowerCase().email()])
const optionalDate = z.union([z.literal(''), dateStr])
const gender = z.enum(['male', 'female', 'other'])
const occupation = z.enum(['student', 'working', 'other'])
const photoUrl = z.string().max(1_000_000).nullable()

/** Editable profile fields (never credentials, bed, status or loginId). */
const profileShape = {
  name: z.string().trim().min(2).max(80),
  phone,
  email,
  gender,
  dob: optionalDate,
  photoUrl,
  permanentAddress: text(500),
  bloodGroup: text(10),
  occupation,
  institution: text(150),
  course: text(150),
  guardianName: text(80),
  guardianRelation: text(40),
  guardianPhone: optionalPhone,
  idProofType: text(40),
  idProofNumber: text(40),
  expectedCheckOut: dateStr.nullable(),
  notes: text(2000),
}

const admitSchema = z.object({
  name: profileShape.name,
  phone,
  email: email.default(''),
  gender: gender.default('male'),
  dob: optionalDate.default(''),
  photoUrl: photoUrl.default(null),
  permanentAddress: text(500).default(''),
  bloodGroup: text(10).default(''),
  occupation: occupation.default('student'),
  institution: text(150).default(''),
  course: text(150).default(''),
  guardianName: text(80).default(''),
  guardianRelation: text(40).default(''),
  guardianPhone: optionalPhone.default(''),
  idProofType: text(40).default(''),
  idProofNumber: text(40).default(''),
  expectedCheckOut: dateStr.nullable().default(null),
  notes: text(2000).default(''),
  // stay
  hostelId: objectId.optional(),
  bedId: objectId.nullable().default(null),
  reserveOnly: z.boolean().default(false),
  checkInDate: dateStr,
  monthlyRent: money,
  securityDeposit: money.optional(),
  messOpted: z.boolean().default(false),
  depositPayment: z
    .object({ amount: money, mode: z.enum(PAYMENT_MODES), reference: text(100).default('') })
    .nullable()
    .default(null),
  generateFirstInvoice: z.boolean().default(false),
  /**
   * What to do with the security deposit not collected now:
   *  first_bill (default) -> a "Security deposit" line on the first bill
   *  next_bill            -> added to the next monthly bill
   *  collected            -> nothing is billed
   */
  depositOption: z.enum(['collected', 'first_bill', 'next_bill']).optional(),
})

// PATCH: profile + stay terms; missing keys are left untouched; unknown keys rejected
const patchSchema = z
  .object({ ...profileShape, monthlyRent: money, securityDeposit: money, messOpted: z.boolean() })
  .partial()
  .strict()

const listQuery = paginationQuery.extend({
  status: z.enum(['active', 'reserved', 'checked_out', 'all']).optional(),
  hostelId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  occupation: occupation.optional(),
  messOpted: z.enum(['true', 'false']).optional(),
  hasDues: z.enum(['true', 'false']).optional(),
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type LeanHosteler = { _id: Types.ObjectId; hostelId: Types.ObjectId; roomId?: Types.ObjectId | null; bedId?: Types.ObjectId | null }

/** Per-hosteler outstanding dues (non-cancelled invoices) in one aggregate. */
async function duesMap(orgId: string, hostelerIds: Types.ObjectId[] | null) {
  const match: Record<string, unknown> = { orgId: oid(orgId), cancelled: false }
  if (hostelerIds) match.hostelerId = { $in: hostelerIds }
  const rows = await Invoice.aggregate<{ _id: Types.ObjectId; dues: number }>([
    { $match: match },
    { $group: { _id: '$hostelerId', dues: { $sum: { $max: [{ $subtract: ['$total', '$paidAmount'] }, 0] } } } },
  ])
  return new Map(rows.map((r) => [String(r._id), r.dues]))
}

/** Adds roomNumber, bedLabel, hostelName and dues to lean hostelers. */
async function decorate<T extends LeanHosteler>(orgId: string, hs: T[]) {
  const bedIds = hs.map((h) => h.bedId).filter(Boolean) as Types.ObjectId[]
  const roomIds = hs.map((h) => h.roomId).filter(Boolean) as Types.ObjectId[]
  const hostelIds = [...new Set(hs.map((h) => String(h.hostelId)))]
  const [beds, rooms, hostels, dues] = await Promise.all([
    Bed.find({ orgId, _id: { $in: bedIds } }).select('label').lean(),
    Room.find({ orgId, _id: { $in: roomIds } }).select('number').lean(),
    Hostel.find({ orgId, _id: { $in: hostelIds } }).select('name').lean(),
    duesMap(orgId, hs.map((h) => h._id)),
  ])
  const bedMap = new Map(beds.map((b) => [String(b._id), b.label]))
  const roomMap = new Map(rooms.map((r) => [String(r._id), r.number]))
  const hostelMap = new Map(hostels.map((x) => [String(x._id), x.name]))
  return hs.map((h) => ({
    ...toApi(h, HIDDEN),
    roomNumber: h.roomId ? (roomMap.get(String(h.roomId)) ?? null) : null,
    bedLabel: h.bedId ? (bedMap.get(String(h.bedId)) ?? null) : null,
    hostelName: hostelMap.get(String(h.hostelId)) ?? null,
    dues: dues.get(String(h._id)) ?? 0,
  }))
}

async function decorateOne(orgId: string, id: string | Types.ObjectId) {
  const h = await Hosteler.findOne({ _id: id, orgId }).lean()
  if (!h) throw notFound('Hosteler')
  return (await decorate(orgId, [h]))[0]!
}

async function loadHosteler(orgId: string, id: string, session?: ClientSession) {
  const h = await Hosteler.findOne({ _id: id, orgId }).session(session ?? null)
  if (!h) throw notFound('Hosteler')
  return h
}

/** A vacant bed in an active room of the org. */
async function vacantBed(orgId: string, bedId: string, session: ClientSession) {
  const bed = await Bed.findOne({ _id: bedId, orgId }).session(session)
  if (!bed) throw notFound('Bed')
  if (bed.hostelerId) throw conflict('Bed is already occupied')
  const room = await Room.findOne({ _id: bed.roomId, orgId }).session(session)
  if (!room) throw notFound('Room')
  if (room.status !== 'active') throw conflict(`Room ${room.number} is under maintenance`)
  return { bed, room }
}

/** Conditional occupy: only succeeds while the bed is still vacant (-> 409). */
async function occupyBed(orgId: string, bedId: Types.ObjectId, hostelerId: Types.ObjectId, session: ClientSession) {
  const r = await Bed.updateOne({ _id: bedId, orgId, hostelerId: null }, { $set: { hostelerId } }, { session })
  if (r.modifiedCount !== 1) throw conflict('Bed is already occupied')
}

async function gateLog(
  h: { orgId: Types.ObjectId; hostelId: Types.ObjectId; _id: Types.ObjectId },
  direction: 'in' | 'out',
  note: string,
  session: ClientSession,
) {
  await GateLog.create([{ orgId: h.orgId, hostelId: h.hostelId, hostelerId: h._id, direction, time: new Date(), note }], { session })
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`

/* ------------------------------------------------------------------ */
/* List / read / update                                                */
/* ------------------------------------------------------------------ */

router.get(
  '/',
  requireStaff('hostelers'),
  requirePlan('hostelers'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const qy = parse(listQuery, req.query)
    const filter: Record<string, unknown> = { orgId, ...hostelScope(qy) }
    if (!qy.status) filter.status = { $in: ['active', 'reserved'] }
    else if (qy.status !== 'all') filter.status = qy.status
    if (qy.occupation) filter.occupation = qy.occupation
    if (qy.messOpted) filter.messOpted = qy.messOpted === 'true'
    if (qy.q) {
      const rx = new RegExp(escapeRegex(qy.q), 'i')
      filter.$or = [{ name: rx }, { phone: rx }, { loginId: rx }, { institution: rx }]
    }
    if (qy.hasDues) {
      const dues = await duesMap(orgId, null)
      const withDues = [...dues].filter(([, d]) => d > 0).map(([hid]) => oid(hid))
      filter._id = qy.hasDues === 'true' ? { $in: withDues } : { $nin: withDues }
    }
    const [rows, total] = await Promise.all([
      Hosteler.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((qy.page - 1) * qy.limit)
        .limit(qy.limit)
        .lean(),
      Hosteler.countDocuments(filter),
    ])
    res.json(paginate(await decorate(orgId, rows), total, qy.page, qy.limit))
  }),
)

router.get(
  '/:id',
  requireStaff('hostelers'),
  requirePlan('hostelers'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const hosteler = await decorateOne(orgId, id)
    const [documents, invoices, payments, complaints, leaves, visitors, depositAgg, lastGate, hostel, lastConsent] = await Promise.all([
      HDocument.countDocuments({ orgId, hostelerId: id }),
      Invoice.countDocuments({ orgId, hostelerId: id, cancelled: false }),
      Payment.countDocuments({ orgId, hostelerId: id }),
      Complaint.countDocuments({ orgId, hostelerId: id }),
      Leave.countDocuments({ orgId, hostelerId: id }),
      Visitor.countDocuments({ orgId, hostelerId: id }),
      Payment.aggregate<{ total: number }>([
        { $match: { orgId: oid(orgId), hostelerId: oid(id), kind: 'deposit' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      GateLog.findOne({ orgId, hostelerId: id }).sort({ time: -1 }).lean(),
      Hostel.findOne({ orgId, _id: (hosteler as { hostelId?: unknown }).hostelId }).select('rulesVersion rulesText').lean(),
      RulesConsent.findOne({ orgId, hostelerId: id }).sort({ acceptedAt: -1, _id: -1 }).select('rulesVersion acceptedAt').lean(),
    ])
    const signedVersion = ((hosteler as { consentVersion?: number }).consentVersion) ?? 0
    const rulesVersion = hostel?.rulesText ? (hostel.rulesVersion ?? 0) : 0
    res.json({
      ...hosteler,
      consentStatus: {
        required: rulesVersion > signedVersion,
        rulesVersion,
        signedVersion,
        signedAt: lastConsent?.acceptedAt ?? null,
      },
      depositCollected: depositAgg[0]?.total ?? 0,
      lastGateLog: lastGate ? toApi(lastGate) : null,
      counts: { documents, invoices, payments, complaints, leaves, visitors },
    })
  }),
)

router.patch(
  '/:id',
  requireStaff('hostelers'),
  requirePlan('hostelers'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const body = parse(patchSchema, req.body)
    const r = await Hosteler.updateOne({ _id: id, orgId }, { $set: body }, { runValidators: true })
    if (!r.matchedCount) throw notFound('Hosteler')
    res.json(await decorateOne(orgId, id))
  }),
)

/* ------------------------------------------------------------------ */
/* Admission / check-in                                                */
/* ------------------------------------------------------------------ */

router.post(
  '/',
  requireStaff('checkin'),
  requirePlan('checkin'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(admitSchema, req.body)
    const { hostelId: bodyHostelId, bedId, reserveOnly, depositPayment, generateFirstInvoice, securityDeposit, depositOption, ...profile } = body
    if (!bedId && !bodyHostelId) throw badRequest('hostelId is required')
    const { settings } = await getSettings(orgId)
    // hash outside the transaction (the callback may be retried)
    const tempPassword = generateTempPassword()
    const passwordHash = await hashPassword(tempPassword)

    const created = await withTransaction(async (session) => {
      let bedRef: { _id: Types.ObjectId; roomId: Types.ObjectId } | null = null
      let hostelId: Types.ObjectId
      if (bedId) {
        const { bed } = await vacantBed(orgId, bedId, session)
        bedRef = { _id: bed._id, roomId: bed.roomId }
        hostelId = bed.hostelId // the bed's hostel wins
      } else {
        hostelId = (await assertHostel(orgId, bodyHostelId, session))._id
      }
      const hostel = await Hostel.findOneAndUpdate({ _id: hostelId, orgId }, { $inc: { hostelerSeq: 1 } }, { new: true, session })
      if (!hostel) throw notFound('Hostel')
      const loginId = formatLoginId(hostel.code, hostel.hostelerSeq)

      const [h] = await Hosteler.create(
        [
          {
            ...profile,
            orgId,
            hostelId,
            roomId: bedRef?.roomId ?? null,
            bedId: bedRef?._id ?? null,
            status: reserveOnly ? 'reserved' : 'active',
            securityDeposit: securityDeposit ?? settings.defaultSecurityDeposit,
            loginId,
            passwordHash,
            mustChangePassword: true,
          },
        ],
        { session },
      )
      const hosteler = h!
      if (bedRef) await occupyBed(orgId, bedRef._id, hosteler._id, session)
      if (bedRef && !reserveOnly) await openStay(orgId, hosteler, { _id: bedRef._id, roomId: bedRef.roomId, hostelId }, hosteler.checkInDate, session)

      if (depositPayment && depositPayment.amount > 0) {
        await recordPayment(
          orgId,
          {
            hostelerId: hosteler._id,
            amount: depositPayment.amount,
            mode: depositPayment.mode,
            reference: depositPayment.reference,
            date: todayStr(),
            note: 'Security deposit',
            kind: 'deposit',
          },
          session,
        )
      }
      // security deposit not collected now -> first bill (default) or next month's bill
      const collectedNow = depositPayment?.amount ?? 0
      const depositLeft = Math.max(hosteler.securityDeposit - collectedNow, 0)
      const option = depositOption ?? (collectedNow > 0 ? 'collected' : 'first_bill')
      const firstBill = generateFirstInvoice && !reserveOnly
      // the next bill created picks up depositToBill. 'first_bill' (or no first bill): set it now, so the
      // first bill created takes it; 'next_bill' with a first bill: set it after the first bill(s) are made
      const billDeposit = depositLeft > 0 && option !== 'collected'
      const afterFirstBill = billDeposit && option === 'next_bill' && firstBill
      if (billDeposit && !afterFirstBill) hosteler.depositToBill = depositLeft
      // no first bill -> start billing from the second rent cycle (the first month is settled outside the app)
      if (!firstBill && !reserveOnly) hosteler.billFromCycle = 1
      await hosteler.save({ session })
      // first bill = rent cycle starting on the check-in date (plus any cycles already due for a back-dated check-in)
      if (firstBill) await billHostelerNow(orgId, hosteler, session)
      if (afterFirstBill) await Hosteler.updateOne({ _id: hosteler._id }, { $set: { depositToBill: depositLeft } }, { session })
      if (!reserveOnly) await gateLog(hosteler, 'in', 'Check-in', session)
      await logActivity(orgId, reserveOnly ? `${hosteler.name} reserved a bed` : `${hosteler.name} checked in`, 'checkin', hostelId, session)
      return { id: hosteler._id, loginId }
    })

    res.status(201).json({
      hosteler: await decorateOne(orgId, created.id),
      credentials: { loginId: created.loginId, tempPassword },
    })
  }),
)

router.post(
  '/:id/confirm-check-in',
  requireStaff('checkin'),
  requirePlan('checkin'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const body = parse(z.object({ date: dateStr.optional() }), req.body ?? {})
    await withTransaction(async (session) => {
      const h = await loadHosteler(orgId, id, session)
      if (h.status !== 'reserved') throw conflict('Only reserved hostelers can be checked in')
      h.status = 'active'
      h.checkInDate = body.date ?? todayStr()
      await h.save({ session })
      if (h.bedId && h.roomId) await openStay(orgId, h, { _id: h.bedId, roomId: h.roomId, hostelId: h.hostelId }, h.checkInDate, session)
      await gateLog(h, 'in', 'Check-in', session)
      await logActivity(orgId, `${h.name} checked in`, 'checkin', h.hostelId, session)
    })
    res.json(await decorateOne(orgId, id))
  }),
)

router.post(
  '/:id/transfer',
  requireStaff('checkin'),
  requirePlan('checkin'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const body = parse(z.object({ bedId: objectId, updateRent: z.boolean().default(false) }), req.body)
    await withTransaction(async (session) => {
      const h = await loadHosteler(orgId, id, session)
      if (h.status === 'checked_out') throw conflict('This hosteler has checked out')
      if (h.bedId && String(h.bedId) === body.bedId) throw badRequest('Already in this bed')
      const { bed, room } = await vacantBed(orgId, body.bedId, session)
      await ensureStay(orgId, h, session) // older data: record the stay on the old bed first
      // free the old bed first (a hosteler can hold only one bed — unique index)
      await Bed.updateMany({ orgId, hostelerId: h._id }, { $set: { hostelerId: null } }, { session })
      await occupyBed(orgId, bed._id, h._id, session)
      if (h.status === 'active') await moveStay(orgId, h, { _id: bed._id, roomId: bed.roomId, hostelId: bed.hostelId }, todayStr(), session)
      h.bedId = bed._id
      h.roomId = bed.roomId
      h.hostelId = bed.hostelId
      if (body.updateRent) h.monthlyRent = room.rentPerBed
      await h.save({ session })
      await logActivity(orgId, `${h.name} moved to Room ${room.number}-${bed.label}`, 'room', bed.hostelId, session)
    })
    res.json(await decorateOne(orgId, id))
  }),
)

/* ------------------------------------------------------------------ */
/* Check-out (settlement) — same rules as src/pages/admin/CheckOut.tsx */
/* ------------------------------------------------------------------ */

const checkOutSchema = z.object({
  date: dateStr,
  deductions: z
    .array(z.object({ label: text(100).default(''), amount: money }))
    .max(50)
    .default([]),
  adjustDuesFromDeposit: z.boolean().default(true),
  /** Override of the deposit held (default: recorded deposit payments, else the agreed deposit). */
  depositHeld: money.optional(),
  /** Override of the computed refund (cannot exceed the deposit held). */
  depositRefund: money.optional(),
  note: text(1000).default(''),
})
type CheckOutInput = z.infer<typeof checkOutSchema>

const previewQuery = z.object({
  date: dateStr.optional(),
  adjustDuesFromDeposit: z.enum(['true', 'false']).optional(),
  depositHeld: money.optional(),
})

type HostelerDocT = Awaited<ReturnType<typeof loadHosteler>>

/**
 * Works out the check-out settlement without writing anything.
 *
 *  - held: deposit payments (+ a deposit still unpaid on a bill, which is also
 *    part of dues so they net out), else the agreed deposit for older records.
 *  - monthsStayed = full rent cycles completed by the check-out date. When the
 *    hostel has depositMinStayMonths and the stay is shorter, the deposit is
 *    FORFEITED: no refund, and it is not used to adjust dues.
 *  - Check-out is allowed only when nothing is left to collect: every unpaid
 *    bill is paid (or adjusted from a refundable deposit) and deductions fit in
 *    what is left of the deposit.
 */
async function planSettlement(orgId: string, h: HostelerDocT, input: CheckOutInput, session?: ClientSession) {
  const date = input.date
  const s = session ?? null
  // sequential: a transaction session must not run concurrent operations
  const hostel = await Hostel.findOne({ _id: h.hostelId, orgId }).select('depositMinStayMonths').session(s).lean()
  const bed = h.bedId ? await Bed.findOne({ _id: h.bedId, orgId }).session(s).lean() : null
  const room = h.roomId ? await Room.findOne({ _id: h.roomId, orgId }).session(s).lean() : null
  const depositPayments = await Payment.find({ orgId, hostelerId: h._id, kind: 'deposit' }).session(s).lean()
  const invoices = await Invoice.find({ orgId, hostelerId: h._id, cancelled: false }).session(s).lean()
  const moveOut = await MoveOutRequest.findOne({ orgId, hostelerId: h._id, active: true }).session(s).lean()

  const collected = depositPayments.reduce((a, p) => a + p.amount, 0)
  // A deposit line still unpaid on a bill is part of `dues` below, so it also
  // counts as held (they net out — never charged twice). Once a deposit is
  // tracked in the app (received, billed or waiting for the next bill), an
  // uncollected deposit is not held; only older records fall back to the agreed amount.
  const billedDeposit = invoices.reduce((a, inv) => a + inv.items.filter((i) => i.key === 'deposit').reduce((x, i) => x + i.amount, 0), 0)
  const billIds = new Set(invoices.map((inv) => String(inv._id)))
  const paidOnBills = depositPayments.filter((p) => p.invoiceId && billIds.has(String(p.invoiceId))).reduce((a, p) => a + p.amount, 0)
  const unpaidBilledDeposit = Math.max(billedDeposit - paidOnBills, 0)
  const tracked = collected > 0 || billedDeposit > 0 || (h.depositToBill ?? 0) > 0
  const held = Math.round(input.depositHeld ?? (tracked ? collected + unpaidBilledDeposit : h.securityDeposit))

  const unpaid = invoices
    .map((inv) => ({ inv, balance: Math.max(inv.total - inv.paidAmount, 0) }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => a.inv.dueDate.localeCompare(b.inv.dueDate))
  const dues = unpaid.reduce((a, x) => a + x.balance, 0)

  // minimum stay for a deposit refund
  const minStayMonths = hostel?.depositMinStayMonths ?? 0
  const monthsStayed = date >= h.checkInDate ? cycleIndexOf(h.checkInDate, date) : 0
  const depositForfeited = minStayMonths > 0 && monthsStayed < minStayMonths && held > 0
  const forfeitReason = depositForfeited
    ? `Stayed ${monthsStayed} of the ${minStayMonths} month${minStayMonths === 1 ? '' : 's'} required for a deposit refund, so the deposit of ${fmt(held)} is kept by the hostel and is not adjusted against dues`
    : null
  const refundable = depositForfeited ? 0 : held

  const deductions = input.deductions.map((d) => ({ label: d.label || 'Deduction', amount: Math.round(d.amount) })).filter((d) => d.amount > 0)
  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0)

  // dues settled from a refundable deposit, oldest bill first
  const adjustments: { invoiceId: Types.ObjectId; number: string; amount: number }[] = []
  if (input.adjustDuesFromDeposit) {
    let left = Math.min(dues, refundable)
    for (const { inv, balance: b } of unpaid) {
      if (left < 1) break
      const amt = Math.min(b, left)
      if (amt < 1) continue
      adjustments.push({ invoiceId: inv._id, number: inv.number, amount: amt })
      left -= amt
    }
  }
  const adjusted = adjustments.reduce((a, x) => a + x.amount, 0)
  const remainingDues = Math.max(dues - adjusted, 0)
  // a forfeited deposit already covers deductions (damages); otherwise they come out of what is left
  const afterDeductions = depositForfeited ? 0 : refundable - adjusted - totalDeductions
  const deductionShortfall = Math.max(-afterDeductions, 0)
  const toCollect = remainingDues + deductionShortfall
  const computedRefund = Math.max(afterDeductions, 0)
  if (input.depositRefund !== undefined && input.depositRefund > held) throw badRequest(`Refund cannot be more than the deposit held (${fmt(held)})`)
  const refund = input.depositRefund !== undefined ? Math.round(input.depositRefund) : computedRefund

  const adjustedBy = new Map(adjustments.map((a) => [String(a.invoiceId), a.amount]))
  const unpaidBills = unpaid.map(({ inv, balance }) => {
    const adj = adjustedBy.get(String(inv._id)) ?? 0
    return {
      id: String(inv._id),
      number: inv.number,
      month: inv.month,
      periodStart: inv.periodStart ?? null,
      periodEnd: inv.periodEnd ?? null,
      dueDate: inv.dueDate,
      total: inv.total,
      paidAmount: inv.paidAmount,
      balance,
      adjustFromDeposit: adj,
      remaining: balance - adj,
    }
  })

  const blockers: string[] = []
  if (remainingDues > 0) {
    const n = unpaidBills.filter((b) => b.remaining > 0).length
    const why = depositForfeited
      ? ' (the forfeited deposit cannot be adjusted)'
      : !input.adjustDuesFromDeposit && refundable > 0
        ? ' (not adjusted from the deposit)'
        : ''
    blockers.push(`${fmt(remainingDues)} is still due on ${n} bill${n === 1 ? '' : 's'}${why}. Record the payment first.`)
  }
  if (deductionShortfall > 0)
    blockers.push(`Deductions are ${fmt(deductionShortfall)} more than the deposit left. Raise a bill for the extra charges and collect it, or reduce the deductions.`)

  return {
    hostelerId: String(h._id),
    name: h.name,
    loginId: h.loginId,
    bed: room && bed ? `Room ${room.number}-${bed.label}` : null,
    checkIn: h.checkInDate,
    checkOut: date,
    days: Math.max(Math.round((Date.parse(date) - Date.parse(h.checkInDate)) / 86_400_000), 0),
    monthsStayed,
    minStayMonths,
    depositForfeited,
    forfeitReason,
    held,
    dues,
    unpaidBills,
    adjusted,
    adjustments,
    remainingDues,
    deductions,
    totalDeductions,
    refund,
    toCollect,
    canCheckOut: toCollect <= 0,
    blockers,
    moveOutRequest: moveOut ? { id: String(moveOut._id), moveOutDate: moveOut.moveOutDate, status: moveOut.status } : null,
  }
}

/**
 * GET /api/hostelers/:id/check-out-preview?date=&adjustDuesFromDeposit=&depositHeld=
 * The settlement a check-out on `date` (default today) would make, without
 * deductions, and whether it is allowed. Nothing is saved.
 */
router.get(
  '/:id/check-out-preview',
  requireStaff('checkin'),
  requirePlan('checkin'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(previewQuery, req.query)
    const h = await loadHosteler(orgId, idParam(req))
    if (h.status === 'checked_out') throw conflict('Already checked out')
    const date = q.date ?? todayStr()
    if (date < h.checkInDate) throw badRequest('Checkout date cannot be before check-in')
    const { adjustments, ...preview } = await planSettlement(orgId, h, {
      date,
      deductions: [],
      adjustDuesFromDeposit: q.adjustDuesFromDeposit !== 'false',
      depositHeld: q.depositHeld,
      note: '',
    })
    void adjustments
    res.json(preview)
  }),
)

router.post(
  '/:id/check-out',
  requireStaff('checkin'),
  requirePlan('checkin'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const body = parse(checkOutSchema, req.body)

    const settlement = await withTransaction(async (session) => {
      const h = await loadHosteler(orgId, id, session)
      if (h.status === 'checked_out') throw conflict('Already checked out')
      if (body.date < h.checkInDate) throw badRequest('Checkout date cannot be before check-in')

      const plan = await planSettlement(orgId, h, body, session)
      if (!plan.canCheckOut) {
        throw new AppError(409, `${fmt(plan.toCollect)} must be collected before check-out. ${plan.blockers.join(' ')}`, 'DUES_PENDING', {
          toCollect: plan.toCollect,
          remainingDues: plan.remainingDues,
          depositForfeited: plan.depositForfeited,
          unpaidBills: plan.unpaidBills.filter((b) => b.remaining > 0),
          blockers: plan.blockers,
        })
      }

      await ensureStay(orgId, h, session) // older data: record the stay before the bed is freed
      for (const a of plan.adjustments) {
        await recordPayment(
          orgId,
          { hostelerId: h._id, invoiceId: a.invoiceId, amount: a.amount, mode: 'cash', date: body.date, note: 'Adjusted from security deposit' },
          session,
        )
      }

      const noteParts = [
        `Deposit held ${fmt(plan.held)}`,
        plan.depositForfeited ? `forfeited (stayed ${plan.monthsStayed} of ${plan.minStayMonths} months)` : null,
        plan.dues > 0 ? `dues ${fmt(plan.dues)}${plan.adjusted ? ` (${fmt(plan.adjusted)} adjusted)` : ''}` : null,
        ...plan.deductions.map((d) => `${d.label} ${fmt(d.amount)}`),
        `refund ${fmt(plan.refund)}`,
      ].filter(Boolean)
      const deductionNote = `${noteParts.join('; ')}${body.note ? `. ${body.note}` : ''}`

      h.status = 'checked_out'
      h.checkOutDate = body.date
      h.depositRefunded = plan.refund
      h.set({ bedId: null, roomId: null })
      h.notes = `${h.notes ? h.notes + '\n' : ''}Checkout: ${deductionNote}`
      h.tokenVersion += 1 // logs the hosteler out of the portal
      await h.save({ session })
      await Bed.updateMany({ orgId, hostelerId: h._id }, { $set: { hostelerId: null } }, { session })
      await closeStay(orgId, h._id, body.date, session)
      // the move-out notice (pending or approved) is done
      await MoveOutRequest.updateMany({ orgId, hostelerId: h._id, active: true }, { $set: { status: 'completed', active: false } }, { session })
      await gateLog(h, 'out', 'Check-out', session)
      await logActivity(orgId, `${h.name} checked out`, 'checkout', h.hostelId, session)

      const { adjustments, canCheckOut, blockers, moveOutRequest, ...rest } = plan
      void adjustments
      void canCheckOut
      void blockers
      void moveOutRequest
      return { ...rest, notes: body.note }
    })
    res.json({ settlement, hosteler: await decorateOne(orgId, id) })
  }),
)

/* ------------------------------------------------------------------ */
/* Consent to the hostel's rules (signed in the portal)                */
/* ------------------------------------------------------------------ */

router.get(
  '/:id/consents',
  requireStaff('hostelers'),
  requirePlan('hostelers'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const h = await loadHosteler(orgId, idParam(req))
    const items = await RulesConsent.find({ orgId, hostelerId: h._id }).sort({ acceptedAt: -1, _id: -1 })
    res.json({ items: items.map((c) => c.toJSON()) })
  }),
)

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

router.post(
  '/:id/reset-password',
  requireStaff('hostelers'),
  requirePlan('hostelers'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const h = await loadHosteler(orgId, id)
    if (h.status === 'checked_out') throw conflict('This account was closed at check-out')
    const tempPassword = generateTempPassword()
    h.passwordHash = await hashPassword(tempPassword)
    h.mustChangePassword = true
    h.tokenVersion += 1 // sign out existing portal sessions
    await h.save()
    await logActivity(orgId, `Portal password reset for ${h.name}`, 'general', h.hostelId)
    res.json({ loginId: h.loginId, tempPassword })
  }),
)

/* ------------------------------------------------------------------ */
/* Security deposit not yet collected -> put it on a bill              */
/* ------------------------------------------------------------------ */

/** Deposit still to be asked for: agreed − collected outside bills − already on bills − waiting for the next bill. */
async function depositOutstanding(orgId: string, h: { _id: Types.ObjectId; securityDeposit: number; depositToBill: number }, session?: ClientSession) {
  const [direct, bills] = await Promise.all([
    Payment.find({ orgId, hostelerId: h._id, kind: 'deposit', invoiceId: null }).select('amount').session(session ?? null).lean(),
    Invoice.find({ orgId, hostelerId: h._id, cancelled: false, 'items.key': 'deposit' }).select('items').session(session ?? null).lean(),
  ])
  const collected = direct.reduce((a, p) => a + p.amount, 0)
  const billed = bills.reduce((a, inv) => a + inv.items.filter((i) => i.key === 'deposit').reduce((x, i) => x + i.amount, 0), 0)
  return Math.max(h.securityDeposit - collected - billed - (h.depositToBill ?? 0), 0)
}

/**
 * POST /api/hostelers/:id/bill-deposit { target: 'open' | 'next' }
 *   open -> adds "Security deposit" to the hosteler's latest bill now
 *   next -> adds it to the next monthly bill when it is generated
 */
router.post(
  '/:id/bill-deposit',
  requireStaff('fees'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(z.object({ target: z.enum(['open', 'next']) }), req.body)
    const id = idParam(req)
    const result = await withTransaction(async (session) => {
      const h = await Hosteler.findOne({ _id: id, orgId }).session(session)
      if (!h) throw notFound('Hosteler')
      if (h.status === 'checked_out') throw conflict('This hosteler has checked out')
      const amount = await depositOutstanding(orgId, h, session)
      if (amount <= 0) throw conflict('The security deposit is already collected or billed')
      if (body.target === 'next') {
        h.depositToBill = (h.depositToBill ?? 0) + amount
        await h.save({ session })
        await logActivity(orgId, `Security deposit ₹${amount.toLocaleString('en-IN')} for ${h.name} will be added to the next bill`, 'payment', h.hostelId, session)
        return { amount, target: 'next' as const, invoiceNumber: null }
      }
      const inv = await Invoice.findOne({ orgId, hostelerId: h._id, cancelled: false }).sort({ month: -1, createdAt: -1 }).session(session)
      if (!inv) throw conflict('No bill yet — choose "Add to next bill" instead')
      inv.items.push({ key: 'deposit', label: 'Security deposit', amount })
      inv.total += amount
      await inv.save({ session })
      await logActivity(orgId, `Security deposit ₹${amount.toLocaleString('en-IN')} added to ${inv.number} for ${h.name}`, 'payment', h.hostelId, session)
      return { amount, target: 'open' as const, invoiceNumber: inv.number }
    })
    res.json({ ...result, hosteler: await decorateOne(orgId, id) })
  }),
)

/* ------------------------------------------------------------------ */
/* Profile photo (kept as a 'photo' document, like the portal does)    */
/* ------------------------------------------------------------------ */

const PHOTO_MAX_BYTES = 2 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
export const staffPhotoUrl = (id: string | Types.ObjectId) => `/api/hostelers/${String(id)}/photo`

router.post(
  '/:id/photo',
  requireStaff('hostelers'),
  requirePlan('hostelers'),
  upload.single('file'),
  ah(async (req, res) => {
    const file = req.file
    let replaced: string[] = []
    try {
      const { orgId } = staffOf(req)
      const id = idParam(req)
      if (!file) throw badRequest('Choose a photo to upload (field "file")')
      if (file.size > PHOTO_MAX_BYTES) throw new AppError(413, 'Photo must be 2 MB or smaller', 'FILE_TOO_LARGE')
      if (!PHOTO_TYPES.includes(file.mimetype)) throw badRequest('Photo must be a JPG, PNG, WEBP or HEIC image')
      await withTransaction(async (session) => {
        const h = await loadHosteler(orgId, id, session)
        const old = await HDocument.find({ orgId, hostelerId: h._id, type: 'photo' }).select('storageKey').session(session).lean()
        replaced = old.map((d) => d.storageKey)
        if (old.length) await HDocument.deleteMany({ _id: { $in: old.map((d) => d._id) } }, { session })
        await HDocument.create(
          [
            {
              orgId,
              hostelId: h.hostelId,
              hostelerId: h._id,
              type: 'photo',
              fileName: path.basename(file.originalname).slice(0, 200) || 'photo',
              mimeType: file.mimetype,
              size: file.size,
              storageKey: file.filename,
              uploadedBy: 'staff',
              verified: false,
            },
          ],
          { session },
        )
        h.photoUrl = staffPhotoUrl(h._id)
        await h.save({ session })
      })
    } catch (e) {
      if (file) removeStoredFile(file.filename)
      throw e
    }
    // remove replaced files only after the transaction committed
    for (const k of replaced) removeStoredFile(k)
    const id = idParam(req)
    res.status(201).json({ hosteler: await decorateOne(staffOf(req).orgId, id), photoUrl: staffPhotoUrl(id) })
  }),
)

router.get(
  '/:id/photo',
  requireStaff('hostelers'),
  requirePlan('hostelers'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const doc = await HDocument.findOne({ orgId, hostelerId: id, type: 'photo', mimeType: { $in: PHOTO_TYPES } })
      .sort({ createdAt: -1, _id: -1 })
      .lean()
    if (!doc) throw notFound('Photo')
    res.setHeader('Cache-Control', 'private, no-cache')
    sendStoredFile(res, doc.storageKey, doc.fileName, doc.mimeType)
  }),
)

/* ------------------------------------------------------------------ */
/* Delete (owner / manager)                                            */
/* ------------------------------------------------------------------ */

router.delete(
  '/:id',
  requireStaff('hostelers'),
  ah(async (req, res) => {
    const { orgId, role } = staffOf(req)
    if (role !== 'owner' && role !== 'manager') throw forbidden('Only the owner or a manager can delete a hosteler')
    const id = idParam(req)
    const storageKeys = await withTransaction(async (session) => {
      const h = await loadHosteler(orgId, id, session)
      const q = { orgId, hostelerId: h._id }
      const docs = await HDocument.find(q).select('storageKey').session(session).lean()
      await HDocument.deleteMany(q, { session })
      await Invoice.deleteMany(q, { session })
      await Payment.deleteMany(q, { session })
      await GateLog.deleteMany(q, { session })
      await MealOptOut.deleteMany(q, { session })
      await MessFeedback.deleteMany(q, { session })
      await Attendance.deleteMany(q, { session })
      await Leave.deleteMany(q, { session })
      await Visitor.deleteMany(q, { session })
      // complaints are kept for the hostel's records, just unlinked
      await Complaint.updateMany(q, { $set: { hostelerId: null } }, { session })
      await Bed.updateMany(q, { $set: { hostelerId: null } }, { session })
      await RoomStay.deleteMany(q, { session })
      await Hosteler.deleteOne({ _id: h._id, orgId }, { session })
      await logActivity(orgId, `${h.name} (${h.loginId}) was deleted`, 'general', h.hostelId, session)
      return docs.map((d) => d.storageKey)
    })
    // remove files only after the transaction committed
    for (const k of storageKeys) removeStoredFile(k)
    res.status(204).end()
  }),
)
