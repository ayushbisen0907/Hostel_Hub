import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { api, makeHostel, makeHosteler, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Hostel } from '../src/models/Hostel.js'
import { Invoice } from '../src/models/Invoice.js'
import { Payment } from '../src/models/Payment.js'
import { Activity, Complaint, Expense, Leave } from '../src/models/Operations.js'
import { lastMonths } from '../src/modules/dashboard/routes.js'

type Id = mongoose.Types.ObjectId
const daysFromNow = (n: number) => todayStr(new Date(Date.now() + n * 86_400_000))
let seq = 0

async function invoice(orgId: Id, hostelId: Id, hostelerId: Id, month: string, total: number, paidAmount: number, dueDate: string, cancelled = false) {
  return Invoice.create({ orgId, hostelId, hostelerId, number: `INV-${++seq}`, month, items: [{ label: 'Rent', amount: total }], total, paidAmount, dueDate, cancelled })
}
async function payment(orgId: Id, hostelId: Id, hostelerId: Id, kind: 'rent' | 'deposit' | 'advance', amount: number, date: string, invoiceId: Id | null = null) {
  return Payment.create({ orgId, hostelId, hostelerId, invoiceId, kind, amount, date, mode: 'cash', receiptNo: `R-${++seq}` })
}

/** World with money: this month 6000 billed / 4000 paid, last month 6000 billed fully paid, a deposit, expenses. */
async function moneyWorld(plan: 'free' | 'basic' | 'pro' = 'pro') {
  const w = await makeWorld({ plan })
  const [prev, cur] = lastMonths(2)
  const o = w.org._id
  const h = w.hostel._id
  const hid = w.hosteler._id
  const i1 = await invoice(o, h, hid, cur!, 6000, 4000, daysFromNow(5))
  const i2 = await invoice(o, h, hid, prev!, 6000, 6000, `${prev}-05`)
  await invoice(o, h, hid, cur!, 999, 0, daysFromNow(5), true) // cancelled: ignored
  await payment(o, h, hid, 'rent', 4000, todayStr(), i1._id)
  await payment(o, h, hid, 'rent', 6000, `${prev}-04`, i2._id)
  await payment(o, h, hid, 'deposit', 5000, todayStr())
  await Expense.create({ orgId: o, hostelId: h, category: 'electricity', amount: 1500, date: todayStr() })
  await Expense.create({ orgId: o, hostelId: h, category: 'salary', amount: 3000, date: `${prev}-10` })
  return { ...w, prev: prev!, cur: cur! }
}

describe('dashboard', () => {
  it('summarizes occupancy, money, lists and the 6-month chart', async () => {
    const w = await moneyWorld()
    const o = w.org._id
    const hostel = (await Hostel.findById(w.hostel._id))!
    const { hosteler: leaving } = await makeHosteler(o, hostel, { name: 'Leaving Soon' })
    await Hosteler.updateOne({ _id: leaving._id }, { expectedCheckOut: daysFromNow(10) })
    const { hosteler: later } = await makeHosteler(o, (await Hostel.findById(w.hostel._id))!, { name: 'Leaving Later' })
    await Hosteler.updateOne({ _id: later._id }, { expectedCheckOut: daysFromNow(60) })
    const { hosteler: res } = await makeHosteler(o, (await Hostel.findById(w.hostel._id))!, { name: 'Reserved One' })
    await Hosteler.updateOne({ _id: res._id }, { status: 'reserved', checkInDate: daysFromNow(3) })
    await Complaint.create({ orgId: o, hostelId: w.hostel._id, category: 'plumbing', title: 'Leak' })
    await Complaint.create({ orgId: o, hostelId: w.hostel._id, category: 'plumbing', title: 'Fixed', status: 'resolved' })
    await Leave.create({ orgId: o, hostelId: w.hostel._id, hostelerId: w.hosteler._id, from: daysFromNow(1), to: daysFromNow(2), reason: 'Home' })
    await Activity.create({ orgId: o, hostelId: w.hostel._id, message: 'Something happened' })

    const warden = await makeStaffUser(o, 'warden')
    const r = await api().get('/api/dashboard').set(warden.auth).expect(200)
    const d = r.body
    expect(d.occupancy).toEqual({ total: 2, occupied: 1, vacant: 1, rate: 50 })
    expect(d.hostelers).toEqual({ active: 3, reserved: 1 })
    expect(d.thisMonth).toMatchObject({ month: w.cur, billed: 6000, collected: 4000, outstanding: 2000 })
    expect(d.totalDues).toBe(2000)
    expect(d.openComplaints).toBe(1)
    expect(d.pendingLeaves.count).toBe(1)
    expect(d.pendingLeaves.items[0].hostelerName).toBe(w.hosteler.name)
    expect(d.upcomingCheckIns.map((h: { name: string }) => h.name)).toEqual(['Reserved One'])
    expect(d.expectedCheckOuts.map((h: { name: string }) => h.name)).toEqual(['Leaving Soon'])
    expect(d.topDues).toEqual([expect.objectContaining({ id: String(w.hosteler._id), dues: 2000 })])
    expect(d.recentActivity[0].message).toBe('Something happened')
    expect(d.last6Months).toHaveLength(6)
    expect(d.last6Months[5]).toEqual({ month: w.cur, collected: 4000, expenses: 1500 })
    expect(d.last6Months[4]).toEqual({ month: w.prev, collected: 6000, expenses: 3000 })
  })

  it('scopes by hostel and isolates organizations', async () => {
    const w = await moneyWorld()
    const second = await makeHostel(w.org._id, 'Second Hostel')
    await makeRoom(w.org._id, second._id, '1', 3)
    const s = await api().get('/api/dashboard').query({ hostelId: String(second._id) }).set(w.auth).expect(200)
    expect(s.body.occupancy).toEqual({ total: 3, occupied: 0, vacant: 3, rate: 0 })
    expect(s.body.thisMonth.billed).toBe(0)
    expect(s.body.hostelers.active).toBe(0)

    const other = await makeOrg()
    const o = await api().get('/api/dashboard').set(other.auth).expect(200)
    expect(o.body.occupancy.total).toBe(0)
    expect(o.body.totalDues).toBe(0)
    expect(o.body.topDues).toEqual([])
    // another org's hostel id yields nothing
    const x = await api().get('/api/dashboard').query({ hostelId: String(w.hostel._id) }).set(other.auth).expect(200)
    expect(x.body.thisMonth.billed).toBe(0)
    await api().get('/api/dashboard').expect(401)
  })
})

describe('reports', () => {
  it('P&L excludes deposits and groups expenses by category', async () => {
    const w = await moneyWorld()
    const r = await api().get('/api/reports/pnl?months=3').set(w.auth).expect(200)
    expect(r.body.months).toHaveLength(3)
    expect(r.body.months[2]).toEqual({ month: w.cur, income: 4000, expenses: 1500, net: 2500, deposits: 5000 })
    expect(r.body.months[1]).toEqual({ month: w.prev, income: 6000, expenses: 3000, net: 3000, deposits: 0 })
    expect(r.body.totals).toEqual({ income: 10000, expenses: 4500, deposits: 5000, net: 5500 })
    expect(r.body.byCategory).toEqual([
      { category: 'salary', amount: 3000, count: 1 },
      { category: 'electricity', amount: 1500, count: 1 },
    ])
    await api().get('/api/reports/pnl?months=0').set(w.auth).expect(400)
    await api().get('/api/reports/pnl?months=abc').set(w.auth).expect(400)
  })

  it('collection: billed vs collected per month', async () => {
    const w = await moneyWorld()
    const r = await api().get('/api/reports/collection?months=2').set(w.auth).expect(200)
    expect(r.body.months).toEqual([
      { month: w.prev, invoices: 1, billed: 6000, collected: 6000, pending: 0, rate: 100 },
      { month: w.cur, invoices: 1, billed: 6000, collected: 4000, pending: 2000, rate: 67 },
    ])
    expect(r.body.totals).toEqual({ invoices: 2, billed: 12000, collected: 10000, pending: 2000, rate: 83 })
  })

  it('occupancy per hostel, room type and sharing', async () => {
    const w = await makeWorld()
    const { room } = await makeRoom(w.org._id, w.hostel._id, '102', 3, 9000)
    await room.updateOne({ type: 'ac' })
    const r = await api().get('/api/reports/occupancy').set(w.auth).expect(200)
    expect(r.body.total).toEqual({ total: 5, occupied: 1, vacant: 4, rate: 20 })
    expect(r.body.byHostel).toEqual([expect.objectContaining({ name: w.hostel.name, rooms: 2, beds: 5, occupied: 1, rate: 20 })])
    expect(r.body.byRoomType).toEqual([
      expect.objectContaining({ type: 'ac', rooms: 1, beds: 3, occupied: 0, avgRent: 9000 }),
      expect.objectContaining({ type: 'non-ac', rooms: 1, beds: 2, occupied: 1, rate: 50 }),
    ])
    expect(r.body.bySharing.map((s: { sharing: number }) => s.sharing)).toEqual([2, 3])
  })

  it('dues aging buckets with per-hosteler detail', async () => {
    const w = await makeWorld()
    const o = w.org._id
    const h = w.hostel._id
    const hid = w.hosteler._id
    await invoice(o, h, hid, '2026-01', 1000, 0, daysFromNow(3)) // not due
    await invoice(o, h, hid, '2026-02', 2000, 500, daysFromNow(-10)) // 1-30 -> 1500
    await invoice(o, h, hid, '2026-03', 3000, 0, daysFromNow(-45)) // 31-60
    await invoice(o, h, hid, '2026-04', 4000, 0, daysFromNow(-90)) // 60+
    await invoice(o, h, hid, '2026-05', 4000, 4000, daysFromNow(-90)) // paid
    await invoice(o, h, hid, '2026-06', 4000, 0, daysFromNow(-90), true) // cancelled
    const r = await api().get('/api/reports/dues-aging').set(w.auth).expect(200)
    expect(r.body.totalDues).toBe(1000 + 1500 + 3000 + 4000)
    expect(r.body.buckets.map((b: { key: string; amount: number; count: number }) => [b.key, b.amount, b.count])).toEqual([
      ['notdue', 1000, 1],
      ['1-30', 1500, 1],
      ['31-60', 3000, 1],
      ['60+', 4000, 1],
    ])
    expect(r.body.invoices[0]).toMatchObject({ daysOverdue: 90, bucket: '60+', balance: 4000 })
    expect(r.body.hostelers).toEqual([
      expect.objectContaining({ total: 9500, oldestDays: 90, buckets: { notdue: 1000, '1-30': 1500, '31-60': 3000, '60+': 4000 } }),
    ])
    expect(r.body.hostelers[0].hosteler.name).toBe(w.hosteler.name)
  })

  it('requires the Pro plan and the reports role; isolates organizations', async () => {
    const basic = await moneyWorld('basic')
    const r = await api().get('/api/reports/pnl').set(basic.auth).expect(402)
    expect(r.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')

    const w = await moneyWorld()
    const warden = await makeStaffUser(w.org._id, 'warden')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/reports/collection').set(warden.auth).expect(403)
    await api().get('/api/reports/collection').set(accountant.auth).expect(200)

    const other = await makeOrg()
    expect((await api().get('/api/reports/pnl').set(other.auth).expect(200)).body.totals.income).toBe(0)
    expect((await api().get('/api/reports/collection').set(other.auth).expect(200)).body.totals.billed).toBe(0)
    expect((await api().get('/api/reports/occupancy').set(other.auth).expect(200)).body.byHostel).toEqual([])
    expect((await api().get('/api/reports/dues-aging').set(other.auth).expect(200)).body.invoices).toEqual([])
    const scoped = await api().get('/api/reports/occupancy').query({ hostelId: String(w.hostel._id) }).set(other.auth).expect(200)
    expect(scoped.body.byHostel).toEqual([])
  })
})
