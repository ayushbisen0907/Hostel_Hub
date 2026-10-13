/**
 * Electricity meter readings (mounted at /api/electricity, module 'rooms').
 *
 *   GET /api/electricity?hostelId=&month=YYYY-MM
 *       -> { hostel {rate, basis}, month, rows: one per room (basis 'room') or per bed (basis 'bed') }
 *   PUT /api/electricity  { hostelId, month, readings: [{ roomId, bedId?, units }] }
 *       units = 0/null removes a reading. Amount = units × rate, split equally among
 *       the room's current hostelers, and added to their bill for that month.
 */
import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { ah, monthStr, objectId, parse, todayStr } from '../../lib/http.js'
import { assertHostel } from '../../lib/org.js'
import { saveReadings } from '../../lib/electricity.js'
import { Bed } from '../../models/Bed.js'
import { ElectricityReading } from '../../models/ElectricityReading.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Invoice } from '../../models/Invoice.js'
import { Room } from '../../models/Room.js'
import { User } from '../../models/User.js'

export const router = Router()
router.use(requireStaff('rooms'))

async function sheet(orgId: string, hostelId: string, month: string) {
  const hostel = await assertHostel(orgId, hostelId)
  const basis = hostel.electricityBasis ?? 'room'
  const [rooms, beds, readings] = await Promise.all([
    Room.find({ orgId, hostelId: hostel._id }).lean(),
    Bed.find({ orgId, hostelId: hostel._id }).sort({ label: 1 }).lean(),
    ElectricityReading.find({ orgId, hostelId: hostel._id, month }).lean(),
  ])
  rooms.sort((a, b) => a.floor - b.floor || a.number.localeCompare(b.number, undefined, { numeric: true }))
  const occupantIds = beds.map((b) => b.hostelerId).filter(Boolean)
  const occupants = new Map(
    (await Hosteler.find({ orgId, _id: { $in: occupantIds }, status: 'active' }).select('name loginId').lean()).map((h) => [String(h._id), h]),
  )
  // which hostelers already have a bill for the month (to show "added to bill" vs "added when bills are generated")
  const billed = new Set((await Invoice.distinct('hostelerId', { orgId, month, cancelled: false, hostelerId: { $in: occupantIds } })).map(String))
  const readingOf = (roomId: unknown, bedId: unknown) =>
    readings.find((r) => String(r.roomId) === String(roomId) && String(r.bedId ?? '') === String(bedId ?? ''))
  const occ = (bedList: typeof beds) =>
    bedList
      .map((b) => (b.hostelerId ? occupants.get(String(b.hostelerId)) : undefined))
      .filter(Boolean)
      .map((h) => ({ id: String(h!._id), name: h!.name, loginId: h!.loginId, billed: billed.has(String(h!._id)) }))
  const out = (r: (typeof readings)[number] | undefined) =>
    r
      ? {
          id: String(r._id),
          units: r.units,
          rate: r.rate,
          amount: r.amount,
          splits: r.splits.map((s) => ({ hostelerId: String(s.hostelerId), name: s.name, amount: s.amount })),
          enteredByName: r.enteredByName,
          updatedAt: (r as { updatedAt?: Date }).updatedAt ?? null,
        }
      : null

  const rows =
    basis === 'room'
      ? rooms.map((room) => {
          const roomBeds = beds.filter((b) => String(b.roomId) === String(room._id))
          return {
            roomId: String(room._id),
            roomNumber: room.number,
            floor: room.floor,
            bedId: null,
            bedLabel: null,
            beds: roomBeds.length,
            occupants: occ(roomBeds),
            reading: out(readingOf(room._id, null)),
          }
        })
      : rooms.flatMap((room) =>
          beds
            .filter((b) => String(b.roomId) === String(room._id))
            .map((b) => ({
              roomId: String(room._id),
              roomNumber: room.number,
              floor: room.floor,
              bedId: String(b._id),
              bedLabel: b.label,
              beds: 1,
              occupants: occ([b]),
              reading: out(readingOf(room._id, b._id)),
            })),
        )
  return {
    hostel: { id: String(hostel._id), name: hostel.name, rate: hostel.electricityRate ?? 0, basis },
    month,
    rows,
    totals: {
      units: readings.reduce((a, r) => a + r.units, 0),
      amount: readings.reduce((a, r) => a + r.amount, 0),
    },
  }
}

router.get(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ hostelId: objectId, month: monthStr.default(todayStr().slice(0, 7)) }), req.query)
    res.json(await sheet(orgId, q.hostelId, q.month))
  }),
)

const putSchema = z.object({
  hostelId: objectId,
  month: monthStr,
  readings: z
    .array(
      z.object({
        roomId: objectId,
        bedId: objectId.nullable().optional(),
        units: z.coerce.number().min(0).max(100_000).nullable(),
      }),
    )
    .min(1)
    .max(1000),
})

router.put(
  '/',
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const body = parse(putSchema, req.body)
    const user = await User.findById(userId).select('name').lean()
    const result = await withTransaction((session) => saveReadings(orgId, body.hostelId, body.month, body.readings, user?.name ?? '', session))
    res.json({ ...result, ...(await sheet(orgId, body.hostelId, body.month)) })
  }),
)
