/**
 * Reports (mounted at /api/reports; Pro plan, roles with 'reports')
 *
 *   GET /api/reports/pnl?months=6&hostelId=        income (rent payments, deposits excluded), expenses by category, net
 *   GET /api/reports/collection?months=6&hostelId= billed vs collected per invoice month
 *   GET /api/reports/occupancy?hostelId=           per hostel, per room type, per sharing
 *   GET /api/reports/dues-aging?hostelId=          buckets: not due, 1-30, 31-60, 60+ days overdue
 */
import { Router } from 'express'
import { z } from 'zod'
import { ah, parse, todayStr } from '../../lib/http.js'
import { hostelScope } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { Hostel } from '../../models/Hostel.js'
import { Room } from '../../models/Room.js'
import { Bed } from '../../models/Bed.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Invoice } from '../../models/Invoice.js'
import { Payment } from '../../models/Payment.js'
import { EXPENSE_CATEGORIES, Expense } from '../../models/Operations.js'
import { balanceOf, daysBetween, lastMonths, occupancyOf, sum } from '../dashboard/routes.js'

export const router = Router()

const reportsAuth = [requireStaff('reports'), requirePlan('reports')]
const monthsQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) })
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

router.get(
  '/pnl',
  ...reportsAuth,
  ah(async (req, res) => {
    const { months: n } = parse(monthsQuery, req.query)
    const scope = { orgId: staffOf(req).orgId, ...hostelScope(req.query) }
    const months = lastMonths(n)
    const from = `${months[0]}-01`
    const to = `${months[months.length - 1]}-31`
    const [payments, expenses] = await Promise.all([
      Payment.find({ ...scope, date: { $gte: from, $lte: to } }).select('kind amount date').lean(),
      Expense.find({ ...scope, date: { $gte: from, $lte: to } }).select('category amount date').lean(),
    ])
    const rows = months.map((m) => {
      const inMonth = <T extends { date: string }>(l: T[]) => l.filter((x) => x.date.slice(0, 7) === m)
      const mp = inMonth(payments)
      const income = sum(mp.filter((p) => p.kind === 'rent'), (p) => p.amount)
      const deposits = sum(mp.filter((p) => p.kind !== 'rent'), (p) => p.amount)
      const exp = sum(inMonth(expenses), (e) => e.amount)
      return { month: m, income, expenses: exp, net: income - exp, deposits }
    })
    const byCategory = EXPENSE_CATEGORIES.map((c) => {
      const list = expenses.filter((e) => e.category === c)
      return { category: c, amount: sum(list, (e) => e.amount), count: list.length }
    })
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount)
    const totals = {
      income: sum(rows, (r) => r.income),
      expenses: sum(rows, (r) => r.expenses),
      deposits: sum(rows, (r) => r.deposits),
      net: 0,
    }
    totals.net = totals.income - totals.expenses
    res.json({ months: rows, byCategory, totals })
  }),
)

router.get(
  '/collection',
  ...reportsAuth,
  ah(async (req, res) => {
    const { months: n } = parse(monthsQuery, req.query)
    const scope = { orgId: staffOf(req).orgId, ...hostelScope(req.query) }
    const months = lastMonths(n)
    const invoices = await Invoice.find({ ...scope, cancelled: false, month: { $in: months } }).select('month total paidAmount').lean()
    const rows = months.map((m) => {
      const list = invoices.filter((i) => i.month === m)
      const billed = sum(list, (i) => i.total)
      const collected = Math.min(sum(list, (i) => i.paidAmount), billed)
      return { month: m, invoices: list.length, billed, collected, pending: billed - collected, rate: pct(collected, billed) }
    })
    const billed = sum(rows, (r) => r.billed)
    const collected = sum(rows, (r) => r.collected)
    res.json({
      months: rows,
      totals: { invoices: sum(rows, (r) => r.invoices), billed, collected, pending: billed - collected, rate: pct(collected, billed) },
    })
  }),
)

router.get(
  '/occupancy',
  ...reportsAuth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const hs = hostelScope(req.query)
    const scope = { orgId, ...hs }
    const [hostels, rooms, beds] = await Promise.all([
      Hostel.find({ orgId, ...(hs.hostelId ? { _id: hs.hostelId } : {}) }).sort({ createdAt: 1 }).lean(),
      Room.find(scope).lean(),
      Bed.find(scope).select('roomId hostelerId').lean(),
    ])
    const bedsOf = (roomList: typeof rooms) => {
      const ids = new Set(roomList.map((r) => String(r._id)))
      return beds.filter((b) => ids.has(String(b.roomId)))
    }
    const activeRooms = rooms.filter((r) => r.status === 'active')

    const byHostel = hostels.map((h) => {
      const hr = rooms.filter((r) => String(r.hostelId) === String(h._id))
      const occ = occupancyOf(hr, bedsOf(hr))
      return {
        hostelId: String(h._id),
        name: h.name,
        type: h.type,
        rooms: hr.filter((r) => r.status === 'active').length,
        maintenance: hr.filter((r) => r.status === 'maintenance').length,
        beds: occ.total,
        occupied: occ.occupied,
        vacant: occ.vacant,
        rate: occ.rate,
      }
    })
    const byRoomType = (['ac', 'non-ac'] as const).map((t) => {
      const tr = activeRooms.filter((r) => r.type === t)
      const occ = occupancyOf(tr, bedsOf(tr))
      return {
        type: t,
        rooms: tr.length,
        beds: occ.total,
        occupied: occ.occupied,
        vacant: occ.vacant,
        rate: occ.rate,
        avgRent: tr.length ? Math.round(sum(tr, (r) => r.rentPerBed) / tr.length) : 0,
      }
    })
    const bySharing = [...new Set(activeRooms.map((r) => r.sharing))]
      .sort((a, b) => a - b)
      .map((s) => {
        const tr = activeRooms.filter((r) => r.sharing === s)
        const occ = occupancyOf(tr, bedsOf(tr))
        return { sharing: s, rooms: tr.length, beds: occ.total, occupied: occ.occupied, vacant: occ.vacant, rate: occ.rate }
      })
    res.json({ total: occupancyOf(rooms, beds), byHostel, byRoomType, bySharing })
  }),
)

const BUCKETS = [
  { key: 'notdue', label: 'Not yet due', test: (d: number) => d <= 0 },
  { key: '1-30', label: '1–30 days', test: (d: number) => d > 0 && d <= 30 },
  { key: '31-60', label: '31–60 days', test: (d: number) => d > 30 && d <= 60 },
  { key: '60+', label: '60+ days', test: (d: number) => d > 60 },
] as const
type BucketKey = (typeof BUCKETS)[number]['key']
const bucketOf = (days: number): BucketKey => BUCKETS.find((b) => b.test(days))!.key

router.get(
  '/dues-aging',
  ...reportsAuth,
  ah(async (req, res) => {
    const scope = { orgId: staffOf(req).orgId, ...hostelScope(req.query) }
    const today = todayStr()
    const invoices = await Invoice.find({ ...scope, cancelled: false, $expr: { $gt: ['$total', '$paidAmount'] } })
      .select('hostelerId hostelId number month dueDate total paidAmount cancelled')
      .lean()
    const hostelers = await Hosteler.find({ orgId: scope.orgId, _id: { $in: invoices.map((i) => i.hostelerId) } })
      .select('name phone status loginId')
      .lean()
    const hMap = new Map(hostelers.map((h) => [String(h._id), h]))

    const rows = invoices
      .map((i) => {
        const days = daysBetween(i.dueDate, today)
        const h = hMap.get(String(i.hostelerId))
        return {
          invoiceId: String(i._id),
          number: i.number,
          month: i.month,
          dueDate: i.dueDate,
          balance: balanceOf(i),
          daysOverdue: Math.max(days, 0),
          bucket: bucketOf(days),
          hostelId: String(i.hostelId),
          hosteler: h ? { id: String(h._id), name: h.name, phone: h.phone, status: h.status, loginId: h.loginId } : null,
        }
      })
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate))

    const buckets = BUCKETS.map((b) => {
      const list = rows.filter((r) => r.bucket === b.key)
      return {
        key: b.key,
        label: b.label,
        count: list.length,
        amount: sum(list, (r) => r.balance),
        hostelers: new Set(list.map((r) => r.hosteler?.id)).size,
      }
    })

    const perHosteler = new Map<string, { hosteler: (typeof rows)[number]['hosteler']; total: number; oldestDays: number; buckets: Record<BucketKey, number> }>()
    for (const r of rows) {
      const k = r.hosteler?.id ?? 'unknown'
      if (!perHosteler.has(k))
        perHosteler.set(k, { hosteler: r.hosteler, total: 0, oldestDays: 0, buckets: { notdue: 0, '1-30': 0, '31-60': 0, '60+': 0 } })
      const e = perHosteler.get(k)!
      e.total += r.balance
      e.oldestDays = Math.max(e.oldestDays, r.daysOverdue)
      e.buckets[r.bucket] += r.balance
    }

    res.json({
      asOf: today,
      totalDues: sum(rows, (r) => r.balance),
      buckets,
      hostelers: [...perHosteler.values()].sort((a, b) => b.total - a.total),
      invoices: rows,
    })
  }),
)
