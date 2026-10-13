/**
 * Visitors (Basic & Pro)
 *
 *   GET  /api/visitors?from&to&q&inside=true&hostelId&page&limit   newest first, paginated
 *   POST /api/visitors                                              { hostelerId, name, phone, relation, purpose, idProof }
 *   POST /api/visitors/:id/check-out                                409 if already checked out
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { conflict, notFound } from '../../lib/errors.js'
import { ah, dateStr, escapeRegex, idParam, objectId, paginate, paginationQuery, parse } from '../../lib/http.js'
import { hostelScope } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { toApi } from '../../models/_base.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Visitor } from '../../models/Operations.js'
import { hostelerInfo } from '../attendance/lookup.js'

export const router = Router()

// mounted at /api/visitors
router.use(requireStaff('visitors'), requirePlan('visitors'))

/** Local-day bounds for a YYYY-MM-DD string (server local time, like todayStr). */
const dayStart = (d: string) => new Date(`${d}T00:00:00`)
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`)

async function decorate(orgId: string, list: { _id: unknown; hostelerId: unknown }[]) {
  const info = await hostelerInfo(orgId, list.map((v) => String(v.hostelerId)))
  return list.map((v) => {
    const h = info.get(String(v.hostelerId))
    return { ...toApi(v), hostelerName: h?.name ?? '', roomNumber: h?.roomNumber ?? null }
  })
}

router.get(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(
      paginationQuery.extend({
        from: dateStr.optional(),
        to: dateStr.optional(),
        q: z.string().trim().max(100).optional(),
        inside: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    )
    const filter: Record<string, unknown> = { orgId, ...hostelScope(req.query) }
    if (q.from || q.to) {
      const inTime: Record<string, Date> = {}
      if (q.from) inTime.$gte = dayStart(q.from)
      if (q.to) inTime.$lte = dayEnd(q.to)
      filter.inTime = inTime
    }
    if (q.inside === 'true') filter.outTime = null
    if (q.inside === 'false') filter.outTime = { $ne: null }
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i')
      const hs = await Hosteler.find({ orgId, name: rx }).select('_id').limit(200).lean()
      filter.$or = [{ name: rx }, { phone: rx }, { relation: rx }, { purpose: rx }, { hostelerId: { $in: hs.map((h) => h._id) } }]
    }
    const [list, total] = await Promise.all([
      Visitor.find(filter)
        .sort({ inTime: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Visitor.countDocuments(filter),
    ])
    res.json(paginate(await decorate(orgId, list), total, q.page, q.limit))
  }),
)

router.post(
  '/',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      z.object({
        hostelerId: objectId,
        name: z.string().trim().min(2).max(80),
        phone: z
          .string()
          .trim()
          .max(20)
          .default('')
          .transform((s) => s.replace(/\D/g, '').slice(-10))
          .refine((s) => s === '' || /^[6-9]\d{9}$/.test(s), { message: 'Enter a valid 10-digit mobile number' }),
        relation: z.string().trim().max(40).default(''),
        purpose: z.string().trim().max(200).default(''),
        idProof: z.string().trim().max(100).default(''),
      }),
      req.body,
    )
    const h = await Hosteler.findOne({ _id: body.hostelerId, orgId, status: 'active' }).select('hostelId').lean()
    if (!h) throw notFound('Hosteler')
    const v = await Visitor.create({ ...body, orgId, hostelId: h.hostelId })
    res.status(201).json((await decorate(orgId, [v.toObject({ transform: false })]))[0])
  }),
)

router.post(
  '/:id/check-out',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const v = await Visitor.findOneAndUpdate({ _id: id, orgId, outTime: null }, { $set: { outTime: new Date() } }, { new: true }).lean()
    if (!v) {
      if (!(await Visitor.exists({ _id: id, orgId }))) throw notFound('Visitor')
      throw conflict('This visitor has already checked out')
    }
    res.json((await decorate(orgId, [v]))[0])
  }),
)
