/**
 * Staff directory & activity feed. Mounted at '/', so every route carries
 * its full path and its own middleware.
 *
 *   GET    /api/staff?role&active&hostelId&month   with paidThisMonth flag (for `month`, default current)
 *   POST   /api/staff
 *   PATCH  /api/staff/:id
 *   DELETE /api/staff/:id
 *   POST   /api/staff/pay-salaries                 { month, mode, staffIds? } -> { created, skipped, total }
 *
 *   GET    /api/activities?limit&hostelId          any staff role; newest first
 */
import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { notFound } from '../../lib/errors.js'
import { ah, dateStr, idParam, money, monthStr, objectId, parse, todayStr } from '../../lib/http.js'
import { assertHostel, hostelScope, logActivity } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { Activity, Expense, STAFF_ROLES, Staff } from '../../models/Operations.js'

export const router = Router()

const guard = [requireStaff('staff'), requirePlan('staff')]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Same note the frontend writes: "Salary Oct 2026" */
export const salaryNote = (month: string) => `Salary ${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

function monthEnd(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

const staffFields = z.object({
  hostelId: objectId,
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(20),
  role: z.enum(STAFF_ROLES),
  salary: money.transform((v) => Math.round(v)),
  joinDate: dateStr,
  active: z.boolean(),
})

/** Keys "<hostelId>|<paidTo>" of salary expenses already recorded for `month`. */
async function paidKeys(orgId: string, month: string, session?: import('mongoose').ClientSession) {
  const exps = await Expense.find({ orgId, category: 'salary', note: salaryNote(month) })
    .select('hostelId paidTo')
    .session(session ?? null)
    .lean()
  return new Set(exps.map((e) => `${String(e.hostelId)}|${e.paidTo}`))
}

router.get(
  '/staff',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(
      z.object({ role: z.enum(STAFF_ROLES).optional(), active: z.enum(['true', 'false']).optional(), month: monthStr.optional() }),
      req.query,
    )
    const month = q.month ?? todayStr().slice(0, 7)
    const filter: Record<string, unknown> = { orgId, ...hostelScope(req.query) }
    if (q.role) filter.role = q.role
    if (q.active) filter.active = q.active === 'true'
    const [list, paid] = await Promise.all([Staff.find(filter).sort({ name: 1 }), paidKeys(orgId, month)])
    res.json({
      month,
      items: list.map((s) => ({ ...s.toJSON(), paidThisMonth: paid.has(`${String(s.hostelId)}|${s.name}`) })),
    })
  }),
)

router.post(
  '/staff',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      staffFields.extend({
        phone: staffFields.shape.phone.default(''),
        joinDate: dateStr.default(() => todayStr()),
        active: z.boolean().default(true),
      }),
      req.body,
    )
    await assertHostel(orgId, body.hostelId)
    const s = await Staff.create({ ...body, orgId })
    res.status(201).json(s.toJSON())
  }),
)

router.patch(
  '/staff/:id',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(staffFields.partial().strict(), req.body)
    if (body.hostelId) await assertHostel(orgId, body.hostelId)
    const s = await Staff.findOneAndUpdate({ _id: idParam(req), orgId }, { $set: body }, { new: true, runValidators: true })
    if (!s) throw notFound('Staff member')
    res.json(s.toJSON())
  }),
)

router.delete(
  '/staff/:id',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    // past salary expenses are kept
    const r = await Staff.deleteOne({ _id: idParam(req), orgId })
    if (!r.deletedCount) throw notFound('Staff member')
    res.status(204).end()
  }),
)

router.post(
  '/staff/pay-salaries',
  ...guard,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      z.object({
        month: monthStr,
        mode: z.enum(['cash', 'upi', 'card', 'bank', 'online']).default('cash'),
        staffIds: z.array(objectId).max(500).optional(),
      }),
      req.body,
    )
    const filter: Record<string, unknown> = { orgId, active: true }
    if (body.staffIds) {
      const ids = [...new Set(body.staffIds)]
      const found = await Staff.countDocuments({ orgId, _id: { $in: ids } })
      if (found !== ids.length) throw notFound('Staff member')
      filter._id = { $in: ids }
    }
    const date = body.month === todayStr().slice(0, 7) ? todayStr() : monthEnd(body.month)
    const note = salaryNote(body.month)

    const result = await withTransaction(async (session) => {
      const staff = await Staff.find(filter).session(session).lean()
      const paid = await paidKeys(orgId, body.month, session)
      const toPay = staff.filter((s) => s.salary > 0 && !paid.has(`${String(s.hostelId)}|${s.name}`))
      if (toPay.length) {
        await Expense.insertMany(
          toPay.map((s) => ({
            orgId,
            hostelId: s.hostelId,
            category: 'salary',
            amount: s.salary,
            date,
            paidTo: s.name,
            mode: body.mode,
            note,
          })),
          { session },
        )
        const total = toPay.reduce((a, s) => a + s.salary, 0)
        await logActivity(orgId, `${toPay.length} salary payment${toPay.length === 1 ? '' : 's'} recorded for ${note.slice(7)}`, 'payment', null, session)
        return { created: toPay.length, skipped: staff.length - toPay.length, total }
      }
      return { created: 0, skipped: staff.length, total: 0 }
    })
    res.status(result.created ? 201 : 200).json({ month: body.month, ...result })
  }),
)

/* ---------------- activity feed ---------------- */

router.get(
  '/activities',
  requireStaff(),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(20) }), req.query)
    const { hostelId } = hostelScope(req.query)
    // hostel-specific feed also shows org-wide entries (hostelId null)
    const filter = hostelId ? { orgId, $or: [{ hostelId }, { hostelId: null }] } : { orgId }
    const items = await Activity.find(filter).sort({ createdAt: -1 }).limit(q.limit)
    res.json({ items: items.map((a) => a.toJSON()) })
  }),
)
