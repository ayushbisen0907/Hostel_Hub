/**
 * Check-out settlement rules: dues must be cleared first (409 DUES_PENDING),
 * adjusting from a refundable deposit, the minimum stay for a deposit refund
 * (forfeiture), and GET /api/hostelers/:id/check-out-preview.
 */
import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { api, makeHosteler, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { Hostel } from '../src/models/Hostel.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Invoice } from '../src/models/Invoice.js'
import { Payment } from '../src/models/Payment.js'
import { Bed } from '../src/models/Bed.js'
import { todayStr } from '../src/lib/http.js'
import { addDays, addMonthsAnchored } from '../src/lib/dates.js'
import { cycleStart } from '../src/lib/rentCycle.js'

const today = todayStr()
type World = Awaited<ReturnType<typeof makeWorld>>
type Id = mongoose.Types.ObjectId

let seq = 0
async function bill(w: World, hostelerId: Id, total: number, dueDate = addDays(today, -3)) {
  seq++
  return Invoice.create({
    orgId: w.org._id,
    hostelId: w.hostel._id,
    hostelerId,
    number: `T-${seq}-${Math.floor(Math.random() * 1e6)}`,
    month: dueDate.slice(0, 7),
    items: [{ key: 'rent', label: 'Rent', amount: total }],
    total,
    dueDate,
  })
}

const pay = (w: World, hostelerId: Id, invoiceId: Id, amount: number) =>
  api().post('/api/payments').set(w.auth).send({ hostelerId: String(hostelerId), invoiceId: String(invoiceId), amount, mode: 'cash' }).expect(201)

const depositPaid = (w: World, hostelerId: Id, amount = 5000) =>
  api().post('/api/payments').set(w.auth).send({ hostelerId: String(hostelerId), amount, mode: 'cash', kind: 'deposit' }).expect(201)

const checkOut = (w: World, id: Id, body: Record<string, unknown> = {}) =>
  api().post(`/api/hostelers/${id}/check-out`).set(w.auth).send({ date: today, ...body })

/** World whose hosteler checked in `months` rent cycles ago, with the hostel's minimum stay set. */
async function worldStayed(months: number, minStay: number) {
  const w = await makeWorld()
  await Hostel.updateOne({ _id: w.hostel._id }, { depositMinStayMonths: minStay })
  await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: addMonthsAnchored(today, -months) })
  return w
}

describe('check-out is blocked while dues remain', () => {
  it('409 DUES_PENDING with the amount; allowed after the dues are paid', async () => {
    const w = await makeWorld()
    await depositPaid(w, w.hosteler._id, 2000)
    const inv = await bill(w, w.hosteler._id, 6000)

    const r = await checkOut(w, w.hosteler._id).expect(409)
    expect(r.body.error.code).toBe('DUES_PENDING')
    expect(r.body.error.message).toContain('₹4,000') // 6000 dues − 2000 deposit adjusted
    expect(r.body.error.details).toMatchObject({ toCollect: 4000, remainingDues: 4000, depositForfeited: false })
    expect(r.body.error.details.unpaidBills).toHaveLength(1)
    expect(r.body.error.details.unpaidBills[0]).toMatchObject({ number: inv.number, balance: 6000, adjustFromDeposit: 2000, remaining: 4000 })
    // nothing was saved: no adjustment payment, still active, bed still taken
    expect(await Payment.countDocuments({ hostelerId: w.hosteler._id, note: 'Adjusted from security deposit' })).toBe(0)
    expect((await Hosteler.findById(w.hosteler._id))!.status).toBe('active')
    expect(String((await Bed.findById(w.beds[0]!._id))!.hostelerId)).toBe(String(w.hosteler._id))

    await pay(w, w.hosteler._id, inv._id, 4000)
    const ok = await checkOut(w, w.hosteler._id).expect(200)
    expect(ok.body.settlement).toMatchObject({ held: 2000, dues: 2000, adjusted: 2000, remainingDues: 0, toCollect: 0, refund: 0, depositForfeited: false })
    expect((await Invoice.findById(inv._id))!.paidAmount).toBe(6000)
    expect(ok.body.hosteler.status).toBe('checked_out')
    expect(ok.body.hosteler.bedId).toBeNull()
    // portal account closed
    await api().post('/api/portal/auth/login').send({ loginId: w.hosteler.loginId, password: w.hostelerPassword }).expect(401)
  })

  it('without adjusting from the deposit every bill must be paid', async () => {
    const w = await makeWorld()
    await depositPaid(w, w.hosteler._id, 5000)
    const inv = await bill(w, w.hosteler._id, 3000)
    const r = await checkOut(w, w.hosteler._id, { adjustDuesFromDeposit: false }).expect(409)
    expect(r.body.error.details.toCollect).toBe(3000)
    expect(r.body.error.message).toContain('not adjusted from the deposit')

    await pay(w, w.hosteler._id, inv._id, 3000)
    const ok = await checkOut(w, w.hosteler._id, { adjustDuesFromDeposit: false }).expect(200)
    expect(ok.body.settlement).toMatchObject({ held: 5000, dues: 0, adjusted: 0, refund: 5000, toCollect: 0 })
    expect(ok.body.hosteler.depositRefunded).toBe(5000)
  })

  it('a refundable deposit that covers the dues clears them (oldest bill first) and refunds the rest', async () => {
    const w = await makeWorld()
    await depositPaid(w, w.hosteler._id, 5000)
    const older = await bill(w, w.hosteler._id, 1500, addDays(today, -40))
    const newer = await bill(w, w.hosteler._id, 2000, addDays(today, -10))
    const r = await checkOut(w, w.hosteler._id, { deductions: [{ label: 'Cleaning', amount: 300 }] }).expect(200)
    expect(r.body.settlement).toMatchObject({ held: 5000, dues: 3500, adjusted: 3500, totalDeductions: 300, refund: 1200, toCollect: 0 })
    expect((await Invoice.findById(older._id))!.paidAmount).toBe(1500)
    expect((await Invoice.findById(newer._id))!.paidAmount).toBe(2000)
    const adj = await Payment.find({ hostelerId: w.hosteler._id, note: 'Adjusted from security deposit' }).sort({ createdAt: 1 }).lean()
    expect(adj.map((p) => p.amount)).toEqual([1500, 2000])
  })

  it('deductions larger than the deposit left also block', async () => {
    const w = await makeWorld()
    await depositPaid(w, w.hosteler._id, 1000)
    const r = await checkOut(w, w.hosteler._id, { deductions: [{ label: 'Broken window', amount: 1600 }] }).expect(409)
    expect(r.body.error.code).toBe('DUES_PENDING')
    expect(r.body.error.details.toCollect).toBe(600)
    expect(r.body.error.message).toContain('Deductions')
    await checkOut(w, w.hosteler._id, { deductions: [{ label: 'Broken window', amount: 1000 }] }).expect(200)
  })

  it('cancelled bills do not count as dues', async () => {
    const w = await makeWorld()
    const inv = await bill(w, w.hosteler._id, 9000)
    await Invoice.updateOne({ _id: inv._id }, { cancelled: true })
    const r = await checkOut(w, w.hosteler._id).expect(200)
    expect(r.body.settlement.dues).toBe(0)
  })
})

describe('minimum stay for a deposit refund', () => {
  it('stayed 2 of 6 months: deposit forfeited, not adjusted, dues must be paid separately', async () => {
    const w = await worldStayed(2, 6)
    await depositPaid(w, w.hosteler._id, 5000)
    const inv = await bill(w, w.hosteler._id, 3000)

    const r = await checkOut(w, w.hosteler._id).expect(409)
    expect(r.body.error.code).toBe('DUES_PENDING')
    expect(r.body.error.details).toMatchObject({ toCollect: 3000, depositForfeited: true })
    expect(r.body.error.message).toContain('forfeited')

    await pay(w, w.hosteler._id, inv._id, 3000)
    const ok = await checkOut(w, w.hosteler._id).expect(200)
    const s = ok.body.settlement
    expect(s).toMatchObject({ held: 5000, dues: 0, adjusted: 0, refund: 0, toCollect: 0, depositForfeited: true, monthsStayed: 2, minStayMonths: 6 })
    expect(s.forfeitReason).toContain('2 of the 6 months')
    expect(ok.body.hosteler.depositRefunded).toBe(0)
    expect(ok.body.hosteler.notes).toContain('forfeited')
    expect(await Payment.countDocuments({ hostelerId: w.hosteler._id, note: 'Adjusted from security deposit' })).toBe(0)
  })

  it('forfeited deposit with no dues: check-out allowed, refund 0', async () => {
    const w = await worldStayed(0, 1)
    await depositPaid(w, w.hosteler._id, 4000)
    const r = await checkOut(w, w.hosteler._id).expect(200)
    expect(r.body.settlement).toMatchObject({ held: 4000, refund: 0, depositForfeited: true, monthsStayed: 0, minStayMonths: 1 })
  })

  it('stayed 6 of 6 months: refundable again (adjusts dues, refunds the rest)', async () => {
    const w = await worldStayed(6, 6)
    await depositPaid(w, w.hosteler._id, 5000)
    await bill(w, w.hosteler._id, 3000)
    const r = await checkOut(w, w.hosteler._id).expect(200)
    expect(r.body.settlement).toMatchObject({
      held: 5000,
      dues: 3000,
      adjusted: 3000,
      refund: 2000,
      depositForfeited: false,
      forfeitReason: null,
      monthsStayed: 6,
      minStayMonths: 6,
    })
  })

  it('depositMinStayMonths 0 = always refundable', async () => {
    const w = await worldStayed(0, 0)
    await depositPaid(w, w.hosteler._id, 5000)
    const r = await checkOut(w, w.hosteler._id).expect(200)
    expect(r.body.settlement).toMatchObject({ refund: 5000, depositForfeited: false, minStayMonths: 0 })
  })
})

describe('GET /api/hostelers/:id/check-out-preview', () => {
  it('shows held, dues, unpaid bills, forfeiture and what blocks check-out without saving', async () => {
    const w = await worldStayed(2, 6)
    await depositPaid(w, w.hosteler._id, 5000)
    const inv = await bill(w, w.hosteler._id, 6000)
    const before = await Payment.countDocuments({ hostelerId: w.hosteler._id })

    const r = await api().get(`/api/hostelers/${w.hosteler._id}/check-out-preview`).set(w.auth).expect(200)
    expect(r.body).toMatchObject({
      hostelerId: String(w.hosteler._id),
      checkOut: today,
      held: 5000,
      dues: 6000,
      adjusted: 0,
      remainingDues: 6000,
      deductions: [],
      totalDeductions: 0,
      refund: 0,
      toCollect: 6000,
      depositForfeited: true,
      monthsStayed: 2,
      minStayMonths: 6,
      canCheckOut: false,
      bed: 'Room 101-A',
      moveOutRequest: null,
    })
    expect(r.body.adjustments).toBeUndefined()
    expect(r.body.unpaidBills).toEqual([expect.objectContaining({ id: String(inv._id), number: inv.number, balance: 6000, remaining: 6000 })])
    expect(r.body.blockers).toHaveLength(1)
    expect(r.body.blockers[0]).toContain('₹6,000')

    // on the first day of the 7th cycle the deposit is refundable and covers 5000 of the dues
    const checkIn = (await Hosteler.findById(w.hosteler._id).lean())!.checkInDate
    const later = cycleStart(checkIn, 6)
    const r2 = await api().get(`/api/hostelers/${w.hosteler._id}/check-out-preview`).query({ date: later }).set(w.auth).expect(200)
    expect(r2.body).toMatchObject({ checkOut: later, monthsStayed: 6, depositForfeited: false, adjusted: 5000, toCollect: 1000, canCheckOut: false })
    // without adjusting
    const r3 = await api().get(`/api/hostelers/${w.hosteler._id}/check-out-preview`).query({ date: later, adjustDuesFromDeposit: 'false' }).set(w.auth).expect(200)
    expect(r3.body).toMatchObject({ adjusted: 0, toCollect: 6000, refund: 5000 })

    // nothing saved
    expect(await Payment.countDocuments({ hostelerId: w.hosteler._id })).toBe(before)
    expect((await Hosteler.findById(w.hosteler._id))!.status).toBe('active')

    // once paid: allowed
    await pay(w, w.hosteler._id, inv._id, 6000)
    const ok = await api().get(`/api/hostelers/${w.hosteler._id}/check-out-preview`).set(w.auth).expect(200)
    expect(ok.body).toMatchObject({ canCheckOut: true, blockers: [], toCollect: 0, unpaidBills: [] })
  })

  it('validation, permissions and isolation', async () => {
    const w = await makeWorld()
    const url = `/api/hostelers/${w.hosteler._id}/check-out-preview`
    await api().get(url).query({ date: '2026-02-30' }).set(w.auth).expect(400)
    await api().get(url).query({ date: '2000-01-01' }).set(w.auth).expect(400) // before check-in
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await api().get(url).set(accountant.auth).expect(403)
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get(url).set(warden.auth).expect(200)
    const other = await makeOrg()
    await api().get(url).set(other.auth).expect(404)
    await api().get(url).set(w.hostelerAuth).expect(403)
    await api().get(url).expect(401)

    await checkOut(w, w.hosteler._id).expect(200)
    await api().get(url).set(w.auth).expect(409)
  })

  it('works for a hosteler without a bed', async () => {
    const w = await makeWorld()
    const { hosteler } = await makeHosteler(w.org._id, w.hostel, { name: 'No Bed', checkInDate: addDays(today, -3) })
    const r = await api().get(`/api/hostelers/${hosteler._id}/check-out-preview`).set(w.auth).expect(200)
    expect(r.body).toMatchObject({ bed: null, canCheckOut: true, held: 5000, refund: 5000, monthsStayed: 0 })
  })
})
