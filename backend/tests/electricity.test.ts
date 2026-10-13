import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeRoom, makeStaffUser, makeWorld, TEST_UPI } from './helpers.js'
import { splitEqually } from '../src/lib/electricity.js'
import { Bed } from '../src/models/Bed.js'
import { ElectricityReading } from '../src/models/ElectricityReading.js'
import { Hostel } from '../src/models/Hostel.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Invoice } from '../src/models/Invoice.js'
import { Notification } from '../src/models/Notification.js'

const MONTH = '2026-10'
type World = Awaited<ReturnType<typeof makeWorld>>

/** Hostel with metered electricity at ₹rate/unit and a 3-bed room 201 (beds A, B, C). */
async function setup(rate = 10, basis: 'room' | 'bed' = 'room') {
  const w = await makeWorld()
  await Hostel.updateOne({ _id: w.hostel._id }, { electricityRate: rate, electricityBasis: basis })
  const r201 = await makeRoom(w.org._id, w.hostel._id, '201', 3)
  return { ...w, r201 }
}

const bill = (hostelerId: unknown, month = MONTH) => Invoice.findOne({ hostelerId, month, cancelled: false }).lean()
const elecLines = (inv: { items: { key?: string | null; label: string; amount: number }[] } | null) =>
  (inv?.items ?? []).filter((i) => i.key === 'electricity')

function put(w: World, readings: { roomId: unknown; bedId?: unknown; units: number | null }[], auth = w.auth, hostelId: unknown = w.hostel._id) {
  return api()
    .put('/api/electricity')
    .set(auth)
    .send({
      hostelId: String(hostelId),
      month: MONTH,
      readings: readings.map((r) => ({ roomId: String(r.roomId), ...(r.bedId !== undefined ? { bedId: r.bedId === null ? null : String(r.bedId) } : {}), units: r.units })),
    })
}

const generate = (w: World, month = MONTH) => api().post('/api/invoices/generate').set(w.auth).send({ month }).expect(200)

describe('hostel electricity settings', () => {
  it('create and patch accept electricityRate / electricityBasis, with validation', async () => {
    const w = await makeWorld()
    const base = { ...TEST_UPI, name: 'Metered House', type: 'boys', city: 'Indore' }
    const def = await api().post('/api/hostels').set(w.auth).send(base).expect(201)
    expect(def.body).toMatchObject({ electricityRate: 0, electricityBasis: 'room' })

    const c = await api().post('/api/hostels').set(w.auth).send({ ...base, name: 'Bed Meter House', electricityRate: 9.5, electricityBasis: 'bed' }).expect(201)
    expect(c.body).toMatchObject({ electricityRate: 9.5, electricityBasis: 'bed' })

    await api().post('/api/hostels').set(w.auth).send({ ...base, electricityRate: -1 }).expect(400)
    await api().post('/api/hostels').set(w.auth).send({ ...base, electricityBasis: 'floor' }).expect(400)

    const p = await api().patch(`/api/hostels/${c.body.id}`).set(w.auth).send({ electricityRate: 12, electricityBasis: 'room' }).expect(200)
    expect(p.body).toMatchObject({ electricityRate: 12, electricityBasis: 'room' })
    await api().patch(`/api/hostels/${c.body.id}`).set(w.auth).send({ electricityRate: -5 }).expect(400)
    await api().patch(`/api/hostels/${c.body.id}`).set(w.auth).send({ electricityBasis: 'meter' }).expect(400)
    const saved = await Hostel.findById(c.body.id).lean()
    expect(saved).toMatchObject({ electricityRate: 12, electricityBasis: 'room' })
  })
})

describe('splitEqually', () => {
  it('splits into whole rupees that add up exactly, extra rupees to the first parts', () => {
    expect(splitEqually(1000, 2)).toEqual([500, 500])
    expect(splitEqually(1010, 3)).toEqual([337, 337, 336])
    expect(splitEqually(1001, 4)).toEqual([251, 250, 250, 250])
    expect(splitEqually(1003, 4)).toEqual([251, 251, 251, 250])
    expect(splitEqually(2, 3)).toEqual([1, 1, 0])
    expect(splitEqually(0, 3)).toEqual([0, 0, 0])
    expect(splitEqually(777, 1)).toEqual([777])
    expect(splitEqually(500, 0)).toEqual([])
    for (const [amt, n] of [[9999, 7], [1, 5], [123457, 13]] as const) {
      const parts = splitEqually(amt, n)
      expect(parts).toHaveLength(n)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amt)
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
    }
  })
})

describe('room-metered electricity', () => {
  it('splits a room reading equally onto the occupants’ existing bills and shows it on the sheet', async () => {
    const w = await setup()
    const [A, , C] = w.r201.beds
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: A!, name: 'Ishaan Rao' })
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: C!, name: 'Kabir Jain' })
    await generate(w)
    const before1 = await bill(h1._id)
    expect(elecLines(before1)).toEqual([])

    const r = await put(w, [{ roomId: w.r201.room._id, units: 100 }]).expect(200)
    expect(r.body).toMatchObject({ billsUpdated: 2, hostelersAffected: 2, warnings: [] })

    for (const h of [h1, h2]) {
      const inv = await bill(h._id)
      const lines = elecLines(inv)
      expect(lines).toHaveLength(1)
      expect(lines[0]!.amount).toBe(500)
      expect(lines[0]!.label).toMatch(/^Electricity/)
      expect(lines[0]!.label).toContain('Room 201')
      expect(lines[0]!.label).toContain('100 units')
      expect(lines[0]!.label).toContain('₹10')
      expect(lines[0]!.label).toContain('split 2 ways')
      expect(inv!.total).toBe(inv!.items.reduce((a, i) => a + i.amount, 0))
      expect(inv!.total).toBe(before1!.total + 500)
    }
    // the world hosteler (room 101) is untouched
    expect(elecLines(await bill(w.hosteler._id))).toEqual([])

    const row = r.body.rows.find((x: { roomNumber: string }) => x.roomNumber === '201')
    expect(row).toMatchObject({ bedId: null, beds: 3 })
    expect(row.occupants.map((o: { name: string; billed: boolean }) => [o.name, o.billed])).toEqual([
      ['Ishaan Rao', true],
      ['Kabir Jain', true],
    ])
    expect(row.reading).toMatchObject({ units: 100, rate: 10, amount: 1000, enteredByName: 'Owner' })
    expect(row.reading.splits).toEqual([
      { hostelerId: String(h1._id), name: 'Ishaan Rao', amount: 500 },
      { hostelerId: String(h2._id), name: 'Kabir Jain', amount: 500 },
    ])

    const g = await api().get('/api/electricity').set(w.auth).query({ hostelId: String(w.hostel._id), month: MONTH }).expect(200)
    expect(g.body.hostel).toMatchObject({ rate: 10, basis: 'room' })
    expect(g.body.month).toBe(MONTH)
    expect(g.body.totals).toEqual({ units: 100, amount: 1000 })
    expect(g.body.rows.map((x: { roomNumber: string }) => x.roomNumber)).toEqual(['101', '201'])
    const g201 = g.body.rows.find((x: { roomNumber: string }) => x.roomNumber === '201')
    expect(g201.reading.splits.map((s: { amount: number }) => s.amount)).toEqual([500, 500])
    expect(g.body.rows.find((x: { roomNumber: string }) => x.roomNumber === '101').reading).toBeNull()
  })

  it('odd amounts: remainder goes to the first beds in label order', async () => {
    const w = await setup()
    const [A, B, C] = w.r201.beds
    // created out of bed order on purpose
    const { hosteler: hc } = await makeHosteler(w.org._id, w.hostel, { bed: C!, name: 'C person' })
    const { hosteler: ha } = await makeHosteler(w.org._id, w.hostel, { bed: A!, name: 'A person' })
    const { hosteler: hb } = await makeHosteler(w.org._id, w.hostel, { bed: B!, name: 'B person' })
    await generate(w)

    const r = await put(w, [{ roomId: w.r201.room._id, units: 101 }]).expect(200)
    const reading = await ElectricityReading.findOne({ roomId: w.r201.room._id, month: MONTH }).lean()
    expect(reading!.amount).toBe(1010)
    expect(reading!.splits.map((s) => s.name)).toEqual(['A person', 'B person', 'C person'])
    expect(reading!.splits.map((s) => s.amount)).toEqual([337, 337, 336])
    expect(r.body.billsUpdated).toBe(3)
    expect(elecLines(await bill(ha._id))[0]!.amount).toBe(337)
    expect(elecLines(await bill(hb._id))[0]!.amount).toBe(337)
    expect(elecLines(await bill(hc._id))[0]!.amount).toBe(336)
    expect(elecLines(await bill(hc._id))[0]!.label).toContain('split 3 ways')

    // fractional units are rounded to whole rupees: 12.34 × 10 = 123.4 → 123 → 41 each
    await put(w, [{ roomId: w.r201.room._id, units: 12.34 }]).expect(200)
    const again = await ElectricityReading.findOne({ roomId: w.r201.room._id, month: MONTH }).lean()
    expect(again!.amount).toBe(123)
    expect(again!.splits.map((s) => s.amount)).toEqual([41, 41, 41])
  })

  it('readings entered before bills exist are added when bills are generated (and notified)', async () => {
    const w = await setup()
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, name: 'Ishaan Rao' })
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[1]!, name: 'Kabir Jain' })

    const r = await put(w, [{ roomId: w.r201.room._id, units: 80 }]).expect(200)
    expect(r.body).toMatchObject({ billsUpdated: 0, hostelersAffected: 2 })
    const row = r.body.rows.find((x: { roomNumber: string }) => x.roomNumber === '201')
    expect(row.occupants.every((o: { billed: boolean }) => o.billed === false)).toBe(true)
    expect(await Invoice.countDocuments({ orgId: w.org._id })).toBe(0)

    await generate(w)
    for (const h of [h1, h2]) {
      const inv = await bill(h._id)
      expect(elecLines(inv).map((l) => l.amount)).toEqual([400])
      expect(inv!.items.map((i) => i.key)).toEqual(['rent', 'mess', 'electricity'])
      expect(inv!.total).toBe(6000 + 3000 + 400)
      const note = await Notification.findOne({ recipientId: h._id, type: 'bill_generated' }).lean()
      expect(note!.title).toContain('₹9,400')
    }
    // no electricity for the room-101 hosteler
    const other = await bill(w.hosteler._id)
    expect(elecLines(other)).toEqual([])
    expect((await Notification.findOne({ recipientId: w.hosteler._id }).lean())!.title).toContain('₹9,000')
  })

  it('re-saving replaces the electricity line; 0 / null removes it', async () => {
    const w = await setup()
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]! })
    await generate(w)
    const base = (await bill(h1._id))!.total

    await put(w, [{ roomId: w.r201.room._id, units: 50 }]).expect(200)
    await put(w, [{ roomId: w.r201.room._id, units: 70 }]).expect(200)
    let inv = await bill(h1._id)
    expect(elecLines(inv).map((l) => l.amount)).toEqual([700])
    expect(inv!.total).toBe(base + 700)
    expect(await ElectricityReading.countDocuments({ roomId: w.r201.room._id })).toBe(1)

    const r0 = await put(w, [{ roomId: w.r201.room._id, units: 0 }]).expect(200)
    expect(r0.body.billsUpdated).toBe(1)
    inv = await bill(h1._id)
    expect(elecLines(inv)).toEqual([])
    expect(inv!.total).toBe(base)
    expect(await ElectricityReading.countDocuments({ roomId: w.r201.room._id })).toBe(0)

    await put(w, [{ roomId: w.r201.room._id, units: 30 }]).expect(200)
    expect((await bill(h1._id))!.total).toBe(base + 300)
    await put(w, [{ roomId: w.r201.room._id, units: null }]).expect(200)
    expect((await bill(h1._id))!.total).toBe(base)
    expect(await ElectricityReading.countDocuments({})).toBe(0)
  })

  it('several rooms in one save; each hosteler gets one line per reading', async () => {
    const w = await setup()
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]! })
    await generate(w)
    const r = await put(w, [
      { roomId: w.room._id, units: 25 },
      { roomId: w.r201.room._id, units: 40 },
    ]).expect(200)
    expect(r.body).toMatchObject({ billsUpdated: 2, hostelersAffected: 2 })
    expect(r.body.totals).toEqual({ units: 65, amount: 650 })
    expect(elecLines(await bill(w.hosteler._id)).map((l) => l.amount)).toEqual([250])
    expect(elecLines(await bill(h1._id)).map((l) => l.amount)).toEqual([400])
  })

  it('room with nobody in it: reading saved, warning returned, nobody billed', async () => {
    const w = await setup()
    await generate(w)
    const before = (await bill(w.hosteler._id))!.total
    const r = await put(w, [{ roomId: w.r201.room._id, units: 60 }]).expect(200)
    expect(r.body.billsUpdated).toBe(0)
    expect(r.body.hostelersAffected).toBe(0)
    expect(r.body.warnings).toHaveLength(1)
    expect(r.body.warnings[0]).toContain('Room 201')
    const reading = await ElectricityReading.findOne({ roomId: w.r201.room._id }).lean()
    expect(reading).toMatchObject({ units: 60, amount: 600, splits: [] })
    expect((await bill(w.hosteler._id))!.total).toBe(before)
    expect(await Invoice.countDocuments({ orgId: w.org._id, 'items.key': 'electricity' })).toBe(0)
  })

  it('checked-out and reserved hostelers are not part of the split', async () => {
    const w = await setup()
    const [A, B, C] = w.r201.beds
    const { hosteler: active } = await makeHosteler(w.org._id, w.hostel, { bed: A!, name: 'Active One' })
    const { hosteler: gone } = await makeHosteler(w.org._id, w.hostel, { bed: B!, name: 'Gone' })
    const { hosteler: reserved } = await makeHosteler(w.org._id, w.hostel, { bed: C!, name: 'Reserved' })
    await generate(w)
    // stale bed links on purpose: only the hosteler status should matter
    await Hosteler.updateOne({ _id: gone._id }, { status: 'checked_out' })
    await Hosteler.updateOne({ _id: reserved._id }, { status: 'reserved' })

    const r = await put(w, [{ roomId: w.r201.room._id, units: 100 }]).expect(200)
    expect(r.body.hostelersAffected).toBe(1)
    const reading = await ElectricityReading.findOne({ roomId: w.r201.room._id }).lean()
    expect(reading!.splits.map((s) => [s.name, s.amount])).toEqual([['Active One', 1000]])
    expect(elecLines(await bill(active._id)).map((l) => l.amount)).toEqual([1000])
    expect(elecLines(await bill(gone._id))).toEqual([])
    expect(elecLines(await bill(reserved._id))).toEqual([])
    const row = r.body.rows.find((x: { roomNumber: string }) => x.roomNumber === '201')
    expect(row.occupants.map((o: { name: string }) => o.name)).toEqual(['Active One'])
  })

  it('a hosteler who leaves the room loses the line when the reading is re-saved', async () => {
    const w = await setup()
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]! })
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[1]! })
    await generate(w)
    await put(w, [{ roomId: w.r201.room._id, units: 100 }]).expect(200)
    expect(elecLines(await bill(h2._id)).map((l) => l.amount)).toEqual([500])

    await Bed.updateOne({ _id: w.r201.beds[1]!._id }, { hostelerId: null })
    await put(w, [{ roomId: w.r201.room._id, units: 100 }]).expect(200)
    expect(elecLines(await bill(h1._id)).map((l) => l.amount)).toEqual([1000])
    expect(elecLines(await bill(h2._id))).toEqual([])
  })

  it('rate 0 → 400 asking to set the rate; nothing saved', async () => {
    const w = await setup(0)
    await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]! })
    const r = await put(w, [{ roomId: w.r201.room._id, units: 100 }]).expect(400)
    expect(JSON.stringify(r.body)).toMatch(/rate/i)
    expect(await ElectricityReading.countDocuments({})).toBe(0)
  })

  it('validates the body', async () => {
    const w = await setup()
    const hostelId = String(w.hostel._id)
    const roomId = String(w.r201.room._id)
    await api().put('/api/electricity').set(w.auth).send({ hostelId, month: MONTH, readings: [] }).expect(400)
    await api().put('/api/electricity').set(w.auth).send({ hostelId, month: '2026-13x', readings: [{ roomId, units: 5 }] }).expect(400)
    await api().put('/api/electricity').set(w.auth).send({ hostelId, month: MONTH, readings: [{ roomId, units: -5 }] }).expect(400)
    await api().put('/api/electricity').set(w.auth).send({ hostelId, month: MONTH, readings: [{ roomId: 'nope', units: 5 }] }).expect(400)
    await api().get('/api/electricity').set(w.auth).query({ hostelId: 'nope' }).expect(400)
    expect(await ElectricityReading.countDocuments({})).toBe(0)
  })

  it('409 when a partly paid bill would end up below the amount paid; nothing changes', async () => {
    const w = await setup()
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]! })
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[1]! })
    await generate(w)
    await put(w, [{ roomId: w.r201.room._id, units: 100 }]).expect(200) // 500 each → 9500
    const inv1 = await bill(h1._id)
    expect(inv1!.total).toBe(9500)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: String(h1._id), invoiceId: String(inv1!._id), amount: 9400, mode: 'cash' }).expect(201)

    // re-saving at 20 units would make h1's bill 9100 < 9400 paid
    const r = await put(w, [
      { roomId: w.room._id, units: 10 }, // an earlier reading in the same save must be rolled back too
      { roomId: w.r201.room._id, units: 20 },
    ]).expect(409)
    expect(JSON.stringify(r.body)).toMatch(/paid/i)

    const reading = await ElectricityReading.findOne({ roomId: w.r201.room._id }).lean()
    expect(reading).toMatchObject({ units: 100, amount: 1000 })
    expect(await ElectricityReading.countDocuments({ roomId: w.room._id })).toBe(0)
    const after1 = await bill(h1._id)
    expect(after1).toMatchObject({ total: 9500, paidAmount: 9400 })
    expect(elecLines(after1).map((l) => l.amount)).toEqual([500])
    expect((await bill(h2._id))!.total).toBe(9500)
    expect(elecLines(await bill(w.hosteler._id))).toEqual([])

    // a reading that keeps the total ≥ paid is fine (9400 exactly)
    await put(w, [{ roomId: w.r201.room._id, units: 80 }]).expect(200)
    expect(await bill(h1._id)).toMatchObject({ total: 9400, paidAmount: 9400 })
  })
})

describe('bed-metered electricity', () => {
  it('requires a bed and bills each bed’s hosteler the full amount', async () => {
    const w = await setup(8, 'bed')
    const [A, B, C] = w.r201.beds
    const { hosteler: ha } = await makeHosteler(w.org._id, w.hostel, { bed: A! })
    const { hosteler: hb } = await makeHosteler(w.org._id, w.hostel, { bed: B! })
    await generate(w)

    const no = await put(w, [{ roomId: w.r201.room._id, units: 10 }]).expect(400)
    expect(JSON.stringify(no.body)).toMatch(/bed/i)
    await put(w, [{ roomId: w.r201.room._id, bedId: null, units: 10 }]).expect(400)
    // bed from another room
    await put(w, [{ roomId: w.r201.room._id, bedId: w.beds[0]!._id, units: 10 }]).expect(404)

    const r = await put(w, [
      { roomId: w.r201.room._id, bedId: A!._id, units: 30 },
      { roomId: w.r201.room._id, bedId: B!._id, units: 45 },
      { roomId: w.r201.room._id, bedId: C!._id, units: 5 }, // empty bed
    ]).expect(200)
    expect(r.body.billsUpdated).toBe(2)
    expect(r.body.warnings).toHaveLength(1)
    expect(r.body.warnings[0]).toContain('bed C')

    const la = elecLines(await bill(ha._id))
    expect(la.map((l) => l.amount)).toEqual([240])
    expect(la[0]!.label).toContain('Bed A')
    expect(la[0]!.label).not.toContain('split')
    expect(elecLines(await bill(hb._id)).map((l) => l.amount)).toEqual([360])

    expect(await ElectricityReading.countDocuments({ roomId: w.r201.room._id })).toBe(3)
    const rows = r.body.rows.filter((x: { roomNumber: string }) => x.roomNumber === '201')
    expect(rows.map((x: { bedLabel: string }) => x.bedLabel)).toEqual(['A', 'B', 'C'])
    expect(rows.map((x: { reading: { amount: number } }) => x.reading.amount)).toEqual([240, 360, 40])
    expect(rows[0].occupants.map((o: { id: string }) => o.id)).toEqual([String(ha._id)])
    expect(rows[2].occupants).toEqual([])
    expect(r.body.hostel.basis).toBe('bed')
  })
})

describe('electricity permissions', () => {
  it('warden and manager can save; accountant 403; hosteler 403; other org 404', async () => {
    const w = await setup()
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]! })
    const warden = await makeStaffUser(w.org._id, 'warden')
    const manager = await makeStaffUser(w.org._id, 'manager')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const q = { hostelId: String(w.hostel._id), month: MONTH }

    const rw = await put(w, [{ roomId: w.r201.room._id, units: 10 }], warden.auth).expect(200)
    expect(rw.body.rows.find((x: { roomNumber: string }) => x.roomNumber === '201').reading.enteredByName).toBe('warden')
    await api().get('/api/electricity').set(warden.auth).query(q).expect(200)
    await put(w, [{ roomId: w.r201.room._id, units: 20 }], manager.auth).expect(200)
    await api().get('/api/electricity').set(manager.auth).query(q).expect(200)

    await put(w, [{ roomId: w.r201.room._id, units: 30 }], accountant.auth).expect(403)
    await api().get('/api/electricity').set(accountant.auth).query(q).expect(403)
    await put(w, [{ roomId: w.r201.room._id, units: 30 }], w.hostelerAuth).expect(403)
    await api().get('/api/electricity').set(w.hostelerAuth).query(q).expect(403)
    await api().put('/api/electricity').send({ ...q, readings: [{ roomId: String(w.r201.room._id), units: 1 }] }).expect(401)

    // other org: their hostel / room are invisible
    const other = await setup()
    await put(w, [{ roomId: w.r201.room._id, units: 30 }], other.auth).expect(404) // our hostel id with their token
    await api().get('/api/electricity').set(other.auth).query(q).expect(404)
    await put(w, [{ roomId: other.r201.room._id, units: 30 }]).expect(404) // their room in our hostel
    // a room from another hostel of the same org is also rejected
    const second = await makeHostel(w.org._id, 'Second')
    const r2 = await makeRoom(w.org._id, second._id, '901', 1)
    await put(w, [{ roomId: r2.room._id, units: 30 }]).expect(404)

    const reading = await ElectricityReading.findOne({ roomId: w.r201.room._id }).lean()
    expect(reading!.units).toBe(20)
    expect(reading!.splits.map((s) => String(s.hostelerId))).toEqual([String(h1._id)])
    expect(await ElectricityReading.countDocuments({})).toBe(1)
  })
})

describe('portal', () => {
  it('the hosteler sees the electricity line on their bill', async () => {
    const w = await setup()
    await generate(w)
    await put(w, [{ roomId: w.room._id, units: 55 }]).expect(200)
    const r = await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)
    expect(r.body.bills).toHaveLength(1)
    const b = r.body.bills[0]
    expect(b.month).toBe(MONTH)
    const line = b.items.find((i: { key: string }) => i.key === 'electricity')
    expect(line).toMatchObject({ amount: 550 })
    expect(line.label).toContain('Room 101')
    expect(b.total).toBe(6000 + 3000 + 550)
    expect(r.body.totalDue).toBe(9550)
  })
})
