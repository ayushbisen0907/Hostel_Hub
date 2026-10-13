/**
 * Expenses (mounted at /api/expenses)
 *
 *   GET    /api/expenses            ?month ?category ?hostelId ?q ?page ?limit  (with total)
 *   GET    /api/expenses/summary    ?months=6 ?month (reference month, default current) ?hostelId
 *   POST   /api/expenses
 *   PATCH  /api/expenses/:id
 *   DELETE /api/expenses/:id
 */
import { Router } from 'express'
import mongoose, { Types } from 'mongoose'
import { z } from 'zod'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { ah, dateStr, escapeRegex, idParam, monthStr, objectId, paginate, paginationQuery, parse, todayStr } from '../../lib/http.js'
import { assertHostel, hostelScope } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { toApi } from '../../models/_base.js'
import { Hostel } from '../../models/Hostel.js'
import { EXPENSE_CATEGORIES, Expense } from '../../models/Operations.js'
import { PAYMENT_MODES } from '../../models/Payment.js'

export const router = Router()

/** YYYY-MM with a real month (01-12). */
const validMonth = monthStr.refine((m) => { const n = Number(m.slice(5)); return n >= 1 && n <= 12 }, { message: 'Invalid month' })

// mounted under /expenses, so a path-less use() only covers this module
router.use(requireStaff('expenses'), requirePlan('expenses'))

type Filter = Record<string, unknown>
type Category = (typeof EXPENSE_CATEGORIES)[number]

function oid(v: string, name = 'id') {
  if (!mongoose.isValidObjectId(v)) throw badRequest(`Invalid ${name}`)
  return new Types.ObjectId(v)
}

function scopeOf(query: Record<string, unknown>): { hostelId?: Types.ObjectId } {
  const s = hostelScope(query)
  return s.hostelId ? { hostelId: oid(s.hostelId, 'hostelId') } : {}
}

function monthRange(month: string) {
  return { $gte: `${month}-01`, $lte: `${month}-31` }
}

/** Last `n` months ending at `ref` (YYYY-MM), oldest first. */
function lastMonths(n: number, ref: string) {
  const [y, m] = ref.split('-').map(Number) as [number, number]
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1))
    return d.toISOString().slice(0, 7)
  })
}

const bodySchema = z.object({
  hostelId: objectId,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().min(1, 'Amount must be at least 1').max(10_000_000),
  date: dateStr,
  paidTo: z.string().trim().max(120).default(''),
  mode: z.enum(PAYMENT_MODES).default('cash'),
  note: z.string().trim().max(500).default(''),
})

const listQuery = paginationQuery.extend({
  month: validMonth.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  q: z.string().trim().max(100).optional(),
})

router.get(
  '/',
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const query = parse(listQuery, req.query)
    const filter: Filter = { orgId, ...scopeOf(req.query) }
    if (query.month) filter.date = monthRange(query.month)
    if (query.category) filter.category = query.category
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i')
      const cats = EXPENSE_CATEGORIES.filter((c) => rx.test(c))
      filter.$or = [{ paidTo: rx }, { note: rx }, ...(cats.length ? [{ category: { $in: cats } }] : [])]
    }
    const [docs, total, agg] = await Promise.all([
      Expense.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Expense.countDocuments(filter),
      Expense.aggregate<{ amount: number }>([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    ])
    const hostels = await Hostel.find({ orgId, _id: { $in: [...new Set(docs.map((d) => String(d.hostelId)))] } })
      .select('name')
      .lean()
    const names = new Map(hostels.map((h) => [String(h._id), h.name]))
    const items = docs.map((d) => ({ ...toApi(d), hostelName: names.get(String(d.hostelId)) ?? '' }))
    res.json({ ...paginate(items, total, query.page, query.limit), totalAmount: agg[0]?.amount ?? 0 })
  }),
)

router.get(
  '/summary',
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const query = parse(
      z.object({
        months: z.coerce.number().int().min(1).max(24).default(6),
        month: validMonth.default(() => todayStr().slice(0, 7)),
      }),
      { months: req.query.months, month: req.query.month },
    )
    const months = lastMonths(query.months, query.month)
    const rows = await Expense.aggregate<{ _id: { month: string; category: Category }; amount: number; count: number }>([
      {
        $match: {
          orgId,
          ...scopeOf(req.query),
          date: { $gte: `${months[0]}-01`, $lte: `${months[months.length - 1]}-31` },
        },
      },
      {
        $group: {
          _id: { month: { $substrBytes: ['$date', 0, 7] }, category: '$category' },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ])
    const emptyCats = () => Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
    const perMonth = months.map((m) => {
      const byCategory = emptyCats()
      let count = 0
      for (const r of rows.filter((x) => x._id.month === m)) {
        byCategory[r._id.category] += r.amount
        count += r.count
      }
      return { month: m, total: Object.values(byCategory).reduce((a, b) => a + b, 0), count, byCategory }
    })
    const byCategoryTotals = emptyCats()
    for (const r of rows) byCategoryTotals[r._id.category] += r.amount
    const cur = perMonth[perMonth.length - 1]!
    const prev = perMonth.length > 1 ? perMonth[perMonth.length - 2]! : null
    res.json({
      months: perMonth,
      byCategory: EXPENSE_CATEGORIES.map((c) => ({ category: c, amount: byCategoryTotals[c] })).sort((a, b) => b.amount - a.amount),
      total: perMonth.reduce((a, m) => a + m.total, 0),
      current: {
        month: cur.month,
        total: cur.total,
        previousTotal: prev?.total ?? null,
        change: prev && prev.total ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null,
      },
    })
  }),
)

router.post(
  '/',
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const body = parse(bodySchema, req.body)
    await assertHostel(orgId, body.hostelId)
    const exp = await Expense.create({ ...body, orgId })
    res.status(201).json(exp.toJSON())
  }),
)

router.patch(
  '/:id',
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const id = idParam(req)
    const patch = parse(
      z.object({
        hostelId: objectId.optional(),
        category: z.enum(EXPENSE_CATEGORIES).optional(),
        amount: z.coerce.number().min(1, 'Amount must be at least 1').max(10_000_000).optional(),
        date: dateStr.optional(),
        paidTo: z.string().trim().max(120).optional(),
        mode: z.enum(PAYMENT_MODES).optional(),
        note: z.string().trim().max(500).optional(),
      }),
      req.body,
    )
    if (patch.hostelId) await assertHostel(orgId, patch.hostelId)
    const exp = await Expense.findOneAndUpdate({ _id: id, orgId }, { $set: patch }, { new: true, runValidators: true })
    if (!exp) throw notFound('Expense')
    res.json(exp.toJSON())
  }),
)

router.delete(
  '/:id',
  ah(async (req, res) => {
    const orgId = oid(staffOf(req).orgId)
    const exp = await Expense.findOneAndDelete({ _id: idParam(req), orgId })
    if (!exp) throw notFound('Expense')
    res.json({ ok: true, id: String(exp._id) })
  }),
)
