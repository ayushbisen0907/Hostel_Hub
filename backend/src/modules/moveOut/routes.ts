/**
 * Move-out (check-out) requests: a hosteler gives notice from the portal,
 * staff approve or reject it. The actual check-out (settlement) stays at
 * POST /api/hostelers/:id/check-out, which marks the request 'completed'.
 *
 * Portal (mounted inside the portal router, so the portal auth + plan apply):
 *   GET    /api/portal/move-out          { items (own, newest first), active, noticePeriodDays, earliestDate, today }
 *   POST   /api/portal/move-out          { moveOutDate, reason? } -> 201
 *                                        moveOutDate must be ≥ today + hostel.noticePeriodDays (400),
 *                                        one pending/approved request at a time (409)
 *   DELETE /api/portal/move-out/:id      cancel own pending / approved request
 *
 * Staff (module 'checkin'):
 *   GET    /api/move-out-requests        ?status&hostelId -> { items } with hosteler name / loginId / room
 *   POST   /api/move-out-requests/:id/approve  { response? } -> sets hosteler.expectedCheckOut
 *   POST   /api/move-out-requests/:id/reject   { response }
 *
 * Staff (owner / manager / warden) are notified of new requests; the
 * hosteler is notified of the decision.
 */
import { Router } from 'express'
import mongoose, { type Types } from 'mongoose'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { hostelerOf, requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { ah, dateStr, idParam, parse, todayStr } from '../../lib/http.js'
import { addDays, shortDate } from '../../lib/dates.js'
import { CHECKIN_ROLES, notifyHostelers, notifyStaff } from '../../lib/notify.js'
import { hostelScope, logActivity } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { Bed } from '../../models/Bed.js'
import { Hostel } from '../../models/Hostel.js'
import { Hosteler } from '../../models/Hosteler.js'
import { MOVE_OUT_STATUSES, MoveOutRequest } from '../../models/MoveOutRequest.js'
import { Room } from '../../models/Room.js'
import { User } from '../../models/User.js'

const oid = (v: string | Types.ObjectId) => new mongoose.Types.ObjectId(String(v))
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/* ================================================================== */
/* Portal                                                              */
/* ================================================================== */

export const portalMoveOutRouter = Router()

async function noticeOf(hostelId: string) {
  const hostel = await Hostel.findById(hostelId).select('noticePeriodDays').lean()
  return hostel?.noticePeriodDays ?? 30
}

portalMoveOutRouter.get(
  '/',
  ah(async (req, res) => {
    const me = hostelerOf(req)
    const today = todayStr()
    const [items, notice, hostel] = await Promise.all([
      MoveOutRequest.find({ orgId: me.orgId, hostelerId: me.hostelerId }).sort({ createdAt: -1, _id: -1 }),
      noticeOf(me.hostelId),
      Hostel.findById(me.hostelId).select('depositMinStayMonths').lean(),
    ])
    const out = items.map((r) => r.toJSON())
    res.json({
      items: out,
      active: out.find((r) => r.status === 'pending' || r.status === 'approved') ?? null,
      noticePeriodDays: notice,
      /** deposit is refunded only after this many months of stay (0 = always) */
      depositMinStayMonths: hostel?.depositMinStayMonths ?? 0,
      earliestDate: addDays(today, notice),
      today,
    })
  }),
)

const requestSchema = z.object({
  moveOutDate: dateStr,
  reason: z.string().trim().max(500).default(''),
})

portalMoveOutRouter.post(
  '/',
  ah(async (req, res) => {
    const me = hostelerOf(req)
    const body = parse(requestSchema, req.body)
    const notice = await noticeOf(me.hostelId)
    const earliest = addDays(todayStr(), notice)
    if (body.moveOutDate < earliest)
      throw badRequest(
        notice > 0
          ? `Your hostel needs ${plural(notice, 'day')} of notice. The earliest move-out date you can choose is ${shortDate(earliest, true)}.`
          : 'The move-out date cannot be in the past.',
      )
    const created = await withTransaction(async (session) => {
      const h = await Hosteler.findOne({ _id: me.hostelerId, orgId: me.orgId }).session(session)
      if (!h) throw notFound('Hosteler')
      if (h.status !== 'active') throw conflict('Only checked-in hostelers can request a move-out')
      if (body.moveOutDate < h.checkInDate) throw badRequest('The move-out date cannot be before your check-in date')
      if (await MoveOutRequest.exists({ hostelerId: h._id, active: true }).session(session))
        throw conflict('You already have a move-out request. Cancel it first to request a different date.')
      const [r] = await MoveOutRequest.create(
        [{ orgId: h.orgId, hostelId: h.hostelId, hostelerId: h._id, moveOutDate: body.moveOutDate, reason: body.reason, status: 'pending', active: true }],
        { session },
      )
      await notifyStaff(
        h.orgId,
        {
          type: 'move_out_requested',
          hostelId: h.hostelId,
          title: `Move-out request: ${h.name}`,
          body: `${h.name} (${h.loginId}) wants to move out on ${shortDate(body.moveOutDate, true)}.${body.reason ? ` Reason: ${body.reason}` : ''}`.slice(0, 500),
          link: '/app/move-out-requests',
        },
        CHECKIN_ROLES,
        session,
      )
      await logActivity(h.orgId, `${h.name} requested to move out on ${body.moveOutDate}`, 'checkout', h.hostelId, session)
      return r!
    })
    res.status(201).json(created.toJSON())
  }),
)

portalMoveOutRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const me = hostelerOf(req)
    const id = idParam(req)
    const updated = await withTransaction(async (session) => {
      const r = await MoveOutRequest.findOne({ _id: id, orgId: me.orgId, hostelerId: me.hostelerId }).session(session)
      if (!r) throw notFound('Move-out request')
      if (!r.active) throw conflict(`This request is already ${r.status}`)
      const wasApproved = r.status === 'approved'
      r.status = 'cancelled'
      r.active = false
      await r.save({ session })
      const h = await Hosteler.findById(me.hostelerId).session(session)
      // an approved date was copied to the hosteler's expected check-out — take it back
      if (h && wasApproved && h.expectedCheckOut === r.moveOutDate) {
        h.set('expectedCheckOut', null)
        await h.save({ session })
      }
      if (h) await logActivity(h.orgId, `${h.name} cancelled their move-out request`, 'checkout', h.hostelId, session)
      return r
    })
    res.json(updated.toJSON())
  }),
)

/* ================================================================== */
/* Staff                                                               */
/* ================================================================== */

export const router = Router()
const checkin = [requireStaff('checkin'), requirePlan('rules')]

const listQuery = z.object({
  status: z.enum([...MOVE_OUT_STATUSES, 'all']).optional(),
  hostelId: z.string().optional(),
})

router.get(
  '/',
  ...checkin,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(listQuery, req.query)
    const filter: Record<string, unknown> = { orgId: oid(orgId), ...hostelScope(q) }
    if (q.status && q.status !== 'all') filter.status = q.status
    const rows = await MoveOutRequest.find(filter).sort({ createdAt: -1, _id: -1 }).limit(500)
    const hs = await Hosteler.find({ orgId, _id: { $in: rows.map((r) => r.hostelerId) } })
      .select('name loginId phone roomId bedId hostelId status expectedCheckOut')
      .lean()
    const [rooms, beds, hostels] = await Promise.all([
      Room.find({ orgId, _id: { $in: hs.map((h) => h.roomId).filter(Boolean) } }).select('number').lean(),
      Bed.find({ orgId, _id: { $in: hs.map((h) => h.bedId).filter(Boolean) } }).select('label').lean(),
      Hostel.find({ orgId, _id: { $in: rows.map((r) => r.hostelId) } }).select('name').lean(),
    ])
    const hMap = new Map(hs.map((h) => [String(h._id), h]))
    const roomMap = new Map(rooms.map((r) => [String(r._id), r.number]))
    const bedMap = new Map(beds.map((b) => [String(b._id), b.label]))
    const hostelMap = new Map(hostels.map((x) => [String(x._id), x.name]))
    res.json({
      items: rows.map((r) => {
        const h = hMap.get(String(r.hostelerId))
        return {
          ...r.toJSON(),
          hosteler: h ? { id: String(h._id), name: h.name, loginId: h.loginId, phone: h.phone, status: h.status } : null,
          roomNumber: h?.roomId ? (roomMap.get(String(h.roomId)) ?? null) : null,
          bedLabel: h?.bedId ? (bedMap.get(String(h.bedId)) ?? null) : null,
          hostelName: hostelMap.get(String(r.hostelId)) ?? null,
        }
      }),
    })
  }),
)

async function decide(req: Parameters<Parameters<typeof ah>[0]>[0], decision: 'approved' | 'rejected', response: string) {
  const { orgId, userId } = staffOf(req)
  const id = idParam(req)
  const user = await User.findById(userId).select('name').lean()
  return withTransaction(async (session) => {
    const r = await MoveOutRequest.findOne({ _id: id, orgId }).session(session)
    if (!r) throw notFound('Move-out request')
    if (r.status !== 'pending') throw conflict(`This request is already ${r.status}`)
    const h = await Hosteler.findOne({ _id: r.hostelerId, orgId }).session(session)
    if (!h) throw notFound('Hosteler')
    r.status = decision
    r.active = decision === 'approved'
    r.response = response
    r.set('decidedByName', user?.name ?? null)
    r.decidedAt = new Date()
    await r.save({ session })
    const date = shortDate(r.moveOutDate, true)
    if (decision === 'approved') {
      h.expectedCheckOut = r.moveOutDate
      await h.save({ session })
    }
    await notifyHostelers(
      orgId,
      [h._id],
      decision === 'approved'
        ? {
            type: 'move_out_approved',
            hostelId: h.hostelId,
            title: 'Move-out approved',
            body: `Your move-out on ${date} is approved. Please clear all dues before check-out.${response ? ` Note: ${response}` : ''}`.slice(0, 500),
            link: '/portal/move-out',
          }
        : {
            type: 'move_out_rejected',
            hostelId: h.hostelId,
            title: 'Move-out request rejected',
            body: `Your move-out request for ${date} was rejected. Reason: ${response}`.slice(0, 500),
            link: '/portal/move-out',
          },
      session,
    )
    await logActivity(orgId, `Move-out of ${h.name} on ${r.moveOutDate} ${decision}`, 'checkout', h.hostelId, session)
    return r
  })
}

router.post(
  '/:id/approve',
  ...checkin,
  ah(async (req, res) => {
    const body = parse(z.object({ response: z.string().trim().max(500).default('') }), req.body ?? {})
    res.json((await decide(req, 'approved', body.response)).toJSON())
  }),
)

router.post(
  '/:id/reject',
  ...checkin,
  ah(async (req, res) => {
    const body = parse(z.object({ response: z.string().trim().min(1, 'Give a reason for rejecting').max(500) }), req.body ?? {})
    res.json((await decide(req, 'rejected', body.response)).toJSON())
  }),
)
