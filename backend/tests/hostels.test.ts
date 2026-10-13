import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { Hostel } from '../src/models/Hostel.js'
import { Room } from '../src/models/Room.js'
import { Bed } from '../src/models/Bed.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { MessMenu, Staff } from '../src/models/Operations.js'

describe('hostels', () => {
  it('creates with generated or provided codes; codes are globally unique', async () => {
    const a = await makeOrg()
    const b = await makeOrg()
    const h1 = await api().post('/api/hostels').set(a.auth).send({ name: 'Sunrise Boys Hostel', type: 'boys', city: 'Indore' }).expect(201)
    expect(h1.body.code).toBe('SBH')
    expect(h1.body.counts).toEqual({ rooms: 0, beds: 0, occupied: 0, vacant: 0, activeHostelers: 0 })
    // another org with the same initials gets a different code
    const h2 = await api().post('/api/hostels').set(b.auth).send({ name: 'Silver Bell House', type: 'coed', city: 'Pune' }).expect(201)
    expect(h2.body.code).toBe('SBH2')

    const h3 = await api().post('/api/hostels').set(a.auth).send({ name: 'Lotus', type: 'girls', city: 'Indore', code: 'lot1' }).expect(201)
    expect(h3.body.code).toBe('LOT1')
    await api().post('/api/hostels').set(b.auth).send({ name: 'Lotus Two', type: 'girls', city: 'Pune', code: 'LOT1' }).expect(409)
    await api().post('/api/hostels').set(a.auth).send({ name: 'Bad', type: 'girls', city: 'Pune', code: 'A' }).expect(400)
    await api().post('/api/hostels').set(a.auth).send({ name: 'Bad Code', type: 'girls', city: 'Pune', code: 'AB-12' }).expect(400)
    await api().post('/api/hostels').set(a.auth).send({ name: 'No city', type: 'boys' }).expect(400)
    await api().post('/api/hostels').set(a.auth).send({ name: 'Wrong type', type: 'mixed', city: 'X' }).expect(400)
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

    await api().post('/api/hostels').set(warden.auth).send({ name: 'Nope', type: 'boys', city: 'X' }).expect(403)
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
