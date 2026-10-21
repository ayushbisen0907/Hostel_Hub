/**
 * Notices (every plan)
 *
 *   GET    /api/notices?hostelId=   that hostel's notices + all-hostel notices; pinned first, newest first
 *   POST   /api/notices             { hostelId (null = all hostels), title, body, priority, pinned }
 *   PATCH  /api/notices/:id
 *   DELETE /api/notices/:id
 */
import { Router } from 'express'
import { z } from 'zod'
import { requirePlan } from '../../lib/plans.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { notFound } from '../../lib/errors.js'
import { ah, idParam, objectId, parse } from '../../lib/http.js'
import { assertHostel, hostelScope } from '../../lib/org.js'
import { Notice } from '../../models/Operations.js'

export const router = Router()

// mounted at /api/notices
router.use(requireStaff('notices'), requirePlan('notices'))

const fields = z.object({
  hostelId: objectId.nullable(),
  title: z.string().trim().min(3).max(150),
  body: z.string().trim().max(5000),
  priority: z.enum(['low', 'medium', 'high']),
  pinned: z.boolean(),
})

router.get(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const { hostelId } = hostelScope(req.query)
    const filter = hostelId ? { orgId, $or: [{ hostelId }, { hostelId: null }] } : { orgId }
    const items = await Notice.find(filter).sort({ pinned: -1, createdAt: -1 }).limit(500)
    res.json({ items: items.map((n) => n.toJSON()) })
  }),
)

router.post(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      fields.extend({
        hostelId: objectId.nullish().transform((v) => v ?? null),
        body: fields.shape.body.default(''),
        priority: fields.shape.priority.default('medium'),
        pinned: fields.shape.pinned.default(false),
      }),
      req.body,
    )
    if (body.hostelId) await assertHostel(orgId, body.hostelId)
    const n = await Notice.create({ ...body, orgId })
    res.status(201).json(n.toJSON())
  }),
)

router.patch(
  '/:id',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(fields.partial().strict(), req.body)
    if (body.hostelId) await assertHostel(orgId, body.hostelId)
    const n = await Notice.findOneAndUpdate({ _id: idParam(req), orgId }, { $set: body }, { new: true, runValidators: true })
    if (!n) throw notFound('Notice')
    res.json(n.toJSON())
  }),
)

router.delete(
  '/:id',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const r = await Notice.deleteOne({ _id: idParam(req), orgId })
    if (!r.deletedCount) throw notFound('Notice')
    res.status(204).end()
  }),
)
