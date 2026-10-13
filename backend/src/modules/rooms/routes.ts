/**
 * Rooms & beds (mounted at '/', so every path is spelled out)
 *
 *   GET    /api/rooms              ?hostelId ?floor ?status ?vacant=true  rooms with their beds + occupant
 *   GET    /api/rooms/:id
 *   POST   /api/rooms              creates beds A, B, … (= sharing)
 *   POST   /api/rooms/bulk         { hostelId, numbers[] | from/to, floor, type, sharing, rentPerBed, amenities }
 *   PATCH  /api/rooms/:id          changing sharing adds beds / removes EMPTY beds and relabels
 *   DELETE /api/rooms/:id          409 if any bed is occupied
 *   GET    /api/beds/vacant        ?hostelId  vacant beds in active rooms (any staff; used by check-in / transfer)
 *
 * Adding beds is limited by the plan's maxBeds (402 PLAN_LIMIT).
 */
import { Router } from 'express'
import type { ClientSession, Types } from 'mongoose'
import { z } from 'zod'
import { ah, idParam, money, objectId, parse } from '../../lib/http.js'
import { AppError, conflict, notFound } from '../../lib/errors.js'
import { assertHostel, hostelScope, logActivity } from '../../lib/org.js'
import { PLANS, requirePlan, type Plan } from '../../lib/plans.js'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { Organization } from '../../models/Organization.js'
import { Room } from '../../models/Room.js'
import { Bed } from '../../models/Bed.js'
import { Hosteler } from '../../models/Hosteler.js'

export const router = Router()

const roomsAuth = [requireStaff('rooms'), requirePlan('rooms')]

const bedLabel = (i: number) => String.fromCharCode(65 + i)
const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** 402 PLAN_LIMIT if adding `extra` beds would exceed the organization's plan. */
export async function assertBedCapacity(orgId: string | Types.ObjectId, extra: number, session?: ClientSession) {
  if (extra <= 0) return
  const org = await Organization.findById(orgId).select('plan').session(session ?? null).lean()
  const plan = (org?.plan ?? 'free') as Plan
  const max = PLANS[plan].maxBeds
  if (max === null) return
  const current = await Bed.countDocuments({ orgId }).session(session ?? null)
  if (current + extra > max)
    throw new AppError(
      402,
      `${PLANS[plan].name} plan allows up to ${max} beds. You have ${current}; this would add ${extra}. Upgrade to add more.`,
      'PLAN_LIMIT',
      { maxBeds: max, current, adding: extra },
    )
}

/* ---------------- shaping ---------------- */

type RoomLike = InstanceType<typeof Room>

/** Rooms in API shape with `beds` [{ id, label, hostelerId, hosteler }] sorted by label. */
async function withBeds(rooms: RoomLike[]) {
  if (!rooms.length) return []
  const beds = await Bed.find({ roomId: { $in: rooms.map((r) => r._id) } }).lean()
  const hIds = beds.map((b) => b.hostelerId).filter(Boolean)
  const hostelers = hIds.length ? await Hosteler.find({ _id: { $in: hIds } }).select('name status').lean() : []
  const hMap = new Map(hostelers.map((h) => [String(h._id), { id: String(h._id), name: h.name, status: h.status }]))
  const byRoom = new Map<string, typeof beds>()
  for (const b of beds) {
    const k = String(b.roomId)
    if (!byRoom.has(k)) byRoom.set(k, [])
    byRoom.get(k)!.push(b)
  }
  return rooms.map((r) => ({
    ...r.toJSON(),
    beds: (byRoom.get(String(r._id)) ?? [])
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((b) => ({
        id: String(b._id),
        label: b.label,
        hostelerId: b.hostelerId ? String(b.hostelerId) : null,
        hosteler: b.hostelerId ? (hMap.get(String(b.hostelerId)) ?? null) : null,
      })),
  }))
}

async function roomOr404(orgId: string, id: string, session?: ClientSession) {
  const room = await Room.findOne({ _id: id, orgId }).session(session ?? null)
  if (!room) throw notFound('Room')
  return room
}

/* ---------------- schemas ---------------- */

const roomFields = {
  floor: z.coerce.number().int().min(0).max(200).default(0),
  type: z.enum(['ac', 'non-ac']).default('non-ac'),
  sharing: z.coerce.number().int().min(1).max(20),
  rentPerBed: money,
  status: z.enum(['active', 'maintenance']).default('active'),
  amenities: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
}
const roomNumber = z.string().trim().min(1).max(20)

const createSchema = z.object({ hostelId: objectId, number: roomNumber, ...roomFields })

const patchSchema = z
  .object({
    number: roomNumber,
    floor: z.coerce.number().int().min(0).max(200),
    type: z.enum(['ac', 'non-ac']),
    sharing: z.coerce.number().int().min(1).max(20),
    rentPerBed: money,
    status: z.enum(['active', 'maintenance']),
    amenities: z.array(z.string().trim().min(1).max(40)).max(30),
  })
  .partial()
  .strict()

const bulkSchema = z
  .object({
    hostelId: objectId,
    numbers: z.array(roomNumber).min(1).max(200).optional(),
    from: z.coerce.number().int().min(0).optional(),
    to: z.coerce.number().int().min(0).optional(),
    ...roomFields,
  })
  .superRefine((v, ctx) => {
    if (v.numbers) return
    if (v.from === undefined || v.to === undefined)
      return ctx.addIssue({ code: 'custom', path: ['numbers'], message: 'Give room numbers or a from/to range' })
    if (v.to < v.from || v.to - v.from >= 200)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Enter a valid range (max 200 rooms), e.g. 101 to 110' })
  })

const listQuery = z.object({
  floor: z.coerce.number().int().optional(),
  status: z.enum(['active', 'maintenance']).optional(),
  vacant: z.enum(['true', 'false']).optional(),
  type: z.enum(['ac', 'non-ac']).optional(),
})

/* ---------------- routes ---------------- */

router.get(
  '/rooms',
  ...roomsAuth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(listQuery, req.query)
    const filter: Record<string, unknown> = { orgId, ...hostelScope(req.query) }
    if (q.floor !== undefined) filter.floor = q.floor
    if (q.status) filter.status = q.status
    if (q.type) filter.type = q.type
    const rooms = await Room.find(filter)
    rooms.sort((a, b) => String(a.hostelId).localeCompare(String(b.hostelId)) || a.floor - b.floor || byNumber(a.number, b.number))
    let items = await withBeds(rooms)
    if (q.vacant === 'true') items = items.filter((r) => r.beds.some((b) => !b.hostelerId))
    res.json({ items })
  }),
)

router.get(
  '/rooms/:id',
  ...roomsAuth,
  ah(async (req, res) => {
    const room = await roomOr404(staffOf(req).orgId, idParam(req))
    res.json((await withBeds([room]))[0])
  }),
)

router.post(
  '/rooms',
  ...roomsAuth,
  ah(async (req, res) => {
    const body = parse(createSchema, req.body)
    const { orgId } = staffOf(req)
    const room = await withTransaction(async (session) => {
      const hostel = await assertHostel(orgId, body.hostelId, session)
      if (await Room.exists({ orgId, hostelId: hostel._id, number: body.number }).session(session))
        throw conflict(`Room ${body.number} already exists in this hostel`)
      await assertBedCapacity(orgId, body.sharing, session)
      const [room] = await Room.create([{ ...body, orgId, hostelId: hostel._id }], { session })
      await Bed.insertMany(
        Array.from({ length: body.sharing }, (_, i) => ({ orgId, hostelId: hostel._id, roomId: room!._id, label: bedLabel(i) })),
        { session },
      )
      return room!
    })
    res.status(201).json((await withBeds([room]))[0])
  }),
)

router.post(
  '/rooms/bulk',
  ...roomsAuth,
  ah(async (req, res) => {
    const body = parse(bulkSchema, req.body)
    const { orgId } = staffOf(req)
    const wanted = body.numbers ?? Array.from({ length: body.to! - body.from! + 1 }, (_, i) => String(body.from! + i))
    const numbers = [...new Set(wanted)]
    const { created, skipped } = await withTransaction(async (session) => {
      const hostel = await assertHostel(orgId, body.hostelId, session)
      const existing = new Set(
        (await Room.find({ orgId, hostelId: hostel._id, number: { $in: numbers } }).select('number').session(session).lean()).map((r) => r.number),
      )
      const fresh = numbers.filter((n) => !existing.has(n))
      const skipped = numbers.filter((n) => existing.has(n))
      if (!fresh.length) return { created: [] as RoomLike[], skipped }
      await assertBedCapacity(orgId, fresh.length * body.sharing, session)
      const base = { orgId, hostelId: hostel._id, floor: body.floor, type: body.type, sharing: body.sharing, rentPerBed: body.rentPerBed, status: body.status, amenities: body.amenities }
      const created = await Room.create(fresh.map((number) => ({ ...base, number })), { session, ordered: true })
      await Bed.insertMany(
        created.flatMap((r) => Array.from({ length: body.sharing }, (_, i) => ({ orgId, hostelId: hostel._id, roomId: r._id, label: bedLabel(i) }))),
        { session },
      )
      await logActivity(orgId, `${created.length} rooms added`, 'room', hostel._id, session)
      return { created, skipped }
    })
    res.status(201).json({ created: created.length, skipped, items: await withBeds(created) })
  }),
)

router.patch(
  '/rooms/:id',
  ...roomsAuth,
  ah(async (req, res) => {
    const body = parse(patchSchema, req.body)
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const room = await withTransaction(async (session) => {
      const room = await roomOr404(orgId, id, session)
      if (body.number !== undefined && body.number !== room.number) {
        if (await Room.exists({ orgId, hostelId: room.hostelId, number: body.number, _id: { $ne: room._id } }).session(session))
          throw conflict(`Room ${body.number} already exists in this hostel`)
      }
      if (body.sharing !== undefined) {
        const beds = (await Bed.find({ roomId: room._id, orgId }).session(session)).sort((a, b) => a.label.localeCompare(b.label))
        if (body.sharing > beds.length) {
          await assertBedCapacity(orgId, body.sharing - beds.length, session)
          // fill the first free labels after the existing ones
          const used = new Set(beds.map((b) => b.label))
          const extra: { orgId: string; hostelId: unknown; roomId: unknown; label: string }[] = []
          for (let i = 0; extra.length < body.sharing - beds.length; i++)
            if (!used.has(bedLabel(i))) extra.push({ orgId, hostelId: room.hostelId, roomId: room._id, label: bedLabel(i) })
          await Bed.insertMany(extra, { session })
        } else if (body.sharing < beds.length) {
          const toRemove = beds.length - body.sharing
          const empty = beds.filter((b) => !b.hostelerId).reverse().slice(0, toRemove)
          if (empty.length < toRemove) throw conflict('Not enough empty beds to reduce sharing. Move hostelers first.')
          const removeIds = new Set(empty.map((b) => String(b._id)))
          await Bed.deleteMany({ _id: { $in: empty.map((b) => b._id) } }, { session })
          // relabel remaining beds A, B, … (ascending order never collides with a label still in use)
          const remaining = beds.filter((b) => !removeIds.has(String(b._id)))
          for (let i = 0; i < remaining.length; i++) {
            const b = remaining[i]!
            if (b.label !== bedLabel(i)) await Bed.updateOne({ _id: b._id }, { $set: { label: bedLabel(i) } }, { session })
          }
        }
      }
      Object.assign(room, body)
      await room.save({ session })
      return room
    })
    res.json((await withBeds([room]))[0])
  }),
)

router.delete(
  '/rooms/:id',
  ...roomsAuth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    await withTransaction(async (session) => {
      const room = await roomOr404(orgId, id, session)
      const occupied =
        (await Bed.exists({ roomId: room._id, hostelerId: { $ne: null } }).session(session)) ||
        (await Hosteler.exists({ orgId, roomId: room._id, status: { $ne: 'checked_out' } }).session(session))
      if (occupied) throw conflict('Room has occupied beds. Move or check out hostelers first.')
      await Bed.deleteMany({ roomId: room._id, orgId }, { session })
      await room.deleteOne({ session })
    })
    res.json({ ok: true })
  }),
)

router.get(
  '/beds/vacant',
  requireStaff(),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const rooms = await Room.find({ orgId, status: 'active', ...hostelScope(req.query) }).lean()
    const roomMap = new Map(rooms.map((r) => [String(r._id), r]))
    const beds = rooms.length ? await Bed.find({ orgId, roomId: { $in: rooms.map((r) => r._id) }, hostelerId: null }).lean() : []
    const items = beds
      .map((b) => {
        const r = roomMap.get(String(b.roomId))!
        return {
          id: String(b._id),
          label: b.label,
          roomId: String(b.roomId),
          hostelId: String(b.hostelId),
          room: { id: String(r._id), number: r.number, floor: r.floor, type: r.type, sharing: r.sharing, rentPerBed: r.rentPerBed, hostelId: String(r.hostelId) },
        }
      })
      .sort((a, b) => byNumber(a.room.number, b.room.number) || a.label.localeCompare(b.label))
    res.json({ items })
  }),
)
