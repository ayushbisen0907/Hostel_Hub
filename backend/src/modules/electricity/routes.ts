/**
 * Electricity meter readings by period (mounted at /api/electricity, module 'rooms').
 *
 *   GET    /api/electricity?hostelId=          meters (rooms, or beds for bed metering) with the last
 *                                              reading and the suggested next "from" date
 *   GET    /api/electricity/readings?hostelId=&roomId=&bedId=   reading history (newest first)
 *   POST   /api/electricity/preview            { roomId, bedId?, fromDate, toDate, units } -> shares by days (nothing saved)
 *   POST   /api/electricity/readings           same body -> saves, adds each share to the hosteler's current bill
 *   PATCH  /api/electricity/readings/:id       { fromDate?, toDate?, units? } -> re-splits and updates the bills
 *   DELETE /api/electricity/readings/:id       removes the reading and its bill lines
 *
 * The amount (units × hostel rate) is shared by the number of days each
 * hosteler stayed on that meter within the period.
 */
import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requirePlan } from '../../lib/plans.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { ah, dateStr, idParam, objectId, parse, todayStr } from '../../lib/http.js'
import { assertHostel } from '../../lib/org.js'
import { addDays } from '../../lib/dates.js'
import { deleteReading, previewReading, saveReading } from '../../lib/electricity.js'
import { backfillStays } from '../../lib/stays.js'
import { notFound } from '../../lib/errors.js'
import { Bed } from '../../models/Bed.js'
import { ElectricityReading } from '../../models/ElectricityReading.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Invoice } from '../../models/Invoice.js'
import { Room } from '../../models/Room.js'
import { RoomStay } from '../../models/RoomStay.js'
import { User } from '../../models/User.js'
import { toApi } from '../../models/_base.js'

export const router = Router()
router.use(requireStaff('rooms'), requirePlan('electricity'))

async function readingOut(orgId: string, r: Record<string, unknown> & { _id: unknown; roomId: unknown; bedId?: unknown; splits: { invoiceId?: unknown }[] }) {
  const [room, bed] = await Promise.all([
    Room.findById(r.roomId).select('number').lean(),
    r.bedId ? Bed.findById(r.bedId).select('label').lean() : null,
  ])
  const invIds = r.splits.map((s) => s.invoiceId).filter(Boolean)
  const invs = new Map((await Invoice.find({ orgId, _id: { $in: invIds } }).select('number').lean()).map((i) => [String(i._id), i.number]))
  const out = toApi(r)
  return {
    ...out,
    roomNumber: room?.number ?? '',
    bedLabel: bed?.label ?? null,
    splits: r.splits.map((s) => ({ ...(s as object), invoiceNumber: s.invoiceId ? (invs.get(String(s.invoiceId)) ?? null) : null })),
  }
}

router.get(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ hostelId: objectId }), req.query)
    const hostel = await assertHostel(orgId, q.hostelId)
    await backfillStays(orgId)
    const basis = hostel.electricityBasis ?? 'room'
    const [rooms, beds, readings, stays] = await Promise.all([
      Room.find({ orgId, hostelId: hostel._id }).lean(),
      Bed.find({ orgId, hostelId: hostel._id }).sort({ label: 1 }).lean(),
      ElectricityReading.find({ orgId, hostelId: hostel._id }).sort({ toDate: -1 }).lean(),
      RoomStay.find({ orgId, hostelId: hostel._id }).sort({ from: 1 }).lean(),
    ])
    rooms.sort((a, b) => a.floor - b.floor || a.number.localeCompare(b.number, undefined, { numeric: true }))
    const current = new Map(
      (await Hosteler.find({ orgId, _id: { $in: beds.map((b) => b.hostelerId).filter(Boolean) }, status: 'active' }).select('name loginId checkInDate bedId').lean()).map(
        (h) => [String(h.bedId), h],
      ),
    )
    const meter = (room: (typeof rooms)[number], bedList: typeof beds, bedId: unknown) => {
      const last = readings.find((r) => String(r.roomId) === String(room._id) && String(r.bedId ?? '') === String(bedId ?? ''))
      const meterStays = stays.filter((s) => (bedId ? String(s.bedId) === String(bedId) : String(s.roomId) === String(room._id)))
      const firstStay = meterStays[0]?.from ?? null
      return {
        roomId: String(room._id),
        roomNumber: room.number,
        floor: room.floor,
        bedId: bedId ? String(bedId) : null,
        bedLabel: bedId ? (bedList[0]?.label ?? null) : null,
        beds: bedList.length,
        occupants: bedList
          .map((b) => current.get(String(b._id)))
          .filter(Boolean)
          .map((h) => ({ id: String(h!._id), name: h!.name, loginId: h!.loginId, checkInDate: h!.checkInDate })),
        lastReading: last ? { id: String(last._id), fromDate: last.fromDate, toDate: last.toDate, units: last.units, amount: last.amount } : null,
        /** default "from" for the next reading: the day after the last one, else when someone first moved in */
        suggestedFrom: last ? addDays(last.toDate, 1) : firstStay,
      }
    }
    const meters =
      basis === 'room'
        ? rooms.map((room) => meter(room, beds.filter((b) => String(b.roomId) === String(room._id)), null))
        : rooms.flatMap((room) => beds.filter((b) => String(b.roomId) === String(room._id)).map((b) => meter(room, [b], b._id)))
    res.json({ hostel: { id: String(hostel._id), name: hostel.name, rate: hostel.electricityRate ?? 0, basis }, today: todayStr(), meters })
  }),
)

router.get(
  '/readings',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ hostelId: objectId, roomId: objectId.optional(), bedId: objectId.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query)
    await assertHostel(orgId, q.hostelId)
    const docs = await ElectricityReading.find({ orgId, hostelId: q.hostelId, ...(q.roomId ? { roomId: q.roomId } : {}), ...(q.bedId ? { bedId: q.bedId } : {}) })
      .sort({ toDate: -1 })
      .limit(q.limit)
      .lean()
    res.json({ items: await Promise.all(docs.map((d) => readingOut(orgId, d))) })
  }),
)

const readingSchema = z.object({
  roomId: objectId,
  bedId: objectId.nullable().optional(),
  fromDate: dateStr,
  toDate: dateStr,
  units: z.coerce.number().min(0).max(100_000),
})

router.post(
  '/preview',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    res.json(await previewReading(orgId, parse(readingSchema, req.body)))
  }),
)

async function staffName(userId: string) {
  return (await User.findById(userId).select('name').lean())?.name ?? ''
}

router.post(
  '/readings',
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const body = parse(readingSchema, req.body)
    await backfillStays(orgId)
    const name = await staffName(userId)
    const r = await withTransaction((session) => saveReading(orgId, null, body, name, session))
    res.status(201).json({ reading: await readingOut(orgId, r.reading.toObject()), billsUpdated: r.billsUpdated, waitingForNextBill: r.waitingForNextBill, warnings: r.warnings })
  }),
)

router.patch(
  '/readings/:id',
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const id = idParam(req)
    const body = parse(z.object({ fromDate: dateStr, toDate: dateStr, units: z.coerce.number().min(0).max(100_000) }).partial().strict(), req.body)
    const existing = await ElectricityReading.findOne({ _id: id, orgId }).lean()
    if (!existing) throw notFound('Reading')
    const name = await staffName(userId)
    const input = {
      roomId: String(existing.roomId),
      bedId: existing.bedId ? String(existing.bedId) : null,
      fromDate: body.fromDate ?? existing.fromDate,
      toDate: body.toDate ?? existing.toDate,
      units: body.units ?? existing.units,
    }
    const r = await withTransaction((session) => saveReading(orgId, id, input, name, session))
    res.json({ reading: await readingOut(orgId, r.reading.toObject()), billsUpdated: r.billsUpdated, waitingForNextBill: r.waitingForNextBill, warnings: r.warnings })
  }),
)

router.delete(
  '/readings/:id',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    await withTransaction((session) => deleteReading(orgId, id, session))
    res.json({ ok: true, id })
  }),
)
