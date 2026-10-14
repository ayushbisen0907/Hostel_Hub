/**
 * Room / bed stay history (models/RoomStay.ts, lib/stays.ts): written at
 * check-in, confirm-check-in, transfer and check-out; removed with the
 * hosteler; backfilled for data from before stays were recorded.
 */
import { describe, expect, it } from 'vitest'
import { api, makeHosteler, makeRoom, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { addDays } from '../src/lib/dates.js'
import { backfillStays } from '../src/lib/stays.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { RoomStay } from '../src/models/RoomStay.js'

const today = todayStr()
type World = Awaited<ReturnType<typeof makeWorld>>

const staysOf = async (hostelerId: unknown) =>
  (await RoomStay.find({ hostelerId }).sort({ from: 1, createdAt: 1 }).lean()).map((s) => ({ bedId: String(s.bedId), roomId: String(s.roomId), from: s.from, to: s.to }))

async function checkIn(w: World, bedId: unknown, extra: Record<string, unknown> = {}) {
  const r = await api()
    .post('/api/hostelers')
    .set(w.auth)
    .send({
      name: 'Rohan Verma',
      phone: '9876543211',
      hostelId: String(w.hostel._id),
      bedId: String(bedId),
      checkInDate: today,
      monthlyRent: 6000,
      securityDeposit: 0,
      messOpted: false,
      generateFirstInvoice: false,
      ...extra,
    })
    .expect(201)
  return r.body.hosteler.id as string
}

describe('room stays', () => {
  it('check-in opens a stay; a reservation does not until confirm-check-in', async () => {
    const w = await makeWorld()
    const ci = addDays(today, -6)
    const id = await checkIn(w, w.beds[1]!._id, { checkInDate: ci })
    expect(await staysOf(id)).toEqual([{ bedId: String(w.beds[1]!._id), roomId: String(w.room._id), from: ci, to: null }])

    const r2 = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    const res = await checkIn(w, r2.beds[0]!._id, { name: 'Reserved', reserveOnly: true })
    expect(await staysOf(res)).toEqual([])
    const confirmOn = addDays(today, -2)
    await api().post(`/api/hostelers/${res}/confirm-check-in`).set(w.auth).send({ date: confirmOn }).expect(200)
    expect(await staysOf(res)).toEqual([{ bedId: String(r2.beds[0]!._id), roomId: String(r2.room._id), from: confirmOn, to: null }])
  })

  it('transfer ends the old stay the day before; check-out closes the open stay on the check-out date', async () => {
    const w = await makeWorld()
    const ci = addDays(today, -10)
    const id = await checkIn(w, w.beds[1]!._id, { checkInDate: ci })
    const r2 = await makeRoom(w.org._id, w.hostel._id, '102', 2)
    await api().post(`/api/hostelers/${id}/transfer`).set(w.auth).send({ bedId: String(r2.beds[1]!._id) }).expect(200)
    expect(await staysOf(id)).toEqual([
      { bedId: String(w.beds[1]!._id), roomId: String(w.room._id), from: ci, to: addDays(today, -1) },
      { bedId: String(r2.beds[1]!._id), roomId: String(r2.room._id), from: today, to: null },
    ])

    await api().post(`/api/hostelers/${id}/check-out`).set(w.auth).send({ date: today }).expect(200)
    expect((await staysOf(id)).map((s) => s.to)).toEqual([addDays(today, -1), today])
    expect(await RoomStay.countDocuments({ hostelerId: id, to: null })).toBe(0)
  })

  it('a transfer on the check-in day replaces the stay (no zero-day stay is kept)', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, w.beds[1]!._id)
    const r2 = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    await api().post(`/api/hostelers/${id}/transfer`).set(w.auth).send({ bedId: String(r2.beds[0]!._id) }).expect(200)
    expect(await staysOf(id)).toEqual([{ bedId: String(r2.beds[0]!._id), roomId: String(r2.room._id), from: today, to: null }])
  })

  it('older hostelers without stay records keep their days on transfer and check-out', async () => {
    const w = await makeWorld() // helper hosteler: bed A, no stay records
    const ci = addDays(today, -20)
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: ci })
    const r2 = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    await api().post(`/api/hostelers/${w.hosteler._id}/transfer`).set(w.auth).send({ bedId: String(r2.beds[0]!._id) }).expect(200)
    expect(await staysOf(w.hosteler._id)).toEqual([
      { bedId: String(w.beds[0]!._id), roomId: String(w.room._id), from: ci, to: addDays(today, -1) },
      { bedId: String(r2.beds[0]!._id), roomId: String(r2.room._id), from: today, to: null },
    ])

    const { hosteler: old } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Old Timer', checkInDate: addDays(today, -30) })
    const out = addDays(today, -3)
    await api().post(`/api/hostelers/${old._id}/check-out`).set(w.auth).send({ date: out }).expect(200)
    expect(await staysOf(old._id)).toEqual([{ bedId: String(w.beds[1]!._id), roomId: String(w.room._id), from: addDays(today, -30), to: out }])
  })

  it('deleting a hosteler removes their stays', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, w.beds[1]!._id)
    expect(await RoomStay.countDocuments({ hostelerId: id })).toBe(1)
    await api().delete(`/api/hostelers/${id}`).set(w.auth).expect(204)
    expect(await RoomStay.countDocuments({ hostelerId: id })).toBe(0)
  })

  it('backfillStays gives active hostelers with a bed an open stay from check-in (once)', async () => {
    const w = await makeWorld()
    const { hosteler: second } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Second', checkInDate: '2026-08-15' })
    const { hosteler: noBed } = await makeHosteler(w.org._id, w.hostel, { name: 'No bed' })
    const r2 = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    const { hosteler: gone } = await makeHosteler(w.org._id, w.hostel, { bed: r2.beds[0]!, name: 'Gone' })
    await Hosteler.updateOne({ _id: gone._id }, { status: 'checked_out' })
    const other = await makeWorld() // another org

    expect(await backfillStays(w.org._id)).toBe(2)
    expect(await staysOf(w.hosteler._id)).toEqual([{ bedId: String(w.beds[0]!._id), roomId: String(w.room._id), from: '2026-09-01', to: null }])
    expect((await staysOf(second._id))[0]!.from).toBe('2026-08-15')
    expect(await RoomStay.countDocuments({ hostelerId: { $in: [noBed._id, gone._id, other.hosteler._id] } })).toBe(0)
    expect(await backfillStays(w.org._id)).toBe(0)
    expect(await RoomStay.countDocuments({ orgId: w.org._id })).toBe(2)
  })
})
