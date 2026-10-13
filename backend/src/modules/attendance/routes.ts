/**
 * Attendance & leave (Pro plan). Mounted at '/', so every route carries its
 * full path and its own middleware.
 *
 *   GET  /api/attendance?date=&hostelId=                roster of active hostelers + status + approved-leave flag
 *                                                       (+ phone and guardian contact for absentee messages)
 *   PUT  /api/attendance                                { hostelerId, date, status } upsert (no future dates)
 *   POST /api/attendance/mark-all-present               { date, hostelId? } only unmarked; approved leave -> 'leave'
 *   GET  /api/attendance/register?month=&hostelId=      per hosteler: date -> status, totals, percentage
 *
 *   GET  /api/leaves?status=&hostelId=
 *   GET  /api/leaves/current?hostelId=                  approved leaves covering today
 *   POST /api/leaves                                    { hostelerId, from, to, reason, destination?, approve? }
 *   POST /api/leaves/:id/approve | /api/leaves/:id/reject   (pending only, else 409)
 */
import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { ah, dateStr, idParam, monthStr, objectId, parse, todayStr } from '../../lib/http.js'
import { assertHostel, hostelScope, logActivity } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { toApi } from '../../models/_base.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Attendance, Leave } from '../../models/Operations.js'
import { hostelerInfo, onLeaveIds, roomNumbers } from './lookup.js'

export const router = Router()

const guard = [requireStaff('attendance'), requirePlan('attendance')]
const STATUSES = ['present', 'absent', 'leave', 'late'] as const

function notFuture(date: string) {
  if (date > todayStr()) throw badRequest("Attendance can't be marked for a future date")
}

/* ================================================================== */
/* Attendance                                                          */
/* ================================================================== */

router.get(
  '/attendance',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ date: dateStr.optional() }), req.query)
    const date = q.date ?? todayStr()
    const scope = hostelScope(req.query)
    const hs = await Hosteler.find({ orgId, ...scope, status: 'active' }).select('name loginId phone guardianName guardianRelation guardianPhone hostelId roomId')
      .sort({ name: 1 })
      .lean()
    const [records, leaveIds, rooms] = await Promise.all([
      Attendance.find({ orgId, ...scope, date }).select('hostelerId status').lean(),
      onLeaveIds(orgId, date, scope),
      roomNumbers(orgId, hs.map((h) => h.roomId)),
    ])
    const status = new Map(records.map((r) => [String(r.hostelerId), r.status]))
    const items = hs.map((h) => ({
      hostelerId: String(h._id),
      name: h.name,
      loginId: h.loginId,
      hostelId: String(h.hostelId),
      roomId: h.roomId ? String(h.roomId) : null,
      roomNumber: h.roomId ? (rooms.get(String(h.roomId)) ?? null) : null,
      phone: h.phone ?? '',
      guardianName: h.guardianName ?? '',
      guardianRelation: h.guardianRelation ?? '',
      guardianPhone: h.guardianPhone ?? '',
      status: status.get(String(h._id)) ?? null,
      onApprovedLeave: leaveIds.has(String(h._id)),
    }))
    const count = (s: (typeof STATUSES)[number]) => items.filter((i) => i.status === s).length
    res.json({
      date,
      items,
      summary: {
        total: items.length,
        present: count('present'),
        late: count('late'),
        absent: count('absent'),
        leave: count('leave'),
        unmarked: items.filter((i) => !i.status).length,
      },
    })
  }),
)

router.put(
  '/attendance',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(z.object({ hostelerId: objectId, date: dateStr, status: z.enum(STATUSES) }), req.body)
    notFuture(body.date)
    const h = await Hosteler.findOne({ _id: body.hostelerId, orgId, status: { $ne: 'reserved' } }).select('hostelId').lean()
    if (!h) throw notFound('Hosteler')
    const rec = await Attendance.findOneAndUpdate(
      { orgId, hostelerId: body.hostelerId, date: body.date },
      { $set: { status: body.status, hostelId: h.hostelId } },
      { upsert: true, new: true, runValidators: true },
    )
    res.json(rec!.toJSON())
  }),
)

router.post(
  '/attendance/mark-all-present',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(z.object({ date: dateStr, hostelId: objectId.optional() }), req.body)
    notFuture(body.date)
    if (body.hostelId) await assertHostel(orgId, body.hostelId)
    const scope = body.hostelId ? { hostelId: body.hostelId } : {}
    const [targets, marked, leaveIds] = await Promise.all([
      Hosteler.find({ orgId, ...scope, status: 'active' }).select('hostelId').lean(),
      Attendance.find({ orgId, date: body.date }).select('hostelerId').lean(),
      onLeaveIds(orgId, body.date, scope),
    ])
    const markedIds = new Set(marked.map((m) => String(m.hostelerId)))
    const todo = targets.filter((h) => !markedIds.has(String(h._id)))
    const count = await withTransaction(async (session) => {
      if (!todo.length) return 0
      // $setOnInsert: never overwrite a status that was marked concurrently
      const r = await Attendance.bulkWrite(
        todo.map((h) => ({
          updateOne: {
            filter: { orgId, hostelerId: h._id, date: body.date },
            update: {
              $setOnInsert: {
                orgId,
                hostelId: h.hostelId,
                hostelerId: h._id,
                date: body.date,
                status: leaveIds.has(String(h._id)) ? 'leave' : 'present',
              },
            },
            upsert: true,
          },
        })),
        { session },
      )
      return r.upsertedCount
    })
    res.json({ count })
  }),
)

router.get(
  '/attendance/register',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ month: monthStr.optional() }), req.query)
    const month = q.month ?? todayStr().slice(0, 7)
    const [y, m] = month.split('-').map(Number) as [number, number]
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const days = Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
    const monthStart = days[0]!
    const monthEnd = days[nDays - 1]!
    const scope = hostelScope(req.query)

    const hs = await Hosteler.find({
      orgId,
      ...scope,
      status: { $ne: 'reserved' },
      checkInDate: { $lte: monthEnd },
      $or: [{ checkOutDate: null }, { checkOutDate: { $gte: monthStart } }],
    })
      .select('name loginId hostelId roomId')
      .sort({ name: 1 })
      .lean()
    const [records, rooms] = await Promise.all([
      Attendance.find({ orgId, ...scope, date: { $gte: monthStart, $lte: monthEnd } }).select('hostelerId date status').lean(),
      roomNumbers(orgId, hs.map((h) => h.roomId)),
    ])
    const byHosteler = new Map<string, Record<string, string>>()
    for (const r of records) {
      const k = String(r.hostelerId)
      if (!byHosteler.has(k)) byHosteler.set(k, {})
      byHosteler.get(k)![r.date] = r.status
    }
    const items = hs.map((h) => {
      const map = byHosteler.get(String(h._id)) ?? {}
      const vals = Object.values(map)
      const n = (s: string) => vals.filter((v) => v === s).length
      const present = n('present')
      const late = n('late')
      const absent = n('absent')
      const counted = present + late + absent
      return {
        hostelerId: String(h._id),
        name: h.name,
        loginId: h.loginId,
        hostelId: String(h.hostelId),
        roomNumber: h.roomId ? (rooms.get(String(h.roomId)) ?? null) : null,
        days: map, // 'YYYY-MM-DD' -> status (unmarked days are absent from the map)
        present,
        late,
        absent,
        leave: n('leave'),
        percentage: counted ? Math.round(((present + late) / counted) * 100) : null,
      }
    })
    res.json({ month, days, items })
  }),
)

/* ================================================================== */
/* Leaves                                                              */
/* ================================================================== */

async function withNames(orgId: string, leaves: { hostelerId: unknown; _id: unknown }[]) {
  const info = await hostelerInfo(orgId, leaves.map((l) => String(l.hostelerId)))
  return leaves.map((l) => {
    const h = info.get(String(l.hostelerId))
    return {
      ...toApi(l),
      hostelerName: h?.name ?? '',
      loginId: h?.loginId ?? '',
      hostelerPhone: h?.phone ?? '',
      roomNumber: h?.roomNumber ?? null,
    }
  })
}

router.get(
  '/leaves',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }), req.query)
    const leaves = await Leave.find({ orgId, ...hostelScope(req.query), ...(q.status ? { status: q.status } : {}) })
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean()
    res.json({ items: await withNames(orgId, leaves) })
  }),
)

router.get(
  '/leaves/current',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const today = todayStr()
    const leaves = await Leave.find({ orgId, ...hostelScope(req.query), status: 'approved', from: { $lte: today }, to: { $gte: today } })
      .sort({ to: 1 })
      .lean()
    res.json({ items: await withNames(orgId, leaves) })
  }),
)

router.post(
  '/leaves',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      z.object({
        hostelerId: objectId,
        from: dateStr,
        to: dateStr,
        reason: z.string().trim().min(2).max(500),
        destination: z.string().trim().max(200).default(''),
        approve: z.boolean().default(false),
      }),
      req.body,
    )
    if (body.to < body.from) throw badRequest('Leave end date must be on or after the start date')
    const h = await Hosteler.findOne({ _id: body.hostelerId, orgId, status: 'active' }).select('name hostelId').lean()
    if (!h) throw notFound('Hosteler')
    const leave = await withTransaction(async (session) => {
      const [doc] = await Leave.create(
        [
          {
            orgId,
            hostelId: h.hostelId,
            hostelerId: h._id,
            from: body.from,
            to: body.to,
            reason: body.reason,
            destination: body.destination,
            status: body.approve ? 'approved' : 'pending',
            decidedAt: body.approve ? new Date() : null,
          },
        ],
        { session },
      )
      await logActivity(orgId, body.approve ? `Leave approved for ${h.name}` : `Leave requested for ${h.name}`, 'leave', h.hostelId, session)
      return doc!
    })
    res.status(201).json(leave.toJSON())
  }),
)

for (const action of ['approve', 'reject'] as const) {
  router.post(
    `/leaves/:id/${action}`,
    ...guard,
    ah(async (req, res) => {
      const { orgId } = staffOf(req)
      const id = idParam(req)
      const status = action === 'approve' ? 'approved' : 'rejected'
      const leave = await withTransaction(async (session) => {
        const doc = await Leave.findOneAndUpdate(
          { _id: id, orgId, status: 'pending' },
          { $set: { status, decidedAt: new Date() } },
          { new: true, session },
        )
        if (!doc) {
          const exists = await Leave.exists({ _id: id, orgId }).session(session)
          if (!exists) throw notFound('Leave request')
          throw conflict('This leave request was already decided')
        }
        const h = await Hosteler.findById(doc.hostelerId).select('name').session(session).lean()
        await logActivity(orgId, `Leave ${status} for ${h?.name ?? 'hosteler'}`, 'leave', doc.hostelId, session)
        return doc
      })
      res.json(leave.toJSON())
    }),
  )
}
