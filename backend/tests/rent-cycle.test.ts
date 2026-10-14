/**
 * Rent cycles counted from each hosteler's check-in date (lib/dates.ts,
 * lib/rentCycle.ts): cycle math and generateDueBills. The generator takes an
 * explicit `today`, so these tests use fixed dates and don't depend on the clock.
 */
import { describe, expect, it } from 'vitest'
import { makeHostel, makeHosteler, makeOrg, makeRoom } from './helpers.js'
import { addDays, addMonthsAnchored, daysInclusive, overlapDays, periodLabel } from '../src/lib/dates.js'
import { cycleEnd, cycleIndexOf, cycleStart, generateDueBills } from '../src/lib/rentCycle.js'
import { saveReading, splitByWeight } from '../src/lib/electricity.js'
import { Hostel } from '../src/models/Hostel.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Invoice } from '../src/models/Invoice.js'
import { Notification } from '../src/models/Notification.js'
import { Organization } from '../src/models/Organization.js'
import { RoomStay } from '../src/models/RoomStay.js'
import { ElectricityReading } from '../src/models/ElectricityReading.js'

const lines = (inv: { items: { key?: string | null; label: string; amount: number }[] }) => inv.items.map((i) => ({ key: i.key, label: i.label, amount: i.amount }))
const billsOf = (hostelerId: unknown) => Invoice.find({ hostelerId, cancelled: false }).sort({ periodStart: 1, month: 1 }).lean()

/** Org + hostel + a 3-bed room, and a hosteler in bed A checked in on `checkInDate`. */
async function world(checkInDate: string, opts: { messOpted?: boolean } = {}) {
  const { org } = await makeOrg()
  const hostel = await makeHostel(org._id)
  const { room, beds } = await makeRoom(org._id, hostel._id, '101', 3)
  const { hosteler } = await makeHosteler(org._id, hostel, { bed: beds[0]!, checkInDate, messOpted: opts.messOpted ?? true })
  return { org, hostel, room, beds, hosteler }
}

describe('date helpers', () => {
  it('addMonthsAnchored keeps the day and clamps to the month end', () => {
    expect(addMonthsAnchored('2026-10-13', 1)).toBe('2026-11-13')
    expect(addMonthsAnchored('2026-10-13', 3)).toBe('2027-01-13')
    expect(addMonthsAnchored('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsAnchored('2028-01-31', 1)).toBe('2028-02-29') // leap year
    expect(addMonthsAnchored('2026-01-31', 2)).toBe('2026-03-31') // the anchor day comes back
    expect(addMonthsAnchored('2026-08-31', 1)).toBe('2026-09-30')
    expect(addMonthsAnchored('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonthsAnchored('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonthsAnchored('2026-10-13', 0)).toBe('2026-10-13')
  })

  it('addDays, daysInclusive, overlapDays, periodLabel', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysInclusive('2026-10-01', '2026-10-31')).toBe(31)
    expect(daysInclusive('2026-10-13', '2026-10-13')).toBe(1)
    expect(daysInclusive('2026-03-28', '2026-04-03')).toBe(7) // no DST effects
    expect(overlapDays('2026-09-20', null, '2026-10-01', '2026-10-31')).toBe(31) // open stay
    expect(overlapDays('2026-10-11', null, '2026-10-01', '2026-10-31')).toBe(21)
    expect(overlapDays('2026-09-01', '2026-10-05', '2026-10-01', '2026-10-31')).toBe(5)
    expect(overlapDays('2026-09-01', '2026-09-30', '2026-10-01', '2026-10-31')).toBe(0)
    expect(overlapDays('2026-11-01', null, '2026-10-01', '2026-10-31')).toBe(0)
    expect(periodLabel('2026-10-13', '2026-11-12')).toBe('13 Oct – 12 Nov 2026')
    expect(periodLabel('2026-12-13', '2027-01-12')).toBe('13 Dec 2026 – 12 Jan 2027')
  })

  it('splitByWeight: proportional whole rupees that add up exactly', () => {
    expect(splitByWeight(1000, [31, 21])).toEqual([596, 404]) // the owner's example
    expect(splitByWeight(1000, [10, 10])).toEqual([500, 500])
    expect(splitByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]) // tie -> earlier entry
    expect(splitByWeight(500, [0, 5])).toEqual([0, 500])
    expect(splitByWeight(500, [0, 0])).toEqual([0, 0])
    expect(splitByWeight(0, [3, 4])).toEqual([0, 0])
    expect(splitByWeight(500, [])).toEqual([])
    for (const [amt, ws] of [
      [9999, [3, 7, 11, 13]],
      [1, [5, 5]],
      [123457, [30, 1, 15, 29]],
    ] as const) {
      const parts = splitByWeight(amt, [...ws])
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amt)
      const total = ws.reduce((a, b) => a + b, 0)
      parts.forEach((p, i) => expect(Math.abs(p - (amt * ws[i]!) / total)).toBeLessThan(1))
    }
  })
})

describe('rent cycle math', () => {
  it('cycles run from the check-in date', () => {
    expect([cycleStart('2026-10-13', 0), cycleEnd('2026-10-13', 0)]).toEqual(['2026-10-13', '2026-11-12'])
    expect([cycleStart('2026-10-13', 1), cycleEnd('2026-10-13', 1)]).toEqual(['2026-11-13', '2026-12-12'])
    expect([cycleStart('2026-10-13', 3), cycleEnd('2026-10-13', 3)]).toEqual(['2027-01-13', '2027-02-12'])
    expect([cycleStart('2026-10-01', 0), cycleEnd('2026-10-01', 0)]).toEqual(['2026-10-01', '2026-10-31'])
  })

  it('month-end check-ins are clamped and keep their anchor', () => {
    const ci = '2026-01-31'
    expect([cycleStart(ci, 0), cycleEnd(ci, 0)]).toEqual(['2026-01-31', '2026-02-27'])
    expect([cycleStart(ci, 1), cycleEnd(ci, 1)]).toEqual(['2026-02-28', '2026-03-30'])
    expect([cycleStart(ci, 2), cycleEnd(ci, 2)]).toEqual(['2026-03-31', '2026-04-29'])
    expect([cycleStart(ci, 3), cycleEnd(ci, 3)]).toEqual(['2026-04-30', '2026-05-30'])
    // cycles tile the calendar with no gaps or overlaps
    for (let k = 0; k < 24; k++) expect(addDays(cycleEnd(ci, k), 1)).toBe(cycleStart(ci, k + 1))
  })

  it('cycleIndexOf', () => {
    const ci = '2026-10-13'
    expect(cycleIndexOf(ci, '2026-09-01')).toBe(0) // before check-in
    expect(cycleIndexOf(ci, '2026-10-13')).toBe(0)
    expect(cycleIndexOf(ci, '2026-11-12')).toBe(0)
    expect(cycleIndexOf(ci, '2026-11-13')).toBe(1)
    expect(cycleIndexOf(ci, '2027-10-12')).toBe(11)
    expect(cycleIndexOf(ci, '2027-10-13')).toBe(12)
    expect(cycleIndexOf('2026-01-31', '2026-02-27')).toBe(0)
    expect(cycleIndexOf('2026-01-31', '2026-02-28')).toBe(1)
    expect(cycleIndexOf('2026-01-31', '2026-03-30')).toBe(1)
    expect(cycleIndexOf('2026-01-31', '2026-03-31')).toBe(2)
  })
})

describe('generateDueBills', () => {
  it('creates one bill per started cycle (rent + mess, period labels, due = start + rentDueDay) and is idempotent', async () => {
    const w = await world('2026-08-13')
    const r = await generateDueBills(w.org._id, { today: '2026-10-14' })
    expect(r).toMatchObject({ created: 3, hostelers: 1, skipped: 0, errors: [] })
    const bills = await billsOf(w.hosteler._id)
    expect(bills.map((b) => [b.periodStart, b.periodEnd, b.month, b.dueDate])).toEqual([
      ['2026-08-13', '2026-09-12', '2026-08', '2026-08-18'],
      ['2026-09-13', '2026-10-12', '2026-09', '2026-09-18'],
      ['2026-10-13', '2026-11-12', '2026-10', '2026-10-18'],
    ])
    expect(lines(bills[2]!)).toEqual([
      { key: 'rent', label: 'Room rent (13 Oct – 12 Nov 2026)', amount: 6000 },
      { key: 'mess', label: 'Mess fees (13 Oct – 12 Nov 2026)', amount: 3000 }, // org fallback mess charge
    ])
    expect(bills[2]!.total).toBe(9000)
    expect(new Set(bills.map((b) => b.number)).size).toBe(3)

    // same day again / until the next cycle starts: nothing new
    expect(await generateDueBills(w.org._id, { today: '2026-10-14' })).toMatchObject({ created: 0, hostelers: 1, skipped: 1 })
    expect((await generateDueBills(w.org._id, { today: '2026-11-12' })).created).toBe(0)
    // the bill is created on the first day of the cycle
    expect((await generateDueBills(w.org._id, { today: '2026-11-13' })).created).toBe(1)
    expect((await billsOf(w.hosteler._id)).at(-1)).toMatchObject({ periodStart: '2026-11-13', periodEnd: '2026-12-12', dueDate: '2026-11-18' })
  })

  it('a check-in today gets only the current cycle; a hosteler checking in after "today" gets nothing yet', async () => {
    const w = await world('2026-10-14')
    const { hosteler: later } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, checkInDate: '2026-10-20', name: 'Later' })
    expect((await generateDueBills(w.org._id, { today: '2026-10-14' })).created).toBe(1)
    expect(await Invoice.countDocuments({ hostelerId: later._id })).toBe(0)
    expect((await generateDueBills(w.org._id, { today: '2026-10-20' })).created).toBe(1)
    expect((await billsOf(later._id))[0]).toMatchObject({ periodStart: '2026-10-20', periodEnd: '2026-11-19' })
  })

  it('month-end anchor: 31 Jan check-in is billed 28 Feb, then 31 Mar', async () => {
    const w = await world('2026-01-31')
    await generateDueBills(w.org._id, { today: '2026-04-29' })
    expect((await billsOf(w.hosteler._id)).map((b) => [b.periodStart, b.periodEnd])).toEqual([
      ['2026-01-31', '2026-02-27'],
      ['2026-02-28', '2026-03-30'],
      ['2026-03-31', '2026-04-29'],
    ])
  })

  it('uses settings.rentDueDay (0 = due on the first day of the cycle) and the hostel mess charge', async () => {
    const w = await world('2026-09-10')
    await Organization.updateOne({ _id: w.org._id }, { 'settings.rentDueDay': 0 })
    await Hostel.updateOne({ _id: w.hostel._id }, { charges: { mess: 2500, electricity: 400, internet: 300 } })
    await generateDueBills(w.org._id, { today: '2026-09-10' })
    const [b] = await billsOf(w.hosteler._id)
    expect(b!.dueDate).toBe('2026-09-10')
    expect(lines(b!).map((l) => [l.key, l.amount])).toEqual([
      ['rent', 6000],
      ['mess', 2500], // hostel charge wins; fixed electricity / internet are not billed
    ])
    await Organization.updateOne({ _id: w.org._id }, { 'settings.rentDueDay': 10 })
    await generateDueBills(w.org._id, { today: '2026-10-10' })
    expect((await billsOf(w.hosteler._id))[1]!.dueDate).toBe('2026-10-20')
  })

  it('skips checked-out and reserved hostelers; respects hostelId', async () => {
    const w = await world('2026-09-01')
    await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, checkInDate: '2026-09-01', name: 'Gone' }).then(({ hosteler }) =>
      Hosteler.updateOne({ _id: hosteler._id }, { status: 'checked_out', checkOutDate: '2026-09-20' }),
    )
    await makeHosteler(w.org._id, w.hostel, { bed: w.beds[2]!, checkInDate: '2026-09-01', name: 'Reserved' }).then(({ hosteler }) =>
      Hosteler.updateOne({ _id: hosteler._id }, { status: 'reserved' }),
    )
    const other = await makeHostel(w.org._id, 'Other')
    const { hosteler: elsewhere } = await makeHosteler(w.org._id, other, { checkInDate: '2026-09-01', name: 'Elsewhere', messOpted: false })

    const r = await generateDueBills(w.org._id, { today: '2026-09-15', hostelId: w.hostel._id })
    expect(r).toMatchObject({ created: 1, hostelers: 1 })
    expect(await Invoice.countDocuments({ orgId: w.org._id })).toBe(1)
    expect((await generateDueBills(w.org._id, { today: '2026-09-15' })).created).toBe(1)
    expect(lines((await billsOf(elsewhere._id))[0]!).map((l) => l.key)).toEqual(['rent'])
  })

  it('billFromCycle = 1 skips the check-in cycle', async () => {
    const w = await world('2026-09-05')
    await Hosteler.updateOne({ _id: w.hosteler._id }, { billFromCycle: 1 })
    expect((await generateDueBills(w.org._id, { today: '2026-10-04' })).created).toBe(0)
    expect((await generateDueBills(w.org._id, { today: '2026-10-05' })).created).toBe(1)
    expect((await billsOf(w.hosteler._id)).map((b) => b.periodStart)).toEqual(['2026-10-05'])
  })

  it('older calendar-month bills (no period) count as cycles; custom and cancelled bills do not', async () => {
    const w = await world('2026-09-13')
    const legacy = (number: string, month: string, dueDate: string, extra: Record<string, unknown> = {}) =>
      Invoice.create({
        orgId: w.org._id,
        hostelId: w.hostel._id,
        hostelerId: w.hosteler._id,
        number,
        month,
        items: [{ key: 'rent', label: 'Room rent', amount: 6000 }],
        total: 6000,
        dueDate,
        ...extra,
      })
    await legacy('OLD-SEP', '2026-09', '2026-09-13') // first bill at check-in
    await legacy('OLD-OCT', '2026-10', '2026-10-05') // calendar October bill
    await legacy('OLD-NOV-X', '2026-11', '2026-11-05', { cancelled: true }) // cancelled: doesn't count
    await legacy('CUSTOM', '2026-11', '2026-11-20', { items: [{ key: 'other', label: 'Broken chair', amount: 500 }], total: 500 }) // not rent

    expect((await generateDueBills(w.org._id, { today: '2026-11-12' })).created).toBe(0) // Sep + Oct cycles are paid for
    expect((await generateDueBills(w.org._id, { today: '2026-11-13' })).created).toBe(1)
    const fresh = await Invoice.find({ hostelerId: w.hosteler._id, periodStart: { $ne: null } }).lean()
    expect(fresh.map((b) => b.periodStart)).toEqual(['2026-11-13'])
  })

  it('a pending deposit and waiting electricity shares land on the next bill created (once)', async () => {
    const w = await world('2026-09-01')
    await Hostel.updateOne({ _id: w.hostel._id }, { electricityRate: 10 })
    await Hosteler.updateOne({ _id: w.hosteler._id }, { depositToBill: 4000 })
    await RoomStay.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, roomId: w.room._id, bedId: w.beds[0]!._id, from: '2026-09-01', to: null })
    // reading saved before any bill exists -> waits for the next bill
    const saved = await saveReading(w.org._id, null, { roomId: String(w.room._id), fromDate: '2026-09-01', toDate: '2026-09-30', units: 25 }, 'Owner')
    expect(saved).toMatchObject({ billsUpdated: 0, waitingForNextBill: 1 })

    await generateDueBills(w.org._id, { today: '2026-10-01' })
    const [sep, oct] = await billsOf(w.hosteler._id)
    expect(lines(sep!)).toEqual([
      { key: 'rent', label: 'Room rent (1 Sept – 30 Sept 2026)', amount: 6000 },
      { key: 'mess', label: 'Mess fees (1 Sept – 30 Sept 2026)', amount: 3000 },
      { key: 'deposit', label: 'Security deposit', amount: 4000 },
      { key: 'electricity', label: expect.stringContaining('Electricity – Room 101'), amount: 250 },
    ])
    expect(sep!.items.at(-1)!.ref).toBe(String(saved.reading._id))
    expect(sep!.total).toBe(13_250)
    expect(oct!.items.map((i) => i.key)).toEqual(['rent', 'mess'])
    expect((await Hosteler.findById(w.hosteler._id).lean())!.depositToBill).toBe(0)
    const reading = await ElectricityReading.findById(saved.reading._id).lean()
    expect(String(reading!.splits[0]!.invoiceId)).toBe(String(sep!._id))

    await generateDueBills(w.org._id, { today: '2026-11-01' })
    expect((await billsOf(w.hosteler._id))[2]!.items.map((i) => i.key)).toEqual(['rent', 'mess'])
  })

  it('notifies each new bill (bill_generated) unless notify is false', async () => {
    const w = await world('2026-09-01')
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, checkInDate: '2026-10-01', name: 'Kabir', messOpted: false, monthlyRent: 5500 })
    await generateDueBills(w.org._id, { today: '2026-10-01' })
    await generateDueBills(w.org._id, { today: '2026-10-02' }) // nothing new
    const notes = await Notification.find({ orgId: w.org._id }).sort({ createdAt: 1 }).lean()
    expect(notes).toHaveLength(3) // 2 cycles for the first hosteler, 1 for Kabir
    expect(notes.every((n) => n.type === 'bill_generated' && n.recipientKind === 'hosteler' && n.link === '/portal/fees')).toBe(true)
    const kabir = notes.find((n) => String(n.recipientId) === String(h2._id))!
    const inv = (await billsOf(h2._id))[0]!
    expect(kabir.title).toBe('New bill: ₹5,500')
    expect(kabir.body).toContain(inv.number)
    expect(kabir.body).toContain('1 Oct – 31 Oct 2026')
    expect(kabir.body).toContain(inv.dueDate)

    await generateDueBills(w.org._id, { today: '2026-11-01', notify: false })
    expect(await Invoice.countDocuments({ orgId: w.org._id })).toBe(5)
    expect(await Notification.countDocuments({ orgId: w.org._id })).toBe(3)
  })

  it('concurrent runs never double-bill a cycle', async () => {
    const w = await world('2026-08-01')
    await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, checkInDate: '2026-09-15', name: 'Second' })
    const rs = await Promise.all(Array.from({ length: 4 }, () => generateDueBills(w.org._id, { today: '2026-10-14' })))
    for (const r of rs) expect(r.errors).toEqual([])
    expect(rs.reduce((a, r) => a + r.created, 0)).toBe(3 + 1)
    expect(await Invoice.countDocuments({ orgId: w.org._id })).toBe(4)
  })
})
