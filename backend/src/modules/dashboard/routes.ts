/**
 * Dashboard (mounted at /api/dashboard, any staff)
 *
 *   GET /api/dashboard?hostelId=   occupancy, hosteler counts, this month's money, dues,
 *                                  complaints, leaves, upcoming check-ins / check-outs,
 *                                  top dues, recent activity, last 6 months chart,
 *                                  maintenance beds, high-priority complaints,
 *                                  setup progress (org-wide counts) and the mess
 *                                  headcount for ?meal=&date= (default: next meal)
 */
import { Router } from 'express'
import { z } from 'zod'
import { ah, dateStr, parse } from '../../lib/http.js'
import { todayStr } from '../../lib/http.js'
import { hostelScope } from '../../lib/org.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { toApi } from '../../models/_base.js'
import { Room } from '../../models/Room.js'
import { Bed } from '../../models/Bed.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Invoice } from '../../models/Invoice.js'
import { Payment } from '../../models/Payment.js'
import { Activity, Complaint, Expense, Leave, MEALS, MealOptOut } from '../../models/Operations.js'

export const router = Router()

/* ---------------- shared helpers (also used by reports) ---------------- */

/** The last `n` months as YYYY-MM, oldest first, ending with the current month. */
export function lastMonths(n: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0)

/** Whole days from `a` to `b` (YYYY-MM-DD). */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export const balanceOf = (i: { total: number; paidAmount: number; cancelled: boolean }) =>
  i.cancelled ? 0 : Math.max(i.total - i.paidAmount, 0)

/** Occupancy of active rooms. */
export function occupancyOf(rooms: { _id: unknown; status: string }[], beds: { roomId: unknown; hostelerId: unknown }[]) {
  const active = new Set(rooms.filter((r) => r.status === 'active').map((r) => String(r._id)))
  const inActive = beds.filter((b) => active.has(String(b.roomId)))
  const occupied = inActive.filter((b) => b.hostelerId).length
  return {
    total: inActive.length,
    occupied,
    vacant: inActive.length - occupied,
    rate: inActive.length ? Math.round((occupied / inActive.length) * 100) : 0,
  }
}

/** Next meal to be served (server clock) — used when the client doesn't send ?meal=&date=. */
function nextMeal(now = new Date()): { meal: (typeof MEALS)[number]; date: string } {
  const h = now.getHours()
  if (h < 10) return { meal: 'breakfast', date: todayStr(now) }
  if (h < 15) return { meal: 'lunch', date: todayStr(now) }
  if (h < 18) return { meal: 'snacks', date: todayStr(now) }
  if (h < 22) return { meal: 'dinner', date: todayStr(now) }
  return { meal: 'breakfast', date: todayStr(new Date(now.getTime() + 86_400_000)) }
}

const dashboardQuery = z.object({ meal: z.enum(MEALS).optional(), date: dateStr.optional() })

/* ---------------- route ---------------- */

router.get(
  '/',
  requireStaff(),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(dashboardQuery, req.query)
    const scope = { orgId, ...hostelScope(req.query) }
    const today = todayStr()
    const month = today.slice(0, 7)
    const in30 = todayStr(new Date(Date.now() + 30 * 86_400_000))
    const months = lastMonths(6)
    const mess = q.meal && q.date ? { meal: q.meal, date: q.date } : nextMeal()

    const [rooms, beds, hostelers, invoices, payments, expenses, openComplaints, pendingLeaves, activity] = await Promise.all([
      Room.find(scope).select('status number').lean(),
      Bed.find(scope).select('roomId hostelerId label').lean(),
      Hosteler.find(scope).select('name phone status roomId bedId checkInDate expectedCheckOut monthlyRent hostelId messOpted').lean(),
      Invoice.find({ ...scope, cancelled: false }).select('hostelerId month total paidAmount cancelled').lean(),
      Payment.find({ ...scope, kind: 'rent', date: { $gte: `${months[0]}-01` } }).select('amount date').lean(),
      Expense.find({ ...scope, date: { $gte: `${months[0]}-01` } }).select('amount date').lean(),
      Complaint.find({ ...scope, status: { $ne: 'resolved' } }).select('priority').lean(),
      Leave.find({ ...scope, status: 'pending' }).sort({ from: 1 }).lean(),
      Activity.find(
        hostelScope(req.query).hostelId
          ? { orgId, hostelId: { $in: [hostelScope(req.query).hostelId, null] } }
          : { orgId },
      )
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ])

    const [setupRooms, setupHostelers, setupInvoices, optOuts, messLeaves] = await Promise.all([
      Room.countDocuments({ orgId }),
      Hosteler.countDocuments({ orgId }),
      Invoice.countDocuments({ orgId }),
      MealOptOut.find({ ...scope, date: mess.date, meal: mess.meal }).select('hostelerId').lean(),
      Leave.find({ ...scope, status: 'approved', from: { $lte: mess.date }, to: { $gte: mess.date } }).select('hostelerId').lean(),
    ])

    const hMap = new Map(hostelers.map((h) => [String(h._id), h]))
    const roomMap = new Map(rooms.map((r) => [String(r._id), r]))
    const bedMap = new Map(beds.map((b) => [String(b._id), b]))
    const brief = (h: (typeof hostelers)[number]) => ({
      id: String(h._id),
      name: h.name,
      phone: h.phone,
      status: h.status,
      hostelId: String(h.hostelId),
      roomId: h.roomId ? String(h.roomId) : null,
      bedId: h.bedId ? String(h.bedId) : null,
      roomNumber: h.roomId ? (roomMap.get(String(h.roomId))?.number ?? null) : null,
      bedLabel: h.bedId ? (bedMap.get(String(h.bedId))?.label ?? null) : null,
      checkInDate: h.checkInDate,
      expectedCheckOut: h.expectedCheckOut ?? null,
    })

    // money
    const monthInvoices = invoices.filter((i) => i.month === month)
    const billed = sum(monthInvoices, (i) => i.total)
    const collected = sum(payments.filter((p) => p.date.slice(0, 7) === month), (p) => p.amount)
    const duesBy = new Map<string, number>()
    for (const i of invoices) {
      const b = balanceOf(i)
      if (b > 0) duesBy.set(String(i.hostelerId), (duesBy.get(String(i.hostelerId)) ?? 0) + b)
    }
    const topDues = [...duesBy.entries()]
      .map(([id, dues]) => ({ h: hMap.get(id), dues }))
      .filter((x) => x.h)
      .sort((a, b) => b.dues - a.dues)
      .slice(0, 5)
      .map((x) => ({ ...brief(x.h!), dues: x.dues }))

    const active = hostelers.filter((h) => h.status === 'active')
    const reserved = hostelers.filter((h) => h.status === 'reserved')

    const maintenanceRooms = new Set(rooms.filter((r) => r.status === 'maintenance').map((r) => String(r._id)))
    const away = new Set([...optOuts, ...messLeaves].map((x) => String(x.hostelerId)))
    const messMembers = active.filter((h) => h.messOpted)

    res.json({
      occupancy: occupancyOf(rooms, beds),
      hostelers: { active: active.length, reserved: reserved.length },
      thisMonth: {
        month,
        billed,
        collected,
        outstanding: sum(monthInvoices, balanceOf),
        rate: billed ? Math.round((collected / billed) * 100) : 0,
      },
      totalDues: sum([...duesBy.values()], (x) => x),
      openComplaints: openComplaints.length,
      highPriorityComplaints: openComplaints.filter((c) => c.priority === 'high').length,
      maintenanceBeds: beds.filter((b) => maintenanceRooms.has(String(b.roomId))).length,
      mess: {
        ...mess,
        members: messMembers.length,
        expected: messMembers.filter((h) => !away.has(String(h._id))).length,
      },
      setup: { rooms: setupRooms, hostelers: setupHostelers, invoices: setupInvoices },
      pendingLeaves: {
        count: pendingLeaves.length,
        items: pendingLeaves.slice(0, 5).map((l) => ({ ...toApi(l), hostelerName: hMap.get(String(l.hostelerId))?.name ?? null })),
      },
      upcomingCheckIns: reserved.sort((a, b) => a.checkInDate.localeCompare(b.checkInDate)).map(brief),
      expectedCheckOuts: active
        .filter((h) => h.expectedCheckOut && h.expectedCheckOut <= in30)
        .sort((a, b) => (a.expectedCheckOut ?? '').localeCompare(b.expectedCheckOut ?? ''))
        .map((h) => ({ ...brief(h), overdue: (h.expectedCheckOut ?? '') < today })),
      topDues,
      recentActivity: activity.map((a) => toApi(a)),
      last6Months: months.map((m) => ({
        month: m,
        collected: sum(payments.filter((p) => p.date.slice(0, 7) === m), (p) => p.amount),
        expenses: sum(expenses.filter((e) => e.date.slice(0, 7) === m), (e) => e.amount),
      })),
    })
  }),
)
