/**
 * Metered electricity by period.
 *
 * Staff enter a reading for a meter (a room, or a bed when the hostel meters
 * each bed) with the period it covers: fromDate–toDate and the units used.
 * amount = units × hostel.electricityRate, shared among everyone who stayed on
 * that meter during the period IN PROPORTION TO THE DAYS they stayed (from the
 * room-stay history). E.g. 1–31 Oct, ₹1000: A stayed 31 days, B 21 days →
 * A ₹596, B ₹404.
 *
 * Each share is added as an "Electricity" line to that hosteler's current
 * (latest) bill, or to their next bill if they have none yet. Lines carry the
 * reading id (item.ref) so editing or deleting a reading updates the bills.
 */
import type { ClientSession, Types } from 'mongoose'
import { Bed } from '../models/Bed.js'
import { ElectricityReading } from '../models/ElectricityReading.js'
import { Hostel } from '../models/Hostel.js'
import { Hosteler } from '../models/Hosteler.js'
import { Invoice } from '../models/Invoice.js'
import { Room } from '../models/Room.js'
import { RoomStay } from '../models/RoomStay.js'
import { badRequest, conflict, notFound } from './errors.js'
import { daysInclusive, overlapDays, periodLabel } from './dates.js'
import { todayStr } from './http.js'

type Id = string | Types.ObjectId

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Split `amount` into `n` whole-rupee parts that add up exactly (first ones get the extra rupee). */
export function splitEqually(amount: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(amount / n)
  const extra = amount - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * Split `amount` in proportion to `weights` (e.g. days stayed), in whole
 * rupees that add up exactly (largest remainder; ties go to the earlier entry).
 */
export function splitByWeight(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, w) => a + w, 0)
  if (total <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (amount * w) / total)
  const out = raw.map(Math.floor)
  let left = amount - out.reduce((a, x) => a + x, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i]! += 1
    left--
  }
  return out
}

interface Meter {
  hostel: InstanceType<typeof Hostel>
  room: InstanceType<typeof Room>
  bed: InstanceType<typeof Bed> | null
}

async function resolveMeter(orgId: Id, input: { roomId: Id; bedId?: Id | null }, session?: ClientSession): Promise<Meter> {
  const room = await Room.findOne({ _id: input.roomId, orgId }).session(session ?? null)
  if (!room) throw notFound('Room')
  const hostel = await Hostel.findOne({ _id: room.hostelId, orgId }).session(session ?? null)
  if (!hostel) throw notFound('Hostel')
  let bed = null
  if ((hostel.electricityBasis ?? 'room') === 'bed') {
    if (!input.bedId) throw badRequest('This hostel meters each bed separately — choose the bed')
    bed = await Bed.findOne({ _id: input.bedId, orgId, roomId: room._id }).session(session ?? null)
    if (!bed) throw notFound('Bed')
  }
  return { hostel, room, bed }
}

export interface Share {
  hostelerId: Types.ObjectId
  name: string
  days: number
  amount: number
}

/** Who stayed on the meter during the period, how many days each, and their share of `amount`. */
export async function computeShares(orgId: Id, meter: Meter, fromDate: string, toDate: string, amount: number, session?: ClientSession) {
  const stays = await RoomStay.find({
    orgId,
    ...(meter.bed ? { bedId: meter.bed._id } : { roomId: meter.room._id }),
    from: { $lte: toDate },
    $or: [{ to: null }, { to: { $gte: fromDate } }],
  })
    .sort({ from: 1 })
    .session(session ?? null)
    .lean()
  const byHosteler = new Map<string, { hostelerId: Types.ObjectId; days: number; first: string }>()
  for (const s of stays) {
    const days = overlapDays(s.from, s.to, fromDate, toDate)
    if (days <= 0) continue
    const k = String(s.hostelerId)
    const cur = byHosteler.get(k)
    if (cur) cur.days += days
    else byHosteler.set(k, { hostelerId: s.hostelerId as Types.ObjectId, days, first: s.from })
  }
  const rows = [...byHosteler.values()].sort((a, b) => a.first.localeCompare(b.first))
  const names = new Map(
    (await Hosteler.find({ _id: { $in: rows.map((r) => r.hostelerId) } }).select('name').session(session ?? null).lean()).map((h) => [String(h._id), h.name]),
  )
  const amounts = splitByWeight(amount, rows.map((r) => r.days))
  const shares: Share[] = rows.map((r, i) => ({ hostelerId: r.hostelerId, name: names.get(String(r.hostelerId)) ?? '', days: r.days, amount: amounts[i]! }))
  return { shares, totalDays: rows.reduce((a, r) => a + r.days, 0), periodDays: daysInclusive(fromDate, toDate) }
}

function lineLabel(r: { fromDate: string; toDate: string; units: number; rate: number; totalDays: number }, meterName: string, share: { days: number }, people: number) {
  const mine = people > 1 ? `, your ${share.days} of ${r.totalDays} days` : ''
  return `Electricity – ${meterName}, ${periodLabel(r.fromDate, r.toDate)} (${r.units} units × ${rupees(r.rate)}${mine})`
}

function meterName(room: { number: string }, bed: { label: string } | null) {
  return `Room ${room.number}${bed ? ` Bed ${bed.label}` : ''}`
}

/** The bill a new electricity share goes on: the hosteler's latest bill (null if none yet). */
async function currentBill(orgId: Id, hostelerId: Id, session?: ClientSession) {
  return Invoice.findOne({ orgId, hostelerId, cancelled: false })
    .sort({ periodStart: -1, month: -1, createdAt: -1 })
    .session(session ?? null)
}

const belowPaid = (inv: { number: string; paidAmount: number }) =>
  conflict(`Bill ${inv.number} already has ${rupees(inv.paidAmount)} paid; changing this reading would make it smaller than that`)

/**
 * Removes this reading's lines from every bill they were added to and returns
 * those bill ids. With `check` = false the caller re-adds lines and checks the
 * paid amounts itself (an edit may put the same or a larger amount back).
 */
async function removeLines(orgId: Id, reading: { _id: unknown; splits: { invoiceId?: unknown }[] }, session?: ClientSession, check = true) {
  const ref = String(reading._id)
  const invIds = [...new Set(reading.splits.map((s) => s.invoiceId).filter(Boolean).map(String))]
  for (const id of invIds) {
    const inv = await Invoice.findOne({ _id: id, orgId }).session(session ?? null)
    if (!inv) continue
    const items = inv.items.filter((i) => i.ref !== ref).map((i) => ({ key: i.key, label: i.label, amount: i.amount, ref: i.ref ?? null }))
    const total = items.reduce((a, i) => a + i.amount, 0)
    if (check && total < inv.paidAmount) throw belowPaid(inv)
    inv.set('items', items)
    inv.total = total
    await inv.save({ session })
  }
  return invIds
}

export interface ReadingInput {
  roomId: string
  bedId?: string | null
  fromDate: string
  toDate: string
  units: number
}

function validatePeriod(fromDate: string, toDate: string) {
  if (fromDate > toDate) throw badRequest('"From" date must be on or before the "to" date')
  if (toDate > todayStr()) throw badRequest("The reading period can't end in the future")
  if (daysInclusive(fromDate, toDate) > 366) throw badRequest('A reading can cover at most one year')
}

async function assertNoOverlap(orgId: Id, meter: Meter, fromDate: string, toDate: string, exceptId: Id | null, session?: ClientSession) {
  const clash = await ElectricityReading.findOne({
    orgId,
    roomId: meter.room._id,
    bedId: meter.bed?._id ?? null,
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
    .session(session ?? null)
    .lean()
  if (clash) throw conflict(`This meter already has a reading for ${periodLabel(clash.fromDate, clash.toDate)} — periods can't overlap`)
}

/** Preview of a reading (nothing saved). */
export async function previewReading(orgId: Id, input: ReadingInput) {
  validatePeriod(input.fromDate, input.toDate)
  const meter = await resolveMeter(orgId, input)
  const rate = meter.hostel.electricityRate ?? 0
  const amount = Math.round(input.units * rate)
  const { shares, totalDays, periodDays } = await computeShares(orgId, meter, input.fromDate, input.toDate, amount)
  return { rate, amount, periodDays, totalDays, shares: shares.map((s) => ({ ...s, hostelerId: String(s.hostelerId) })) }
}

/**
 * Creates (readingId = null) or updates a reading, re-splits it by days and
 * updates the affected bills. Use inside a transaction.
 */
export async function saveReading(orgId: Id, readingId: Id | null, input: ReadingInput, enteredByName: string, session?: ClientSession) {
  validatePeriod(input.fromDate, input.toDate)
  if (!(input.units > 0)) throw badRequest('Enter the units used (more than 0)')
  const meter = await resolveMeter(orgId, input, session)
  const rate = meter.hostel.electricityRate ?? 0
  if (!(rate > 0)) throw badRequest('Set the electricity rate per unit for this hostel first (Settings → Hostels)')
  await assertNoOverlap(orgId, meter, input.fromDate, input.toDate, readingId, session)

  let reading = readingId ? await ElectricityReading.findOne({ _id: readingId, orgId }).session(session ?? null) : null
  if (readingId && !reading) throw notFound('Reading')
  // the old lines come off first; whether a paid bill ends up too small is checked once the new lines are on
  const touched = reading ? await removeLines(orgId, reading, session, false) : []

  const amount = Math.round(input.units * rate)
  const { shares, totalDays } = await computeShares(orgId, meter, input.fromDate, input.toDate, amount, session)
  const fields = {
    orgId,
    hostelId: meter.hostel._id,
    roomId: meter.room._id,
    bedId: meter.bed?._id ?? null,
    fromDate: input.fromDate,
    toDate: input.toDate,
    month: input.toDate.slice(0, 7),
    units: input.units,
    rate,
    amount,
    totalDays,
    enteredByName,
  }
  if (reading) {
    reading.set({ ...fields, splits: [] })
  } else {
    reading = new ElectricityReading({ ...fields, splits: [] })
  }
  await reading.save({ session }) // need the id for the bill lines

  const name = meterName(meter.room, meter.bed)
  const splits = []
  const billed: string[] = []
  for (const s of shares) {
    let invoiceId: Types.ObjectId | null = null
    if (s.amount > 0) {
      const inv = await currentBill(orgId, s.hostelerId, session)
      if (inv) {
        inv.items.push({ key: 'electricity', label: lineLabel(fields, name, s, shares.length), amount: s.amount, ref: String(reading._id) })
        inv.total += s.amount
        await inv.save({ session })
        invoiceId = inv._id
        billed.push(inv.number)
      }
    }
    splits.push({ hostelerId: s.hostelerId, name: s.name, days: s.days, amount: s.amount, invoiceId })
  }
  reading.set('splits', splits)
  await reading.save({ session })
  for (const id of touched) {
    const inv = await Invoice.findOne({ _id: id, orgId }).select('number total paidAmount').session(session ?? null).lean()
    if (inv && inv.total < inv.paidAmount) throw belowPaid(inv) // the caller's transaction rolls everything back
  }

  const warnings: string[] = []
  if (!shares.length) warnings.push(`${name}: nobody stayed there during this period, so it isn't billed to anyone`)
  const waiting = splits.filter((s) => s.amount > 0 && !s.invoiceId).length
  return { reading, billsUpdated: billed.length, waitingForNextBill: waiting, warnings }
}

export async function deleteReading(orgId: Id, readingId: Id, session?: ClientSession) {
  const reading = await ElectricityReading.findOne({ _id: readingId, orgId }).session(session ?? null)
  if (!reading) throw notFound('Reading')
  await removeLines(orgId, reading, session)
  await reading.deleteOne({ session })
}

/**
 * Electricity shares still waiting for a bill (the hosteler had no bill when the
 * reading was saved). Called when a new bill is created: returns the lines to add
 * and marks the shares as billed on `invoiceId` once the caller saved the bill.
 */
export async function pendingElectricity(orgId: Id, hostelerId: Id, session?: ClientSession) {
  const readings = await ElectricityReading.find({ orgId, splits: { $elemMatch: { hostelerId, invoiceId: null, amount: { $gt: 0 } } } })
    .session(session ?? null)
  const rooms = new Map(
    (await Room.find({ _id: { $in: readings.map((r) => r.roomId) } }).select('number').session(session ?? null).lean()).map((r) => [String(r._id), r]),
  )
  const beds = new Map(
    (await Bed.find({ _id: { $in: readings.map((r) => r.bedId).filter(Boolean) } }).select('label').session(session ?? null).lean()).map((b) => [String(b._id), b]),
  )
  const lines = readings.map((r) => {
    const share = r.splits.find((s) => String(s.hostelerId) === String(hostelerId) && !s.invoiceId)!
    const name = meterName(rooms.get(String(r.roomId)) ?? { number: '' }, r.bedId ? (beds.get(String(r.bedId)) ?? null) : null)
    return { key: 'electricity' as const, label: lineLabel(r, name, share, r.splits.length), amount: share.amount, ref: String(r._id) }
  })
  const markBilled = async (invoiceId: Types.ObjectId) => {
    for (const r of readings) {
      for (const s of r.splits) if (String(s.hostelerId) === String(hostelerId) && !s.invoiceId) s.invoiceId = invoiceId
      await r.save({ session })
    }
  }
  return { lines, markBilled }
}

/**
 * Readings saved before periods existed only have `month`: give them the
 * month's first day → last day (or today for the current month).
 * Runs at server start, before indexes are synced. Safe to run repeatedly.
 */
export async function migrateLegacyReadings() {
  const legacy = await ElectricityReading.collection.find({ $or: [{ fromDate: { $exists: false } }, { fromDate: null }] }).toArray()
  const today = todayStr()
  for (const r of legacy) {
    const month = String(r.month ?? today.slice(0, 7))
    const [y, m] = month.split('-').map(Number)
    const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
    const toDate = last > today ? today : last
    await ElectricityReading.collection.updateOne({ _id: r._id }, { $set: { fromDate: `${month}-01`, toDate, totalDays: r.totalDays ?? 0 } })
  }
  return legacy.length
}
