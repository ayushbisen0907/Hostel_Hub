/**
 * Rent cycles counted from each hosteler's check-in date.
 *
 * Checked in on 13 Oct → bills for 13 Oct–12 Nov, 13 Nov–12 Dec, … Each bill
 * is created on the first day of its cycle (rent is paid in advance) and is
 * due `settings.rentDueDay` days later. generateDueBills() creates every bill
 * whose cycle has started and isn't billed yet; the server runs it every hour
 * and staff can run it from Fees.
 */
import type { ClientSession, Types } from 'mongoose'
import { withTransaction } from '../config/db.js'
import { Hostel } from '../models/Hostel.js'
import { Hosteler } from '../models/Hosteler.js'
import { Invoice } from '../models/Invoice.js'
import { Organization } from '../models/Organization.js'
import { addDays, addMonthsAnchored, periodLabel } from './dates.js'
import { monthlyBillItems, type BillItem } from './billing.js'
import { pendingElectricity } from './electricity.js'
import { createInvoice } from './money.js'
import { notifyNewBill } from './notify.js'
import { todayStr } from './http.js'
import { logActivity } from './org.js'

type Id = string | Types.ObjectId
const MAX_CYCLES = 600 // 50 years — a safety stop for the loops below

export function cycleStart(checkIn: string, k: number) {
  return addMonthsAnchored(checkIn, k)
}
export function cycleEnd(checkIn: string, k: number) {
  return addDays(addMonthsAnchored(checkIn, k + 1), -1)
}

/** Index of the cycle that contains `date` (0 for dates before check-in). */
export function cycleIndexOf(checkIn: string, date: string) {
  let k = 0
  while (k < MAX_CYCLES && cycleStart(checkIn, k + 1) <= date) k++
  return k
}

/** Whole months from month `a` to month `b` ("YYYY-MM"). */
function monthsBetween(a: string, b: string) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
}

/**
 * Cycles already billed: bills with a period, plus older calendar-month rent
 * bills (no period). Cycle k starts in the k-th month after the check-in
 * month, so a calendar bill for month M counts for the cycle that starts in M
 * (each old monthly bill = one cycle; mapping by due date could put two old
 * bills on the same cycle and bill a period twice). Bills without a period and
 * without a rent line are custom bills (damages, extras…) and don't count.
 */
async function billedCycles(orgId: Id, h: { _id: Id; checkInDate: string }, session?: ClientSession) {
  const invs = await Invoice.find({ orgId, hostelerId: h._id, cancelled: false }).select('periodStart month items.key').session(session ?? null).lean()
  const set = new Set<number>()
  for (const inv of invs) {
    if (inv.periodStart) set.add(cycleIndexOf(h.checkInDate, inv.periodStart))
    else if (inv.items.some((i) => i.key === 'rent')) set.add(Math.max(0, monthsBetween(h.checkInDate.slice(0, 7), inv.month)))
  }
  return set
}

interface BillTarget {
  _id: Types.ObjectId
  hostelId: Types.ObjectId
  checkInDate: string
  monthlyRent: number
  messOpted: boolean
  depositToBill: number
  billFromCycle?: number | null
}

/**
 * Creates this hosteler's missing bills for every cycle that has started by
 * `today`. Must run inside a transaction (pass its session). Returns the new bills.
 */
export async function billDueCycles(
  orgId: Id,
  h: BillTarget,
  ctx: { today: string; dueDays: number; fallbackMess: number; notify: boolean },
  session: ClientSession,
) {
  const billed = await billedCycles(orgId, h, session)
  const hostel = await Hostel.findById(h.hostelId).select('charges').session(session).lean()
  const created = []
  for (let k = h.billFromCycle ?? 0; k < MAX_CYCLES; k++) {
    const start = cycleStart(h.checkInDate, k)
    if (start > ctx.today) break
    if (billed.has(k)) continue
    const end = cycleEnd(h.checkInDate, k)
    const label = periodLabel(start, end)
    const items: BillItem[] = monthlyBillItems(h, hostel?.charges, ctx.fallbackMess).map((i) => ({ ...i, label: `${i.label} (${label})` }))
    const hostelerDoc = await Hosteler.findById(h._id).select('depositToBill').session(session)
    if (hostelerDoc && hostelerDoc.depositToBill > 0) {
      items.push({ key: 'deposit', label: 'Security deposit', amount: hostelerDoc.depositToBill })
      hostelerDoc.depositToBill = 0
      await hostelerDoc.save({ session })
    }
    const elec = await pendingElectricity(orgId, h._id, session)
    const inv = await createInvoice(
      orgId,
      { hostelerId: h._id, month: start.slice(0, 7), items: [...items, ...elec.lines], dueDate: addDays(start, ctx.dueDays), periodStart: start, periodEnd: end },
      session,
    )
    if (elec.lines.length) await elec.markBilled(inv._id)
    if (ctx.notify) await notifyNewBill(orgId, inv, label, session)
    created.push(inv)
    billed.add(k)
  }
  return created
}

async function billContext(orgId: Id, today: string, notify: boolean) {
  const org = await Organization.findById(orgId).select('settings').lean()
  const s = org?.settings
  return { today, dueDays: Math.max(0, Math.min(s?.rentDueDay ?? 5, 28)), fallbackMess: s?.messMonthlyCharge ?? 0, notify }
}

/** Bills a single hosteler inside the caller's transaction (used at check-in; notifies the hosteler by default). */
export async function billHostelerNow(orgId: Id, h: BillTarget, session: ClientSession, notify = true) {
  return billDueCycles(orgId, h, await billContext(orgId, todayStr(), notify), session)
}

/**
 * Creates every due bill in the organization (optionally one hostel).
 * Each hosteler is billed in its own transaction so one problem doesn't block the rest.
 */
export async function generateDueBills(orgId: Id, opts: { hostelId?: Id; today?: string; notify?: boolean } = {}) {
  const ctx = await billContext(orgId, opts.today ?? todayStr(), opts.notify ?? true)
  const hs = await Hosteler.find({ orgId, status: 'active', ...(opts.hostelId ? { hostelId: opts.hostelId } : {}), checkInDate: { $lte: ctx.today } })
    .select('hostelId checkInDate monthlyRent messOpted depositToBill billFromCycle')
    .lean()
  let created = 0
  let billedHostelers = 0
  const errors: string[] = []
  for (const h of hs) {
    try {
      const n = (await withTransaction((session) => billDueCycles(orgId, h as BillTarget, ctx, session))).length
      created += n
      if (n) billedHostelers++
    } catch (e) {
      // a concurrent run already created it (unique cycle index) — fine
      if ((e as { code?: number }).code !== 11000) errors.push(`${String(h._id)}: ${(e as Error).message}`)
    }
  }
  if (created) await logActivity(orgId, `${created} bill${created === 1 ? '' : 's'} generated`, 'payment', opts.hostelId ?? null)
  // skipped = hostelers with nothing new to bill
  return { created, hostelers: hs.length, skipped: hs.length - billedHostelers - errors.length, errors }
}

/** Runs generateDueBills for every organization (scheduler). */
export async function generateDueBillsForAllOrgs() {
  const orgs = await Organization.find({}).select('_id').lean()
  let created = 0
  for (const o of orgs) created += (await generateDueBills(o._id)).created
  return created
}
