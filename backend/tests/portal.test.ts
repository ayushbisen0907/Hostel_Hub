import type { Plan } from '../src/lib/plans.js'
import { afterEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { api, makeHosteler, makeWorld } from './helpers.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Hostel } from '../src/models/Hostel.js'
import { Invoice } from '../src/models/Invoice.js'
import { Payment } from '../src/models/Payment.js'
import { PaymentClaim } from '../src/models/PaymentClaim.js'
import { HDocument } from '../src/models/Document.js'
import { Complaint, Leave, MealOptOut, MessMenu, Notice } from '../src/models/Operations.js'
import { clock } from '../src/modules/portal/clock.js'

const realNow = clock.now
afterEach(() => {
  clock.now = realNow
})

/** Freeze the portal clock at a local date/time. */
function freeze(y: number, m: number, d: number, hh: number, mm = 0) {
  clock.now = () => new Date(y, m - 1, d, hh, mm)
}

async function makeInvoice(w: { org: { _id: mongoose.Types.ObjectId } }, h: { _id: mongoose.Types.ObjectId; hostelId: mongoose.Types.ObjectId }, total = 6000, n = Math.random()) {
  return Invoice.create({
    orgId: w.org._id,
    hostelId: h.hostelId,
    hostelerId: h._id,
    number: `INV-${Math.floor(n * 1e9)}`,
    month: '2026-10',
    items: [{ label: 'Rent', amount: total }],
    total,
    dueDate: '2026-10-05',
  })
}

/** Two hostelers in the same hostel/room. */
async function twoHostelers(plan: Plan = 'business') {
  const w = await makeWorld({ plan })
  const hostel = (await Hostel.findById(w.hostel._id))!
  const other = await makeHosteler(w.org._id, hostel, { bed: w.beds[1]!, name: 'Vikram Rao' })
  return { ...w, other }
}

describe('portal access control', () => {
  it('temp-password hosteler gets 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const w = await makeWorld()
    const hostel = (await Hostel.findById(w.hostel._id))!
    const temp = await makeHosteler(w.org._id, hostel, { mustChangePassword: true })
    const r = await api().get('/api/portal/home').set(temp.auth).expect(403)
    expect(r.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    await api().get('/api/portal/invoices').set(temp.auth).expect(403)
  })

  it('free plan: the app works for bills and payments only; Starter adds mess, notices…, Pro adds attendance', async () => {
    const free = await makeWorld({ plan: 'free' })
    const home = await api().get('/api/portal/home').set(free.hostelerAuth).expect(200)
    expect(home.body.todayMenu).toBeNull()
    expect(home.body.last7DaysAttendance).toBeNull()
    expect(home.body.features).toEqual({ mess: false, attendance: false, notices: false, complaints: false, documents: false, gateLog: false, moveOut: false })
    await api().get('/api/portal/invoices').set(free.hostelerAuth).expect(200)
    await api().get('/api/portal/payment-info').set(free.hostelerAuth).expect(200)
    for (const path of ['/mess/menu', '/leaves', '/attendance', '/complaints', '/notices', '/documents', '/gate-logs', '/move-out']) {
      const r = await api().get(`/api/portal${path}`).set(free.hostelerAuth).expect(402)
      expect(r.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')
    }

    const starter = await makeWorld({ plan: 'starter' })
    const s = await api().get('/api/portal/home').set(starter.hostelerAuth).expect(200)
    expect(s.body.features).toEqual({ mess: true, attendance: false, notices: true, complaints: true, documents: true, gateLog: false, moveOut: true })
    await api().get('/api/portal/mess/menu').set(starter.hostelerAuth).expect(200)
    await api().get('/api/portal/move-out').set(starter.hostelerAuth).expect(200)
    await api().get('/api/portal/leaves').set(starter.hostelerAuth).expect(402)
    await api().get('/api/portal/attendance').set(starter.hostelerAuth).expect(402)
    await api().get('/api/portal/gate-logs').set(starter.hostelerAuth).expect(402)
  })

  it('checked-out hosteler -> 401; staff token -> 403; no token -> 401', async () => {
    const w = await makeWorld()
    await api().get('/api/portal/home').expect(401)
    await api().get('/api/portal/home').set(w.auth).expect(403)
    await Hosteler.updateOne({ _id: w.hosteler._id }, { status: 'checked_out' })
    await api().get('/api/portal/home').set(w.hostelerAuth).expect(401)
  })
})

describe('portal home & profile', () => {
  it('home returns own data without secrets', async () => {
    freeze(2026, 10, 12, 8)
    const w = await makeWorld()
    await makeInvoice(w, w.hosteler, 6000)
    await Notice.create({ orgId: w.org._id, hostelId: null, title: 'Water cut', pinned: false })
    await Notice.create({ orgId: w.org._id, hostelId: w.hostel._id, title: 'Fee reminder', pinned: true })
    const otherHostel = await Hostel.create({ orgId: w.org._id, name: 'Other', type: 'girls', city: 'Indore', code: 'OTHX' })
    await Notice.create({ orgId: w.org._id, hostelId: otherHostel._id, title: 'Not for you' })
    await MessMenu.create({ orgId: w.org._id, hostelId: w.hostel._id, day: 1, meal: 'lunch', items: 'Dal, rice' }) // 2026-10-12 is a Monday

    const r = await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)
    expect(r.body.hosteler.id).toBe(String(w.hosteler._id))
    expect(r.body.hosteler).not.toHaveProperty('passwordHash')
    expect(r.body.hosteler).not.toHaveProperty('tokenVersion')
    expect(r.body.bed).toBe('Room 101 · Bed A')
    expect(r.body.dues).toMatchObject({ total: 6000, nextDueDate: '2026-10-05', overdue: true })
    expect(r.body.notices.map((n: { title: string }) => n.title)).toEqual(['Fee reminder', 'Water cut'])
    expect(r.body.todayMenu).toHaveLength(4)
    expect(r.body.todayMenu[1]).toMatchObject({ meal: 'lunch', items: 'Dal, rice', skipped: false })
    expect(r.body.last7DaysAttendance).toHaveLength(7)
    expect(r.body).toMatchObject({ today: '2026-10-12', currencySymbol: '₹', features: { mess: true, attendance: true } })

    const notices = await api().get('/api/portal/notices').set(w.hostelerAuth).expect(200)
    expect(notices.body.items).toHaveLength(2)
  })

  it('PATCH /profile updates only allowed fields and rejects others', async () => {
    const w = await makeWorld()
    const ok = await api()
      .patch('/api/portal/profile')
      .set(w.hostelerAuth)
      .send({ email: 'Aarav@Mail.com', permanentAddress: 'Jaipur', guardianPhone: '9811122233' })
      .expect(200)
    expect(ok.body.hosteler).toMatchObject({ email: 'aarav@mail.com', permanentAddress: 'Jaipur', guardianPhone: '9811122233' })

    await api().patch('/api/portal/profile').set(w.hostelerAuth).send({ monthlyRent: 1 }).expect(400)
    await api().patch('/api/portal/profile').set(w.hostelerAuth).send({ email: 'x@y.in', name: 'Hacker' }).expect(400)
    await api().patch('/api/portal/profile').set(w.hostelerAuth).send({ guardianPhone: '123' }).expect(400)
    const h = await Hosteler.findById(w.hosteler._id).lean()
    expect(h).toMatchObject({ monthlyRent: 6000, name: 'Aarav Sharma', email: 'aarav@mail.com' })
  })

  it('profile photo upload (image ≤ 2MB) and streaming', async () => {
    const w = await makeWorld()
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const r = await api().post('/api/portal/profile/photo').set(w.hostelerAuth).attach('file', png, { filename: 'me.png', contentType: 'image/png' }).expect(201)
    expect(r.body.photoUrl).toBe('/api/portal/profile/photo')
    const got = await api().get('/api/portal/profile/photo').set(w.hostelerAuth).expect(200)
    expect(got.headers['content-type']).toContain('image/png')
    await api().post('/api/portal/profile/photo').set(w.hostelerAuth).attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400)
    const big = Buffer.alloc(2 * 1024 * 1024 + 10)
    await api().post('/api/portal/profile/photo').set(w.hostelerAuth).attach('file', big, { filename: 'big.png', contentType: 'image/png' }).expect(413)
  })
})

describe('portal isolation between hostelers', () => {
  it("cannot read another hosteler's invoice / payment / document / complaint", async () => {
    const w = await twoHostelers()
    const theirInv = await makeInvoice(w, w.other.hosteler)
    const theirPay = await Payment.create({
      orgId: w.org._id,
      hostelId: w.hostel._id,
      hostelerId: w.other.hosteler._id,
      invoiceId: theirInv._id,
      kind: 'rent',
      receiptNo: 'RCPT-1',
      amount: 100,
      mode: 'cash',
      date: '2026-10-01',
    })
    const theirDoc = await HDocument.create({
      orgId: w.org._id,
      hostelId: w.hostel._id,
      hostelerId: w.other.hosteler._id,
      type: 'aadhaar',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      size: 10,
      storageKey: 'nope.pdf',
    })
    const theirComplaint = await Complaint.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.other.hosteler._id, category: 'plumbing', title: 'Leak' })

    await api().get(`/api/portal/invoices/${theirInv._id}`).set(w.hostelerAuth).expect(404)
    await api().get(`/api/portal/payments/${theirPay._id}`).set(w.hostelerAuth).expect(404)
    await api().get(`/api/portal/documents/${theirDoc._id}/file`).set(w.hostelerAuth).expect(404)
    await api().post(`/api/portal/complaints/${theirComplaint._id}/comments`).set(w.hostelerAuth).send({ text: 'hi' }).expect(404)
    const theirClaim = await PaymentClaim.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.other.hosteler._id, amount: 100, utr: 'THEIRS123', paidOn: '2026-10-01', screenshotKey: 'nope.png', screenshotMime: 'image/png' })
    await api().get(`/api/portal/payment-claims/${theirClaim._id}/screenshot`).set(w.hostelerAuth).expect(404)
    await api().post('/api/portal/pay').set(w.hostelerAuth).send({ invoiceId: String(theirInv._id), amount: 10, method: 'upi' }).expect(404) // route removed

    for (const path of ['invoices', 'payments', 'documents', 'complaints', 'payment-claims']) {
      const r = await api().get(`/api/portal/${path}`).set(w.hostelerAuth).expect(200)
      expect(r.body.items).toHaveLength(0)
    }
    // owner still sees theirs
    const theirs = await api().get(`/api/portal/invoices/${theirInv._id}`).set(w.other.auth).expect(200)
    expect(theirs.body.invoice.balance).toBe(6000 - 0)
    const c = await Complaint.findById(theirComplaint._id).lean()
    expect(c!.comments).toHaveLength(0)
  })

  it('ignores client-supplied hostelerId / hostelId on create', async () => {
    const w = await twoHostelers()
    const r = await api()
      .post('/api/portal/complaints')
      .set(w.hostelerAuth)
      .send({ category: 'internet', title: 'WiFi down', description: 'since morning', hostelerId: String(w.other.hosteler._id) })
      .expect(201)
    expect(r.body.complaint.hostelerId).toBe(String(w.hosteler._id))
    expect(r.body.complaint.roomId).toBe(String(w.room._id))
    const cm = await api().post(`/api/portal/complaints/${r.body.complaint.id}/comments`).set(w.hostelerAuth).send({ text: 'Still down' }).expect(201)
    expect(cm.body.complaint.comments[0]).toMatchObject({ by: 'Aarav Sharma', byKind: 'hosteler', text: 'Still down' })
    await api().post(`/api/portal/complaints/${r.body.complaint.id}/comments`).set(w.other.auth).send({ text: 'me too' }).expect(404)
  })
})

describe('portal payments', () => {
  it('direct "pay" is gone: hosteler reports a UPI payment, staff verify, balance + receipt update', async () => {
    const w = await makeWorld()
    const inv = await makeInvoice(w, w.hosteler, 6000)

    const gone = await api().post('/api/portal/pay').set(w.hostelerAuth).send({ invoiceId: String(inv._id), amount: 100, method: 'upi' }).expect(404)
    expect(gone.body.error.code).toBe('ROUTE_NOT_FOUND')

    await api().post('/api/portal/payment-claims').set(w.hostelerAuth).send({ amount: 6001, utr: 'UTR0000001' }).expect(400)
    await api().post('/api/portal/payment-claims').set(w.hostelerAuth).send({ amount: 0, utr: 'UTR0000001' }).expect(400)
    const c1 = await api().post('/api/portal/payment-claims').set(w.hostelerAuth).send({ amount: 2500, utr: 'utr0000001' }).expect(201)
    expect(c1.body).toMatchObject({ amount: 2500, utr: 'UTR0000001', status: 'pending', hasScreenshot: false })

    // nothing is paid until staff verify
    let list = await api().get('/api/portal/invoices').set(w.hostelerAuth).expect(200)
    expect(list.body.items[0]).toMatchObject({ paidAmount: 0, balance: 6000 })
    const v1 = await api().post(`/api/payment-claims/${c1.body.id}/verify`).set(w.auth).send({ receivedAmount: 2500 }).expect(200)
    expect(v1.body.remainingDues).toBe(3500)
    list = await api().get('/api/portal/invoices').set(w.hostelerAuth).expect(200)
    expect(list.body.items[0]).toMatchObject({ paidAmount: 2500, balance: 3500 })

    await api().post('/api/portal/payment-claims').set(w.hostelerAuth).send({ amount: 3501, utr: 'UTR0000002' }).expect(400)
    const c2 = await api().post('/api/portal/payment-claims').set(w.hostelerAuth).send({ amount: 3500, utr: 'UTR0000002' }).expect(201)
    await api().post(`/api/payment-claims/${c2.body.id}/verify`).set(w.auth).send({ receivedAmount: 3500 }).expect(200)
    const done = await api().get(`/api/portal/invoices/${inv._id}`).set(w.hostelerAuth).expect(200)
    expect(done.body.invoice).toMatchObject({ balance: 0, status: 'paid' })
    expect(done.body.payments).toHaveLength(2)
    expect(done.body.hostel).toMatchObject({ name: 'Sunrise Boys Hostel', upiId: 'sunrise.hostel@okhdfc', payeeName: 'Sunrise Hostels' })
    await api().post('/api/portal/payment-claims').set(w.hostelerAuth).send({ amount: 1, utr: 'UTR0000003' }).expect(400) // no dues left

    const pays = await api().get('/api/portal/payments').set(w.hostelerAuth).expect(200)
    expect(pays.body.items).toHaveLength(2)
    const first = pays.body.items.find((p: { reference: string }) => p.reference === 'UTR0000001')
    expect(first).toMatchObject({ amount: 2500, mode: 'upi', recordedBy: 'hosteler', kind: 'rent', invoiceNumber: inv.number })
    const rcpt = await api().get(`/api/portal/payments/${first.id}`).set(w.hostelerAuth).expect(200)
    expect(rcpt.body.payment.receiptNo).toBeTruthy()
    expect(rcpt.body.invoice.number).toBe(inv.number)
    expect(rcpt.body.hosteler.loginId).toBe(w.hosteler.loginId)
  })
})

describe('portal mess', () => {
  it('meal skip cut-offs and past-date rules', async () => {
    freeze(2030, 1, 15, 9, 30) // 09:30 local on 2030-01-15
    const w = await makeWorld()
    const skip = (date: string, meal: string) => api().post('/api/portal/mess/opt-outs').set(w.hostelerAuth).send({ date, meal })
    const unskip = (date: string, meal: string) => api().delete('/api/portal/mess/opt-outs').set(w.hostelerAuth).send({ date, meal })

    await skip('2030-01-14', 'dinner').expect(400) // past date
    await skip('2020-05-01', 'lunch').expect(400)
    await skip('2030-01-15', 'breakfast').expect(400) // cut-off 07:00 passed
    await skip('2030-01-15', 'lunch').expect(201) // cut-off 10:00 not yet
    await skip('2030-01-15', 'lunch').expect(200) // idempotent
    await skip('2030-01-16', 'breakfast').expect(201) // tomorrow is always open
    await skip('2030-01-15', 'feast').expect(400)

    const list = await api().get('/api/portal/mess/opt-outs?from=2030-01-15&to=2030-01-20').set(w.hostelerAuth).expect(200)
    expect(list.body.items).toHaveLength(2)

    freeze(2030, 1, 15, 10, 0) // lunch window closed
    await unskip('2030-01-15', 'lunch').expect(400)
    await unskip('2030-01-16', 'breakfast').expect(200)
    await unskip('2030-01-16', 'breakfast').expect(404)
    expect(await MealOptOut.countDocuments({ hostelerId: w.hosteler._id })).toBe(1)

    // must be enrolled in the mess
    await Hosteler.updateOne({ _id: w.hosteler._id }, { messOpted: false })
    const r = await skip('2030-01-17', 'dinner').expect(403)
    expect(r.body.error.code).toBe('MESS_NOT_OPTED')
  })

  it('menu and feedback', async () => {
    freeze(2030, 1, 15, 12)
    const w = await makeWorld()
    await MessMenu.create({ orgId: w.org._id, hostelId: w.hostel._id, day: 2, meal: 'dinner', items: 'Paneer' })
    await MessMenu.create({ orgId: w.org._id, hostelId: w.hostel._id, day: 2, meal: 'breakfast', items: 'Poha' })
    const menu = await api().get('/api/portal/mess/menu').set(w.hostelerAuth).expect(200)
    expect(menu.body.items.map((m: { meal: string }) => m.meal)).toEqual(['breakfast', 'dinner'])

    await api().post('/api/portal/mess/feedback').set(w.hostelerAuth).send({ meal: 'lunch', rating: 6 }).expect(400)
    await api().post('/api/portal/mess/feedback').set(w.hostelerAuth).send({ meal: 'lunch', rating: 4, date: '2030-01-16' }).expect(400)
    const fb = await api().post('/api/portal/mess/feedback').set(w.hostelerAuth).send({ meal: 'lunch', rating: 4, comment: 'Good' }).expect(201)
    expect(fb.body.feedback).toMatchObject({ date: '2030-01-15', rating: 4, hostelerId: String(w.hosteler._id) })
    const list = await api().get('/api/portal/mess/feedback').set(w.hostelerAuth).expect(200)
    expect(list.body.items).toHaveLength(1)
  })
})

describe('portal leave', () => {
  it('validates dates, rejects overlaps with 409, cancels own pending only', async () => {
    freeze(2030, 3, 10, 12)
    const w = await twoHostelers()
    const apply = (auth: Record<string, string>, from: string, to: string) =>
      api().post('/api/portal/leaves').set(auth).send({ from, to, destination: 'Home', reason: 'Festival' })

    await apply(w.hostelerAuth, '2030-03-09', '2030-03-12').expect(400) // past
    await apply(w.hostelerAuth, '2030-03-15', '2030-03-12').expect(400) // to < from
    const first = await apply(w.hostelerAuth, '2030-03-12', '2030-03-15').expect(201)
    expect(first.body.leave.status).toBe('pending')
    const dup = await apply(w.hostelerAuth, '2030-03-15', '2030-03-18').expect(409)
    expect(dup.body.error.code).toBe('CONFLICT')
    await apply(w.other.auth, '2030-03-12', '2030-03-15').expect(201) // other hostelers don't conflict

    // rejected leaves don't block
    await Leave.updateOne({ _id: first.body.leave.id }, { status: 'rejected' })
    const second = await apply(w.hostelerAuth, '2030-03-14', '2030-03-16').expect(201)

    await api().delete(`/api/portal/leaves/${first.body.leave.id}`).set(w.hostelerAuth).expect(409) // not pending
    await api().delete(`/api/portal/leaves/${second.body.leave.id}`).set(w.other.auth).expect(404) // not theirs
    await api().delete(`/api/portal/leaves/${second.body.leave.id}`).set(w.hostelerAuth).expect(200)
    const mine = await api().get('/api/portal/leaves').set(w.hostelerAuth).expect(200)
    expect(mine.body.items).toHaveLength(1)
  })
})

describe('portal documents, attendance, gate log', () => {
  it('uploads own documents (≤ 2MB image/PDF) and streams them', async () => {
    const w = await twoHostelers()
    await api().post('/api/portal/documents').set(w.hostelerAuth).field('type', 'aadhaar').attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400)
    await api().post('/api/portal/documents').set(w.hostelerAuth).field('type', 'aadhaar').attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(413)
    await api().post('/api/portal/documents').set(w.hostelerAuth).field('type', 'passport').attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400)
    const up = await api().post('/api/portal/documents').set(w.hostelerAuth).field('type', 'aadhaar').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'aadhaar.pdf', contentType: 'application/pdf' }).expect(201)
    expect(up.body.document).toMatchObject({ type: 'aadhaar', uploadedBy: 'hosteler', verified: false, hostelerId: String(w.hosteler._id) })
    expect(up.body.document).not.toHaveProperty('storageKey')

    const list = await api().get('/api/portal/documents').set(w.hostelerAuth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]).not.toHaveProperty('storageKey')
    const file = await api().get(`/api/portal/documents/${up.body.document.id}/file`).set(w.hostelerAuth).expect(200)
    expect(file.headers['content-type']).toContain('application/pdf')
    await api().get(`/api/portal/documents/${up.body.document.id}/file`).set(w.other.auth).expect(404)
  })

  it('attendance summary and gate logs are own only', async () => {
    const w = await twoHostelers()
    const { Attendance, GateLog } = await import('../src/models/Operations.js')
    await Attendance.create([
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, date: '2030-04-01', status: 'present' },
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, date: '2030-04-02', status: 'late' },
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.other.hosteler._id, date: '2030-04-01', status: 'absent' },
    ])
    await GateLog.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.other.hosteler._id, direction: 'out' })
    await GateLog.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, direction: 'in' })
    const a = await api().get('/api/portal/attendance?month=2030-04').set(w.hostelerAuth).expect(200)
    expect(a.body.summary).toMatchObject({ present: 1, late: 1, absent: 0, total: 2 })
    await api().get('/api/portal/attendance?month=April').set(w.hostelerAuth).expect(400)
    const g = await api().get('/api/portal/gate-logs').set(w.hostelerAuth).expect(200)
    expect(g.body.items).toHaveLength(1)
    expect(g.body.items[0].direction).toBe('in')
  })
})

