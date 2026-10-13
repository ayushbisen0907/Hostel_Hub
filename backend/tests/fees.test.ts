import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { Invoice } from '../src/models/Invoice.js'
import { Payment } from '../src/models/Payment.js'
import { Hosteler } from '../src/models/Hosteler.js'

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const today = todayStr()
const month = today.slice(0, 7)

/** Custom invoice for the world's hosteler. */
async function customInvoice(w: Awaited<ReturnType<typeof makeWorld>>, total: number, dueDate = addDays(today, 10), m = month) {
  const r = await api()
    .post('/api/invoices')
    .set(w.auth)
    .send({ hostelerId: String(w.hosteler._id), month: m, items: [{ label: 'Rent', amount: total }], dueDate })
    .expect(201)
  return r.body as { id: string; number: string; total: number; status: string; balance: number }
}

describe('invoice generation', () => {
  it('bills active hostelers (rent + mess), is idempotent, and skips months before check-in', async () => {
    const w = await makeWorld()
    // second hosteler without mess, checked in later
    const { hosteler: h2 } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Kabir Jain', messOpted: false, monthlyRent: 5500 })
    await Hosteler.updateOne({ _id: h2._id }, { checkInDate: '2026-10-15' })

    const r1 = await api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-10' }).expect(200)
    expect(r1.body).toMatchObject({ created: 2, skipped: 0, dueDate: '2026-10-05' })
    const r2 = await api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-10', hostelId: String(w.hostel._id) }).expect(200)
    expect(r2.body).toMatchObject({ created: 0, skipped: 2 })

    const invs = await Invoice.find({ orgId: w.org._id, month: '2026-10' }).lean()
    const a = invs.find((i) => String(i.hostelerId) === String(w.hosteler._id))!
    expect(a.items.map((i) => i.label)).toEqual(['Room rent – 2026-10', 'Mess charges'])
    expect(a.total).toBe(9000)
    const b = invs.find((i) => String(i.hostelerId) === String(h2._id))!
    expect(b.total).toBe(5500)
    expect(new Set(invs.map((i) => i.number)).size).toBe(2)

    // h2 checked in Oct 15 -> not billed for September
    const sep = await api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-09' }).expect(200)
    expect(sep.body.created).toBe(1)
    const aug = await api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-08' }).expect(200)
    expect(aug.body.created).toBe(0)

    // a cancelled invoice doesn't block re-billing
    await api().post(`/api/invoices/${String(a._id)}/cancel`).set(w.auth).expect(200)
    const again = await api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-10' }).expect(200)
    expect(again.body.created).toBe(1)

    await api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-13' }).expect(400)
    await api().post('/api/invoices/generate').set(w.auth).send({ month: 'Oct' }).expect(400)
  })

  it('concurrent generate calls do not double-bill', async () => {
    const w = await makeWorld()
    await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Second' })
    const rs = await Promise.all(Array.from({ length: 3 }, () => api().post('/api/invoices/generate').set(w.auth).send({ month: '2026-11' })))
    for (const r of rs) expect(r.status).toBe(200)
    expect(rs.reduce((a, r) => a + r.body.created, 0)).toBe(2)
    expect(await Invoice.countDocuments({ orgId: w.org._id, month: '2026-11' })).toBe(2)
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
    expect(r.body.items.at(-1)).toEqual({ label: 'Late fee (10 days)', amount: 500 })

    await Invoice.updateOne({ _id: inv.id }, { dueDate: addDays(today, -12) })
    const r2 = await api().post(`/api/invoices/${inv.id}/late-fee`).set(w.auth).expect(200)
    expect(r2.body).toMatchObject({ lateFee: 600, total: 6600, replaced: true })
    expect(r2.body.items.filter((i: { label: string }) => i.label.startsWith('Late fee'))).toHaveLength(1)

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
