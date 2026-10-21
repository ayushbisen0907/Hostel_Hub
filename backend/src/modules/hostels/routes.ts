/**
 * Hostels (mounted at /api/hostels)
 *
 *   GET    /api/hostels       any staff: list with counts { rooms, beds, occupied, activeHostelers }
 *   GET    /api/hostels/:id   any staff
 *   POST   /api/hostels       code optional (auto-generated, globally unique)
 *   PATCH  /api/hostels/:id   code can't change once hosteler IDs were issued
 *   DELETE /api/hostels/:id   409 while active/reserved hostelers; cascades rooms, beds, mess menu, staff
 *   PUT    /api/hostels/:id/qr   multipart image: the hostel's UPI QR code (optional; otherwise drawn from upiId)
 *   GET    /api/hostels/:id/qr   any staff
 *   DELETE /api/hostels/:id/qr
 *   GET    /api/hostels/:id/default-rules   { rulesText } — suggested rules built from the hostel + org settings
 *   GET    /api/hostels/:id/whatsapp        WhatsApp bill messages: { enabled, ready, sender: 'own' | 'default' | null, number, templateText }
 *   PUT    /api/hostels/:id/whatsapp        { enabled } (Starter plan and up; HostelHub's number, or the hostel's own once connected)
 *   POST   /api/hostels/:id/whatsapp/test   { phone } -> sends a sample bill message now
 *
 * Stay terms: noticePeriodDays (0–90, default 30) for move-out requests;
 * depositMinStayMonths (0 = always refundable, else 1–12 full rent cycles)
 * for the deposit refund at check-out; rulesText (≤ 10000) that hostelers sign
 * in the portal. rulesVersion is read-only: it goes up whenever rulesText
 * changes, and active hostelers are asked to sign again.
 *
 * Every hostel has its own UPI ID + payee name (required when creating) where
 * hostelers pay rent, a mess charge, and an electricity rate per unit with
 * metering per room (split among its hostelers) or per bed.
 */
import { Router } from 'express'
import mongoose, { type Types } from 'mongoose'
import { z } from 'zod'
import { ah, idParam, parse } from '../../lib/http.js'
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js'
import { removeStoredFile, sendStoredFile, upload } from '../../lib/upload.js'
import { makeHostelCode } from '../../lib/auth.js'
import { getSettings, logActivity } from '../../lib/org.js'
import { notifyHostelers } from '../../lib/notify.js'
import { defaultRulesText } from '../../lib/rules.js'
import { withTransaction } from '../../config/db.js'
import { assertLimit, orgPlan, requirePlan } from '../../lib/plans.js'
import { BILL_TEMPLATE_TEXT, sampleBillParams, senderFor, sendTemplate, waNumber } from '../../lib/whatsapp.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { Hostel, UPI_ID_RE } from '../../models/Hostel.js'
import { Room } from '../../models/Room.js'
import { Bed } from '../../models/Bed.js'
import { Hosteler } from '../../models/Hosteler.js'
import { MessMenu, Staff } from '../../models/Operations.js'

export const router = Router()

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,8}$/, 'Code must be 2-8 letters or digits')

const upiId = z.string().trim().regex(UPI_ID_RE, 'Enter a valid UPI ID, e.g. name@okhdfc')
const charge = z.coerce.number().min(0).max(1_000_000)
const chargesSchema = z
  .object({
    mess: charge.default(0),
    electricity: charge.default(0),
    water: charge.default(0),
    internet: charge.default(0),
    laundry: charge.default(0),
    maintenance: charge.default(0),
    others: z.array(z.object({ label: z.string().trim().min(1).max(60), amount: charge })).max(10).default([]),
  })
  .strict()

const stayTerms = {
  noticePeriodDays: z.coerce.number().int().min(0).max(90),
  depositMinStayMonths: z.coerce.number().int().min(0).max(12),
  rulesText: z.string().trim().max(10000, 'Rules can be at most 10000 characters'),
}

const fields = {
  name: z.string().trim().min(2).max(120),
  type: z.enum(['boys', 'girls', 'coed']),
  address: z.string().trim().max(300).default(''),
  city: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).default(''),
}
const createSchema = z.object({
  ...fields,
  code: code.optional().or(z.literal('').transform(() => undefined)),
  upiId,
  payeeName: z.string().trim().min(2, 'Enter the name shown on the UPI account').max(80),
  charges: chargesSchema.default({}),
  electricityRate: charge.default(0),
  electricityBasis: z.enum(['room', 'bed']).default('room'),
  noticePeriodDays: stayTerms.noticePeriodDays.default(30),
  depositMinStayMonths: stayTerms.depositMinStayMonths.default(0),
  rulesText: stayTerms.rulesText.default(''),
})
const patchSchema = z
  .object({
    name: fields.name,
    type: fields.type,
    address: z.string().trim().max(300),
    city: fields.city,
    phone: z.string().trim().max(20),
    code,
    upiId,
    payeeName: z.string().trim().min(2).max(80),
    charges: chargesSchema,
    electricityRate: charge,
    electricityBasis: z.enum(['room', 'bed']),
    ...stayTerms,
  })
  .partial()
  .strict()

/** Counts per hostel: rooms, beds (active rooms), occupied, activeHostelers. */
async function hostelCounts(orgId: string, hostelIds: Types.ObjectId[]) {
  const [rooms, beds, active] = await Promise.all([
    Room.find({ orgId, hostelId: { $in: hostelIds } }).select('hostelId status').lean(),
    Bed.find({ orgId, hostelId: { $in: hostelIds } }).select('hostelId roomId hostelerId').lean(),
    Hosteler.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { orgId: new mongoose.Types.ObjectId(orgId), hostelId: { $in: hostelIds }, status: 'active' } },
      { $group: { _id: '$hostelId', n: { $sum: 1 } } },
    ]),
  ])
  const activeRooms = new Set(rooms.filter((r) => r.status === 'active').map((r) => String(r._id)))
  const out = new Map<string, { rooms: number; beds: number; occupied: number; vacant: number; activeHostelers: number }>()
  for (const id of hostelIds) out.set(String(id), { rooms: 0, beds: 0, occupied: 0, vacant: 0, activeHostelers: 0 })
  for (const r of rooms) out.get(String(r.hostelId))!.rooms++
  for (const b of beds) {
    if (!activeRooms.has(String(b.roomId))) continue
    const c = out.get(String(b.hostelId))!
    c.beds++
    if (b.hostelerId) c.occupied++
    else c.vacant++
  }
  for (const a of active) {
    const c = out.get(String(a._id))
    if (c) c.activeHostelers = a.n
  }
  return out
}

async function withCounts(orgId: string, hostels: InstanceType<typeof Hostel>[]) {
  const counts = await hostelCounts(orgId, hostels.map((h) => h._id))
  return hostels.map((h) => ({
    ...h.toJSON(),
    hasQr: !!h.qrStorageKey,
    whatsapp: { enabled: !!h.whatsappEnabled, ownNumber: h.whatsappApiKey ? h.whatsappNumber || 'connected' : null },
    counts: counts.get(String(h._id))!,
  }))
}

async function hostelOr404(orgId: string, id: string) {
  const h = await Hostel.findOne({ _id: id, orgId })
  if (!h) throw notFound('Hostel')
  return h
}

router.get(
  '/',
  requireStaff(),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const hostels = await Hostel.find({ orgId }).sort({ createdAt: 1 })
    res.json({ items: await withCounts(orgId, hostels) })
  }),
)

router.get(
  '/:id',
  requireStaff(),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const h = await hostelOr404(orgId, idParam(req))
    res.json((await withCounts(orgId, [h]))[0])
  }),
)

router.post(
  '/',
  requireStaff('hostels'),
  ah(async (req, res) => {
    const body = parse(createSchema, req.body)
    const { orgId } = staffOf(req)
    assertLimit(await orgPlan(orgId), 'hostels', await Hostel.countDocuments({ orgId }))
    let hostelCode: string
    if (body.code) {
      if (await Hostel.exists({ code: body.code })) throw conflict(`Hostel code ${body.code} is already taken. Choose another.`)
      hostelCode = body.code
    } else {
      // codes are unique across ALL organizations (hosteler IDs are global)
      const taken = (await Hostel.find({}).select('code').lean()).map((h) => h.code)
      hostelCode = makeHostelCode(body.name, taken)
    }
    const hostel = await Hostel.create({ ...body, code: hostelCode, orgId, rulesVersion: body.rulesText ? 1 : 0 })
    await logActivity(orgId, `Hostel "${hostel.name}" created`, 'room', hostel._id)
    res.status(201).json((await withCounts(orgId, [hostel]))[0])
  }),
)

router.patch(
  '/:id',
  requireStaff('hostels'),
  ah(async (req, res) => {
    const body = parse(patchSchema, req.body)
    const { orgId } = staffOf(req)
    const hostel = await hostelOr404(orgId, idParam(req))
    if (body.code !== undefined && body.code !== hostel.code) {
      if (hostel.hostelerSeq > 0)
        throw conflict("The hostel code can't change after hosteler IDs have been issued")
      if (await Hostel.exists({ code: body.code, _id: { $ne: hostel._id } }))
        throw conflict(`Hostel code ${body.code} is already taken. Choose another.`)
    }
    const { charges, rulesText, ...rest } = body
    Object.assign(hostel, rest)
    if (charges) hostel.set('charges', charges)
    const rulesChanged = rulesText !== undefined && rulesText !== (hostel.rulesText ?? '')
    if (rulesChanged) {
      hostel.rulesText = rulesText
      hostel.rulesVersion = (hostel.rulesVersion ?? 0) + 1
    }
    await hostel.save()
    if (rulesChanged && rulesText) {
      const active = await Hosteler.find({ orgId, hostelId: hostel._id, status: 'active' }).select('_id').lean()
      await notifyHostelers(orgId, active.map((h) => h._id), {
        type: 'consent_required',
        hostelId: hostel._id,
        title: 'Hostel rules updated',
        body: `${hostel.name} has updated its rules. Please read and sign them in the app to continue.`,
        link: '/portal/rules',
      })
      await logActivity(orgId, `Rules of "${hostel.name}" updated (version ${hostel.rulesVersion})`, 'general', hostel._id)
    }
    res.json((await withCounts(orgId, [hostel]))[0])
  }),
)

router.delete(
  '/:id',
  requireStaff('hostels'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    await withTransaction(async (session) => {
      const hostel = await Hostel.findOne({ _id: id, orgId }).session(session)
      if (!hostel) throw notFound('Hostel')
      if (await Hosteler.exists({ orgId, hostelId: hostel._id, status: { $ne: 'checked_out' } }).session(session))
        throw conflict('This hostel still has active or reserved hostelers.')
      const filter = { orgId, hostelId: hostel._id }
      await Bed.deleteMany(filter, { session })
      await Room.deleteMany(filter, { session })
      await MessMenu.deleteMany(filter, { session })
      await Staff.deleteMany(filter, { session })
      await hostel.deleteOne({ session })
      if (hostel.qrStorageKey) removeStoredFile(hostel.qrStorageKey)
      await logActivity(orgId, `Hostel "${hostel.name}" deleted`, 'room', null, session)
    })
    res.json({ ok: true })
  }),
)

/* ---------------- rules ---------------- */

router.get(
  '/:id/default-rules',
  requireStaff('hostels'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const hostel = await hostelOr404(orgId, idParam(req))
    const { settings } = await getSettings(orgId)
    res.json({ rulesText: defaultRulesText(hostel, settings) })
  }),
)

/* ---------------- UPI QR image ---------------- */

const QR_MAX = 2 * 1024 * 1024

router.put(
  '/:id/qr',
  requireStaff('hostels'),
  upload.single('file'),
  ah(async (req, res) => {
    const file = req.file
    try {
      const { orgId } = staffOf(req)
      if (!file) throw badRequest('Choose a QR image to upload')
      if (!file.mimetype.startsWith('image/')) throw badRequest('The QR code must be an image (JPG/PNG/WEBP)')
      if (file.size > QR_MAX) throw badRequest('The QR image must be 2 MB or smaller')
      const hostel = await hostelOr404(orgId, idParam(req))
      const old = hostel.qrStorageKey
      hostel.qrStorageKey = file.filename
      hostel.qrMimeType = file.mimetype
      await hostel.save()
      if (old) removeStoredFile(old)
      res.json((await withCounts(orgId, [hostel]))[0])
    } catch (e) {
      if (file) removeStoredFile(file.filename)
      throw e
    }
  }),
)

router.get(
  '/:id/qr',
  requireStaff(),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const hostel = await hostelOr404(orgId, idParam(req))
    if (!hostel.qrStorageKey) throw notFound('QR image')
    sendStoredFile(res, hostel.qrStorageKey, `${hostel.code}-upi-qr`, hostel.qrMimeType ?? 'image/png')
  }),
)

router.delete(
  '/:id/qr',
  requireStaff('hostels'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const hostel = await hostelOr404(orgId, idParam(req))
    if (hostel.qrStorageKey) removeStoredFile(hostel.qrStorageKey)
    hostel.set('qrStorageKey', null)
    hostel.set('qrMimeType', null)
    await hostel.save()
    res.json((await withCounts(orgId, [hostel]))[0])
  }),
)

/* ------------------------------------------------------------------ */
/* WhatsApp bill messages (Pabbly Chatflow)                            */
/* ------------------------------------------------------------------ */

function whatsappOut(h: InstanceType<typeof Hostel>) {
  const sender = senderFor(h)
  return {
    enabled: !!h.whatsappEnabled,
    ready: !!sender,
    sender: sender ? (sender.own ? 'own' : 'default') : null,
    number: sender?.number ?? '',
    templateText: BILL_TEMPLATE_TEXT,
  }
}

router.get(
  '/:id/whatsapp',
  requireStaff('hostels'),
  ah(async (req, res) => {
    res.json(whatsappOut(await hostelOr404(staffOf(req).orgId, idParam(req))))
  }),
)

router.put(
  '/:id/whatsapp',
  requireStaff('hostels'),
  requirePlan('whatsapp'),
  ah(async (req, res) => {
    const body = parse(z.object({ enabled: z.boolean() }).strict(), req.body)
    const { orgId } = staffOf(req)
    const hostel = await hostelOr404(orgId, idParam(req))
    if (body.enabled && !senderFor(hostel)) throw conflict("WhatsApp messages aren't set up yet")
    hostel.whatsappEnabled = body.enabled
    await hostel.save()
    await logActivity(orgId, `WhatsApp bill messages ${hostel.whatsappEnabled ? 'on' : 'off'} for "${hostel.name}"`, 'general', hostel._id)
    res.json(whatsappOut(hostel))
  }),
)

router.post(
  '/:id/whatsapp/test',
  requireStaff('hostels'),
  requirePlan('whatsapp'),
  ah(async (req, res) => {
    const body = parse(z.object({ phone: z.string().trim().min(10).max(20) }), req.body)
    const hostel = await hostelOr404(staffOf(req).orgId, idParam(req))
    const sender = senderFor(hostel)
    if (!sender) throw conflict("WhatsApp messages aren't set up yet")
    const to = waNumber(body.phone)
    if (!to) throw badRequest('Enter a valid WhatsApp number')
    const r = await sendTemplate(sender.apiKey, to, sender.templateName, sampleBillParams(hostel.name, hostel.upiId ?? ''))
    if (!r.ok) throw new AppError(502, `WhatsApp test failed: ${r.error}`, 'WHATSAPP_FAILED')
    res.json({ ok: true, to, messageId: r.id })
  }),
)
