/** Room/bed stay history (see models/RoomStay.ts). Pass the session from the caller's transaction. */
import type { ClientSession, Types } from 'mongoose'
import { RoomStay } from '../models/RoomStay.js'
import { Hosteler } from '../models/Hosteler.js'
import { Bed } from '../models/Bed.js'
import { addDays } from './dates.js'

type Id = string | Types.ObjectId

export async function openStay(
  orgId: Id,
  h: { _id: Id; hostelId: Id },
  bed: { _id: Id; roomId: Id; hostelId?: Id },
  from: string,
  session?: ClientSession,
) {
  await RoomStay.create([{ orgId, hostelId: bed.hostelId ?? h.hostelId, hostelerId: h._id, roomId: bed.roomId, bedId: bed._id, from, to: null }], { session })
}

/**
 * A hosteler from before stays were recorded has none: give them an open stay
 * on their current bed from the check-in date, so a transfer / check-out
 * doesn't lose the days they already spent there. No-op otherwise.
 * Call BEFORE the hosteler's bed is changed.
 */
export async function ensureStay(
  orgId: Id,
  h: { _id: Id; hostelId: Id; status: string; bedId?: Id | null; roomId?: Id | null; checkInDate: string },
  session?: ClientSession,
) {
  if (h.status !== 'active' || !h.bedId || !h.roomId) return
  if (await RoomStay.exists({ orgId, hostelerId: h._id }).session(session ?? null)) return
  await openStay(orgId, h, { _id: h.bedId, roomId: h.roomId }, h.checkInDate, session)
}

/** Ends the open stay on `to` (inclusive). A stay that would end before it starts is removed. */
export async function closeStay(orgId: Id, hostelerId: Id, to: string, session?: ClientSession) {
  const open = await RoomStay.find({ orgId, hostelerId, to: null }).session(session ?? null)
  for (const s of open) {
    if (to < s.from) await s.deleteOne({ session })
    else {
      s.to = to
      await s.save({ session })
    }
  }
}

/** Bed transfer on `date`: the old stay ends the day before, the new one starts on `date`. */
export async function moveStay(
  orgId: Id,
  h: { _id: Id; hostelId: Id },
  bed: { _id: Id; roomId: Id; hostelId?: Id },
  date: string,
  session?: ClientSession,
) {
  await closeStay(orgId, h._id, addDays(date, -1), session)
  await openStay(orgId, h, bed, date, session)
}

/**
 * Older data has no stay records: give every active hosteler with a bed an
 * open stay from their check-in date. Safe to run repeatedly.
 */
export async function backfillStays(orgId?: Id) {
  const hs = await Hosteler.find({ ...(orgId ? { orgId } : {}), status: 'active', bedId: { $ne: null } }).select('orgId hostelId bedId checkInDate').lean()
  if (!hs.length) return 0
  const withStay = new Set((await RoomStay.distinct('hostelerId', { hostelerId: { $in: hs.map((h) => h._id) }, to: null })).map(String))
  let created = 0
  for (const h of hs) {
    if (withStay.has(String(h._id))) continue
    const bed = await Bed.findById(h.bedId).select('roomId hostelId').lean()
    if (!bed) continue
    await RoomStay.create({ orgId: h.orgId, hostelId: bed.hostelId, hostelerId: h._id, roomId: bed.roomId, bedId: bed._id, from: h.checkInDate, to: null })
    created++
  }
  return created
}
