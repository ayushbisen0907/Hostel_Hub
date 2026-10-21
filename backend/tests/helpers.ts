/**
 * Test helpers. They create data directly through the models (not through
 * other modules' endpoints) so each module's tests stay independent.
 */
import type { Plan } from '../src/lib/plans.js'
import request from 'supertest'
import mongoose from 'mongoose'
import { createApp } from '../src/app.js'
import { hashPassword, signToken, formatLoginId } from '../src/lib/auth.js'
import { Organization } from '../src/models/Organization.js'
import { User } from '../src/models/User.js'
import { Hostel } from '../src/models/Hostel.js'
import { Room } from '../src/models/Room.js'
import { Bed } from '../src/models/Bed.js'
import { Hosteler } from '../src/models/Hosteler.js'

export const app = createApp()
export const api = () => request(app)

let codeCounter = 0

/** Creates an organization with an owner and returns an auth header for it. */
export async function makeOrg(opts: { plan?: Plan; email?: string } = {}) {
  const org = await Organization.create({ name: 'Test Hostels', ownerName: 'Owner', email: opts.email ?? `owner${Date.now()}${Math.random()}@test.in`, plan: opts.plan ?? 'business' })
  const owner = await User.create({ orgId: org._id, name: 'Owner', email: org.email, passwordHash: await hashPassword('Owner@123'), role: 'owner' })
  return { org, owner, auth: staffAuth(owner) }
}

/** Another staff login in the same org with a given role. */
export async function makeStaffUser(orgId: mongoose.Types.ObjectId, role: 'manager' | 'warden' | 'accountant') {
  const u = await User.create({ orgId, name: role, email: `${role}${Date.now()}${Math.random()}@test.in`, passwordHash: await hashPassword('Staff@123'), role })
  return { user: u, auth: staffAuth(u) }
}

export function staffAuth(u: { _id: unknown; orgId: unknown; role: 'owner' | 'manager' | 'warden' | 'accountant'; tokenVersion: number }) {
  return { Authorization: `Bearer ${signToken({ kind: 'staff', sub: String(u._id), orgId: String(u.orgId), role: u.role, tv: u.tokenVersion })}` }
}

/** Every hostel has a UPI ID + payee name (required when created through the API). */
export const TEST_UPI = { upiId: 'sunrise.hostel@okhdfc', payeeName: 'Sunrise Hostels' }

export async function makeHostel(orgId: mongoose.Types.ObjectId, name = 'Sunrise Boys Hostel') {
  codeCounter++
  return Hostel.create({ orgId, name, type: 'boys', city: 'Indore', code: `T${codeCounter}${Math.floor(Math.random() * 90 + 10)}`, ...TEST_UPI })
}

/** Room with `sharing` empty beds A, B, C… */
export async function makeRoom(orgId: mongoose.Types.ObjectId, hostelId: mongoose.Types.ObjectId, number = '101', sharing = 2, rentPerBed = 6000) {
  const room = await Room.create({ orgId, hostelId, number, floor: 1, sharing, rentPerBed })
  const beds = await Bed.insertMany(
    Array.from({ length: sharing }, (_, i) => ({ orgId, hostelId, roomId: room._id, label: String.fromCharCode(65 + i) })),
  )
  return { room, beds }
}

/**
 * Active hosteler occupying `bed` (optional). Password is known so portal
 * tests can log in: `password` (default "Hostel@123"), already activated
 * unless mustChangePassword is true.
 */
export async function makeHosteler(
  orgId: mongoose.Types.ObjectId,
  hostel: { _id: mongoose.Types.ObjectId; code: string; hostelerSeq: number },
  opts: { bed?: { _id: mongoose.Types.ObjectId; roomId: mongoose.Types.ObjectId }; password?: string; mustChangePassword?: boolean; name?: string; messOpted?: boolean; monthlyRent?: number; checkInDate?: string } = {},
) {
  const h = await Hostel.findByIdAndUpdate(hostel._id, { $inc: { hostelerSeq: 1 } }, { new: true })
  const password = opts.password ?? 'Hostel@123'
  const hosteler = await Hosteler.create({
    orgId,
    hostelId: hostel._id,
    name: opts.name ?? 'Aarav Sharma',
    phone: '9876543210',
    guardianName: 'Ramesh',
    guardianPhone: '9876500000',
    roomId: opts.bed?.roomId ?? null,
    bedId: opts.bed?._id ?? null,
    status: 'active',
    checkInDate: opts.checkInDate ?? '2026-09-01',
    monthlyRent: opts.monthlyRent ?? 6000,
    securityDeposit: 5000,
    messOpted: opts.messOpted ?? true,
    loginId: formatLoginId(h!.code, h!.hostelerSeq),
    passwordHash: await hashPassword(password),
    mustChangePassword: opts.mustChangePassword ?? false,
  })
  if (opts.bed) await Bed.updateOne({ _id: opts.bed._id }, { hostelerId: hosteler._id })
  return { hosteler, password, auth: hostelerAuth(hosteler) }
}

export function hostelerAuth(h: { _id: unknown; orgId: unknown; hostelId: unknown; mustChangePassword: boolean; tokenVersion: number }) {
  return {
    Authorization: `Bearer ${signToken({ kind: 'hosteler', sub: String(h._id), orgId: String(h.orgId), hostelId: String(h.hostelId), mustChangePassword: h.mustChangePassword, tv: h.tokenVersion })}`,
  }
}

/** Full fixture: org + owner, a hostel, a 2-bed room and one hosteler in bed A. */
export async function makeWorld(opts: { plan?: Plan } = {}) {
  const { org, owner, auth } = await makeOrg(opts)
  const hostel = await makeHostel(org._id)
  const { room, beds } = await makeRoom(org._id, hostel._id)
  const { hosteler, password, auth: hAuth } = await makeHosteler(org._id, hostel, { bed: beds[0]! })
  return { org, owner, auth, hostel, room, beds, hosteler, hostelerPassword: password, hostelerAuth: hAuth }
}
