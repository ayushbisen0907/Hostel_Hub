import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { Invoice } from '../src/models/Invoice.js'
import { Payment } from '../src/models/Payment.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Hostel } from '../src/models/Hostel.js'
import { Organization } from '../src/models/Organization.js'
import { Notification } from '../src/models/Notification.js'
import { addDays, addMonthsAnchored, periodLabel } from '../src/lib/dates.js'
import { cycleEnd, cycleIndexOf, cycleStart, generateDueBills } from '../src/lib/rentCycle.js'

const today = todayStr()
const month = today.slice(0, 7)

/** Custom invoice for the world's hosteler. */
async function customInvoice(w: Awaited<ReturnType<typeof makeWorld>>, total: number, dueDate = addDays(today, 10), m = month) {
  const r = await api()
    .post('/api/invoices')
    .set(w.auth)
    .send({ hostelerId: String(w.hosteler._id), month: m, items: [{ key: 'rent', label: 'Rent', amount: total }], dueDate })
    .expect(201)
  return r.body as { id: string; number: string; total: number; status: string; balance: number }
}

describe('invoice generation (rent cycles from check-in)', () => {
  it('bills every started cycle per hosteler (rent + mess), is idempotent; a cancelled bill is re-created', async () => {
    const w = await makeWorld()
    const ciA = addMonthsAnchored(today, -2) // back-dated: 3 cycles have started
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: ciA })
    const nA = cycleIndexOf(ciA, today) + 1
    expect(nA).toBe(3)
    // second hosteler without mess, checked in today -> just the current cycle
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Kabir Jain', messOpted: false, monthlyRent: 5500, checkInDate: today })

    const r1 = await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200)
    expect(r1.body).toMatchObject({ created: nA + 1, hostelers: 2, skipped: 0, errors: [] })
    // `month` is ignored now; nothing new to bill
    const r2 = await api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-13', hostelId: String(w.hostel._id) }).expect(200)
    expect(r2.body).toMatchObject({ created: 0, hostelers: 2, skipped: 2 })

    const billsA = await Invoice.find({ hostelerId: w.hosteler._id }).sort({ periodStart: 1 }).lean()
    expect(billsA.map((i) => i.periodStart)).toEqual([0, 1, 2].map((k) => cycleStart(ciA, k)))
    const cur = billsA.at(-1)!
    const label = periodLabel(cycleStart(ciA, 2), cycleEnd(ciA, 2))
    expect(cur.items.map((i) => ({ key: i.key, label: i.label, amount: i.amount }))).toEqual([
      { key: 'rent', label: `Room rent (${label})`, amount: 6000 },
      { key: 'mess', label: `Mess fees (${label})`, amount: 3000 }, // org settings fallback (hostel has no mess charge)
    ])
    expect(cur).toMatchObject({ total: 9000, periodEnd: cycleEnd(ciA, 2), dueDate: addDays(cycleStart(ciA, 2), 5), month: cycleStart(ciA, 2).slice(0, 7) })

    const [b] = await Invoice.find({ hostelerId: h2._id }).lean()
    expect(b).toMatchObject({ total: 5500, periodStart: today, periodEnd: cycleEnd(today, 0), dueDate: addDays(today, 5) })
    expect(b!.items.map((i) => i.key)).toEqual(['rent']) // no mess: not opted
    expect(new Set((await Invoice.find({ orgId: w.org._id }).lean()).map((i) => i.number)).size).toBe(nA + 1)

    // a cancelled bill doesn't block re-billing that cycle
    await api().post(`/api/invoices/${String(cur._id)}/cancel`).set(w.auth).expect(200)
    const again = await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200)
    expect(again.body.created).toBe(1)
    expect(await Invoice.countDocuments({ hostelerId: w.hosteler._id, cancelled: false, periodStart: cur.periodStart })).toBe(1)

    await api().post('/api/invoices/generate').set(w.auth).send({ hostelId: 'nope' }).expect(400)
  })

  it('concurrent generate calls do not double-bill', async () => {
    const w = await makeWorld()
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: today })
    await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Second', checkInDate: today })
    const rs = await Promise.all(Array.from({ length: 3 }, () => api().post('/api/invoices/generate').set(w.auth).send({})))
    for (const r of rs) expect(r.status).toBe(200)
    expect(rs.reduce((a, r) => a + r.body.created, 0)).toBe(2)
    expect(await Invoice.countDocuments({ orgId: w.org._id })).toBe(2)
  })
})

describe('invoices CRUD', () => {
  it('custom invoice, list filters, detail, edit and cancel rules', async () => {
    const w = await makeWorld()
    await api().post('/api/invoices').set(w.auth).send({ hostelerId: String(w.hosteler._id), month, items: [], dueDate: today }).expect(400)
    await api().post('/api/invoices').set(w.auth).send({ hostelerId: String(w.hosteler._id), month, items: [{ label: 'X', amount: -5 }], dueDate: today }).expect(400)
    await api().post('/api/invoices').set(w.auth).send({ hostelerId: '000000000000000000000000', month, items: [{ label: 'X', amount: 5 }], dueDate: today }).expect(404)

    const inv = await customInvoice(w, 1000)
    expect(inv).toMatchObject({ total: 1000, status: 'unpaid', balance: 1000 })
    const overdue = await customInvoice(w, 2000, addDays(today, -3), '2026-01')

    const list = await api().get('/api/invoices').set(w.auth).expect(200)
    expect(list.body.total).toBe(2)
    expect(list.body.items[0].hosteler).toMatchObject({ name: 'Aarav Sharma', loginId: w.hosteler.loginId })
    expect(list.body.items[0].roomLabel).toBe('Room 101 · Bed A')
    expect(list.body.totals).toMatchObject({ total: 3000, balance: 3000 })

    const od = await api().get('/api/invoices?status=overdue').set(w.auth).expect(200)
    expect(od.body.items.map((i: { id: string }) => i.id)).toEqual([overdue.id])
    expect((await api().get(`/api/invoices?month=${month}`).set(w.auth)).body.total).toBe(1)
    expect((await api().get('/api/invoices?q=aarav').set(w.auth)).body.total).toBe(2)
    expect((await api().get(`/api/invoices?q=${inv.number}`).set(w.auth)).body.total).toBe(1)
    expect((await api().get('/api/invoices?q=nobody').set(w.auth)).body.total).toBe(0)
    expect((await api().get(`/api/invoices?hostelId=${String(w.hostel._id)}&limit=1`).set(w.auth)).body).toMatchObject({ total: 2, pages: 2 })
    await api().get('/api/invoices?status=weird').set(w.auth).expect(400)

    // pay 600 -> partial; edit total below paid -> 409; above -> ok
    await api()
      .post('/api/payments')
      .set(w.auth)
      .send({ hostelerId: String(w.hosteler._id), invoiceId: inv.id, amount: 600, mode: 'upi', date: today })
      .expect(201)
    const detail = await api().get(`/api/invoices/${inv.id}`).set(w.auth).expect(200)
    expect(detail.body).toMatchObject({ status: 'partial', paidAmount: 600, balance: 400 })
    expect(detail.body.payments).toHaveLength(1)
    expect(detail.body.hostel.name).toBe('Sunrise Boys Hostel')
    expect(detail.body.organization.name).toBe('Test Hostels')
    expect(detail.body.hosteler.guardianPhone).toBe('9876500000')

    await api().patch(`/api/invoices/${inv.id}`).set(w.auth).send({ items: [{ label: 'Rent', amount: 500 }] }).expect(409)
    const edited = await api()
      .patch(`/api/invoices/${inv.id}`)
      .set(w.auth)
      .send({ items: [{ label: 'Rent', amount: 1000 }, { label: 'Electricity', amount: 250 }], dueDate: addDays(today, 20) })
      .expect(200)
    expect(edited.body).toMatchObject({ total: 1250, balance: 650 })
    await api().patch(`/api/invoices/${inv.id}`).set(w.auth).send({}).expect(400)

    // cancel refused while a payment exists
    await api().post(`/api/invoices/${inv.id}/cancel`).set(w.auth).expect(409)
    await api().post(`/api/invoices/${overdue.id}/cancel`).set(w.auth).expect(200)
    await api().post(`/api/invoices/${overdue.id}/cancel`).set(w.auth).expect(409)
    await api().patch(`/api/invoices/${overdue.id}`).set(w.auth).send({ dueDate: today }).expect(400)
    const cancelled = await api().get('/api/invoices?status=cancelled').set(w.auth).expect(200)
    expect(cancelled.body.items[0]).toMatchObject({ status: 'cancelled', balance: 0 })

    await api().get('/api/invoices/not-an-id').set(w.auth).expect(400)
    await api().get('/api/invoices/000000000000000000000000').set(w.auth).expect(404)
  })

  it('late fee: added for overdue invoices, replaced on repeat, refused otherwise', async () => {
    const w = await makeWorld()
    const inv = await customInvoice(w, 6000, addDays(today, -10))
    const r = await api().post(`/api/invoices/${inv.id}/late-fee`).set(w.auth).expect(200)
    expect(r.body).toMatchObject({ lateFee: 500, days: 10, total: 6500, replaced: false })
    expect(r.body.items.at(-1)).toEqual({ key: 'late_fee', label: 'Late fee (10 days)', amount: 500, ref: null })
    expect(r.body.items[0]).toEqual({ key: 'rent', label: 'Rent', amount: 6000, ref: null }) // other lines keep their key

    await Invoice.updateOne({ _id: inv.id }, { dueDate: addDays(today, -12) })
    const r2 = await api().post(`/api/invoices/${inv.id}/late-fee`).set(w.auth).expect(200)
    expect(r2.body).toMatchObject({ lateFee: 600, total: 6600, replaced: true })
    expect(r2.body.items.filter((i: { label: string }) => i.label.startsWith('Late fee'))).toHaveLength(1)
    expect(r2.body.items.map((i: { key: string }) => i.key)).toEqual(['rent', 'late_fee'])

    const notDue = await customInvoice(w, 100, addDays(today, 2))
    await api().post(`/api/invoices/${notDue.id}/late-fee`).set(w.auth).expect(400)
  })
})

describe('payments', () => {
  it('records rent/deposit/advance, rejects overpayment, lists with totals, deletes', async () => {
    const w = await makeWorld()
    const inv = await customInvoice(w, 1000)
    const hid = String(w.hosteler._id)

    await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, invoiceId: inv.id, amount: 1001, mode: 'cash', date: today }).expect(409)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, invoiceId: inv.id, amount: 0, mode: 'cash', date: today }).expect(400)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, invoiceId: inv.id, amount: 100, mode: 'cheque', date: today }).expect(400)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, invoiceId: inv.id, amount: 100, mode: 'cash', date: '12/10/2026' }).expect(400)

    const full = await api()
      .post('/api/payments')
      .set(w.auth)
      .send({ hostelerId: hid, invoiceId: inv.id, amount: 1000, mode: 'upi', reference: 'UPI123', date: today })
      .expect(201)
    expect(full.body).toMatchObject({ kind: 'rent', amount: 1000, invoiceId: inv.id })
    expect(full.body.receiptNo).toMatch(/^RCPT-\d+$/)
    expect((await api().get(`/api/invoices/${inv.id}`).set(w.auth)).body.status).toBe('paid')
    await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, invoiceId: inv.id, amount: 1, mode: 'cash', date: today }).expect(409)

    const dep = await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, amount: 3000, mode: 'cash', kind: 'deposit', date: today }).expect(201)
    expect(dep.body).toMatchObject({ kind: 'deposit', invoiceId: null, note: 'Security deposit' })
    const adv = await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, amount: 200, mode: 'card', date: today }).expect(201)
    expect(adv.body.kind).toBe('advance')

    const list = await api().get('/api/payments').set(w.auth).expect(200)
    expect(list.body.total).toBe(3)
    expect(list.body.totals).toMatchObject({ amount: 4200, count: 3, byMode: { upi: 1000, cash: 3000, card: 200, bank: 0 } })
    const rentRow = list.body.items.find((p: { kind: string }) => p.kind === 'rent')
    expect(rentRow.invoice.number).toBe(inv.number)
    expect(rentRow.hosteler.name).toBe('Aarav Sharma')
    expect((await api().get('/api/payments?kind=deposit').set(w.auth)).body.total).toBe(1)
    expect((await api().get('/api/payments?mode=upi').set(w.auth)).body.total).toBe(1)
    expect((await api().get('/api/payments?q=UPI123').set(w.auth)).body.total).toBe(1)
    expect((await api().get(`/api/payments?q=${full.body.receiptNo}`).set(w.auth)).body.total).toBe(1)
    expect((await api().get(`/api/payments?from=${addDays(today, 1)}`).set(w.auth)).body.total).toBe(0)
    expect((await api().get(`/api/payments?from=${today}&to=${today}`).set(w.auth)).body.total).toBe(3)

    const receipt = await api().get(`/api/payments/${full.body.id}`).set(w.auth).expect(200)
    expect(receipt.body).toMatchObject({ receiptNo: full.body.receiptNo, invoice: { number: inv.number, status: 'paid' } })
    expect(receipt.body.hosteler.roomLabel).toBe('Room 101 · Bed A')
    expect(receipt.body.organization.name).toBe('Test Hostels')
    expect(receipt.body.hostel.city).toBe('Indore')

    await api().delete(`/api/payments/${full.body.id}`).set(w.auth).expect(200)
    await api().delete(`/api/payments/${full.body.id}`).set(w.auth).expect(404)
    const after = await api().get(`/api/invoices/${inv.id}`).set(w.auth).expect(200)
    expect(after.body).toMatchObject({ paidAmount: 0, status: 'unpaid' })
    // now it can be cancelled, and cancelled invoices can't be paid
    await api().post(`/api/invoices/${inv.id}/cancel`).set(w.auth).expect(200)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: hid, invoiceId: inv.id, amount: 10, mode: 'cash', date: today }).expect(400)
  })

  it('5 parallel payments get 5 unique receipt numbers', async () => {
    const w = await makeWorld()
    const inv = await customInvoice(w, 10_000)
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().post('/api/payments').set(w.auth).send({ hostelerId: String(w.hosteler._id), invoiceId: inv.id, amount: 100, mode: 'cash', date: today }),
      ),
    )
    for (const r of rs) expect(r.status).toBe(201)
    expect(new Set(rs.map((r) => r.body.receiptNo)).size).toBe(5)
    expect((await Invoice.findById(inv.id).lean())!.paidAmount).toBe(500)
  })

  it('parallel payments can never overpay an invoice', async () => {
    const w = await makeWorld()
    const inv = await customInvoice(w, 1000)
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().post('/api/payments').set(w.auth).send({ hostelerId: String(w.hosteler._id), invoiceId: inv.id, amount: 300, mode: 'cash', date: today }),
      ),
    )
    expect(rs.filter((r) => r.status === 201)).toHaveLength(3)
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2)
    expect((await Invoice.findById(inv.id).lean())!.paidAmount).toBe(900)
    expect(await Payment.countDocuments({ invoiceId: inv.id })).toBe(3)
  })
})

describe('dues, deposits, summary', () => {
  it('reports dues per hosteler, deposits and the monthly summary', async () => {
    const w = await makeWorld()
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Kabir Jain' })
    await customInvoice(w, 3000, addDays(today, -5), '2026-01')
    await customInvoice(w, 2000, addDays(today, 5))
    const r2 = await api()
      .post('/api/invoices')
      .set(w.auth)
      .send({ hostelerId: String(h2._id), month, items: [{ label: 'Rent', amount: 8000 }], dueDate: addDays(today, 5) })
      .expect(201)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: String(h2._id), invoiceId: r2.body.id, amount: 1000, mode: 'cash', date: today }).expect(201)

    const dues = await api().get('/api/dues').set(w.auth).expect(200)
    expect(dues.body.items.map((d: { name: string; amount: number }) => [d.name, d.amount])).toEqual([
      ['Kabir Jain', 7000],
      ['Aarav Sharma', 5000],
    ])
    const aarav = dues.body.items[1]
    expect(aarav).toMatchObject({ oldestDueDate: addDays(today, -5), daysOverdue: 5, overdue: true, guardianPhone: '9876500000', phone: '9876543210' })
    expect(aarav.invoices).toHaveLength(2)
    expect(dues.body.totals).toMatchObject({ amount: 12_000, hostelers: 2, overdueAmount: 3000 })

    // deposits: Aarav paid 2000 of 5000; h2 checked out with 5000 collected, 4000 refunded
    await api().post('/api/payments').set(w.auth).send({ hostelerId: String(w.hosteler._id), amount: 2000, mode: 'cash', kind: 'deposit', date: today }).expect(201)
    await api().post('/api/payments').set(w.auth).send({ hostelerId: String(h2._id), amount: 5000, mode: 'cash', kind: 'deposit', date: today }).expect(201)
    await Hosteler.updateOne({ _id: h2._id }, { status: 'checked_out', checkOutDate: today, depositRefunded: 4000 })
    const dep = await api().get('/api/deposits').set(w.auth).expect(200)
    expect(dep.body.held).toHaveLength(1)
    expect(dep.body.held[0]).toMatchObject({ agreed: 5000, collected: 2000, held: 2000, pending: 3000 })
    expect(dep.body.checkedOut[0]).toMatchObject({ collected: 5000, refunded: 4000, deducted: 1000, refundRecorded: true })
    expect(dep.body.totals).toEqual({ held: 2000, pending: 3000, refunded: 4000, deducted: 1000 })

    const sum = await api().get(`/api/fees/summary?month=${month}&hostelId=${String(w.hostel._id)}`).set(w.auth).expect(200)
    expect(sum.body).toMatchObject({ month, billed: 10_000, collected: 1000, outstanding: 9000, overdueCount: 1, overdueAmount: 3000, collectionRate: 10, received: 1000 })
    const other = await makeHostel(w.org._id, 'Other')
    expect((await api().get(`/api/fees/summary?month=${month}&hostelId=${String(other._id)}`).set(w.auth)).body.billed).toBe(0)
    await api().get('/api/fees/summary?month=2026').set(w.auth).expect(400)
  })
})

describe('isolation and permissions', () => {
  it("another org can't see or touch this org's fees", async () => {
    const w = await makeWorld()
    const inv = await customInvoice(w, 1000)
    const pay = await api().post('/api/payments').set(w.auth).send({ hostelerId: String(w.hosteler._id), invoiceId: inv.id, amount: 100, mode: 'cash', date: today }).expect(201)

    const b = await makeOrg()
    const bHostel = await makeHostel(b.org._id, 'B Hostel')
    const { beds } = await makeRoom(b.org._id, bHostel._id, '1', 1)
    const { hosteler: bh } = await makeHosteler(b.org._id, bHostel, { bed: beds[0]! })

    await api().get(`/api/invoices/${inv.id}`).set(b.auth).expect(404)
    await api().get(`/api/payments/${pay.body.id}`).set(b.auth).expect(404)
    await api().patch(`/api/invoices/${inv.id}`).set(b.auth).send({ dueDate: today }).expect(404)
    await api().post(`/api/invoices/${inv.id}/cancel`).set(b.auth).expect(404)
    await api().post(`/api/invoices/${inv.id}/late-fee`).set(b.auth).expect(404)
    await api().delete(`/api/payments/${pay.body.id}`).set(b.auth).expect(404)
    await api().post('/api/payments').set(b.auth).send({ hostelerId: String(w.hosteler._id), amount: 100, mode: 'cash', date: today }).expect(404)
    // B's hosteler paying against A's invoice
    await api().post('/api/payments').set(b.auth).send({ hostelerId: String(bh._id), invoiceId: inv.id, amount: 100, mode: 'cash', date: today }).expect(404)
    await api().post('/api/invoices').set(b.auth).send({ hostelerId: String(w.hosteler._id), month, items: [{ label: 'X', amount: 1 }], dueDate: today }).expect(404)
    await api().post('/api/invoices/generate').set(b.auth).send({ month, hostelId: String(w.hostel._id) }).expect(404)

    expect((await api().get('/api/invoices').set(b.auth)).body.total).toBe(0)
    expect((await api().get('/api/payments').set(b.auth)).body.total).toBe(0)
    expect((await api().get('/api/dues').set(b.auth)).body.items).toHaveLength(0)
    expect((await api().get(`/api/invoices?hostelId=${String(w.hostel._id)}`).set(b.auth)).body.total).toBe(0)
    expect((await Invoice.findById(inv.id).lean())!.paidAmount).toBe(100)
  })

  it('warden is blocked; accountant and manager can work with fees', async () => {
    const w = await makeWorld()
    const inv = await customInvoice(w, 1000)
    const warden = await makeStaffUser(w.org._id, 'warden')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const manager = await makeStaffUser(w.org._id, 'manager')

    await api().get('/api/invoices').set(warden.auth).expect(403)
    await api().get('/api/dues').set(warden.auth).expect(403)
    await api().post('/api/payments').set(warden.auth).send({ hostelerId: String(w.hosteler._id), amount: 100, mode: 'cash' }).expect(403)
    await api().get('/api/invoices').expect(401)
    await api().get('/api/invoices').set(w.hostelerAuth).expect(403)

    await api().get('/api/invoices').set(accountant.auth).expect(200)
    const p = await api().post('/api/payments').set(accountant.auth).send({ hostelerId: String(w.hosteler._id), invoiceId: inv.id, amount: 100, mode: 'cash' }).expect(201)
    expect(p.body.date).toBe(today)
    await api().delete(`/api/payments/${p.body.id}`).set(accountant.auth).expect(200)
    await api().get('/api/fees/summary').set(manager.auth).expect(200)
    await api().delete(`/api/payments/000000000000000000000000`).set(manager.auth).expect(404)
  })
})

describe('itemized bills', () => {
  const lines = (inv: { items: { key?: string | null; label: string; amount: number }[] }) => inv.items.map((i) => ({ key: i.key, amount: i.amount }))

  it('bills rent + mess (opted only); old fixed charges (incl. electricity) are not billed', async () => {
    const w = await makeWorld()
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: today })
    await Hostel.updateOne(
      { _id: w.hostel._id },
      { charges: { mess: 2500, electricity: 400, water: 0, internet: 300, laundry: 0, maintenance: 200, others: [{ label: 'Housekeeping', amount: 150 }] } },
    )
    const { hosteler: noMess } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Kabir Jain', messOpted: false, monthlyRent: 5500, checkInDate: today })
    // a hosteler of another hostel without charges (org mess fallback applies)
    const plain = await makeHostel(w.org._id, 'Plain Stay')
    const { hosteler: elsewhere } = await makeHosteler(w.org._id, plain, { name: 'Dev Patel', monthlyRent: 4000, checkInDate: today })

    const r = await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200)
    expect(r.body.created).toBe(3)
    const of = async (id: unknown) => (await Invoice.findOne({ hostelerId: id }).lean())!

    const a = await of(w.hosteler._id)
    // hostel's mess charge wins over the org setting; electricity is metered; internet / maintenance / custom heads are part of the rent
    expect(lines(a)).toEqual([
      { key: 'rent', amount: 6000 },
      { key: 'mess', amount: 2500 },
    ])
    expect(a).toMatchObject({ total: 8500, dueDate: addDays(today, 5) })
    expect(lines(await of(noMess._id))).toEqual([{ key: 'rent', amount: 5500 }])
    expect(lines(await of(elsewhere._id))).toEqual([
      { key: 'rent', amount: 4000 },
      { key: 'mess', amount: 3000 },
    ])
  })

  it('falls back to the org mess charge; no mess line when both are 0', async () => {
    const w = await makeWorld()
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: today })
    await Organization.updateOne({ _id: w.org._id }, { 'settings.messMonthlyCharge': 2800 })
    await Hostel.updateOne({ _id: w.hostel._id }, { charges: { mess: 0, water: 100 } })
    await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200)
    const first = await Invoice.findOne({ hostelerId: w.hosteler._id }).lean()
    expect(lines(first!)).toEqual([
      { key: 'rent', amount: 6000 },
      { key: 'mess', amount: 2800 },
    ])
    expect(first!.total).toBe(8800) // water is included in rent

    await Organization.updateOne({ _id: w.org._id }, { 'settings.messMonthlyCharge': 0 })
    await generateDueBills(w.org._id, { today: cycleStart(today, 1) }) // next cycle
    const next = await Invoice.findOne({ hostelerId: w.hosteler._id, periodStart: cycleStart(today, 1) }).lean()
    expect(next!.items.map((i) => i.key)).toEqual(['rent'])
  })

  it('notifies each billed hosteler once (bill_generated) and they see it in the portal', async () => {
    const w = await makeWorld()
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: today })
    const { hosteler: h2, auth: h2Auth } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Kabir Jain', messOpted: false, monthlyRent: 5500, checkInDate: today })
    await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200)
    await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200) // nothing new -> no new notifications

    const notes = await Notification.find({ orgId: w.org._id }).lean()
    expect(notes).toHaveLength(2)
    expect(new Set(notes.map((n) => String(n.recipientId)))).toEqual(new Set([String(w.hosteler._id), String(h2._id)]))

    const mine = await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)
    expect(mine.body.unreadCount).toBe(1)
    expect(mine.body.items[0]).toMatchObject({ type: 'bill_generated', title: 'New bill: ₹9,000', link: '/portal/fees' })
    const inv = await Invoice.findOne({ hostelerId: w.hosteler._id }).lean()
    expect(mine.body.items[0].body).toContain(inv!.number)
    expect(mine.body.items[0].body).toContain(periodLabel(today, cycleEnd(today, 0)))
    const theirs = await api().get('/api/portal/notifications').set(h2Auth).expect(200)
    expect(theirs.body.items[0].title).toBe('New bill: ₹5,500')
    // staff get nothing for bill generation
    expect((await api().get('/api/notifications').set(w.auth).expect(200)).body).toEqual({ items: [], unreadCount: 0 })
  })
})

describe('previous balance on invoice detail', () => {
  it('lists older unpaid bills of the same hosteler (staff + portal) with the hostel UPI', async () => {
    const w = await makeWorld()
    const { hosteler: other } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Other' })
    const mk = (hostelerId: unknown, number: string, m: string, total: number, paidAmount = 0, extra: Record<string, unknown> = {}) =>
      Invoice.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId, number, month: m, items: [{ key: 'rent', label: 'Room rent', amount: total }], total, paidAmount, dueDate: `${m}-05`, ...extra })
    const jul = await mk(w.hosteler._id, 'INV-JUL', '2026-07', 3000, 0, { cancelled: true }) // cancelled: ignored
    const aug = await mk(w.hosteler._id, 'INV-AUG', '2026-08', 5000, 1000)
    await mk(w.hosteler._id, 'INV-SEP', '2026-09', 6000, 6000) // fully paid: ignored
    const sep2 = await mk(w.hosteler._id, 'INV-SEP2', '2026-09', 700) // custom bill, same month
    const oct = await mk(w.hosteler._id, 'INV-OCT', '2026-10', 7000, 500)
    await mk(other._id, 'INV-OTHER', '2026-08', 9999) // another hosteler: ignored
    const nov = await mk(w.hosteler._id, 'INV-NOV', '2026-11', 7000) // newer: not "previous" for Oct

    const staff = await api().get(`/api/invoices/${oct.id}`).set(w.auth).expect(200)
    expect(staff.body.previousBalance).toEqual({
      amount: 4000 + 700,
      invoices: [
        { id: aug.id, number: 'INV-AUG', month: '2026-08', periodStart: null, periodEnd: null, balance: 4000, dueDate: '2026-08-05' },
        { id: sep2.id, number: 'INV-SEP2', month: '2026-09', periodStart: null, periodEnd: null, balance: 700, dueDate: '2026-09-05' },
      ],
    })
    expect(staff.body.balance).toBe(6500) // this bill's own balance is separate
    expect(staff.body.hostel).toMatchObject({ upiId: 'sunrise.hostel@okhdfc', payeeName: 'Sunrise Hostels' })

    const first = await api().get(`/api/invoices/${aug.id}`).set(w.auth).expect(200)
    expect(first.body.previousBalance).toEqual({ amount: 0, invoices: [] })
    const last = await api().get(`/api/invoices/${nov.id}`).set(w.auth).expect(200)
    expect(last.body.previousBalance.amount).toBe(4000 + 700 + 6500)
    expect(last.body.previousBalance.invoices.map((i: { number: string }) => i.number)).toEqual(['INV-AUG', 'INV-SEP2', 'INV-OCT'])

    const portal = await api().get(`/api/portal/invoices/${oct.id}`).set(w.hostelerAuth).expect(200)
    expect(portal.body.previousBalance).toEqual(staff.body.previousBalance)
    expect(portal.body.hostel).toMatchObject({ upiId: 'sunrise.hostel@okhdfc', payeeName: 'Sunrise Hostels' })
    expect(jul.cancelled).toBe(true)
  })
})

describe('rent period on bill summaries', () => {
  it('dues, previous balance, payments and the portal carry periodStart / periodEnd', async () => {
    const w = await makeWorld()
    const ci = addMonthsAnchored(today, -1)
    await Hosteler.updateOne({ _id: w.hosteler._id }, { checkInDate: ci })
    const n = cycleIndexOf(ci, today) + 1
    await api().post('/api/invoices/generate').set(w.auth).send({}).expect(200)
    const bills = await Invoice.find({ hostelerId: w.hosteler._id }).sort({ periodStart: 1 }).lean()
    expect(bills).toHaveLength(n)
    const periods = bills.map((b) => ({ periodStart: b.periodStart, periodEnd: b.periodEnd }))
    expect(periods[0]).toEqual({ periodStart: ci, periodEnd: cycleEnd(ci, 0) })
    const first = bills[0]!
    const last = bills.at(-1)!
    await api().post('/api/payments').set(w.auth).send({ hostelerId: String(w.hosteler._id), invoiceId: String(first._id), amount: 100, mode: 'cash', date: today }).expect(201)

    const dues = await api().get('/api/dues').set(w.auth).expect(200)
    expect(dues.body.items[0].invoices.map((i: { periodStart: string; periodEnd: string }) => ({ periodStart: i.periodStart, periodEnd: i.periodEnd }))).toEqual(periods)

    const detail = await api().get(`/api/invoices/${String(last._id)}`).set(w.auth).expect(200)
    expect(detail.body).toMatchObject({ periodStart: last.periodStart, periodEnd: last.periodEnd })
    expect(detail.body.previousBalance.invoices[0]).toMatchObject({ number: first.number, ...periods[0] })
    const portalDetail = await api().get(`/api/portal/invoices/${String(last._id)}`).set(w.hostelerAuth).expect(200)
    expect(portalDetail.body.previousBalance).toEqual(detail.body.previousBalance)

    const info = await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)
    expect(info.body.bills.map((b: { periodStart: string; periodEnd: string }) => ({ periodStart: b.periodStart, periodEnd: b.periodEnd }))).toEqual(periods)

    const pays = await api().get('/api/payments').set(w.auth).expect(200)
    expect(pays.body.items[0].invoice).toMatchObject({ number: first.number, ...periods[0] })
    const mine = await api().get('/api/portal/payments').set(w.hostelerAuth).expect(200)
    expect(mine.body.items[0]).toMatchObject({ invoiceNumber: first.number, invoiceMonth: first.month, invoicePeriodStart: ci, invoicePeriodEnd: cycleEnd(ci, 0) })
  })
})
