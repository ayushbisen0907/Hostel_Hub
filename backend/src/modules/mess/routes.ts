/**
 * Mess (Pro plan)
 *
 *   GET    /api/mess/menu?hostelId=            weekly menu of one hostel (max 7 days x 4 meals)
 *   PUT    /api/mess/menu                      upsert { hostelId, day, meal, items }
 *   POST   /api/mess/menu/copy                 { fromHostelId, toHostelId } replaces the target menu
 *   GET    /api/mess/today?date=&hostelId=     per meal: menu, members, opted out, on leave, headcount
 *   GET    /api/mess/members?hostelId=         active hostelers with their messOpted flag
 *   PATCH  /api/mess/members/:hostelerId       { messOpted }
 *   GET    /api/mess/opt-outs?from&to&hostelId
 *   POST   /api/mess/opt-outs                  { hostelerId, date, meal } (409 if it exists)
 *   DELETE /api/mess/opt-outs/:id
 *   GET    /api/mess/feedback?meal&hostelId    newest first (paginated) + average rating per meal
 *   GET    /api/mess/stats?month=&hostelId=    opt-outs in month + estimated savings
 */
import { Router } from 'express'
import { z } from 'zod'
import { withTransaction } from '../../config/db.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { ah, dateStr, idParam, monthStr, objectId, paginate, paginationQuery, parse, todayStr } from '../../lib/http.js'
import { assertHostel, getSettings, hostelScope } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { toApi } from '../../models/_base.js'
import { Hosteler } from '../../models/Hosteler.js'
import { MEALS, MealOptOut, MessFeedback, MessMenu } from '../../models/Operations.js'
import { hostelerInfo, onLeaveIds, roomNumbers } from '../attendance/lookup.js'

export const router = Router()

// mounted at /api/mess, so router-level middleware only affects this module
router.use(requireStaff('mess'), requirePlan('mess'))

const meal = z.enum(MEALS)

/* ---------------- menu ---------------- */

router.get(
  '/menu',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const { hostelId } = parse(z.object({ hostelId: objectId }), req.query)
    await assertHostel(orgId, hostelId)
    const items = await MessMenu.find({ orgId, hostelId }).limit(28).lean()
    items.sort((a, b) => a.day - b.day || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal))
    res.json({ items: items.map((m) => toApi(m)) })
  }),
)

router.put(
  '/menu',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(
      z.object({ hostelId: objectId, day: z.coerce.number().int().min(0).max(6), meal, items: z.string().trim().max(500) }),
      req.body,
    )
    await assertHostel(orgId, body.hostelId)
    const entry = await MessMenu.findOneAndUpdate(
      { orgId, hostelId: body.hostelId, day: body.day, meal: body.meal },
      { $set: { items: body.items } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    )
    res.json(entry!.toJSON())
  }),
)

router.post(
  '/menu/copy',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(z.object({ fromHostelId: objectId, toHostelId: objectId }), req.body)
    if (body.fromHostelId === body.toHostelId) throw badRequest('Choose a different hostel to copy to')
    await assertHostel(orgId, body.fromHostelId)
    await assertHostel(orgId, body.toHostelId)
    const source = await MessMenu.find({ orgId, hostelId: body.fromHostelId }).lean()
    const copied = await withTransaction(async (session) => {
      await MessMenu.deleteMany({ orgId, hostelId: body.toHostelId }, { session })
      if (!source.length) return 0
      await MessMenu.insertMany(
        source.map((m) => ({ orgId, hostelId: body.toHostelId, day: m.day, meal: m.meal, items: m.items })),
        { session },
      )
      return source.length
    })
    res.json({ copied })
  }),
)

/* ---------------- today's headcount ---------------- */

router.get(
  '/today',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ hostelId: objectId, date: dateStr.optional() }), req.query)
    await assertHostel(orgId, q.hostelId)
    const date = q.date ?? todayStr()
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()

    const [members, menu, outs, leaveIds] = await Promise.all([
      Hosteler.find({ orgId, hostelId: q.hostelId, status: 'active', messOpted: true }).select('_id').lean(),
      MessMenu.find({ orgId, hostelId: q.hostelId, day }).lean(),
      MealOptOut.find({ orgId, hostelId: q.hostelId, date }).lean(),
      onLeaveIds(orgId, date, { hostelId: q.hostelId }),
    ])
    const memberIds = new Set(members.map((m) => String(m._id)))
    const info = await hostelerInfo(orgId, outs.map((o) => o.hostelerId))

    // headcount = mess members - opted out - on approved leave (not double counted)
    const meals = MEALS.map((m) => {
      const mealOuts = outs.filter((o) => o.meal === m && memberIds.has(String(o.hostelerId)))
      const outIds = new Set(mealOuts.map((o) => String(o.hostelerId)))
      const leaveOnly = [...leaveIds].filter((id) => memberIds.has(id) && !outIds.has(id))
      return {
        meal: m,
        items: menu.find((x) => x.meal === m)?.items ?? '',
        members: memberIds.size,
        optedOut: mealOuts.map((o) => {
          const h = info.get(String(o.hostelerId))
          return { id: String(o._id), hostelerId: String(o.hostelerId), name: h?.name ?? '', roomNumber: h?.roomNumber ?? null }
        }),
        onLeave: leaveOnly.length,
        headcount: Math.max(memberIds.size - mealOuts.length - leaveOnly.length, 0),
      }
    })
    res.json({ date, day, hostelId: q.hostelId, members: memberIds.size, meals })
  }),
)

/* ---------------- members ---------------- */

router.get(
  '/members',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const hs = await Hosteler.find({ orgId, ...hostelScope(req.query), status: 'active' })
      .select('name loginId hostelId roomId messOpted')
      .sort({ name: 1 })
      .lean()
    const rooms = await roomNumbers(orgId, hs.map((h) => h.roomId))
    const items = hs.map((h) => ({
      id: String(h._id),
      name: h.name,
      loginId: h.loginId,
      hostelId: String(h.hostelId),
      roomId: h.roomId ? String(h.roomId) : null,
      roomNumber: h.roomId ? (rooms.get(String(h.roomId)) ?? null) : null,
      messOpted: h.messOpted,
    }))
    res.json({ items, members: items.filter((h) => h.messOpted).length, active: items.length })
  }),
)

router.patch(
  '/members/:hostelerId',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const hostelerId = idParam(req, 'hostelerId')
    const body = parse(z.object({ messOpted: z.boolean() }), req.body)
    const h = await Hosteler.findOneAndUpdate(
      { _id: hostelerId, orgId, status: { $ne: 'checked_out' } },
      { $set: { messOpted: body.messOpted } },
      { new: true },
    )
    if (!h) throw notFound('Hosteler')
    res.json({ id: String(h._id), name: h.name, messOpted: h.messOpted })
  }),
)

/* ---------------- opt-outs ---------------- */

router.get(
  '/opt-outs',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query)
    const date: Record<string, string> = {}
    if (q.from) date.$gte = q.from
    if (q.to) date.$lte = q.to
    const outs = await MealOptOut.find({ orgId, ...hostelScope(req.query), ...(q.from || q.to ? { date } : {}) })
      .sort({ date: 1 })
      .limit(2000)
      .lean()
    outs.sort((a, b) => a.date.localeCompare(b.date) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal))
    const info = await hostelerInfo(orgId, outs.map((o) => o.hostelerId))
    res.json({
      items: outs.map((o) => {
        const h = info.get(String(o.hostelerId))
        return { ...toApi(o), hostelerName: h?.name ?? '', roomNumber: h?.roomNumber ?? null }
      }),
    })
  }),
)

router.post(
  '/opt-outs',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const body = parse(z.object({ hostelerId: objectId, date: dateStr, meal }), req.body)
    const h = await Hosteler.findOne({ _id: body.hostelerId, orgId, status: 'active' }).select('hostelId messOpted').lean()
    if (!h) throw notFound('Hosteler')
    if (!h.messOpted) throw badRequest('This hosteler is not a mess member')
    if (await MealOptOut.exists({ orgId, hostelerId: body.hostelerId, date: body.date, meal: body.meal }))
      throw conflict('Already opted out of this meal')
    const doc = await MealOptOut.create({ orgId, hostelId: h.hostelId, hostelerId: body.hostelerId, date: body.date, meal: body.meal })
    res.status(201).json(doc.toJSON())
  }),
)

router.delete(
  '/opt-outs/:id',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const r = await MealOptOut.deleteOne({ _id: idParam(req), orgId })
    if (!r.deletedCount) throw notFound('Opt-out')
    res.status(204).end()
  }),
)

/* ---------------- feedback ---------------- */

router.get(
  '/feedback',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(paginationQuery.extend({ meal: meal.optional() }), req.query)
    const scope = { orgId, ...hostelScope(req.query) }
    const filter = { ...scope, ...(q.meal ? { meal: q.meal } : {}) }
    const [list, total, ratings] = await Promise.all([
      MessFeedback.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      MessFeedback.countDocuments(filter),
      MessFeedback.find(scope).select('meal rating').lean(),
    ])
    const info = await hostelerInfo(orgId, list.map((f) => f.hostelerId))
    const averages = Object.fromEntries(
      MEALS.map((m) => {
        const rs = ratings.filter((r) => r.meal === m)
        const avg = rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : null
        return [m, { average: avg === null ? null : Math.round(avg * 10) / 10, count: rs.length }]
      }),
    )
    res.json({
      ...paginate(
        list.map((f) => {
          const h = info.get(String(f.hostelerId))
          return { ...toApi(f), hostelerName: h?.name ?? '', roomNumber: h?.roomNumber ?? null }
        }),
        total,
        q.page,
        q.limit,
      ),
      averages,
    })
  }),
)

/* ---------------- stats ---------------- */

router.get(
  '/stats',
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const q = parse(z.object({ month: monthStr.optional() }), req.query)
    const month = q.month ?? todayStr().slice(0, 7)
    const { settings } = await getSettings(orgId)
    const [optOuts, members] = await Promise.all([
      MealOptOut.countDocuments({ orgId, ...hostelScope(req.query), date: { $gte: `${month}-01`, $lte: `${month}-31` } }),
      Hosteler.countDocuments({ orgId, ...hostelScope(req.query), status: 'active', messOpted: true }),
    ])
    const perMeal = (settings.messMonthlyCharge ?? 0) / 30 / 4
    res.json({
      month,
      members,
      optOuts,
      perMealCost: Math.round(perMeal * 100) / 100,
      estimatedSavings: Math.round(optOuts * perMeal),
    })
  }),
)
