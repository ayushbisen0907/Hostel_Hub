/**
 * Hostelers (residents), mounted at /api/hostelers
 *
 *   GET    /                      list (status, hostelId, q, occupation, messOpted, hasDues; paginated)
 *   GET    /:id                   hosteler + room/bed + dues + counts
 *   PATCH  /:id                   profile fields only (no credentials / bed / status / loginId)
 *   POST   /                      admission / check-in (module 'checkin') -> returns temp credentials once
 *   POST   /:id/confirm-check-in  reserved -> active
 *   POST   /:id/transfer          move to another vacant bed
 *   POST   /:id/check-out         settlement, frees bed, closes portal account
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
import { createInvoice, recordPayment } from '../../lib/money.js'
import { monthlyBillItems } from '../../lib/billing.js'
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
    const [documents, invoices, payments, complaints, leaves, visitors, depositAgg, lastGate] = await Promise.all([
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
    ])
    res.json({
      ...hosteler,
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
    const { hostelId: bodyHostelId, bedId, reserveOnly, depositPayment, generateFirstInvoice, securityDeposit, ...profile } = body
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
      if (generateFirstInvoice && !reserveOnly) {
        const month = hosteler.checkInDate.slice(0, 7)
        const hostelDoc = await Hostel.findById(hosteler.hostelId).select('charges').session(session).lean()
        const items = monthlyBillItems(hosteler, hostelDoc?.charges, settings.messMonthlyCharge)
        await createInvoice(orgId, { hostelerId: hosteler._id, month, items, dueDate: hosteler.checkInDate }, session)
      }
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
      // free the old bed first (a hosteler can hold only one bed — unique index)
      await Bed.updateMany({ orgId, hostelerId: h._id }, { $set: { hostelerId: null } }, { session })
      await occupyBed(orgId, bed._id, h._id, session)
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

      const bed = h.bedId ? await Bed.findOne({ _id: h.bedId, orgId }).session(session).lean() : null
      const room = h.roomId ? await Room.findOne({ _id: h.roomId, orgId }).session(session).lean() : null
      const depositPayments = await Payment.find({ orgId, hostelerId: h._id, kind: 'deposit' }).session(session).lean()
      const collected = depositPayments.reduce((a, p) => a + p.amount, 0)
      const held = Math.round(body.depositHeld ?? (collected || h.securityDeposit))

      const invoices = await Invoice.find({ orgId, hostelerId: h._id, cancelled: false }).session(session).lean()
      const unpaid = invoices
        .map((inv) => ({ inv, balance: Math.max(inv.total - inv.paidAmount, 0) }))
        .filter((x) => x.balance > 0)
        .sort((a, b) => a.inv.dueDate.localeCompare(b.inv.dueDate))
      const dues = unpaid.reduce((a, x) => a + x.balance, 0)
      const deductions = body.deductions
        .map((d) => ({ label: d.label || 'Deduction', amount: Math.round(d.amount) }))
        .filter((d) => d.amount > 0)
      const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0)
      const balance = held - dues - totalDeductions
      const toCollect = Math.max(-balance, 0)
      if (body.depositRefund !== undefined && body.depositRefund > held)
        throw badRequest(`Refund cannot be more than the deposit held (${fmt(held)})`)
      const refund = body.depositRefund !== undefined ? Math.round(body.depositRefund) : Math.max(balance, 0)

      let adjusted = 0
      if (body.adjustDuesFromDeposit) {
        let left = Math.min(dues, held)
        for (const { inv, balance: b } of unpaid) {
          if (left < 1) break
          const amt = Math.min(b, left)
          if (amt < 1) continue
          await recordPayment(
            orgId,
            { hostelerId: h._id, invoiceId: inv._id, amount: amt, mode: 'cash', date: body.date, note: 'Adjusted from security deposit' },
            session,
          )
          left -= amt
          adjusted += amt
        }
      }

      const noteParts = [
        `Deposit held ${fmt(held)}`,
        dues > 0 ? `dues ${fmt(dues)}${adjusted ? ` (${fmt(adjusted)} adjusted)` : ' (not adjusted)'}` : null,
        ...deductions.map((d) => `${d.label} ${fmt(d.amount)}`),
        toCollect > 0 ? `to collect ${fmt(toCollect)}` : `refund ${fmt(refund)}`,
      ].filter(Boolean)
      const deductionNote = `${noteParts.join('; ')}${body.note ? `. ${body.note}` : ''}`

      const checkIn = h.checkInDate
      h.status = 'checked_out'
      h.checkOutDate = body.date
      h.depositRefunded = refund
      h.set({ bedId: null, roomId: null })
      h.notes = `${h.notes ? h.notes + '\n' : ''}Checkout: ${deductionNote}`
      h.tokenVersion += 1 // logs the hosteler out of the portal
      await h.save({ session })
      await Bed.updateMany({ orgId, hostelerId: h._id }, { $set: { hostelerId: null } }, { session })
      await gateLog(h, 'out', 'Check-out', session)
      await logActivity(orgId, `${h.name} checked out`, 'checkout', h.hostelId, session)

      return {
        hostelerId: String(h._id),
        name: h.name,
        loginId: h.loginId,
        bed: room && bed ? `Room ${room.number}-${bed.label}` : null,
        checkIn,
        checkOut: body.date,
        days: Math.max(Math.round((Date.parse(body.date) - Date.parse(checkIn)) / 86_400_000), 0),
        held,
        dues,
        adjusted,
        deductions,
        totalDeductions,
        refund,
        toCollect,
        notes: body.note,
      }
    })
    res.json({ settlement, hosteler: await decorateOne(orgId, id) })
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
      await Hosteler.deleteOne({ _id: h._id, orgId }, { session })
      await logActivity(orgId, `${h.name} (${h.loginId}) was deleted`, 'general', h.hostelId, session)
      return docs.map((d) => d.storageKey)
    })
    // remove files only after the transaction committed
    for (const k of storageKeys) removeStoredFile(k)
    res.status(204).end()
  }),
)
