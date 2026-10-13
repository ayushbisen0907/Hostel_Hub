/**
 * Metered electricity.
 *
 * Each month staff enter the units used per room (hostel.electricityBasis =
 * 'room': one meter per room, the amount is split EQUALLY among the hostelers
 * currently in that room) or per bed ('bed': each bed has its own meter).
 * amount = units × hostel.electricityRate. Every hosteler's share becomes an
 * "Electricity" line on their bill for that month — immediately if the bill
 * exists, otherwise when the month's bills are generated.
 */
import type { ClientSession, Types } from 'mongoose'
import { Bed } from '../models/Bed.js'
import { ElectricityReading } from '../models/ElectricityReading.js'
import { Hostel } from '../models/Hostel.js'
import { Hosteler } from '../models/Hosteler.js'
import { Invoice } from '../models/Invoice.js'
import { Room } from '../models/Room.js'
import { badRequest, conflict, notFound } from './errors.js'

type Id = string | Types.ObjectId

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Split `amount` into `n` whole-rupee parts that add up exactly (first ones get the extra rupee). */
export function splitEqually(amount: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(amount / n)
  const extra = amount - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Bill lines for a hosteler's electricity in `month` (from all readings that include them). */
export async function electricityLines(orgId: Id, hostelerId: Id, month: string, session?: ClientSession) {
  const readings = await ElectricityReading.find({ orgId, month, 'splits.hostelerId': hostelerId }).session(session ?? null).lean()
  if (!readings.length) return []
  const rooms = new Map(
    (await Room.find({ _id: { $in: readings.map((r) => r.roomId) } }).select('number').session(session ?? null).lean()).map((r) => [String(r._id), r.number]),
  )
  const beds = new Map(
    (await Bed.find({ _id: { $in: readings.map((r) => r.bedId).filter(Boolean) } }).select('label').session(session ?? null).lean()).map((b) => [String(b._id), b.label]),
  )
  return readings.map((r) => {
    const share = r.splits.find((s) => String(s.hostelerId) === String(hostelerId))!
    const where = `Room ${rooms.get(String(r.roomId)) ?? ''}${r.bedId ? ` Bed ${beds.get(String(r.bedId)) ?? ''}` : ''}`.trim()
    const ways = r.splits.length > 1 ? `, split ${r.splits.length} ways` : ''
    return {
      key: 'electricity' as const,
      label: `Electricity – ${where} (${r.units} units × ${rupees(r.rate)}${ways})`,
      amount: share.amount,
    }
  })
}

/**
 * Puts the hosteler's current electricity lines on their bill for `month`
 * (replacing older electricity lines). No-op if that bill doesn't exist yet.
 * Returns true if a bill was updated.
 */
export async function applyElectricityToBill(orgId: Id, hostelerId: Id, month: string, session?: ClientSession) {
  const inv = await Invoice.findOne({ orgId, hostelerId, month, cancelled: false }).sort({ createdAt: 1 }).session(session ?? null)
  if (!inv) return false
  const lines = await electricityLines(orgId, hostelerId, month, session)
  const items = [...inv.items.filter((i) => i.key !== 'electricity').map((i) => ({ key: i.key, label: i.label, amount: i.amount })), ...lines]
  const total = items.reduce((a, i) => a + i.amount, 0)
  if (total < inv.paidAmount)
    throw conflict(`Bill ${inv.number} already has ${rupees(inv.paidAmount)} paid; the new electricity amount would make the bill smaller than that`)
  inv.set('items', items)
  inv.total = total
  await inv.save({ session })
  return true
}

export interface ReadingInput {
  roomId: string
  bedId?: string | null
  /** null / 0 removes the reading */
  units: number | null
}

/**
 * Saves the month's readings for a hostel, splits the amounts and updates
 * the affected bills. Use inside a transaction.
 */
export async function saveReadings(
  orgId: Id,
  hostelId: Id,
  month: string,
  inputs: ReadingInput[],
  enteredByName: string,
  session?: ClientSession,
) {
  const hostel = await Hostel.findOne({ _id: hostelId, orgId }).session(session ?? null)
  if (!hostel) throw notFound('Hostel')
  const rate = hostel.electricityRate ?? 0
  if (!(rate > 0)) throw badRequest('Set the electricity rate per unit for this hostel first (Settings → Hostels)')
  const basis = hostel.electricityBasis ?? 'room'

  const affected = new Set<string>()
  const warnings: string[] = []
  for (const input of inputs) {
    const room = await Room.findOne({ _id: input.roomId, orgId, hostelId: hostel._id }).session(session ?? null)
    if (!room) throw notFound('Room')
    let bedId: Types.ObjectId | null = null
    let occupantBeds
    if (basis === 'bed') {
      if (!input.bedId) throw badRequest('This hostel meters each bed separately — choose the bed')
      const bed = await Bed.findOne({ _id: input.bedId, orgId, roomId: room._id }).session(session ?? null)
      if (!bed) throw notFound('Bed')
      bedId = bed._id
      occupantBeds = [bed]
    } else {
      occupantBeds = await Bed.find({ orgId, roomId: room._id }).sort({ label: 1 }).session(session ?? null)
    }

    const existing = await ElectricityReading.findOne({ orgId, roomId: room._id, bedId, month }).session(session ?? null)
    for (const s of existing?.splits ?? []) affected.add(String(s.hostelerId))

    if (!input.units || input.units <= 0) {
      if (existing) await existing.deleteOne({ session })
      continue
    }

    const occupants = await Hosteler.find({
      orgId,
      _id: { $in: occupantBeds.map((b) => b.hostelerId).filter(Boolean) },
      status: 'active',
    })
      .select('name bedId')
      .session(session ?? null)
      .lean()
    // keep bed order (A, B, C…) so the extra rupee goes to the same people each month
    const ordered = occupantBeds.map((b) => occupants.find((h) => String(h.bedId) === String(b._id))).filter(Boolean) as typeof occupants
    const amount = Math.round(input.units * rate)
    const parts = splitEqually(amount, ordered.length)
    const splits = ordered.map((h, i) => ({ hostelerId: h._id, name: h.name, amount: parts[i]! }))
    if (!splits.length)
      warnings.push(`Room ${room.number}${basis === 'bed' ? ` bed ${occupantBeds[0]!.label}` : ''}: nobody is staying there, so this reading isn't billed to anyone`)
    for (const s of splits) affected.add(String(s.hostelerId))

    await ElectricityReading.findOneAndUpdate(
      { orgId, roomId: room._id, bedId, month },
      { $set: { hostelId: hostel._id, units: input.units, rate, amount, splits, enteredByName } },
      { upsert: true, new: true, session },
    )
  }

  let billsUpdated = 0
  for (const hostelerId of affected) if (await applyElectricityToBill(orgId, hostelerId, month, session)) billsUpdated++
  return { billsUpdated, hostelersAffected: affected.size, warnings }
}
