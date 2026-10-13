/**
 * UPI payment claims ("I have paid" -> staff verify / reject), the portal
 * payment info, and in-app notifications.
 */
import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { api, makeHosteler, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { Hostel } from '../src/models/Hostel.js'
import { Invoice } from '../src/models/Invoice.js'
import { Notification } from '../src/models/Notification.js'
import { Payment } from '../src/models/Payment.js'
import { PaymentClaim } from '../src/models/PaymentClaim.js'
import { User } from '../src/models/User.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex')
const today = todayStr()

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

type World = Awaited<ReturnType<typeof makeWorld>>
let seq = 0

/** A bill for `h` (rent line only). */
async function bill(w: { org: { _id: mongoose.Types.ObjectId } }, h: { _id: mongoose.Types.ObjectId; hostelId: mongoose.Types.ObjectId }, total: number, month = '2026-10', extra: Record<string, unknown> = {}) {
  seq++
  return Invoice.create({
    orgId: w.org._id,
    hostelId: h.hostelId,
    hostelerId: h._id,
    number: `INV-T${seq}`,
    month,
    items: [{ key: 'rent', label: 'Room rent', amount: total }],
    total,
    dueDate: `${month}-05`,
    ...extra,
  })
}

const claim = (auth: Record<string, string>, body: Record<string, unknown>) => api().post('/api/portal/payment-claims').set(auth).send(body)

/** Submit a claim and return its id. */
async function submit(w: World, amount: number, utr: string, auth = w.hostelerAuth) {
  const r = await claim(auth, { amount, utr }).expect(201)
  return r.body.id as string
}

/** Two hostelers in the same hostel. */
async function twoHostelers() {
  const w = await makeWorld()
  const hostel = (await Hostel.findById(w.hostel._id))!
  const other = await makeHosteler(w.org._id, hostel, { bed: w.beds[1]!, name: 'Vikram Rao' })
  return { ...w, other }
}

describe('portal payment info', () => {
  it('shows the hostel UPI details and unpaid bills oldest first', async () => {
    const w = await makeWorld()
    const oct = await bill(w, w.hosteler, 7000, '2026-10', { paidAmount: 2000 })
    const aug = await bill(w, w.hosteler, 5000, '2026-08')
    await bill(w, w.hosteler, 6000, '2026-09', { paidAmount: 6000 }) // paid
    await bill(w, w.hosteler, 3000, '2026-07', { cancelled: true }) // cancelled

    const r = await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)
    expect(r.body).toMatchObject({
      hostelName: 'Sunrise Boys Hostel',
      upiId: 'sunrise.hostel@okhdfc',
      payeeName: 'Sunrise Hostels',
      hasQr: false,
      totalDue: 10000,
      pendingVerification: 0,
    })
    expect(r.body.bills.map((b: { id: string }) => b.id)).toEqual([aug.id, oct.id])
    expect(r.body.bills[1]).toMatchObject({ number: oct.number, month: '2026-10', total: 7000, paidAmount: 2000, balance: 5000, dueDate: '2026-10-05' })
    expect(r.body.bills[1].items).toEqual([{ key: 'rent', label: 'Room rent', amount: 7000 }])

    await submit(w, 1500, 'UTR1500AA')
    const after = await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)
    expect(after.body).toMatchObject({ totalDue: 10000, pendingVerification: 1500 })

    await api().get('/api/portal/payment-info').set(w.auth).expect(403) // staff token
  })
})

describe('submitting a payment claim', () => {
  it('validates amount, UTR, date and the dues', async () => {
    const w = await makeWorld()
    const r0 = await claim(w.hostelerAuth, { amount: 100, utr: 'UTR123456' }).expect(400)
    expect(r0.body.error.message).toMatch(/no unpaid bills/)

    await bill(w, w.hosteler, 6000)
    for (const utr of ['', '12345', 'UTR-12345', 'UTR 12345', 'A'.repeat(31), '₹123456'])
      await claim(w.hostelerAuth, { amount: 100, utr }).expect(400)
    await claim(w.hostelerAuth, { utr: 'UTR123456' }).expect(400) // no amount
    for (const amount of [0, -5, 10.5, 'abc']) await claim(w.hostelerAuth, { amount, utr: 'UTR123456' }).expect(400)
    await claim(w.hostelerAuth, { amount: 100, utr: 'UTR123456', paidOn: addDays(today, 2) }).expect(400) // future
    await claim(w.hostelerAuth, { amount: 100, utr: 'UTR123456', paidOn: '12/10/2026' }).expect(400)
    await claim(w.hostelerAuth, { amount: 100, utr: 'UTR123456', note: 'x'.repeat(301) }).expect(400)
    const over = await claim(w.hostelerAuth, { amount: 6001, utr: 'UTR123456' }).expect(400)
    expect(over.body.error.message).toMatch(/total due \(₹6,000\)/)
    expect(await PaymentClaim.countDocuments()).toBe(0)

    const ok = await claim(w.hostelerAuth, { amount: '4000', utr: ' utr123456 ', note: 'Paid from PhonePe' }).expect(201)
    expect(ok.body).toMatchObject({
      amount: 4000,
      utr: 'UTR123456',
      paidOn: today,
      note: 'Paid from PhonePe',
      status: 'pending',
      hasScreenshot: false,
      hostelerId: String(w.hosteler._id),
      hostelId: String(w.hostel._id),
      receivedAmount: null,
      paymentIds: [],
    })
    expect(ok.body).not.toHaveProperty('screenshotKey')
    expect(ok.body).not.toHaveProperty('reviewedBy')
    // nothing paid yet
    expect((await Invoice.findOne({ hostelerId: w.hosteler._id }).lean())!.paidAmount).toBe(0)
    expect(await Payment.countDocuments({ hostelerId: w.hosteler._id })).toBe(0)

    // amount + already-pending claims can't exceed dues
    const pend = await claim(w.hostelerAuth, { amount: 2001, utr: 'UTR999999' }).expect(400)
    expect(pend.body.error.message).toMatch(/₹4,000 .*waiting for verification/)
    const past = await claim(w.hostelerAuth, { amount: 2000, utr: 'UTR999999', paidOn: addDays(today, -3) }).expect(201)
    expect(past.body.paidOn).toBe(addDays(today, -3))
    await claim(w.hostelerAuth, { amount: 1, utr: 'UTR888888' }).expect(400) // fully claimed

    const list = await api().get('/api/portal/payment-claims').set(w.hostelerAuth).expect(200)
    expect(list.body.items.map((c: { utr: string }) => c.utr)).toEqual(['UTR999999', 'UTR123456'])
    expect(list.body.items[0]).not.toHaveProperty('screenshotKey')
  })

  it('a UTR can only be claimed once per org (unless the earlier claim was rejected)', async () => {
    const w = await twoHostelers()
    await bill(w, w.hosteler, 6000)
    await bill(w, w.other.hosteler, 6000)
    const id = await submit(w, 1000, 'UTRDUP001')
    const dup = await claim(w.hostelerAuth, { amount: 500, utr: 'utrdup001' }).expect(409)
    expect(dup.body.error.message).toMatch(/already submitted/)
    await claim(w.other.auth, { amount: 500, utr: 'UTRDUP001' }).expect(409) // another hosteler, same org

    // a different organization may coincidentally see the same UTR
    const x = await makeWorld()
    await bill(x, x.hosteler, 6000)
    await claim(x.hostelerAuth, { amount: 500, utr: 'UTRDUP001' }).expect(201)

    // verified claims still block it
    await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 1000 }).expect(200)
    await claim(w.hostelerAuth, { amount: 500, utr: 'UTRDUP001' }).expect(409)

    // rejected claims don't
    const id2 = await submit(w, 700, 'UTRDUP002')
    await api().post(`/api/payment-claims/${id2}/reject`).set(w.auth).send({ reason: 'Not received in bank' }).expect(200)
    const retry = await claim(w.hostelerAuth, { amount: 700, utr: 'UTRDUP002' }).expect(201)
    expect(retry.body.status).toBe('pending')
    expect(await PaymentClaim.countDocuments({ orgId: w.org._id, utr: 'UTRDUP002' })).toBe(2)
  })

  it('optional screenshot: image only, viewable by staff of the org and by the same hosteler', async () => {
    const w = await twoHostelers()
    await bill(w, w.hosteler, 6000)
    const bad = await api()
      .post('/api/portal/payment-claims')
      .set(w.hostelerAuth)
      .field('amount', '1000')
      .field('utr', 'UTRSHOT01')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'proof.pdf', contentType: 'application/pdf' })
    expect(bad.status).toBe(400)
    await api()
      .post('/api/portal/payment-claims')
      .set(w.hostelerAuth)
      .field('amount', '1000')
      .field('utr', 'UTRSHOT01')
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' })
      .expect(413)
    expect(await PaymentClaim.countDocuments()).toBe(0)

    const r = await api()
      .post('/api/portal/payment-claims')
      .set(w.hostelerAuth)
      .field('amount', '1000')
      .field('utr', 'UTRSHOT01')
      .field('paidOn', today)
      .attach('file', PNG, { filename: 'proof.png', contentType: 'image/png' })
      .expect(201)
    expect(r.body).toMatchObject({ amount: 1000, utr: 'UTRSHOT01', hasScreenshot: true })
    expect(r.body).not.toHaveProperty('screenshotKey')

    const mine = await api().get(`/api/portal/payment-claims/${r.body.id}/screenshot`).set(w.hostelerAuth).expect(200)
    expect(mine.headers['content-type']).toContain('image/png')
    expect(Buffer.compare(mine.body as Buffer, PNG)).toBe(0)
    await api().get(`/api/portal/payment-claims/${r.body.id}/screenshot`).set(w.other.auth).expect(404)

    const staff = await api().get(`/api/payment-claims/${r.body.id}/screenshot`).set(w.auth).expect(200)
    expect(Buffer.compare(staff.body as Buffer, PNG)).toBe(0)
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await api().get(`/api/payment-claims/${r.body.id}/screenshot`).set(accountant.auth).expect(200)
    const other = await makeOrg()
    await api().get(`/api/payment-claims/${r.body.id}/screenshot`).set(other.auth).expect(404)

    // a claim without a screenshot
    const plain = await submit(w, 500, 'UTRNOSHOT')
    await api().get(`/api/portal/payment-claims/${plain}/screenshot`).set(w.hostelerAuth).expect(404)
    await api().get(`/api/payment-claims/${plain}/screenshot`).set(w.auth).expect(404)
  })

  it('notifies active owner / manager / accountant, not wardens, inactive staff or hostelers', async () => {
    const w = await makeWorld()
    await bill(w, w.hosteler, 6000)
    const manager = await makeStaffUser(w.org._id, 'manager')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const warden = await makeStaffUser(w.org._id, 'warden')
    const gone = await makeStaffUser(w.org._id, 'accountant')
    await User.updateOne({ _id: gone.user._id }, { active: false })
    const otherOrg = await makeOrg()

    await claim(w.hostelerAuth, { amount: 2500, utr: 'UTRNOTIFY1' }).expect(201)
    const notes = await Notification.find({}).lean()
    expect(notes.map((n) => String(n.recipientId)).sort()).toEqual([String(w.owner._id), String(manager.user._id), String(accountant.user._id)].sort())
    expect(notes.every((n) => n.recipientKind === 'staff' && n.type === 'payment_submitted' && String(n.orgId) === String(w.org._id))).toBe(true)

    for (const who of [w, manager, accountant]) {
      const r = await api().get('/api/notifications').set(who.auth).expect(200)
      expect(r.body.unreadCount).toBe(1)
      expect(r.body.items[0]).toMatchObject({ type: 'payment_submitted', title: 'Aarav Sharma paid ₹2,500', link: '/app/fees?tab=verify' })
      expect(r.body.items[0].body).toContain('UTRNOTIFY1')
      expect(r.body.items[0].body).toContain(w.hosteler.loginId)
    }
    expect((await api().get('/api/notifications').set(warden.auth).expect(200)).body).toEqual({ items: [], unreadCount: 0 })
    expect((await api().get('/api/notifications').set(otherOrg.auth).expect(200)).body.unreadCount).toBe(0)
    expect((await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)).body.unreadCount).toBe(0)
  })
})

describe('verifying and rejecting claims', () => {
  it('full verification pays the bill, records a hosteler UPI payment and notifies the hosteler', async () => {
    const w = await makeWorld()
    const inv = await bill(w, w.hosteler, 6000)
    const id = await submit(w, 6000, 'UTRFULL01')
    const manager = await makeStaffUser(w.org._id, 'manager')

    const pending = await api().get('/api/payment-claims').set(w.auth).expect(200)
    expect(pending.body.items).toHaveLength(1)
    expect(pending.body.items[0]).toMatchObject({ id, status: 'pending', hosteler: { name: 'Aarav Sharma', loginId: w.hosteler.loginId } })
    expect((await api().get('/api/payment-claims/count').set(w.auth).expect(200)).body).toEqual({ pending: 1 })
    const detail = await api().get(`/api/payment-claims/${id}`).set(w.auth).expect(200)
    expect(detail.body).toMatchObject({ dues: 6000, payments: [] })
    expect(detail.body.openBills).toHaveLength(1)
    expect(detail.body.openBills[0]).toMatchObject({ id: inv.id, balance: 6000 })

    const r = await api().post(`/api/payment-claims/${id}/verify`).set(manager.auth).send({ receivedAmount: 6000 }).expect(200)
    expect(r.body.remainingDues).toBe(0)
    expect(r.body.applied).toEqual([{ invoiceId: inv.id, number: inv.number, amount: 6000 }])
    expect(r.body.claim).toMatchObject({ status: 'verified', receivedAmount: 6000, reviewedByName: 'manager' })

    expect((await Invoice.findById(inv.id).lean())!.paidAmount).toBe(6000)
    const pays = await Payment.find({ hostelerId: w.hosteler._id }).lean()
    expect(pays).toHaveLength(1)
    expect(pays[0]).toMatchObject({ amount: 6000, mode: 'upi', kind: 'rent', recordedBy: 'hosteler', reference: 'UTRFULL01', date: today, note: 'UPI payment verified' })
    expect(String(pays[0]!.invoiceId)).toBe(inv.id)
    const saved = (await PaymentClaim.findById(id).lean())!
    expect(saved.paymentIds.map(String)).toEqual([String(pays[0]!._id)])
    expect(String(saved.reviewedBy)).toBe(String(manager.user._id))
    expect(saved.reviewedAt).toBeInstanceOf(Date)

    const notes = await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)
    expect(notes.body.unreadCount).toBe(1)
    expect(notes.body.items[0]).toMatchObject({ type: 'payment_verified', title: '₹6,000 received', link: '/portal/fees' })
    expect(notes.body.items[0].body).toContain('UTRFULL01')
    expect(notes.body.items[0].body).toContain('All bills are paid')

    const detail2 = await api().get(`/api/payment-claims/${id}`).set(w.auth).expect(200)
    expect(detail2.body).toMatchObject({ dues: 0, openBills: [] })
    expect(detail2.body.payments).toHaveLength(1)
    expect((await api().get('/api/payment-claims/count').set(w.auth).expect(200)).body).toEqual({ pending: 0 })
    expect((await api().get('/api/payment-claims?status=verified').set(w.auth).expect(200)).body.items).toHaveLength(1)
    const portal = await api().get('/api/portal/payment-claims').set(w.hostelerAuth).expect(200)
    expect(portal.body.items[0]).toMatchObject({ status: 'verified', receivedAmount: 6000 })
    expect(portal.body.items[0]).not.toHaveProperty('reviewedBy')

    // already reviewed
    await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 1 }).expect(409)
    await api().post(`/api/payment-claims/${id}/reject`).set(w.auth).send({ reason: 'Changed my mind' }).expect(409)
    expect(await Payment.countDocuments({ hostelerId: w.hosteler._id })).toBe(1)
  })

  it('partial verification leaves the rest due and says so', async () => {
    const w = await makeWorld()
    const inv = await bill(w, w.hosteler, 6000)
    const id = await submit(w, 6000, 'UTRPART01')
    const r = await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 4000 }).expect(200)
    expect(r.body.remainingDues).toBe(2000)
    expect(r.body.claim).toMatchObject({ amount: 6000, receivedAmount: 4000, status: 'verified' })
    expect((await Invoice.findById(inv.id).lean())!.paidAmount).toBe(4000)
    const pay = (await Payment.findOne({ hostelerId: w.hosteler._id }).lean())!
    expect(pay.amount).toBe(4000)
    expect(pay.note).toBe('UPI payment verified (claimed ₹6,000)')

    const n = (await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)).body.items[0]
    expect(n).toMatchObject({ type: 'payment_verified', title: '₹4,000 received' })
    expect(n.body).toContain('₹4,000 of the ₹6,000')
    expect(n.body).toContain('Remaining due: ₹2,000')

    const info = await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)
    expect(info.body).toMatchObject({ totalDue: 2000, pendingVerification: 0 })
    // the hosteler can now report the rest
    await claim(w.hostelerAuth, { amount: 2001, utr: 'UTRPART02' }).expect(400)
    await claim(w.hostelerAuth, { amount: 2000, utr: 'UTRPART02' }).expect(201)
  })

  it('applies the money to the oldest bills first; custom note kept', async () => {
    const w = await makeWorld()
    const oct = await bill(w, w.hosteler, 4000, '2026-10') // created first, but newer
    const sep = await bill(w, w.hosteler, 3000, '2026-09')
    const id = await submit(w, 5000, 'UTROLD001')
    const r = await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 5000, note: 'Checked HDFC statement' }).expect(200)
    expect(r.body.applied).toEqual([
      { invoiceId: sep.id, number: sep.number, amount: 3000 },
      { invoiceId: oct.id, number: oct.number, amount: 2000 },
    ])
    expect(r.body.remainingDues).toBe(2000)
    expect((await Invoice.findById(sep.id).lean())!.paidAmount).toBe(3000)
    expect((await Invoice.findById(oct.id).lean())!.paidAmount).toBe(2000)
    const pays = await Payment.find({ hostelerId: w.hosteler._id }).sort({ createdAt: 1 }).lean()
    expect(pays.map((p) => [String(p.invoiceId), p.amount, p.reference, p.recordedBy, p.note])).toEqual([
      [sep.id, 3000, 'UTROLD001', 'hosteler', 'Checked HDFC statement'],
      [oct.id, 2000, 'UTROLD001', 'hosteler', 'Checked HDFC statement'],
    ])
    expect(new Set(pays.map((p) => p.receiptNo)).size).toBe(2)
    expect((await PaymentClaim.findById(id).lean())!.paymentIds.map(String)).toEqual(pays.map((p) => String(p._id)))
    const n = (await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)).body.items[0]
    expect(n.body).toContain('Remaining due: ₹2,000')
  })

  it('refuses more than the total dues and invalid amounts, leaving the claim pending', async () => {
    const w = await makeWorld()
    await bill(w, w.hosteler, 3000)
    const id = await submit(w, 3000, 'UTRBIG001')
    // more than the hosteler reported
    const over = await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 3001 }).expect(400)
    expect(over.body.error.message).toMatch(/₹3,000 the hosteler reported/)
    // dues shrank after the claim (cash recorded at the desk) -> more than the total due
    await api().post('/api/payments').set(w.auth).send({ hostelerId: String(w.hosteler._id), invoiceId: (await Invoice.findOne({ hostelerId: w.hosteler._id }).lean())!._id.toString(), amount: 1000, mode: 'cash', date: todayStr() }).expect(201)
    const r = await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 2500 }).expect(400)
    expect(r.body.error.message).toMatch(/more than the total due \(₹2,000\)/)
    await Payment.deleteMany({ hostelerId: w.hosteler._id })
    await Invoice.updateMany({ hostelerId: w.hosteler._id }, { paidAmount: 0 })
    for (const receivedAmount of [0, -1, 10.5, 'x', undefined]) await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount }).expect(400)
    const c = (await PaymentClaim.findById(id).lean())!
    expect(c).toMatchObject({ status: 'pending', receivedAmount: null, paymentIds: [] })
    expect(await Payment.countDocuments()).toBe(0)
    expect(await Notification.countDocuments({ recipientKind: 'hosteler' })).toBe(0)

    // bill cancelled meanwhile (nothing paid) -> no dues left
    await Invoice.updateMany({ hostelerId: w.hosteler._id }, { cancelled: true })
    const none = await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 100 }).expect(400)
    expect(none.body.error.message).toMatch(/no unpaid bills/)
    expect((await PaymentClaim.findById(id).lean())!.status).toBe('pending')
  })

  it('concurrent verifications only apply the money once', async () => {
    const w = await makeWorld()
    await bill(w, w.hosteler, 6000)
    const id = await submit(w, 3000, 'UTRRACE01')
    const rs = await Promise.all([1, 2, 3].map(() => api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 3000 })))
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409])
    expect(await Payment.countDocuments()).toBe(1)
    expect((await Invoice.findOne({ hostelerId: w.hosteler._id }).lean())!.paidAmount).toBe(3000)
  })

  it('reject needs a reason and tells the hosteler why', async () => {
    const w = await makeWorld()
    const inv = await bill(w, w.hosteler, 6000)
    const id = await submit(w, 6000, 'UTRREJ001')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await api().post(`/api/payment-claims/${id}/reject`).set(accountant.auth).send({}).expect(400)
    await api().post(`/api/payment-claims/${id}/reject`).set(accountant.auth).send({ reason: '  no ' }).expect(400)
    const r = await api().post(`/api/payment-claims/${id}/reject`).set(accountant.auth).send({ reason: 'No such UTR in our bank statement' }).expect(200)
    expect(r.body.claim).toMatchObject({ status: 'rejected', rejectReason: 'No such UTR in our bank statement', reviewedByName: 'accountant', receivedAmount: null })

    expect((await Invoice.findById(inv.id).lean())!.paidAmount).toBe(0)
    expect(await Payment.countDocuments()).toBe(0)
    const n = (await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)).body.items[0]
    expect(n).toMatchObject({ type: 'payment_rejected', title: 'Payment not confirmed', link: '/portal/fees' })
    expect(n.body).toContain('₹6,000')
    expect(n.body).toContain('UTRREJ001')
    expect(n.body).toContain('No such UTR in our bank statement')

    await api().post(`/api/payment-claims/${id}/reject`).set(w.auth).send({ reason: 'Again please' }).expect(409)
    await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 6000 }).expect(409)
    // the rejected amount no longer counts as pending
    expect((await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)).body.pendingVerification).toBe(0)
    expect((await api().get('/api/payment-claims?status=rejected').set(w.auth).expect(200)).body.items).toHaveLength(1)
    expect((await api().get('/api/payment-claims').set(w.auth).expect(200)).body.items).toHaveLength(0)
  })

  it('staff access: fees roles only; other orgs and hostelers get nothing', async () => {
    const w = await makeWorld()
    await bill(w, w.hosteler, 6000)
    const id = await submit(w, 1000, 'UTRACL001')
    const warden = await makeStaffUser(w.org._id, 'warden')
    const other = await makeOrg()

    await api().get('/api/payment-claims').set(warden.auth).expect(403)
    await api().get('/api/payment-claims/count').set(warden.auth).expect(403)
    await api().get(`/api/payment-claims/${id}`).set(warden.auth).expect(403)
    await api().post(`/api/payment-claims/${id}/verify`).set(warden.auth).send({ receivedAmount: 1000 }).expect(403)
    await api().post(`/api/payment-claims/${id}/reject`).set(warden.auth).send({ reason: 'Nope nope' }).expect(403)
    await api().get('/api/payment-claims').set(w.hostelerAuth).expect(403)
    await api().get('/api/payment-claims').expect(401)

    expect((await api().get('/api/payment-claims').set(other.auth).expect(200)).body.items).toEqual([])
    expect((await api().get('/api/payment-claims/count').set(other.auth).expect(200)).body).toEqual({ pending: 0 })
    await api().get(`/api/payment-claims/${id}`).set(other.auth).expect(404)
    await api().post(`/api/payment-claims/${id}/verify`).set(other.auth).send({ receivedAmount: 1000 }).expect(404)
    await api().post(`/api/payment-claims/${id}/reject`).set(other.auth).send({ reason: 'Not ours at all' }).expect(404)
    await api().get('/api/payment-claims/000000000000000000000000').set(w.auth).expect(404)
    await api().post('/api/payment-claims/000000000000000000000000/verify').set(w.auth).send({ receivedAmount: 1 }).expect(404)
    await api().get('/api/payment-claims/not-an-id').set(w.auth).expect(400)
    expect((await PaymentClaim.findById(id).lean())!.status).toBe('pending')

    // list filters
    const q = await api().get(`/api/payment-claims?status=all&q=${w.hosteler.loginId}`).set(w.auth).expect(200)
    expect(q.body.items).toHaveLength(1)
    expect((await api().get('/api/payment-claims?status=all&q=UTRACL').set(w.auth).expect(200)).body.items).toHaveLength(1)
    expect((await api().get('/api/payment-claims?status=all&q=nobody').set(w.auth).expect(200)).body.items).toHaveLength(0)
    expect((await api().get(`/api/payment-claims?hostelId=${w.hostel._id}`).set(w.auth).expect(200)).body.items).toHaveLength(1)
    await api().get('/api/payment-claims?status=weird').set(w.auth).expect(400)
  })
})

describe('notifications', () => {
  async function note(orgId: unknown, recipientKind: 'staff' | 'hosteler', recipientId: unknown, title: string, createdAt?: Date) {
    const n = await Notification.create({ orgId, recipientKind, recipientId, title, type: 'general' })
    if (createdAt) await Notification.collection.updateOne({ _id: n._id }, { $set: { createdAt } })
    return n
  }

  it('staff: list newest first with unreadCount, unread filter, read one, read all', async () => {
    const w = await makeWorld()
    const manager = await makeStaffUser(w.org._id, 'manager')
    const a = await note(w.org._id, 'staff', w.owner._id, 'Old', new Date('2026-01-01'))
    const b = await note(w.org._id, 'staff', w.owner._id, 'New', new Date('2026-02-01'))
    await note(w.org._id, 'staff', w.owner._id, 'Newest', new Date('2026-03-01'))
    const mgr = await note(w.org._id, 'staff', manager.user._id, 'For manager')

    const list = await api().get('/api/notifications').set(w.auth).expect(200)
    expect(list.body.unreadCount).toBe(3)
    expect(list.body.items.map((n: { title: string }) => n.title)).toEqual(['Newest', 'New', 'Old'])
    expect(list.body.items[0]).toMatchObject({ readAt: null, recipientKind: 'staff' })
    expect((await api().get('/api/notifications?limit=1').set(w.auth).expect(200)).body.items).toHaveLength(1)
    await api().get('/api/notifications?limit=0').set(w.auth).expect(400)

    const read = await api().post(`/api/notifications/${b.id}/read`).set(w.auth).expect(200)
    expect(read.body.readAt).toBeTruthy()
    const after = await api().get('/api/notifications').set(w.auth).expect(200)
    expect(after.body.unreadCount).toBe(2)
    expect(after.body.items).toHaveLength(3)
    const unread = await api().get('/api/notifications?unread=true').set(w.auth).expect(200)
    expect(unread.body.items.map((n: { title: string }) => n.title)).toEqual(['Newest', 'Old'])

    // can't touch someone else's
    await api().post(`/api/notifications/${mgr.id}/read`).set(w.auth).expect(404)
    expect((await Notification.findById(mgr.id).lean())!.readAt).toBeNull()

    const all = await api().post('/api/notifications/read-all').set(w.auth).expect(200)
    expect(all.body.updated).toBe(2)
    expect((await api().get('/api/notifications').set(w.auth).expect(200)).body.unreadCount).toBe(0)
    expect((await Notification.findById(mgr.id).lean())!.readAt).toBeNull() // read-all is per user
    expect((await Notification.findById(a.id).lean())!.readAt).not.toBeNull()
    expect((await api().get('/api/notifications').set(manager.auth).expect(200)).body.unreadCount).toBe(1)

    await api().post('/api/notifications/not-an-id/read').set(w.auth).expect(400)
    await api().post('/api/notifications/000000000000000000000000/read').set(w.auth).expect(404)
  })

  it('hosteler: own notifications only; staff and hosteler notifications never cross', async () => {
    const w = await twoHostelers()
    const mine = await note(w.org._id, 'hosteler', w.hosteler._id, 'Mine')
    const theirs = await note(w.org._id, 'hosteler', w.other.hosteler._id, 'Theirs')
    const staffNote = await note(w.org._id, 'staff', w.owner._id, 'Staff only')
    // a staff notification whose recipientId happens to equal the hosteler's id must not leak
    const forged = await note(w.org._id, 'staff', w.hosteler._id, 'Forged id')

    const list = await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)
    expect(list.body.items.map((n: { title: string }) => n.title)).toEqual(['Mine'])
    expect(list.body.unreadCount).toBe(1)

    for (const id of [theirs.id, staffNote.id, forged.id]) await api().post(`/api/portal/notifications/${id}/read`).set(w.hostelerAuth).expect(404)
    await api().post(`/api/portal/notifications/${mine.id}/read`).set(w.hostelerAuth).expect(200)
    expect((await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)).body.unreadCount).toBe(0)

    const all = await api().post('/api/portal/notifications/read-all').set(w.other.auth).expect(200)
    expect(all.body.updated).toBe(1)
    for (const n of [staffNote, forged]) expect((await Notification.findById(n.id).lean())!.readAt).toBeNull()

    // staff can't read hosteler notifications through the staff endpoint
    await api().post(`/api/notifications/${mine.id}/read`).set(w.auth).expect(404)
    const staffList = await api().get('/api/notifications').set(w.auth).expect(200)
    expect(staffList.body.items.map((n: { title: string }) => n.title)).toEqual(['Staff only'])

    // wrong token kinds
    await api().get('/api/notifications').set(w.hostelerAuth).expect(403)
    await api().get('/api/portal/notifications').set(w.auth).expect(403)
    await api().get('/api/notifications').expect(401)
  })
})

describe('verification guard rails', () => {
  it("staff can't confirm more than the hosteler reported", async () => {
    const w = await makeWorld()
    await bill(w, w.hosteler, 6000)
    const id = await submit(w, 3000, 'UTRCAP0001')
    const r = await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 3500 }).expect(400)
    expect(r.body.error.message).toMatch(/reported/)
    expect((await PaymentClaim.findById(id).lean())!.status).toBe('pending')
    await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 3000 }).expect(200)
  })

  it("payments created by a verified UPI report can't be deleted", async () => {
    const w = await makeWorld()
    await bill(w, w.hosteler, 6000)
    const id = await submit(w, 6000, 'UTRLOCK001')
    await api().post(`/api/payment-claims/${id}/verify`).set(w.auth).send({ receivedAmount: 6000 }).expect(200)
    const pay = (await Payment.findOne({ hostelerId: w.hosteler._id }).lean())!
    await api().delete(`/api/payments/${pay._id}`).set(w.auth).expect(409)
    expect(await Payment.countDocuments({ hostelerId: w.hosteler._id })).toBe(1)
  })
})
