/**
 * Gate in/out log, mounted at /api/gate-logs (module 'checkin')
 *
 *   GET  /         list (?date=YYYY-MM-DD, ?direction, ?hostelerId, ?hostelId; paginated)
 *                  each item has hosteler name / room / bed and a `late` flag
 *   POST /         { hostelerId, direction, note }
 *   GET  /outside  active hostelers whose latest log is 'out'
 *
 * Times are stored as Dates; `date` filtering and the `late` flag use the
 * server's local time zone (same as todayStr()).
 */
import { Router } from 'express'
import mongoose, { type Types } from 'mongoose'
import { z } from 'zod'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { ah, dateStr, objectId, paginate, paginationQuery, parse } from '../../lib/http.js'
import { getSettings, hostelScope } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { toApi } from '../../models/_base.js'
import { Bed } from '../../models/Bed.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Room } from '../../models/Room.js'
import { GateLog } from '../../models/Operations.js'

export const router = Router()

const auth = [requireStaff('checkin'), requirePlan('checkin')]

/** Local HH:MM of a Date */
function localTime(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** An IN entry after curfew (or in the small hours before 5 AM) is late — same as the frontend. */
export function isLate(direction: string, time: Date, curfew: string) {
  if (direction !== 'in') return false
  const t = localTime(time)
  return t >= curfew || t < '05:00'
}

type HostelerInfo = { name: string; loginId: string; phone: string; roomNumber: string | null; bedLabel: string | null }

async function hostelerInfo(orgId: string, ids: Types.ObjectId[]) {
  const hs = await Hosteler.find({ orgId, _id: { $in: ids } }).select('name loginId phone roomId bedId').lean()
  const [rooms, beds] = await Promise.all([
    Room.find({ orgId, _id: { $in: hs.map((h) => h.roomId).filter(Boolean) } }).select('number').lean(),
    Bed.find({ orgId, _id: { $in: hs.map((h) => h.bedId).filter(Boolean) } }).select('label').lean(),
  ])
  const roomMap = new Map(rooms.map((r) => [String(r._id), r.number]))
  const bedMap = new Map(beds.map((b) => [String(b._id), b.label]))
  return new Map<string, HostelerInfo>(
    hs.map((h) => [
      String(h._id),
      {
        name: h.name,
        loginId: h.loginId,
        phone: h.phone,
        roomNumber: h.roomId ? (roomMap.get(String(h.roomId)) ?? null) : null,
        bedLabel: h.bedId ? (bedMap.get(String(h.bedId)) ?? null) : null,
      },
    ]),
  )
}

const listQuery = paginationQuery.extend({
  date: dateStr.optional(),
  direction: z.enum(['in', 'out']).optional(),
  hostelerId: objectId.optional(),
  hostelId: z.string().optional(),
})

router.get(
  '/',
  ...auth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const qy = parse(listQuery, req.query)
    const filter: Record<string, unknown> = { orgId, ...hostelScope(qy) }
    if (qy.direction) filter.direction = qy.direction
    if (qy.hostelerId) filter.hostelerId = qy.hostelerId
    if (qy.date) {
      const start = new Date(`${qy.date}T00:00:00`) // local midnight
      if (Number.isNaN(start.getTime())) throw badRequest('Invalid date')
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      filter.time = { $gte: start, $lt: end }
    }
    const [rows, total, { settings }] = await Promise.all([
      GateLog.find(filter)
        .sort({ time: -1, _id: -1 })
        .skip((qy.page - 1) * qy.limit)
        .limit(qy.limit)
        .lean(),
      GateLog.countDocuments(filter),
      getSettings(orgId),
    ])
    const curfew = settings.nightCurfew || '22:00'
    const info = await hostelerInfo(orgId, rows.map((g) => g.hostelerId))
    const items = rows.map((g) => {
      const h = info.get(String(g.hostelerId))
      return {
        ...toApi(g),
        hostelerName: h?.name ?? null,
        hostelerLoginId: h?.loginId ?? null,
        roomNumber: h?.roomNumber ?? null,
        bedLabel: h?.bedLabel ?? null,
        late: isLate(g.direction, g.time, curfew),
      }
    })
    res.json(paginate(items, total, qy.page, qy.limit))
  }),
)

router.post(
  '/',
  ...auth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      z.object({ hostelerId: objectId, direction: z.enum(['in', 'out']), note: z.string().trim().max(300).default('') }),
      req.body,
    )
    const h = await Hosteler.findOne({ _id: body.hostelerId, orgId }).select('hostelId status').lean()
    if (!h) throw notFound('Hosteler')
    if (h.status !== 'active') throw badRequest('Only checked-in (active) hostelers can be logged at the gate')
    const g = await GateLog.create({ orgId, hostelId: h.hostelId, hostelerId: h._id, direction: body.direction, time: new Date(), note: body.note })
    const { settings } = await getSettings(orgId)
    res.status(201).json({ ...g.toJSON(), late: isLate(g.direction, g.time, settings.nightCurfew || '22:00') })
  }),
)

router.get(
  '/outside',
  ...auth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const scope = hostelScope(req.query as Record<string, unknown>)
    // scope by the hosteler's current hostel (not the log's), so transfers are handled
    const match = { orgId: new mongoose.Types.ObjectId(orgId) }
    const latest = await GateLog.aggregate<{ _id: Types.ObjectId; logId: Types.ObjectId; direction: 'in' | 'out'; time: Date; note: string }>([
      { $match: match },
      { $sort: { time: -1, _id: -1 } },
      { $group: { _id: '$hostelerId', logId: { $first: '$_id' }, direction: { $first: '$direction' }, time: { $first: '$time' }, note: { $first: '$note' } } },
      { $match: { direction: 'out' } },
    ])
    const active = await Hosteler.find({ orgId, status: 'active', ...scope, _id: { $in: latest.map((l) => l._id) } })
      .select('_id')
      .lean()
    const activeSet = new Set(active.map((h) => String(h._id)))
    const outside = latest.filter((l) => activeSet.has(String(l._id))).sort((a, b) => a.time.getTime() - b.time.getTime())
    const info = await hostelerInfo(orgId, outside.map((l) => l._id))
    res.json({
      items: outside.map((l) => {
        const h = info.get(String(l._id))!
        return {
          hosteler: { id: String(l._id), ...h },
          log: { id: String(l.logId), direction: l.direction, time: l.time, note: l.note },
          since: l.time,
        }
      }),
    })
  }),
)
