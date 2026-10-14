/**
 * Metered electricity by period (lib/electricity.ts, /api/electricity):
 * readings for a period on a room (or bed) meter, shared by the days each
 * hosteler stayed there (room-stay history), added to their latest bill.
 * All periods are relative to today so they are always in the past.
 */
import { describe, expect, it } from 'vitest'
import { api, makeHosteler, makeRoom, makeStaffUser, makeWorld, TEST_UPI } from './helpers.js'
import { splitEqually } from '../src/lib/electricity.js'
import { todayStr } from '../src/lib/http.js'
import { addDays, addMonthsAnchored, daysInclusive, periodLabel } from '../src/lib/dates.js'
import { generateDueBills } from '../src/lib/rentCycle.js'
import { backfillStays } from '../src/lib/stays.js'
import { ElectricityReading } from '../src/models/ElectricityReading.js'
import { Hostel } from '../src/models/Hostel.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Invoice } from '../src/models/Invoice.js'
import { RoomStay } from '../src/models/RoomStay.js'

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

const today = todayStr()

/** The most recent calendar month with 31 days that has fully passed (from = 1st, to = 31st). */
function past31DayMonth() {
  let from = addMonthsAnchored(`${today.slice(0, 7)}-01`, -1)
  while (daysInclusive(from, addDays(addMonthsAnchored(from, 1), -1)) !== 31) from = addMonthsAnchored(from, -1)
  return { from, to: addDays(from, 30) }
}

/** World + metered electricity at ₹rate/unit and a 3-bed room 201 (beds A, B, C). */
async function setup(rate = 10, basis: 'room' | 'bed' = 'room') {
  const w = await makeWorld()
  await Hostel.updateOne({ _id: w.hostel._id }, { electricityRate: rate, electricityBasis: basis })
  const r201 = await makeRoom(w.org._id, w.hostel._id, '201', 3)
  return { ...w, r201 }
}
type World = Awaited<ReturnType<typeof setup>>

interface Body {
  roomId: unknown
  bedId?: unknown
  fromDate: string
  toDate: string
  units: number
}
const body = (b: Body) => ({ ...b, roomId: String(b.roomId), ...(b.bedId !== undefined ? { bedId: b.bedId === null ? null : String(b.bedId) } : {}) })
const post = (w: { auth: Record<string, string> }, b: Body, auth = w.auth) => api().post('/api/electricity/readings').set(auth).send(body(b))
const preview = (w: World, b: Body) => api().post('/api/electricity/preview').set(w.auth).send(body(b))
const patch = (w: World, id: string, b: Record<string, unknown>, auth = w.auth) => api().patch(`/api/electricity/readings/${id}`).set(auth).send(b)
const del = (w: World, id: string, auth = w.auth) => api().delete(`/api/electricity/readings/${id}`).set(auth)
const billAll = (w: { org: { _id: unknown } }) => generateDueBills(w.org._id as never, { today, notify: false })

/** Hosteler's latest bill (by period) and all bills. */
const bills = (hostelerId: unknown) => Invoice.find({ hostelerId, cancelled: false }).sort({ periodStart: 1 }).lean()
const latest = async (hostelerId: unknown) => (await bills(hostelerId)).at(-1)!
const elecLines = (inv: { items: { key?: string | null; label: string; amount: number; ref?: string | null }[] } | null | undefined) =>
  (inv?.items ?? []).filter((i) => i.key === 'electricity')

describe('room-metered electricity by period', () => {
  it("shares by days stayed (the owner's example: 31 and 21 days of ₹1000 → 596 / 404) onto the latest bills", async () => {
    const w = await setup()
    const M = past31DayMonth()
    const [A, B] = w.r201.beds
    const { hosteler: ha } = await makeHosteler(w.org._id, w.hostel, { bed: A!, name: 'Aman', checkInDate: addDays(M.from, -10) })
    const { hosteler: hb } = await makeHosteler(w.org._id, w.hostel, { bed: B!, name: 'Bhavya', checkInDate: addDays(M.from, 10) }) // moved in on day 11
    await backfillStays(w.org._id)
    await billAll(w)
    const before = { a: await latest(ha._id), b: await latest(hb._id) }

    // preview: nothing saved
    const p = await preview(w, { roomId: w.r201.room._id, fromDate: M.from, toDate: M.to, units: 100 }).expect(200)
    expect(p.body).toMatchObject({ rate: 10, amount: 1000, periodDays: 31, totalDays: 52 })
    expect(p.body.shares).toEqual([
      { hostelerId: String(ha._id), name: 'Aman', days: 31, amount: 596 },
      { hostelerId: String(hb._id), name: 'Bhavya', days: 21, amount: 404 },
    ])
    expect(await ElectricityReading.countDocuments({})).toBe(0)

    const r = await post(w, { roomId: w.r201.room._id, fromDate: M.from, toDate: M.to, units: 100 }).expect(201)
    expect(r.body).toMatchObject({ billsUpdated: 2, waitingForNextBill: 0, warnings: [] })
    expect(r.body.reading).toMatchObject({ roomNumber: '201', bedLabel: null, fromDate: M.from, toDate: M.to, month: M.to.slice(0, 7), units: 100, rate: 10, amount: 1000, totalDays: 52, enteredByName: 'Owner' })
    expect(r.body.reading.splits).toMatchObject([
      { hostelerId: String(ha._id), name: 'Aman', days: 31, amount: 596, invoiceNumber: before.a.number },
      { hostelerId: String(hb._id), name: 'Bhavya', days: 21, amount: 404, invoiceNumber: before.b.number },
    ])

    const a = await latest(ha._id)
    const [line] = elecLines(a)
    expect(elecLines(a)).toHaveLength(1)
    expect(line).toMatchObject({ amount: 596, ref: r.body.reading.id })
    expect(line!.label).toBe(`Electricity – Room 201, ${periodLabel(M.from, M.to)} (100 units × ₹10, your 31 of 52 days)`)
    expect(a.total).toBe(before.a.total + 596)
    expect(elecLines(await latest(hb._id)).map((l) => l.amount)).toEqual([404])
    // only the latest bill gets it
    expect((await bills(ha._id)).slice(0, -1).every((b) => elecLines(b).length === 0)).toBe(true)
    // the helper's hosteler in room 101 isn't part of it
    expect((await bills(w.hosteler._id)).every((b) => elecLines(b).length === 0)).toBe(true)

    // history
    const list = await api().get('/api/electricity/readings').set(w.auth).query({ hostelId: String(w.hostel._id) }).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0].splits.map((s: { invoiceNumber: string }) => s.invoiceNumber)).toEqual([before.a.number, before.b.number])
  })

  it('shares wait for the next bill when the hosteler has none yet', async () => {
    const w = await setup()
    const from = addDays(today, -9)
    const { hosteler: h } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, checkInDate: addDays(today, -20) })
    const r = await post(w, { roomId: w.r201.room._id, fromDate: from, toDate: today, units: 12 }).expect(201)
    expect(r.body).toMatchObject({ billsUpdated: 0, waitingForNextBill: 1 })
    expect(r.body.reading.splits).toMatchObject([{ hostelerId: String(h._id), days: 10, amount: 120, invoiceId: null, invoiceNumber: null }])

    await billAll(w)
    const [first] = await bills(h._id)
    expect(elecLines(first)).toMatchObject([{ amount: 120, ref: r.body.reading.id }])
    expect(String((await ElectricityReading.findById(r.body.reading.id).lean())!.splits[0]!.invoiceId)).toBe(String(first!._id))
    // not added twice
    await generateDueBills(w.org._id, { today: addMonthsAnchored(today, 1), notify: false })
    const all = await bills(h._id)
    expect(all.flatMap((b) => elecLines(b))).toHaveLength(1)
  })

  it('follows stays across a transfer (days in each room)', async () => {
    const w = await setup()
    const r202 = await makeRoom(w.org._id, w.hostel._id, '202', 2)
    const { hosteler: x } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, name: 'Xavier', checkInDate: addDays(today, -20) })
    const { hosteler: y } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[1]!, name: 'Yash', checkInDate: addDays(today, -20) })
    await billAll(w)
    await api().post(`/api/hostelers/${x._id}/transfer`).set(w.auth).send({ bedId: String(r202.beds[0]!._id) }).expect(200)

    const from = addDays(today, -9)
    const r1 = await post(w, { roomId: w.r201.room._id, fromDate: from, toDate: today, units: 19 }).expect(201)
    expect(r1.body.reading.splits.map((s: { name: string; days: number; amount: number }) => [s.name, s.days, s.amount])).toEqual([
      ['Xavier', 9, 90], // until yesterday
      ['Yash', 10, 100],
    ])
    const r2 = await post(w, { roomId: r202.room._id, fromDate: from, toDate: today, units: 5 }).expect(201)
    expect(r2.body.reading.splits.map((s: { name: string; days: number; amount: number }) => [s.name, s.days, s.amount])).toEqual([['Xavier', 1, 50]])
    expect(elecLines(await latest(x._id)).map((l) => l.amount)).toEqual([90, 50])
    expect(elecLines(await latest(x._id))[1]!.label).not.toContain('your') // alone on that meter
    expect(elecLines(await latest(y._id)).map((l) => l.amount)).toEqual([100])
  })

  it('a hosteler who checked out during the period still pays for their days', async () => {
    const w = await setup()
    const { hosteler: z } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, name: 'Zoya', checkInDate: addDays(today, -20) })
    const { hosteler: v } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[1]!, name: 'Vivek', checkInDate: addDays(today, -20) })
    await billAll(w)
    await api().post(`/api/hostelers/${z._id}/check-out`).set(w.auth).send({ date: addDays(today, -5) }).expect(200)

    const r = await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -9), toDate: today, units: 15 }).expect(201)
    expect(r.body.reading.splits.map((s: { name: string; days: number; amount: number }) => [s.name, s.days, s.amount])).toEqual([
      ['Zoya', 5, 50],
      ['Vivek', 10, 100],
    ])
    expect(r.body.billsUpdated).toBe(2)
    expect(elecLines(await latest(z._id)).map((l) => l.amount)).toEqual([50])
    // checked-out hostelers don't appear as current occupants of the meter
    const meters = await api().get('/api/electricity').set(w.auth).query({ hostelId: String(w.hostel._id) }).expect(200)
    const m201 = meters.body.meters.find((m: { roomNumber: string }) => m.roomNumber === '201')
    expect(m201.occupants.map((o: { name: string }) => o.name)).toEqual(['Vivek'])
  })

  it('editing re-splits and updates the bill lines; deleting removes them', async () => {
    const w = await setup()
    const { hosteler: h } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, checkInDate: addDays(today, -40) })
    await billAll(w)
    const base = (await latest(h._id)).total
    const r = await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -29), toDate: addDays(today, -15), units: 10 }).expect(201)
    const id = r.body.reading.id as string

    const e1 = await patch(w, id, { units: 20 }).expect(200)
    expect(e1.body).toMatchObject({ billsUpdated: 1 })
    expect(e1.body.reading).toMatchObject({ units: 20, amount: 200 })
    let bill = await latest(h._id)
    expect(elecLines(bill)).toMatchObject([{ amount: 200, ref: id }])
    expect(bill.total).toBe(base + 200)

    // a second person in the room for part of the period: editing the dates re-splits by days
    const { hosteler: g } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[1]!, name: 'Guest', checkInDate: addDays(today, -19) })
    await RoomStay.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: g._id, roomId: w.r201.room._id, bedId: w.r201.beds[1]!._id, from: addDays(today, -19), to: null })
    const e2 = await patch(w, id, { fromDate: addDays(today, -24), toDate: addDays(today, -15) }).expect(200)
    expect(e2.body.reading.splits.map((s: { days: number; amount: number }) => [s.days, s.amount])).toEqual([
      [10, 133],
      [5, 67],
    ])
    expect(e2.body.waitingForNextBill).toBe(1) // the guest has no bill yet
    bill = await latest(h._id)
    expect(elecLines(bill).map((l) => l.amount)).toEqual([133])
    expect(bill.total).toBe(base + 133)

    await patch(w, id, { units: 0 }).expect(400)
    await patch(w, id, { roomId: String(w.room._id) }).expect(400) // the meter can't be changed
    await patch(w, '000000000000000000000000', { units: 5 }).expect(404)

    await del(w, id).expect(200)
    bill = await latest(h._id)
    expect(elecLines(bill)).toEqual([])
    expect(bill.total).toBe(base)
    expect(await ElectricityReading.countDocuments({})).toBe(0)
    await del(w, id).expect(404)
  })

  it('periods on one meter cannot overlap; next "from" is suggested', async () => {
    const w = await setup()
    await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, checkInDate: addDays(today, -40) })
    const meters0 = await api().get('/api/electricity').set(w.auth).query({ hostelId: String(w.hostel._id) }).expect(200)
    const m0 = meters0.body.meters.find((m: { roomNumber: string }) => m.roomNumber === '201')
    expect(m0).toMatchObject({ lastReading: null, suggestedFrom: addDays(today, -40), beds: 3 }) // first move-in (stays backfilled)
    expect(meters0.body).toMatchObject({ today, hostel: { rate: 10, basis: 'room' } })

    const first = await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -30), toDate: addDays(today, -15), units: 10 }).expect(201)
    const clash = await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -16), toDate: addDays(today, -10), units: 5 }).expect(409)
    expect(clash.body.error.message).toMatch(/overlap/)
    await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -40), toDate: addDays(today, -30), units: 5 }).expect(409)
    // another meter, same dates: fine
    await post(w, { roomId: w.room._id, fromDate: addDays(today, -30), toDate: addDays(today, -15), units: 5 }).expect(201)
    // the next period starting the day after: fine
    const second = await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -14), toDate: today, units: 5 }).expect(201)
    // editing into the other period: 409
    await patch(w, first.body.reading.id, { toDate: addDays(today, -14) }).expect(409)

    const meters = await api().get('/api/electricity').set(w.auth).query({ hostelId: String(w.hostel._id) }).expect(200)
    const m = meters.body.meters.find((x: { roomNumber: string }) => x.roomNumber === '201')
    expect(m).toMatchObject({ lastReading: { id: second.body.reading.id, fromDate: addDays(today, -14), toDate: today }, suggestedFrom: addDays(today, 1) })
    const hist = await api().get('/api/electricity/readings').set(w.auth).query({ hostelId: String(w.hostel._id), roomId: String(w.r201.room._id) }).expect(200)
    expect(hist.body.items.map((i: { id: string }) => i.id)).toEqual([second.body.reading.id, first.body.reading.id]) // newest first
  })

  it('validates the period, units and rate', async () => {
    const w = await setup()
    await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, checkInDate: addDays(today, -40) })
    const ok = { roomId: w.r201.room._id, fromDate: addDays(today, -10), toDate: today, units: 10 }
    await post(w, { ...ok, fromDate: today, toDate: addDays(today, -1) }).expect(400) // from after to
    const fut = await post(w, { ...ok, toDate: addDays(today, 1) }).expect(400)
    expect(fut.body.error.message).toMatch(/future/)
    await preview(w, { ...ok, toDate: addDays(today, 1) }).expect(400)
    await post(w, { ...ok, fromDate: addDays(today, -400) }).expect(400) // over a year
    await post(w, { ...ok, units: 0 }).expect(400)
    await post(w, { ...ok, units: -5 }).expect(400)
    await post(w, { ...ok, fromDate: '01/10/2026' }).expect(400)
    await api().post('/api/electricity/readings').set(w.auth).send({ fromDate: ok.fromDate, toDate: ok.toDate, units: 5 }).expect(400)
    await post(w, { ...ok, roomId: '000000000000000000000000' }).expect(404)

    await Hostel.updateOne({ _id: w.hostel._id }, { electricityRate: 0 })
    const noRate = await post(w, ok).expect(400)
    expect(noRate.body.error.message).toMatch(/rate/i)
    expect(await ElectricityReading.countDocuments({})).toBe(0)
  })

  it('a room nobody stayed in: reading saved with a warning, nobody billed', async () => {
    const w = await setup()
    await billAll(w)
    const r = await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -9), toDate: today, units: 7 }).expect(201)
    expect(r.body).toMatchObject({ billsUpdated: 0, waitingForNextBill: 0 })
    expect(r.body.reading).toMatchObject({ amount: 70, totalDays: 0, splits: [] })
    expect(r.body.warnings).toHaveLength(1)
    expect(r.body.warnings[0]).toContain('Room 201')
    expect(await Invoice.countDocuments({ 'items.key': 'electricity' })).toBe(0)
  })

  it('409 when a change would leave a bill below what was already paid; nothing changes', async () => {
    const w = await setup()
    const { hosteler: h } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, checkInDate: addDays(today, -20) })
    await billAll(w)
    const r = await post(w, { roomId: w.r201.room._id, fromDate: addDays(today, -9), toDate: today, units: 30 }).expect(201)
    const bill = await latest(h._id)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: String(h._id), invoiceId: String(bill._id), amount: bill.total, mode: 'cash', date: today }).expect(201)

    await del(w, r.body.reading.id).expect(409)
    await patch(w, r.body.reading.id, { units: 10 }).expect(409)
    const after = await Invoice.findById(bill._id).lean()
    expect(after!.total).toBe(bill.total)
    expect(elecLines(after)).toMatchObject([{ amount: 300 }])
    expect((await ElectricityReading.findById(r.body.reading.id).lean())!.units).toBe(30)
    // a higher reading is fine (the bill grows)
    await patch(w, r.body.reading.id, { units: 40 }).expect(200)
    expect((await Invoice.findById(bill._id).lean())!.total).toBe(bill.total + 100)
  })
})

describe('bed-metered electricity', () => {
  it('requires a bed and bills each bed’s hosteler the full amount', async () => {
    const w = await setup(8, 'bed')
    const [A, B, C] = w.r201.beds
    const { hosteler: ha } = await makeHosteler(w.org._id, w.hostel, { bed: A!, checkInDate: addDays(today, -20) })
    const { hosteler: hb } = await makeHosteler(w.org._id, w.hostel, { bed: B!, checkInDate: addDays(today, -20) })
    await billAll(w)
    const period = { roomId: w.r201.room._id, fromDate: addDays(today, -9), toDate: today }

    const no = await post(w, { ...period, units: 10 }).expect(400)
    expect(no.body.error.message).toMatch(/bed/i)
    await post(w, { ...period, bedId: null, units: 10 }).expect(400)
    await post(w, { ...period, bedId: w.beds[0]!._id, units: 10 }).expect(404) // bed from another room

    const ra = await post(w, { ...period, bedId: A!._id, units: 30 }).expect(201)
    expect(ra.body.reading).toMatchObject({ bedLabel: 'A', amount: 240, totalDays: 10 })
    await post(w, { ...period, bedId: B!._id, units: 45 }).expect(201) // same dates, other bed: no overlap
    await post(w, { ...period, bedId: A!._id, units: 1 }).expect(409)
    const rc = await post(w, { ...period, bedId: C!._id, units: 5 }).expect(201) // empty bed
    expect(rc.body.warnings[0]).toContain('Bed C')

    const la = elecLines(await latest(ha._id))
    expect(la.map((l) => l.amount)).toEqual([240])
    expect(la[0]!.label).toContain('Room 201 Bed A')
    expect(la[0]!.label).not.toContain('your')
    expect(elecLines(await latest(hb._id)).map((l) => l.amount)).toEqual([360])

    const meters = await api().get('/api/electricity').set(w.auth).query({ hostelId: String(w.hostel._id) }).expect(200)
    expect(meters.body.hostel.basis).toBe('bed')
    const rows = meters.body.meters.filter((x: { roomNumber: string }) => x.roomNumber === '201')
    expect(rows.map((x: { bedLabel: string }) => x.bedLabel)).toEqual(['A', 'B', 'C'])
    expect(rows.map((x: { lastReading: { amount: number } }) => x.lastReading.amount)).toEqual([240, 360, 40])
    expect(rows[0].occupants.map((o: { id: string }) => o.id)).toEqual([String(ha._id)])
    expect(rows[2].occupants).toEqual([])
  })
})

describe('electricity permissions', () => {
  it('warden and manager can work with readings; accountant 403; hosteler 403; other org 404', async () => {
    const w = await setup()
    const { hosteler: h1 } = await makeHosteler(w.org._id, w.hostel, { bed: w.r201.beds[0]!, checkInDate: addDays(today, -40) })
    const warden = await makeStaffUser(w.org._id, 'warden')
    const manager = await makeStaffUser(w.org._id, 'manager')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const q = { hostelId: String(w.hostel._id) }
    const p1 = { roomId: w.r201.room._id, fromDate: addDays(today, -30), toDate: addDays(today, -21), units: 10 }

    const rw = await post(w, p1, warden.auth).expect(201)
    expect(rw.body.reading.enteredByName).toBe('warden')
    await api().get('/api/electricity').set(warden.auth).query(q).expect(200)
    await patch(w, rw.body.reading.id, { units: 20 }, manager.auth).expect(200)
    await api().get('/api/electricity/readings').set(manager.auth).query(q).expect(200)

    await post(w, { ...p1, fromDate: addDays(today, -20), toDate: addDays(today, -11) }, accountant.auth).expect(403)
    await api().get('/api/electricity').set(accountant.auth).query(q).expect(403)
    await del(w, rw.body.reading.id, accountant.auth).expect(403)
    await post(w, p1, w.hostelerAuth).expect(403)
    await api().get('/api/electricity').set(w.hostelerAuth).query(q).expect(403)
    await api().post('/api/electricity/readings').send(body(p1)).expect(401)

    // other org: our hostel / room / reading are invisible
    const other = await setup()
    await api().get('/api/electricity').set(other.auth).query(q).expect(404)
    await api().get('/api/electricity/readings').set(other.auth).query(q).expect(404)
    await post(w, { ...p1, fromDate: addDays(today, -10), toDate: today }, other.auth).expect(404)
    await api().post('/api/electricity/preview').set(other.auth).send(body(p1)).expect(404)
    await patch(w, rw.body.reading.id, { units: 99 }, other.auth).expect(404)
    await del(w, rw.body.reading.id, other.auth).expect(404)

    const reading = await ElectricityReading.findById(rw.body.reading.id).lean()
    expect(reading!.units).toBe(20)
    expect(reading!.splits.map((s) => String(s.hostelerId))).toEqual([String(h1._id)])
    expect(await ElectricityReading.countDocuments({})).toBe(1)
  })
})

describe('portal', () => {
  it('the hosteler sees the electricity line on their bill', async () => {
    const w = await setup()
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: addDays(today, -15) })
    await billAll(w)
    await post(w, { roomId: w.room._id, fromDate: addDays(today, -9), toDate: today, units: 55 }).expect(201)
    const r = await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)
    const withLine = r.body.bills.filter((b: { items: { key: string }[] }) => b.items.some((i) => i.key === 'electricity'))
    expect(withLine).toHaveLength(1)
    const b = withLine[0]
    const line = b.items.find((i: { key: string }) => i.key === 'electricity')
    expect(line).toMatchObject({ amount: 550 })
    expect(line.label).toContain('Room 101')
    expect(b.total).toBe(6000 + 3000 + 550)
    expect(b.periodStart).toBe((await latest(w.hosteler._id)).periodStart)
    const inv = await api().get(`/api/portal/invoices/${b.id}`).set(w.hostelerAuth).expect(200)
    expect(inv.body.invoice.items.some((i: { key: string; amount: number }) => i.key === 'electricity' && i.amount === 550)).toBe(true)
  })
})
