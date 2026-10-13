import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeRoom, makeStaffUser, makeWorld, TEST_UPI } from './helpers.js'
import { Hostel } from '../src/models/Hostel.js'
import { Room } from '../src/models/Room.js'
import { Bed } from '../src/models/Bed.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { MessMenu, Staff } from '../src/models/Operations.js'
import { uploadRoot } from '../src/lib/upload.js'

describe('hostels', () => {
  it('creates with generated or provided codes; codes are globally unique', async () => {
    const a = await makeOrg()
    const b = await makeOrg()
    const h1 = await api().post('/api/hostels').set(a.auth).send({ ...TEST_UPI, name: 'Sunrise Boys Hostel', type: 'boys', city: 'Indore' }).expect(201)
    expect(h1.body.code).toBe('SBH')
    expect(h1.body.counts).toEqual({ rooms: 0, beds: 0, occupied: 0, vacant: 0, activeHostelers: 0 })
    // another org with the same initials gets a different code
    const h2 = await api().post('/api/hostels').set(b.auth).send({ ...TEST_UPI, name: 'Silver Bell House', type: 'coed', city: 'Pune' }).expect(201)
    expect(h2.body.code).toBe('SBH2')

    const h3 = await api().post('/api/hostels').set(a.auth).send({ ...TEST_UPI, name: 'Lotus', type: 'girls', city: 'Indore', code: 'lot1' }).expect(201)
    expect(h3.body.code).toBe('LOT1')
    await api().post('/api/hostels').set(b.auth).send({ ...TEST_UPI, name: 'Lotus Two', type: 'girls', city: 'Pune', code: 'LOT1' }).expect(409)
    await api().post('/api/hostels').set(a.auth).send({ ...TEST_UPI, name: 'Bad', type: 'girls', city: 'Pune', code: 'A' }).expect(400)
    await api().post('/api/hostels').set(a.auth).send({ ...TEST_UPI, name: 'Bad Code', type: 'girls', city: 'Pune', code: 'AB-12' }).expect(400)
    await api().post('/api/hostels').set(a.auth).send({ ...TEST_UPI, name: 'No city', type: 'boys' }).expect(400)
    await api().post('/api/hostels').set(a.auth).send({ ...TEST_UPI, name: 'Wrong type', type: 'mixed', city: 'X' }).expect(400)
  })

  it('lists with counts and gets one; any staff may read, only hostel managers write', async () => {
    const w = await makeWorld()
    await makeRoom(w.org._id, w.hostel._id, '102', 3)
    const warden = await makeStaffUser(w.org._id, 'warden')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const manager = await makeStaffUser(w.org._id, 'manager')

    const list = await api().get('/api/hostels').set(accountant.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0].counts).toEqual({ rooms: 2, beds: 5, occupied: 1, vacant: 4, activeHostelers: 1 })
    const one = await api().get(`/api/hostels/${w.hostel._id}`).set(warden.auth).expect(200)
    expect(one.body.name).toBe(w.hostel.name)

    await api().post('/api/hostels').set(warden.auth).send({ ...TEST_UPI, name: 'Nope', type: 'boys', city: 'X' }).expect(403)
    await api().patch(`/api/hostels/${w.hostel._id}`).set(accountant.auth).send({ name: 'Nope' }).expect(403)
    await api().patch(`/api/hostels/${w.hostel._id}`).set(manager.auth).send({ city: 'Bhopal' }).expect(200)
  })

  it('code cannot change once hosteler IDs were issued', async () => {
    const { org, auth } = await makeOrg()
    const fresh = await makeHostel(org._id, 'Fresh')
    const r = await api().patch(`/api/hostels/${fresh._id}`).set(auth).send({ code: 'frsh', name: 'Fresh Stay' }).expect(200)
    expect(r.body).toMatchObject({ code: 'FRSH', name: 'Fresh Stay' })
    const other = await makeHostel(org._id, 'Other')
    await api().patch(`/api/hostels/${other._id}`).set(auth).send({ code: 'FRSH' }).expect(409)

    await makeHosteler(org._id, (await Hostel.findById(fresh._id))!)
    await api().patch(`/api/hostels/${fresh._id}`).set(auth).send({ code: 'NEW1' }).expect(409)
    await api().patch(`/api/hostels/${fresh._id}`).set(auth).send({ code: 'FRSH', phone: '9826000000' }).expect(200) // same code is fine
    await api().patch(`/api/hostels/${fresh._id}`).set(auth).send({ orgId: String(org._id) }).expect(400)
  })

  it('delete refuses while hostelers stay, otherwise cascades', async () => {
    const w = await makeWorld()
    await MessMenu.create({ orgId: w.org._id, hostelId: w.hostel._id, day: 1, meal: 'lunch', items: 'Dal' })
    await Staff.create({ orgId: w.org._id, hostelId: w.hostel._id, name: 'Cook', role: 'cook', joinDate: '2026-01-01' })
    await api().delete(`/api/hostels/${w.hostel._id}`).set(w.auth).expect(409)

    await Hosteler.updateOne({ _id: w.hosteler._id }, { status: 'checked_out', bedId: null, roomId: null })
    await Bed.updateMany({ hostelId: w.hostel._id }, { hostelerId: null })
    await api().delete(`/api/hostels/${w.hostel._id}`).set(w.auth).expect(200)
    expect(await Hostel.countDocuments({ _id: w.hostel._id })).toBe(0)
    expect(await Room.countDocuments({ hostelId: w.hostel._id })).toBe(0)
    expect(await Bed.countDocuments({ hostelId: w.hostel._id })).toBe(0)
    expect(await MessMenu.countDocuments({ hostelId: w.hostel._id })).toBe(0)
    expect(await Staff.countDocuments({ hostelId: w.hostel._id })).toBe(0)
  })

  it('isolates organizations', async () => {
    const w = await makeWorld()
    const other = await makeOrg()
    const id = String(w.hostel._id)
    expect((await api().get('/api/hostels').set(other.auth).expect(200)).body.items).toEqual([])
    await api().get(`/api/hostels/${id}`).set(other.auth).expect(404)
    await api().patch(`/api/hostels/${id}`).set(other.auth).send({ name: 'Mine now' }).expect(404)
    await api().delete(`/api/hostels/${id}`).set(other.auth).expect(404)
    await api().get('/api/hostels/xyz').set(other.auth).expect(400)
  })
})

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex')
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')
const stored = (key: string) => fs.existsSync(path.join(uploadRoot, key))
/** removeStoredFile is fire-and-forget; wait until the file is gone */
async function gone(key: string) {
  for (let i = 0; i < 50 && stored(key); i++) await new Promise((r) => setTimeout(r, 20))
  return !stored(key)
}

describe('hostel UPI details and monthly charges', () => {
  const base = { name: 'Lotus Girls Hostel', type: 'girls', city: 'Indore' }

  it('requires a valid UPI ID and payee name on create', async () => {
    const { auth } = await makeOrg()
    const noUpi = await api().post('/api/hostels').set(auth).send({ ...base, payeeName: 'Lotus' }).expect(400)
    expect(noUpi.body.error.message).toMatch(/upiId/)
    for (const upiId of ['', 'lotus', 'lotus@', '@okhdfc', 'lo tus@okhdfc', 'lotus@1bank', 'a@b']) {
      await api().post('/api/hostels').set(auth).send({ ...base, upiId, payeeName: 'Lotus' }).expect(400)
    }
    const noPayee = await api().post('/api/hostels').set(auth).send({ ...base, upiId: 'lotus@okicici' }).expect(400)
    expect(noPayee.body.error.message).toMatch(/payeeName/)
    await api().post('/api/hostels').set(auth).send({ ...base, upiId: 'lotus@okicici', payeeName: ' ' }).expect(400)
    expect(await Hostel.countDocuments()).toBe(0)

    const ok = await api().post('/api/hostels').set(auth).send({ ...base, upiId: ' lotus.girls-1@okicici ', payeeName: ' Lotus Hostels ' }).expect(201)
    expect(ok.body).toMatchObject({ upiId: 'lotus.girls-1@okicici', payeeName: 'Lotus Hostels', hasQr: false })
    // no charges given -> all heads 0
    expect(ok.body.charges).toEqual({ mess: 0, electricity: 0, water: 0, internet: 0, laundry: 0, maintenance: 0, others: [] })
    expect(ok.body).not.toHaveProperty('qrStorageKey')

    // PATCH validates the UPI ID too
    await api().patch(`/api/hostels/${ok.body.id}`).set(auth).send({ upiId: 'not-a-upi' }).expect(400)
    await api().patch(`/api/hostels/${ok.body.id}`).set(auth).send({ payeeName: 'x' }).expect(400)
    const p = await api().patch(`/api/hostels/${ok.body.id}`).set(auth).send({ upiId: 'lotus@ybl' }).expect(200)
    expect(p.body).toMatchObject({ upiId: 'lotus@ybl', payeeName: 'Lotus Hostels' })
  })

  it('saves charge heads on create and replaces them on PATCH', async () => {
    const { auth } = await makeOrg()
    const charges = { mess: 2500, electricity: 400, internet: 300, others: [{ label: 'Housekeeping', amount: 150 }] }
    const r = await api().post('/api/hostels').set(auth).send({ ...base, ...TEST_UPI, charges }).expect(201)
    expect(r.body.charges).toEqual({ mess: 2500, electricity: 400, water: 0, internet: 300, laundry: 0, maintenance: 0, others: [{ label: 'Housekeeping', amount: 150 }] })
    const db = await Hostel.findById(r.body.id).lean()
    expect(db!.charges).toMatchObject({ mess: 2500, electricity: 400, internet: 300 })

    await api().post('/api/hostels').set(auth).send({ ...base, ...TEST_UPI, name: 'Neg', charges: { water: -1 } }).expect(400)
    await api().post('/api/hostels').set(auth).send({ ...base, ...TEST_UPI, name: 'Unknown head', charges: { gym: 100 } }).expect(400)
    await api().post('/api/hostels').set(auth).send({ ...base, ...TEST_UPI, name: 'Blank other', charges: { others: [{ label: '', amount: 10 }] } }).expect(400)

    const p = await api().patch(`/api/hostels/${r.body.id}`).set(auth).send({ charges: { water: 200 } }).expect(200)
    expect(p.body.charges).toEqual({ mess: 0, electricity: 0, water: 200, internet: 0, laundry: 0, maintenance: 0, others: [] })
  })

  it('QR image: upload, view, replace, delete; images only; scoped to the org; hostel managers only', async () => {
    const w = await makeWorld()
    const id = String(w.hostel._id)
    const warden = await makeStaffUser(w.org._id, 'warden')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const other = await makeOrg()

    await api().get(`/api/hostels/${id}/qr`).set(w.auth).expect(404)
    await api().get('/api/portal/payment-qr').set(w.hostelerAuth).expect(404)
    await api().put(`/api/hostels/${id}/qr`).set(w.auth).expect(400) // no file

    const up = await api().put(`/api/hostels/${id}/qr`).set(w.auth).attach('file', PNG, { filename: 'qr.png', contentType: 'image/png' }).expect(200)
    expect(up.body).toMatchObject({ id, hasQr: true })
    expect(up.body).not.toHaveProperty('qrStorageKey')
    const firstKey = (await Hostel.findById(id).lean())!.qrStorageKey!
    expect(stored(firstKey)).toBe(true)

    // any staff can view it; so can the hostel's hostelers
    for (const auth of [w.auth, warden.auth, accountant.auth]) {
      const got = await api().get(`/api/hostels/${id}/qr`).set(auth).expect(200)
      expect(got.headers['content-type']).toContain('image/png')
      expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0)
    }
    const portalQr = await api().get('/api/portal/payment-qr').set(w.hostelerAuth).expect(200)
    expect(Buffer.compare(portalQr.body as Buffer, PNG)).toBe(0)
    expect((await api().get('/api/portal/payment-info').set(w.hostelerAuth).expect(200)).body.hasQr).toBe(true)

    // replace -> old file removed
    await api().put(`/api/hostels/${id}/qr`).set(w.auth).attach('file', JPG, { filename: 'qr.jpg', contentType: 'image/jpeg' }).expect(200)
    const second = (await Hostel.findById(id).lean())!
    expect(second.qrStorageKey).not.toBe(firstKey)
    expect(second.qrMimeType).toBe('image/jpeg')
    expect(await gone(firstKey)).toBe(true)
    expect((await api().get(`/api/hostels/${id}/qr`).set(w.auth).expect(200)).headers['content-type']).toContain('image/jpeg')

    // non-images / too big are refused and leave the current QR in place
    const before = new Set(fs.readdirSync(uploadRoot))
    await api().put(`/api/hostels/${id}/qr`).set(w.auth).attach('file', Buffer.from('%PDF-1.4'), { filename: 'qr.pdf', contentType: 'application/pdf' }).expect(400)
    await api().put(`/api/hostels/${id}/qr`).set(w.auth).attach('file', Buffer.from('hello'), { filename: 'qr.txt', contentType: 'text/plain' }).expect(400)
    await api().put(`/api/hostels/${id}/qr`).set(w.auth).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' }).expect(400)
    expect((await Hostel.findById(id).lean())!.qrStorageKey).toBe(second.qrStorageKey)
    for (let i = 0; i < 50 && fs.readdirSync(uploadRoot).some((f) => !before.has(f)); i++) await new Promise((r) => setTimeout(r, 20))
    expect(fs.readdirSync(uploadRoot).filter((f) => !before.has(f))).toEqual([]) // rejected uploads cleaned up

    // other org: 404; warden / accountant can't change it
    await api().put(`/api/hostels/${id}/qr`).set(other.auth).attach('file', PNG, { filename: 'qr.png', contentType: 'image/png' }).expect(404)
    await api().get(`/api/hostels/${id}/qr`).set(other.auth).expect(404)
    await api().delete(`/api/hostels/${id}/qr`).set(other.auth).expect(404)
    await api().put(`/api/hostels/${id}/qr`).set(warden.auth).attach('file', PNG, { filename: 'qr.png', contentType: 'image/png' }).expect(403)
    await api().delete(`/api/hostels/${id}/qr`).set(warden.auth).expect(403)
    await api().delete(`/api/hostels/${id}/qr`).set(accountant.auth).expect(403)
    expect((await Hostel.findById(id).lean())!.qrStorageKey).toBe(second.qrStorageKey)

    const del = await api().delete(`/api/hostels/${id}/qr`).set(w.auth).expect(200)
    expect(del.body.hasQr).toBe(false)
    expect(await gone(second.qrStorageKey!)).toBe(true)
    await api().get(`/api/hostels/${id}/qr`).set(w.auth).expect(404)
    await api().get('/api/portal/payment-qr').set(w.hostelerAuth).expect(404)
    await api().delete(`/api/hostels/${id}/qr`).set(w.auth).expect(200) // idempotent
  })
})
