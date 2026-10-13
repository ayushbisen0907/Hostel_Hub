import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { Bed } from '../src/models/Bed.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Hostel } from '../src/models/Hostel.js'
import { Invoice } from '../src/models/Invoice.js'
import { Payment } from '../src/models/Payment.js'
import { Room } from '../src/models/Room.js'
import { GateLog } from '../src/models/Operations.js'
import { HDocument } from '../src/models/Document.js'
import { uploadRoot } from '../src/lib/upload.js'

function admission(hostelId: unknown, bedId: unknown, extra: Record<string, unknown> = {}) {
  return {
    name: 'Rohan Verma',
    phone: '+91 98765 43211',
    guardianName: 'Suresh',
    guardianPhone: '9876500001',
    institution: 'IIT Indore',
    hostelId: String(hostelId),
    bedId: bedId ? String(bedId) : null,
    checkInDate: '2026-10-01',
    monthlyRent: 6000,
    securityDeposit: 5000,
    messOpted: true,
    depositPayment: { amount: 5000, mode: 'upi', reference: 'UPI123' },
    generateFirstInvoice: true,
    ...extra,
  }
}

describe('admission / check-in', () => {
  it('admits with credentials, portal login works on temp password, sequential IDs', async () => {
    const w = await makeWorld()
    const r = await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, w.beds[1]!._id)).expect(201)
    const { hosteler, credentials } = r.body
    expect(hosteler).not.toHaveProperty('passwordHash')
    expect(hosteler).not.toHaveProperty('tempPassword')
    expect(hosteler.status).toBe('active')
    expect(hosteler.phone).toBe('9876543211')
    expect(hosteler.roomNumber).toBe('101')
    expect(hosteler.bedLabel).toBe('B')
    expect(hosteler.mustChangePassword).toBe(true)
    // makeWorld already issued seq 1
    expect(credentials.loginId).toBe(`${w.hostel.code}-0002`)
    expect(credentials.tempPassword).toMatch(/^[A-Za-z0-9]{8}$/)

    // bed occupied, deposit + first invoice (rent + mess), gate in
    expect(String((await Bed.findById(w.beds[1]!._id))!.hostelerId)).toBe(hosteler.id)
    const deps = await Payment.find({ hostelerId: hosteler.id })
    expect(deps).toHaveLength(1)
    expect(deps[0]!.kind).toBe('deposit')
    const invs = await Invoice.find({ hostelerId: hosteler.id })
    expect(invs).toHaveLength(1)
    expect(invs[0]!.total).toBe(6000 + 3000)
    expect(invs[0]!.dueDate).toBe('2026-10-01')
    expect(await GateLog.countDocuments({ hostelerId: hosteler.id, direction: 'in' })).toBe(1)
    expect(hosteler.dues).toBe(9000)

    // temp password is not stored in plain text
    const raw = await Hosteler.findById(hosteler.id).lean()
    expect(JSON.stringify(raw)).not.toContain(credentials.tempPassword)

    const login = await api().post('/api/portal/auth/login').send({ loginId: credentials.loginId, password: credentials.tempPassword }).expect(200)
    expect(login.body.mustChangePassword).toBe(true)

    // next admission gets the next ID
    const room2 = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    const r2 = await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, room2.beds[0]!._id, { name: 'Kabir Das' })).expect(201)
    expect(r2.body.credentials.loginId).toBe(`${w.hostel.code}-0003`)
  })

  it('rejects double-booking, bad input, maintenance rooms and other-org ids', async () => {
    const w = await makeWorld()
    // bed A is taken by makeWorld's hosteler
    await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, w.beds[0]!._id)).expect(409)
    await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, w.beds[1]!._id)).expect(201)
    await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, w.beds[1]!._id, { name: 'Second' })).expect(409)
    // sequence number was not consumed by failed attempts (transaction rolled back)
    expect((await Hosteler.find({ orgId: w.org._id })).length).toBe(2)

    await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, null, { phone: '123' })).expect(400)
    await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, null, { checkInDate: '01/10/2026' })).expect(400)
    await api().post('/api/hostelers').set(w.auth).send({ ...admission(w.hostel._id, null), hostelId: undefined }).expect(400)

    const maint = await makeRoom(w.org._id, w.hostel._id, '201', 1)
    await Room.updateOne({ _id: maint.room._id }, { status: 'maintenance' })
    await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, maint.beds[0]!._id)).expect(409)

    const other = await makeWorld()
    await api().post('/api/hostelers').set(w.auth).send(admission(other.hostel._id, null)).expect(404)
    await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, other.beds[1]!._id)).expect(404)
  })

  it('bed hostel wins; reserve-only then confirm check-in', async () => {
    const w = await makeWorld()
    const h2 = await makeHostel(w.org._id, 'Lotus Girls Hostel')
    const { beds } = await makeRoom(w.org._id, h2._id, '1', 1)
    const r = await api()
      .post('/api/hostelers')
      .set(w.auth)
      .send(admission(w.hostel._id, beds[0]!._id, { reserveOnly: true, depositPayment: null }))
      .expect(201)
    expect(r.body.hosteler.hostelId).toBe(String(h2._id))
    expect(r.body.hosteler.status).toBe('reserved')
    expect(r.body.credentials.loginId).toBe(`${h2.code}-0001`)
    expect(await GateLog.countDocuments({ hostelerId: r.body.hosteler.id })).toBe(0)
    expect(await Invoice.countDocuments({ hostelerId: r.body.hosteler.id })).toBe(0) // no invoice for reservations

    const c = await api().post(`/api/hostelers/${r.body.hosteler.id}/confirm-check-in`).set(w.auth).send({ date: '2026-10-05' }).expect(200)
    expect(c.body.status).toBe('active')
    expect(c.body.checkInDate).toBe('2026-10-05')
    expect(await GateLog.countDocuments({ hostelerId: r.body.hosteler.id, direction: 'in' })).toBe(1)
    await api().post(`/api/hostelers/${r.body.hosteler.id}/confirm-check-in`).set(w.auth).send({ date: '2026-10-05' }).expect(409)
  })
})

describe('list / detail / update', () => {
  it('lists with filters, dues and room info; patches profile only', async () => {
    const w = await makeWorld()
    await makeHosteler(w.org._id, w.hostel, { name: 'Zoya Khan', messOpted: false })
    await Invoice.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, number: 'INV-1', month: '2026-10', items: [{ label: 'Rent', amount: 6000 }], total: 6000, paidAmount: 1000, dueDate: '2026-10-05' })

    const all = await api().get('/api/hostelers').set(w.auth).expect(200)
    expect(all.body.total).toBe(2)
    const aarav = all.body.items.find((x: { name: string }) => x.name === 'Aarav Sharma')
    expect(aarav.roomNumber).toBe('101')
    expect(aarav.bedLabel).toBe('A')
    expect(aarav.dues).toBe(5000)
    expect(aarav).not.toHaveProperty('passwordHash')

    expect((await api().get('/api/hostelers?q=zoya').set(w.auth)).body.items).toHaveLength(1)
    expect((await api().get('/api/hostelers?q=(').set(w.auth).expect(200)).body.items).toHaveLength(0) // regex-escaped
    expect((await api().get(`/api/hostelers?q=${w.hosteler.loginId}`).set(w.auth)).body.items).toHaveLength(1)
    expect((await api().get('/api/hostelers?hasDues=true').set(w.auth)).body.items.map((x: { name: string }) => x.name)).toEqual(['Aarav Sharma'])
    expect((await api().get('/api/hostelers?hasDues=false').set(w.auth)).body.items.map((x: { name: string }) => x.name)).toEqual(['Zoya Khan'])
    expect((await api().get('/api/hostelers?messOpted=false').set(w.auth)).body.items).toHaveLength(1)
    expect((await api().get('/api/hostelers?status=checked_out').set(w.auth)).body.items).toHaveLength(0)
    await api().get('/api/hostelers?status=bogus').set(w.auth).expect(400)

    const d = await api().get(`/api/hostelers/${w.hosteler._id}`).set(w.auth).expect(200)
    expect(d.body.dues).toBe(5000)
    expect(d.body.counts.invoices).toBe(1)

    const p = await api().patch(`/api/hostelers/${w.hosteler._id}`).set(w.auth).send({ institution: 'DAVV', guardianPhone: '' }).expect(200)
    expect(p.body.institution).toBe('DAVV')
    await api().patch(`/api/hostelers/${w.hosteler._id}`).set(w.auth).send({ loginId: 'HACK-0001' }).expect(400)
    await api().patch(`/api/hostelers/${w.hosteler._id}`).set(w.auth).send({ status: 'checked_out' }).expect(400)
    await api().patch(`/api/hostelers/${w.hosteler._id}`).set(w.auth).send({ bedId: String(w.beds[1]!._id) }).expect(400)
    await api().patch(`/api/hostelers/${w.hosteler._id}`).set(w.auth).send({ passwordHash: 'x' }).expect(400)
  })

  it('isolates organizations', async () => {
    const a = await makeWorld()
    const b = await makeWorld()
    expect((await api().get('/api/hostelers').set(a.auth)).body.items).toHaveLength(1)
    await api().get(`/api/hostelers/${b.hosteler._id}`).set(a.auth).expect(404)
    await api().patch(`/api/hostelers/${b.hosteler._id}`).set(a.auth).send({ notes: 'x' }).expect(404)
    await api().post(`/api/hostelers/${b.hosteler._id}/reset-password`).set(a.auth).expect(404)
    await api().post(`/api/hostelers/${b.hosteler._id}/check-out`).set(a.auth).send({ date: '2026-10-10' }).expect(404)
    await api().post(`/api/hostelers/${a.hosteler._id}/transfer`).set(a.auth).send({ bedId: String(b.beds[1]!._id) }).expect(404)
    await api().delete(`/api/hostelers/${b.hosteler._id}`).set(a.auth).expect(404)
    await api().get('/api/hostelers/not-an-id').set(a.auth).expect(400)
  })

  it('enforces role permissions', async () => {
    const w = await makeWorld()
    const acct = await makeStaffUser(w.org._id, 'accountant')
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get('/api/hostelers').set(acct.auth).expect(200)
    await api().post('/api/hostelers').set(acct.auth).send(admission(w.hostel._id, w.beds[1]!._id)).expect(403)
    await api().post(`/api/hostelers/${w.hosteler._id}/check-out`).set(acct.auth).send({ date: '2026-10-10' }).expect(403)
    await api().post(`/api/hostelers/${w.hosteler._id}/transfer`).set(acct.auth).send({ bedId: String(w.beds[1]!._id) }).expect(403)
    await api().delete(`/api/hostelers/${w.hosteler._id}`).set(warden.auth).expect(403)
    await api().post('/api/hostelers').set(warden.auth).send(admission(w.hostel._id, w.beds[1]!._id)).expect(201)
    await api().get('/api/hostelers').set(w.hostelerAuth).expect(403)
    await api().get('/api/hostelers').expect(401)
  })
})

describe('transfer, check-out, reset-password, delete', () => {
  it('transfers to a vacant bed and frees the old one', async () => {
    const w = await makeWorld()
    const { room, beds } = await makeRoom(w.org._id, w.hostel._id, '301', 1, 7500)
    await api().post(`/api/hostelers/${w.hosteler._id}/transfer`).set(w.auth).send({ bedId: String(w.beds[0]!._id) }).expect(400)
    const r = await api().post(`/api/hostelers/${w.hosteler._id}/transfer`).set(w.auth).send({ bedId: String(beds[0]!._id), updateRent: true }).expect(200)
    expect(r.body.roomNumber).toBe('301')
    expect(r.body.roomId).toBe(String(room._id))
    expect(r.body.monthlyRent).toBe(7500)
    expect((await Bed.findById(w.beds[0]!._id))!.hostelerId).toBeNull()
    // occupied bed
    const other = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]! })
    await api().post(`/api/hostelers/${other.hosteler._id}/transfer`).set(w.auth).send({ bedId: String(beds[0]!._id) }).expect(409)
    expect(String((await Bed.findById(w.beds[1]!._id))!.hostelerId)).toBe(String(other.hosteler._id)) // rolled back
  })

  it('checks out with settlement, frees bed and blocks portal login', async () => {
    const w = await makeWorld()
    // deposit 5000 collected, two unpaid invoices (3000 + 4000)
    await Payment.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, kind: 'deposit', receiptNo: 'R-1', amount: 5000, mode: 'cash', date: '2026-09-01' })
    const inv1 = await Invoice.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, number: 'INV-1', month: '2026-09', items: [{ label: 'Rent', amount: 3000 }], total: 3000, dueDate: '2026-09-05' })
    const inv2 = await Invoice.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, number: 'INV-2', month: '2026-10', items: [{ label: 'Rent', amount: 4000 }], total: 4000, dueDate: '2026-10-05' })

    await api().post('/api/portal/auth/login').send({ loginId: w.hosteler.loginId, password: w.hostelerPassword }).expect(200)
    await api().post(`/api/hostelers/${w.hosteler._id}/check-out`).set(w.auth).send({ date: '2026-08-01' }).expect(400) // before check-in
    await api().post(`/api/hostelers/${w.hosteler._id}/check-out`).set(w.auth).send({ date: '2026-10-10', deductions: [{ label: 'x', amount: -5 }] }).expect(400)

    const r = await api()
      .post(`/api/hostelers/${w.hosteler._id}/check-out`)
      .set(w.auth)
      .send({ date: '2026-10-10', deductions: [{ label: 'Broken chair', amount: 500 }], adjustDuesFromDeposit: true, note: 'Keys returned' })
      .expect(200)
    const s = r.body.settlement
    expect(s.held).toBe(5000)
    expect(s.dues).toBe(7000)
    expect(s.adjusted).toBe(5000)
    expect(s.totalDeductions).toBe(500)
    expect(s.refund).toBe(0)
    expect(s.toCollect).toBe(2500)
    expect(s.days).toBe(39)
    expect(s.bed).toBe('Room 101-A')
    expect(r.body.hosteler.status).toBe('checked_out')
    expect(r.body.hosteler.bedId).toBeNull()
    expect(r.body.hosteler.depositRefunded).toBe(0)

    // oldest invoice settled first
    expect((await Invoice.findById(inv1._id))!.paidAmount).toBe(3000)
    expect((await Invoice.findById(inv2._id))!.paidAmount).toBe(2000)
    const adj = await Payment.find({ hostelerId: w.hosteler._id, note: 'Adjusted from security deposit' })
    expect(adj).toHaveLength(2)

    expect((await Bed.findById(w.beds[0]!._id))!.hostelerId).toBeNull()
    expect(await GateLog.countDocuments({ hostelerId: w.hosteler._id, direction: 'out' })).toBe(1)
    await api().post('/api/portal/auth/login').send({ loginId: w.hosteler.loginId, password: w.hostelerPassword }).expect(401)
    await api().get('/api/portal/auth/me').set(w.hostelerAuth).expect(401)
    await api().post(`/api/hostelers/${w.hosteler._id}/check-out`).set(w.auth).send({ date: '2026-10-10' }).expect(409)

    // listing defaults exclude checked-out hostelers
    expect((await api().get('/api/hostelers').set(w.auth)).body.items).toHaveLength(0)
    expect((await api().get('/api/hostelers?status=checked_out').set(w.auth)).body.items).toHaveLength(1)
  })

  it('refunds the balance when there are no dues', async () => {
    const w = await makeWorld()
    // no deposit payments recorded -> agreed securityDeposit (5000) is used
    const r = await api()
      .post(`/api/hostelers/${w.hosteler._id}/check-out`)
      .set(w.auth)
      .send({ date: '2026-10-10', deductions: [{ label: 'Cleaning', amount: 300 }] })
      .expect(200)
    expect(r.body.settlement.refund).toBe(4700)
    expect(r.body.hosteler.depositRefunded).toBe(4700)
    const w2 = await makeWorld()
    await api().post(`/api/hostelers/${w2.hosteler._id}/check-out`).set(w2.auth).send({ date: '2026-10-10', depositRefund: 9999 }).expect(400)
  })

  it('reset-password invalidates the old password and sessions', async () => {
    const w = await makeWorld()
    const acct = await makeStaffUser(w.org._id, 'accountant')
    const r = await api().post(`/api/hostelers/${w.hosteler._id}/reset-password`).set(acct.auth).expect(200)
    expect(r.body.loginId).toBe(w.hosteler.loginId)
    expect(r.body.tempPassword).toHaveLength(8)
    await api().post('/api/portal/auth/login').send({ loginId: w.hosteler.loginId, password: w.hostelerPassword }).expect(401)
    await api().get('/api/portal/auth/me').set(w.hostelerAuth).expect(401)
    const login = await api().post('/api/portal/auth/login').send({ loginId: w.hosteler.loginId, password: r.body.tempPassword }).expect(200)
    expect(login.body.mustChangePassword).toBe(true)
  })

  it('delete cascades and frees the bed (owner/manager only)', async () => {
    const w = await makeWorld()
    const mgr = await makeStaffUser(w.org._id, 'manager')
    await Invoice.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, number: 'INV-1', month: '2026-10', items: [{ label: 'Rent', amount: 6000 }], total: 6000, dueDate: '2026-10-05' })
    await GateLog.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, direction: 'out' })
    await api().delete(`/api/hostelers/${w.hosteler._id}`).set(mgr.auth).expect(204)
    expect(await Hosteler.countDocuments({ _id: w.hosteler._id })).toBe(0)
    expect(await Invoice.countDocuments({ hostelerId: w.hosteler._id })).toBe(0)
    expect(await GateLog.countDocuments({ hostelerId: w.hosteler._id })).toBe(0)
    expect((await Bed.findById(w.beds[0]!._id))!.hostelerId).toBeNull()
    await api().delete(`/api/hostelers/${w.hosteler._id}`).set(w.auth).expect(404)
  })

  it('works for a separate org owner too', async () => {
    const { org, auth } = await makeOrg()
    const hostel = await makeHostel(org._id)
    const r = await api().post('/api/hostelers').set(auth).send(admission(hostel._id, null, { depositPayment: null, generateFirstInvoice: false, securityDeposit: undefined })).expect(201)
    expect(r.body.hosteler.bedId).toBeNull()
    expect(r.body.hosteler.securityDeposit).toBe(5000) // org default
    expect(r.body.credentials.loginId).toBe(`${hostel.code}-0001`)
  })
})

describe('profile photo (staff)', () => {
  // 1x1 transparent PNG
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const keys = async () => (await HDocument.find({ type: 'photo' }).select('storageKey').lean()).map((d) => d.storageKey)

  afterEach(async () => {
    for (const k of await keys()) fs.rmSync(path.join(uploadRoot, k), { force: true })
  })

  it('uploads, replaces and serves the photo', async () => {
    const w = await makeWorld()
    await api().get(`/api/hostelers/${w.hosteler._id}/photo`).set(w.auth).expect(404)
    const r1 = await api()
      .post(`/api/hostelers/${w.hosteler._id}/photo`)
      .set(w.auth)
      .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' })
      .expect(201)
    expect(r1.body.photoUrl).toBe(`/api/hostelers/${w.hosteler._id}/photo`)
    expect(r1.body.hosteler.photoUrl).toBe(r1.body.photoUrl)
    expect(r1.body.hosteler).not.toHaveProperty('passwordHash')
    const [first] = await keys()
    expect(fs.existsSync(path.join(uploadRoot, first!))).toBe(true)

    await api()
      .post(`/api/hostelers/${w.hosteler._id}/photo`)
      .set(w.auth)
      .attach('file', PNG, { filename: 'me2.png', contentType: 'image/png' })
      .expect(201)
    const docs = await HDocument.find({ hostelerId: w.hosteler._id, type: 'photo' }).lean()
    expect(docs).toHaveLength(1)
    expect(docs[0]!.fileName).toBe('me2.png')
    expect(docs[0]!.uploadedBy).toBe('staff')
    // old file removed after the replace committed
    await new Promise((r) => setTimeout(r, 50))
    expect(fs.existsSync(path.join(uploadRoot, first!))).toBe(false)

    const img = await api().get(`/api/hostelers/${w.hosteler._id}/photo`).set(w.auth).expect(200)
    expect(img.headers['content-type']).toMatch(/^image\/png/)
  })

  it('rejects non-images, missing files, other orgs and hostelers', async () => {
    const w = await makeWorld()
    const before = fs.readdirSync(uploadRoot).length
    await api()
      .post(`/api/hostelers/${w.hosteler._id}/photo`)
      .set(w.auth)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(400)
    await api().post(`/api/hostelers/${w.hosteler._id}/photo`).set(w.auth).expect(400)
    const other = await makeWorld()
    await api()
      .post(`/api/hostelers/${other.hosteler._id}/photo`)
      .set(w.auth)
      .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' })
      .expect(404)
    expect(fs.readdirSync(uploadRoot).length).toBe(before)
    await api().get(`/api/hostelers/${w.hosteler._id}/photo`).set(w.hostelerAuth).expect(403)
  })
})

describe('first bill at check-in', () => {
  it('is itemized like a monthly bill (hostel charge heads, mess only if opted)', async () => {
    const w = await makeWorld()
    await Hostel.updateOne({ _id: w.hostel._id }, { charges: { mess: 2000, electricity: 350, laundry: 250, others: [{ label: 'Housekeeping', amount: 100 }] } })
    const r = await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, w.beds[1]!._id)).expect(201)
    const [inv] = await Invoice.find({ hostelerId: r.body.hosteler.id }).lean()
    expect(inv!.items.map((i) => ({ key: i.key, label: i.label, amount: i.amount }))).toEqual([
      { key: 'rent', label: 'Room rent', amount: 6000 },
      { key: 'mess', label: 'Mess fees', amount: 2000 },
      { key: 'electricity', label: 'Electricity', amount: 350 },
      { key: 'laundry', label: 'Laundry', amount: 250 },
      { key: 'other', label: 'Housekeeping', amount: 100 },
    ])
    expect(inv).toMatchObject({ month: '2026-10', total: 8700, dueDate: '2026-10-01' })
    expect(r.body.hosteler.dues).toBe(8700)

    const room2 = await makeRoom(w.org._id, w.hostel._id, '102', 1)
    const r2 = await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, room2.beds[0]!._id, { name: 'No Mess', messOpted: false })).expect(201)
    const [inv2] = await Invoice.find({ hostelerId: r2.body.hosteler.id }).lean()
    expect(inv2!.items.map((i) => i.key)).toEqual(['rent', 'electricity', 'laundry', 'other'])
    expect(inv2!.total).toBe(6700)

    // no first bill when not asked for
    const room3 = await makeRoom(w.org._id, w.hostel._id, '103', 1)
    const r3 = await api().post('/api/hostelers').set(w.auth).send(admission(w.hostel._id, room3.beds[0]!._id, { name: 'Later', generateFirstInvoice: false })).expect(201)
    expect(await Invoice.countDocuments({ hostelerId: r3.body.hosteler.id })).toBe(0)
  })
})
