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
 *
 * Every hostel has its own UPI ID + payee name (required when creating) where
 * hostelers pay rent, a mess charge, and an electricity rate per unit with
 * metering per room (split among its hostelers) or per bed.
 */
import { Router } from 'express'
import mongoose, { type Types } from 'mongoose'
import { z } from 'zod'
import { ah, idParam, parse } from '../../lib/http.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { removeStoredFile, sendStoredFile, upload } from '../../lib/upload.js'
import { makeHostelCode } from '../../lib/auth.js'
import { logActivity } from '../../lib/org.js'
import { withTransaction } from '../../config/db.js'
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
  return hostels.map((h) => ({ ...h.toJSON(), hasQr: !!h.qrStorageKey, counts: counts.get(String(h._id))! }))
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
    let hostelCode: string
    if (body.code) {
      if (await Hostel.exists({ code: body.code })) throw conflict(`Hostel code ${body.code} is already taken. Choose another.`)
      hostelCode = body.code
    } else {
      // codes are unique across ALL organizations (hosteler IDs are global)
      const taken = (await Hostel.find({}).select('code').lean()).map((h) => h.code)
      hostelCode = makeHostelCode(body.name, taken)
    }
    const hostel = await Hostel.create({ ...body, code: hostelCode, orgId })
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
    const { charges, ...rest } = body
    Object.assign(hostel, rest)
    if (charges) hostel.set('charges', charges)
    await hostel.save()
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
