/**
 * Security deposit billed on bills: check-in options (first bill / next bill /
 * collected), monthly generation picking up a pending deposit, payments split
 * into deposit + rent receipts, UPI claim verification, check-out, and
 * POST /api/hostelers/:id/bill-deposit.
 */
import { describe, expect, it } from 'vitest'
import { api, hostelerAuth, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Invoice } from '../src/models/Invoice.js'
import { Payment } from '../src/models/Payment.js'
import { PaymentClaim } from '../src/models/PaymentClaim.js'
import { todayStr } from '../src/lib/http.js'
import { cycleStart, generateDueBills } from '../src/lib/rentCycle.js'

const today = todayStr()
/** Runs the bill generator as if it were the first day of the check-in's next rent cycle. */
const generateNextCycle = (w: World) => generateDueBills(w.org._id, { today: cycleStart(today, 1), notify: false })

type World = Awaited<ReturnType<typeof makeWorld>>

function admission(w: World, extra: Record<string, unknown> = {}) {
  return {
    name: 'Rohan Verma',
    phone: '+91 98765 43211',
    hostelId: String(w.hostel._id),
    bedId: String(w.beds[1]!._id),
    checkInDate: today,
    monthlyRent: 6000,
    securityDeposit: 5000,
    messOpted: false,
    depositPayment: null,
    generateFirstInvoice: true,
    ...extra,
  }
}

async function checkIn(w: World, extra: Record<string, unknown> = {}) {
  const r = await api().post('/api/hostelers').set(w.auth).send(admission(w, extra)).expect(201)
  return r.body.hosteler.id as string
}

// labels carry the rent period ("Room rent (13 Oct – 12 Nov 2026)"); compare keys and amounts
const lines = (inv: { items: { key?: string | null; label: string; amount: number }[] }) => inv.items.map((i) => ({ key: i.key, amount: i.amount }))

const bills = (hostelerId: string) => Invoice.find({ hostelerId }).sort({ periodStart: 1, createdAt: 1 }).lean()

const pay = (w: World, hostelerId: string, invoiceId: unknown, amount: number) =>
  api().post('/api/payments').set(w.auth).send({ hostelerId, invoiceId: String(invoiceId), amount, mode: 'cash' })

describe('check-in deposit options', () => {
  it('default (nothing paid now, first bill) puts the deposit on the first bill', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { messOpted: true })
    const [inv, ...rest] = await bills(id)
    expect(rest).toHaveLength(0)
    expect(lines(inv!)).toEqual([
      { key: 'rent', amount: 6000 },
      { key: 'mess', amount: 3000 },
      { key: 'deposit', amount: 5000 },
    ])
    expect(inv!.items[2]!.label).toBe('Security deposit')
    expect(inv!.periodStart).toBe(today)
    expect(inv!.total).toBe(14000)
    expect((await Hosteler.findById(id).lean())!.depositToBill).toBe(0)
    expect(await Payment.countDocuments({ hostelerId: id })).toBe(0)
  })

  it('next_bill: first bill has no deposit; next generated bill gets it once', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { depositOption: 'next_bill' })
    const [first] = await bills(id)
    expect(lines(first!)).toEqual([{ key: 'rent', amount: 6000 }])
    expect((await Hosteler.findById(id).lean())!.depositToBill).toBe(5000)
    // nothing new today
    await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200)
    expect(await Invoice.countDocuments({ hostelerId: id })).toBe(1)

    await generateNextCycle(w)
    const next = await Invoice.findOne({ hostelerId: id, periodStart: cycleStart(today, 1) }).lean()
    expect(lines(next!)).toEqual([
      { key: 'rent', amount: 6000 },
      { key: 'deposit', amount: 5000 },
    ])
    expect(next!.total).toBe(11000)
    expect((await Hosteler.findById(id).lean())!.depositToBill).toBe(0)

    // generating again: nothing new; the cycle after that has no deposit line
    expect((await generateNextCycle(w)).created).toBe(0)
    await generateDueBills(w.org._id, { today: cycleStart(today, 2), notify: false })
    const third = await Invoice.findOne({ hostelerId: id, periodStart: cycleStart(today, 2) }).lean()
    expect(third!.items.map((i) => i.key)).toEqual(['rent'])
    // the other (helper-made) hosteler never had a deposit line
    const others = await Invoice.find({ hostelerId: w.hosteler._id }).lean()
    expect(others.every((i) => i.items.every((x) => x.key !== 'deposit'))).toBe(true)
  })

  it('partial deposit now + first_bill bills the remainder; "collected" bills nothing', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { depositPayment: { amount: 2000, mode: 'cash' }, depositOption: 'first_bill' })
    const [inv] = await bills(id)
    expect(lines(inv!)).toEqual([
      { key: 'rent', amount: 6000 },
      { key: 'deposit', amount: 3000 },
    ])
    expect(await Payment.find({ hostelerId: id }).lean()).toMatchObject([{ kind: 'deposit', amount: 2000, invoiceId: null }])

    // default when something was paid now = collected -> nothing billed, nothing pending
    const room = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    const id2 = await checkIn(w, { name: 'Kabir', bedId: String(room.beds[0]!._id), depositPayment: { amount: 2000, mode: 'cash' } })
    const [inv2] = await bills(id2)
    expect(inv2!.items.map((i) => i.key)).toEqual(['rent'])
    expect((await Hosteler.findById(id2).lean())!.depositToBill).toBe(0)

    // explicit 'collected' with nothing paid
    const room3 = await makeRoom(w.org._id, w.hostel._id, '103', 1)
    const id3 = await checkIn(w, { name: 'Dev', bedId: String(room3.beds[0]!._id), depositOption: 'collected' })
    expect((await bills(id3))[0]!.items.map((i) => i.key)).toEqual(['rent'])
    expect((await Hosteler.findById(id3).lean())!.depositToBill).toBe(0)
  })

  it('first_bill without a first bill (or reserve only) waits for the next bill', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { generateFirstInvoice: false, depositPayment: { amount: 1000, mode: 'cash' }, depositOption: 'first_bill' })
    expect(await Invoice.countDocuments({ hostelerId: id })).toBe(0)
    expect((await Hosteler.findById(id).lean())!.depositToBill).toBe(4000)

    const room = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    const id2 = await checkIn(w, { name: 'Kabir', bedId: String(room.beds[0]!._id), reserveOnly: true })
    expect(await Invoice.countDocuments({ hostelerId: id2 })).toBe(0)
    expect((await Hosteler.findById(id2).lean())!.depositToBill).toBe(5000)
  })
})

describe('paying a bill with a deposit line', () => {
  it('full payment -> deposit receipt + rent receipt', async () => {
    const w = await makeWorld()
    const id = await checkIn(w)
    const [inv] = await bills(id)
    const r = await pay(w, id, inv!._id, 11000).expect(201)
    expect(r.body).toMatchObject({ kind: 'rent', amount: 6000 }) // main receipt returned

    const ps = await Payment.find({ hostelerId: id }).sort({ createdAt: 1 }).lean()
    expect(ps.map((p) => ({ kind: p.kind, amount: p.amount, invoiceId: String(p.invoiceId) }))).toEqual([
      { kind: 'deposit', amount: 5000, invoiceId: String(inv!._id) },
      { kind: 'rent', amount: 6000, invoiceId: String(inv!._id) },
    ])
    expect(ps[0]!.receiptNo).not.toBe(ps[1]!.receiptNo)
    expect((await Invoice.findById(inv!._id).lean())!.paidAmount).toBe(11000)

    const h = await api().get(`/api/hostelers/${id}`).set(w.auth).expect(200)
    expect(h.body).toMatchObject({ depositCollected: 5000, dues: 0 })

    const d = await api().get('/api/deposits').set(w.auth).expect(200)
    expect(d.body.held.find((x: { hostelerId: string }) => x.hostelerId === id)).toMatchObject({ agreed: 5000, collected: 5000, held: 5000, pending: 0 })

    // P&L: rent income excludes the deposit part (it is under "deposits")
    const pnl = await api().get('/api/reports/pnl?months=1').set(w.auth).expect(200)
    expect(pnl.body.totals).toMatchObject({ income: 6000, deposits: 5000 })

    // fees summary "received" excludes deposits too
    const sum = await api().get('/api/fees/summary').set(w.auth).expect(200)
    expect(sum.body.received).toBe(6000)
  })

  it('partial payments: deposit first, then rent', async () => {
    const w = await makeWorld()
    const id = await checkIn(w)
    const [inv] = await bills(id)

    const r1 = await pay(w, id, inv!._id, 3000).expect(201)
    expect(r1.body).toMatchObject({ kind: 'deposit', amount: 3000 })
    expect(await Payment.countDocuments({ hostelerId: id })).toBe(1)

    const r2 = await pay(w, id, inv!._id, 4000).expect(201)
    expect(r2.body).toMatchObject({ kind: 'rent', amount: 2000 })
    const ps = await Payment.find({ hostelerId: id }).sort({ createdAt: 1 }).lean()
    expect(ps.map((p) => [p.kind, p.amount])).toEqual([
      ['deposit', 3000],
      ['deposit', 2000],
      ['rent', 2000],
    ])

    const h = await api().get(`/api/hostelers/${id}`).set(w.auth).expect(200)
    expect(h.body).toMatchObject({ depositCollected: 5000, dues: 4000 })

    // the rest is rent only
    const r3 = await pay(w, id, inv!._id, 4000).expect(201)
    expect(r3.body).toMatchObject({ kind: 'rent', amount: 4000 })
    await pay(w, id, inv!._id, 1).expect(409) // overpay refused

    // deleting a deposit receipt rolls back; the next payment covers the deposit again
    await api().delete(`/api/payments/${ps[0]!._id}`).set(w.auth).expect(200)
    const r4 = await pay(w, id, inv!._id, 3000).expect(201)
    expect(r4.body).toMatchObject({ kind: 'deposit', amount: 3000 })
  })

  it('UPI claim verification records both receipts; neither can be deleted', async () => {
    const w = await makeWorld()
    const id = await checkIn(w)
    await Hosteler.updateOne({ _id: id }, { mustChangePassword: false })
    const auth = hostelerAuth((await Hosteler.findById(id))!)

    const c = await api().post('/api/portal/payment-claims').set(auth).send({ amount: 11000, utr: 'UTR1234567' }).expect(201)
    const v = await api().post(`/api/payment-claims/${c.body.id}/verify`).set(w.auth).send({ receivedAmount: 11000 }).expect(200)
    expect(v.body.remainingDues).toBe(0)
    expect(v.body.applied).toHaveLength(1)
    expect(v.body.applied[0]).toMatchObject({ amount: 11000 })

    const claim = (await PaymentClaim.findById(c.body.id).lean())!
    const ps = await Payment.find({ hostelerId: id }).lean()
    expect(ps).toHaveLength(2)
    expect(claim.paymentIds.map(String).sort()).toEqual(ps.map((p) => String(p._id)).sort())
    const dep = ps.find((p) => p.kind === 'deposit')!
    const rent = ps.find((p) => p.kind === 'rent')!
    expect(dep).toMatchObject({ amount: 5000, mode: 'upi', reference: 'UTR1234567', recordedBy: 'hosteler' })
    expect(rent.amount).toBe(6000)

    await api().delete(`/api/payments/${dep._id}`).set(w.auth).expect(409)
    await api().delete(`/api/payments/${rent._id}`).set(w.auth).expect(409)
    expect(await Payment.countDocuments({ hostelerId: id })).toBe(2)
  })
})

describe('check-out with a deposit collected through bills', () => {
  it('uses the deposit paid on bills as deposit held', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { securityDeposit: 8000 })
    const [inv] = await bills(id)
    await pay(w, id, inv!._id, 14000).expect(201)
    const r = await api().post(`/api/hostelers/${id}/check-out`).set(w.auth).send({ date: today }).expect(200)
    expect(r.body.settlement).toMatchObject({ held: 8000, dues: 0, refund: 8000, toCollect: 0 })
  })

  it('part of a billed deposit unpaid: the unpaid part nets out (not charged twice)', async () => {
    const w = await makeWorld()
    const id = await checkIn(w)
    const [inv] = await bills(id)
    await pay(w, id, inv!._id, 3000).expect(201) // deposit 3000 of 5000; rent 6000 unpaid
    const r = await api().post(`/api/hostelers/${id}/check-out`).set(w.auth).send({ date: today }).expect(200)
    // the hosteler owes 6000 rent and has paid 3000 deposit -> 3000 to collect
    expect(r.body.settlement).toMatchObject({ toCollect: 3000, refund: 0 })
  })

  it('a deposit still waiting for the next bill is not treated as held', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { depositOption: 'next_bill', generateFirstInvoice: false })
    const r = await api().post(`/api/hostelers/${id}/check-out`).set(w.auth).send({ date: today }).expect(200)
    expect(r.body.settlement).toMatchObject({ held: 0, dues: 0, refund: 0, toCollect: 0 })
  })
})

describe('POST /api/hostelers/:id/bill-deposit', () => {
  it("'open' adds the outstanding deposit to the latest bill", async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { depositOption: 'collected', depositPayment: { amount: 1500, mode: 'cash' } })
    await generateNextCycle(w)
    const r = await api().post(`/api/hostelers/${id}/bill-deposit`).set(w.auth).send({ target: 'open' }).expect(200)
    const next = (await Invoice.findOne({ hostelerId: id, periodStart: cycleStart(today, 1) }).lean())!
    expect(r.body).toMatchObject({ amount: 3500, target: 'open', invoiceNumber: next.number })
    expect(next.items.at(-1)).toMatchObject({ key: 'deposit', label: 'Security deposit', amount: 3500 })
    expect(next.total).toBe(9500)
    expect(r.body.hosteler.dues).toBe(6000 + 9500)
    // the first bill is untouched
    expect((await Invoice.findOne({ hostelerId: id, periodStart: today }).lean())!.total).toBe(6000)

    // everything is now collected or billed
    await api().post(`/api/hostelers/${id}/bill-deposit`).set(w.auth).send({ target: 'open' }).expect(409)
    await api().post(`/api/hostelers/${id}/bill-deposit`).set(w.auth).send({ target: 'next' }).expect(409)
  })

  it("'next' sets depositToBill; 409 for 'open' without a bill, or when nothing is left", async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { depositOption: 'collected', generateFirstInvoice: false })
    await api().post(`/api/hostelers/${id}/bill-deposit`).set(w.auth).send({ target: 'open' }).expect(409)
    await api().post(`/api/hostelers/${id}/bill-deposit`).set(w.auth).send({ target: 'bogus' }).expect(400)
    const r = await api().post(`/api/hostelers/${id}/bill-deposit`).set(w.auth).send({ target: 'next' }).expect(200)
    expect(r.body).toMatchObject({ amount: 5000, target: 'next', invoiceNumber: null })
    expect((await Hosteler.findById(id).lean())!.depositToBill).toBe(5000)
    await api().post(`/api/hostelers/${id}/bill-deposit`).set(w.auth).send({ target: 'next' }).expect(409)

    // fully paid outside bills -> nothing to bill
    const room = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    const id2 = await checkIn(w, { name: 'Kabir', bedId: String(room.beds[0]!._id), depositPayment: { amount: 5000, mode: 'cash' } })
    await api().post(`/api/hostelers/${id2}/bill-deposit`).set(w.auth).send({ target: 'open' }).expect(409)

    // already on the first bill (default) -> nothing more to bill; a cancelled bill frees it again
    const room3 = await makeRoom(w.org._id, w.hostel._id, '103', 1)
    const id3 = await checkIn(w, { name: 'Dev', bedId: String(room3.beds[0]!._id) })
    await api().post(`/api/hostelers/${id3}/bill-deposit`).set(w.auth).send({ target: 'next' }).expect(409)
    const [b3] = await bills(id3)
    await api().post(`/api/invoices/${b3!._id}/cancel`).set(w.auth).expect(200)
    const r3 = await api().post(`/api/hostelers/${id3}/bill-deposit`).set(w.auth).send({ target: 'next' }).expect(200)
    expect(r3.body.amount).toBe(5000)
  })

  it('roles, other org and checked-out hostelers', async () => {
    const w = await makeWorld()
    const id = await checkIn(w, { depositOption: 'collected' })
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().post(`/api/hostelers/${id}/bill-deposit`).set(warden.auth).send({ target: 'next' }).expect(403)
    await api().post(`/api/hostelers/${id}/bill-deposit`).set(accountant.auth).send({ target: 'next' }).expect(200)

    const other = await makeOrg()
    const id2 = await checkIn(w, { name: 'Kabir', bedId: String((await makeRoom(w.org._id, w.hostel._id, '102', 1)).beds[0]!._id), depositOption: 'collected' })
    await api().post(`/api/hostelers/${id2}/bill-deposit`).set(other.auth).send({ target: 'next' }).expect(404)

    await api().post(`/api/hostelers/${id2}/check-out`).set(w.auth).send({ date: today }).expect(200)
    await api().post(`/api/hostelers/${id2}/bill-deposit`).set(w.auth).send({ target: 'next' }).expect(409)
  })
})
