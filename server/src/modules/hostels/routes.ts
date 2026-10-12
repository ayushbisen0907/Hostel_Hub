/**
 * Hostels (mounted at /api/hostels)
 *
 *   GET    /api/hostels       any staff: list with counts { rooms, beds, occupied, activeHostelers }
 *   GET    /api/hostels/:id   any staff
 *   POST   /api/hostels       code optional (auto-generated, globally unique)
 *   PATCH  /api/hostels/:id   code can't change once hosteler IDs were issued
 *   DELETE /api/hostels/:id   409 while active/reserved hostelers; cascades rooms, beds, mess menu, staff
 */
import { Router } from 'express'
import mongoose, { type Types } from 'mongoose'
import { z } from 'zod'
import { ah, idParam, parse } from '../../lib/http.js'
import { conflict, notFound } from '../../lib/errors.js'
import { makeHostelCode } from '../../lib/auth.js'
import { logActivity } from '../../lib/org.js'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { Hostel } from '../../models/Hostel.js'
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

const fields = {
  name: z.string().trim().min(2).max(120),
  type: z.enum(['boys', 'girls', 'coed']),
  address: z.string().trim().max(300).default(''),
  city: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).default(''),
}
const createSchema = z.object({ ...fields, code: code.optional().or(z.literal('').transform(() => undefined)) })
const patchSchema = z
  .object({
    name: fields.name,
    type: fields.type,
    address: z.string().trim().max(300),
    city: fields.city,
    phone: z.string().trim().max(20),
    code,
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
  return hostels.map((h) => ({ ...h.toJSON(), counts: counts.get(String(h._id))! }))
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
    Object.assign(hostel, body)
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
      await logActivity(orgId, `Hostel "${hostel.name}" deleted`, 'room', null, session)
    })
    res.json({ ok: true })
  }),
)
