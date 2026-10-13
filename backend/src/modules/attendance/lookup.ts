/**
 * Small lookups shared by the operations modules (attendance, mess,
 * complaints, visitors): hosteler name / room number and approved leaves.
 */
import type { Types } from 'mongoose'
import { Hosteler } from '../../models/Hosteler.js'
import { Room } from '../../models/Room.js'
import { Leave } from '../../models/Operations.js'

type Id = string | Types.ObjectId

export interface HostelerInfo {
  name: string
  loginId: string
  roomId: string | null
  roomNumber: string | null
  hostelId: string
}

/** Map of room id -> room number for the given ids (org scoped). */
export async function roomNumbers(orgId: Id, roomIds: (Id | null | undefined)[]) {
  const ids = [...new Set(roomIds.filter(Boolean).map(String))]
  const map = new Map<string, string>()
  if (!ids.length) return map
  const rooms = await Room.find({ orgId, _id: { $in: ids } }).select('number').lean()
  for (const r of rooms) map.set(String(r._id), r.number)
  return map
}

/** Map of hosteler id -> name / room number (org scoped). */
export async function hostelerInfo(orgId: Id, hostelerIds: (Id | null | undefined)[]) {
  const ids = [...new Set(hostelerIds.filter(Boolean).map(String))]
  const map = new Map<string, HostelerInfo>()
  if (!ids.length) return map
  const hs = await Hosteler.find({ orgId, _id: { $in: ids } }).select('name loginId roomId hostelId').lean()
  const rooms = await roomNumbers(orgId, hs.map((h) => h.roomId))
  for (const h of hs) {
    const roomId = h.roomId ? String(h.roomId) : null
    map.set(String(h._id), {
      name: h.name,
      loginId: h.loginId,
      roomId,
      roomNumber: roomId ? (rooms.get(roomId) ?? null) : null,
      hostelId: String(h.hostelId),
    })
  }
  return map
}

/** Ids of hostelers on approved leave on `date` (optionally within one hostel). */
export async function onLeaveIds(orgId: Id, date: string, scope: { hostelId?: string } = {}) {
  const leaves = await Leave.find({ orgId, ...scope, status: 'approved', from: { $lte: date }, to: { $gte: date } })
    .select('hostelerId')
    .lean()
  return new Set(leaves.map((l) => String(l.hostelerId)))
}
