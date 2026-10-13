/**
 * Complaints (every plan)
 *
 *   GET    /api/complaints?status&category&priority&q&hostelId   newest first, with hosteler name & room
 *   GET    /api/complaints/stats?hostelId                         open, inProgress, resolvedThisMonth, avgResolutionHours
 *   GET    /api/complaints/assignees?hostelId                     staff directory entries a complaint can be assigned to
 *                                                                 (any complaints role, so wardens can assign without the staff module)
 *   GET    /api/complaints/:id
 *   POST   /api/complaints                                        staff-created
 *   PATCH  /api/complaints/:id                                    { status, priority, assignedStaffId, title, description }
 *   POST   /api/complaints/:id/comments                           { text }
 *   DELETE /api/complaints/:id
 */
import { Router } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { notFound } from '../../lib/errors.js'
import { ah, escapeRegex, idParam, objectId, parse, todayStr } from '../../lib/http.js'
import { assertHostel, hostelScope, logActivity } from '../../lib/org.js'
import { toApi } from '../../models/_base.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Room } from '../../models/Room.js'
import { User } from '../../models/User.js'
import { Complaint, Staff } from '../../models/Operations.js'
import { hostelerInfo, roomNumbers } from '../attendance/lookup.js'

export const router = Router()

// mounted at /api/complaints
router.use(requireStaff('complaints'))

const CATEGORIES = ['electrical', 'plumbing', 'internet', 'cleaning', 'furniture', 'food', 'security', 'other'] as const
const PRIORITIES = ['low', 'medium', 'high'] as const
const STATUSES = ['open', 'in_progress', 'resolved'] as const

type ComplaintLean = {
  _id: Types.ObjectId
  hostelerId?: Types.ObjectId | null
  roomId?: Types.ObjectId | null
  assignedStaffId?: Types.ObjectId | null
  comments?: { _id?: Types.ObjectId; by: string; byKind: string; text: string; at: Date }[]
}

/** Adds hostelerName, roomNumber, assignedStaffName; comment ids as `id`. */
async function decorate<T extends ComplaintLean>(orgId: string, list: T[]) {
  const info = await hostelerInfo(orgId, list.map((c) => c.hostelerId))
  const rooms = await roomNumbers(orgId, list.map((c) => c.roomId))
  const staffIds = [...new Set(list.map((c) => c.assignedStaffId).filter(Boolean).map(String))]
  const staff = staffIds.length ? await Staff.find({ orgId, _id: { $in: staffIds } }).select('name').lean() : []
  const staffName = new Map(staff.map((s) => [String(s._id), s.name]))
  return list.map((c) => {
    const h = c.hostelerId ? info.get(String(c.hostelerId)) : undefined
    const { comments, ...rest } = toApi(c) as Record<string, unknown> & { comments?: ComplaintLean['comments'] }
    return {
      ...rest,
      comments: (comments ?? []).map(({ _id, ...cm }) => ({ id: String(_id), ...cm })),
      hostelerName: h?.name ?? null,
      hostelerPhone: h?.phone ?? null,
      roomNumber: (c.roomId ? rooms.get(String(c.roomId)) : undefined) ?? h?.roomNumber ?? null,
      assignedStaffName: c.assignedStaffId ? (staffName.get(String(c.assignedStaffId)) ?? null) : null,
    }
  })
}

async function loadOne(orgId: string, id: string) {
  const c = await Complaint.findOne({ _id: id, orgId }).lean()
  if (!c) throw notFound('Complaint')
  return (await decorate(orgId, [c]))[0]!
}

router.get(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(
      z.object({
        status: z.enum(STATUSES).optional(),
        category: z.enum(CATEGORIES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        q: z.string().trim().max(100).optional(),
      }),
      req.query,
    )
    const filter: Record<string, unknown> = { orgId, ...hostelScope(req.query) }
    if (q.status) filter.status = q.status
    if (q.category) filter.category = q.category
    if (q.priority) filter.priority = q.priority
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i')
      const hs = await Hosteler.find({ orgId, name: rx }).select('_id').limit(200).lean()
      filter.$or = [{ title: rx }, { description: rx }, { hostelerId: { $in: hs.map((h) => h._id) } }]
    }
    const list = await Complaint.find(filter).sort({ createdAt: -1 }).limit(1000).lean()
    res.json({ items: await decorate(orgId, list) })
  }),
)

router.get(
  '/stats',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const scope = { orgId, ...hostelScope(req.query) }
    const month = todayStr().slice(0, 7)
    const [open, inProgress, resolved] = await Promise.all([
      Complaint.countDocuments({ ...scope, status: 'open' }),
      Complaint.countDocuments({ ...scope, status: 'in_progress' }),
      Complaint.find({ ...scope, status: 'resolved', resolvedAt: { $ne: null } }).select('createdAt resolvedAt').lean(),
    ])
    const resolvedThisMonth = resolved.filter((c) => todayStr(c.resolvedAt!).slice(0, 7) === month).length
    const avgMs = resolved.length
      ? resolved.reduce((a, c) => a + (c.resolvedAt!.getTime() - c.createdAt.getTime()), 0) / resolved.length
      : null
    res.json({
      open,
      inProgress,
      resolvedThisMonth,
      resolvedTotal: resolved.length,
      avgResolutionHours: avgMs === null ? null : Math.round((avgMs / 3_600_000) * 10) / 10,
    })
  }),
)

router.get(
  '/assignees',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ includeInactive: z.enum(['true', 'false']).optional() }), req.query)
    const filter: Record<string, unknown> = { orgId, ...hostelScope(req.query) }
    if (q.includeInactive !== 'true') filter.active = true
    const list = await Staff.find(filter).select('name role hostelId active').sort({ name: 1 }).lean()
    res.json({
      items: list.map((s) => ({ id: String(s._id), name: s.name, role: s.role, hostelId: String(s.hostelId), active: s.active })),
    })
  }),
)

router.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await loadOne(staffOf(req).orgId, idParam(req)))
  }),
)

router.post(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      z.object({
        hostelId: objectId,
        hostelerId: objectId.nullish(),
        roomId: objectId.nullish(),
        category: z.enum(CATEGORIES),
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().max(2000).default(''),
        priority: z.enum(PRIORITIES).default('medium'),
      }),
      req.body,
    )
    await assertHostel(orgId, body.hostelId)
    let roomId: Types.ObjectId | string | null = body.roomId ?? null
    if (body.hostelerId) {
      const h = await Hosteler.findOne({ _id: body.hostelerId, orgId, hostelId: body.hostelId }).select('roomId').lean()
      if (!h) throw notFound('Hosteler')
      if (!roomId) roomId = h.roomId ?? null
    }
    if (body.roomId && !(await Room.exists({ _id: body.roomId, orgId, hostelId: body.hostelId }))) throw notFound('Room')
    const created = await withTransaction(async (session) => {
      const [doc] = await Complaint.create(
        [
          {
            orgId,
            hostelId: body.hostelId,
            hostelerId: body.hostelerId ?? null,
            roomId,
            category: body.category,
            title: body.title,
            description: body.description,
            priority: body.priority,
          },
        ],
        { session },
      )
      await logActivity(orgId, `New complaint: ${body.title}`, 'complaint', body.hostelId, session)
      return doc!
    })
    res.status(201).json(await loadOne(orgId, String(created._id)))
  }),
)

router.patch(
  '/:id',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const body = parse(
      z
        .object({
          status: z.enum(STATUSES),
          priority: z.enum(PRIORITIES),
          assignedStaffId: objectId.nullable(),
          title: z.string().trim().min(3).max(120),
          description: z.string().trim().max(2000),
        })
        .partial()
        .strict(),
      req.body,
    )
    const c = await Complaint.findOne({ _id: id, orgId })
    if (!c) throw notFound('Complaint')
    if (body.assignedStaffId) {
      if (!(await Staff.exists({ _id: body.assignedStaffId, orgId, hostelId: c.hostelId }))) throw notFound('Staff member')
    }
    if (body.status !== undefined && body.status !== c.status) {
      c.set('resolvedAt', body.status === 'resolved' ? new Date() : null)
      c.status = body.status
    }
    if (body.priority !== undefined) c.priority = body.priority
    if (body.title !== undefined) c.title = body.title
    if (body.description !== undefined) c.description = body.description
    if (body.assignedStaffId !== undefined) c.set('assignedStaffId', body.assignedStaffId)
    await c.save()
    res.json(await loadOne(orgId, id))
  }),
)

router.post(
  '/:id/comments',
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const id = idParam(req)
    const body = parse(z.object({ text: z.string().trim().min(1).max(1000) }), req.body)
    const user = await User.findById(userId).select('name').lean()
    const r = await Complaint.updateOne(
      { _id: id, orgId },
      { $push: { comments: { by: user?.name ?? 'Staff', byKind: 'staff', text: body.text, at: new Date() } } },
    )
    if (!r.matchedCount) throw notFound('Complaint')
    res.status(201).json(await loadOne(orgId, id))
  }),
)

router.delete(
  '/:id',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const r = await Complaint.deleteOne({ _id: idParam(req), orgId })
    if (!r.deletedCount) throw notFound('Complaint')
    res.status(204).end()
  }),
)
