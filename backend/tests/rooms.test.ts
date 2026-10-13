import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { Bed } from '../src/models/Bed.js'
import { Room } from '../src/models/Room.js'

describe('rooms', () => {
  it('creates a room with beds A..N and lists it with occupants', async () => {
    const w = await makeWorld()
    const r = await api()
      .post('/api/rooms')
      .set(w.auth)
      .send({ hostelId: String(w.hostel._id), number: '201', floor: 2, type: 'ac', sharing: 3, rentPerBed: 8000, amenities: ['WiFi'] })
      .expect(201)
    expect(r.body.beds.map((b: { label: string }) => b.label)).toEqual(['A', 'B', 'C'])
    expect(r.body.beds[0].hosteler).toBeNull()

    await api().post('/api/rooms').set(w.auth).send({ hostelId: String(w.hostel._id), number: '201', sharing: 1, rentPerBed: 1 }).expect(409)
    await api().post('/api/rooms').set(w.auth).send({ hostelId: String(w.hostel._id), number: '', sharing: 1, rentPerBed: 1 }).expect(400)
    await api().post('/api/rooms').set(w.auth).send({ hostelId: String(w.hostel._id), number: '9', sharing: 0, rentPerBed: 1 }).expect(400)
    await api().post('/api/rooms').set(w.auth).send({ hostelId: String(w.hostel._id), number: '9', sharing: 2, rentPerBed: -5 }).expect(400)

    const list = await api().get('/api/rooms').set(w.auth).query({ hostelId: String(w.hostel._id) }).expect(200)
    expect(list.body.items.map((x: { number: string }) => x.number)).toEqual(['101', '201'])
    const r101 = list.body.items[0]
    expect(r101.beds[0]).toMatchObject({ label: 'A', hostelerId: String(w.hosteler._id), hosteler: { id: String(w.hosteler._id), name: w.hosteler.name, status: 'active' } })

    expect((await api().get('/api/rooms?floor=2').set(w.auth).expect(200)).body.items).toHaveLength(1)
    await Room.updateOne({ _id: r.body.id }, { status: 'maintenance' })
    expect((await api().get('/api/rooms?status=maintenance').set(w.auth).expect(200)).body.items).toHaveLength(1)
    await api().get('/api/rooms?status=broken').set(w.auth).expect(400)

    // vacant: room 101 has one free bed; fill it
    await Bed.updateOne({ roomId: w.room._id, label: 'B' }, { hostelerId: w.org._id })
    const vacant = await api().get('/api/rooms?vacant=true').set(w.auth).expect(200)
    expect(vacant.body.items.map((x: { number: string }) => x.number)).toEqual(['201'])

    const one = await api().get(`/api/rooms/${r.body.id}`).set(w.auth).expect(200)
    expect(one.body.number).toBe('201')
  })

  it('bulk creates from a range or a list, skipping existing numbers', async () => {
    const { org, auth } = await makeOrg()
    const hostel = await makeHostel(org._id)
    await makeRoom(org._id, hostel._id, '103', 1)
    const r = await api()
      .post('/api/rooms/bulk')
      .set(auth)
      .send({ hostelId: String(hostel._id), from: 101, to: 105, floor: 1, sharing: 2, rentPerBed: 5000 })
      .expect(201)
    expect(r.body.created).toBe(4)
    expect(r.body.skipped).toEqual(['103'])
    expect(await Bed.countDocuments({ orgId: org._id })).toBe(1 + 8)

    const l = await api().post('/api/rooms/bulk').set(auth).send({ hostelId: String(hostel._id), numbers: ['G1', 'G2', 'G1', '101'], sharing: 1, rentPerBed: 0 }).expect(201)
    expect(l.body).toMatchObject({ created: 2, skipped: ['101'] })

    await api().post('/api/rooms/bulk').set(auth).send({ hostelId: String(hostel._id), sharing: 1, rentPerBed: 0 }).expect(400)
    await api().post('/api/rooms/bulk').set(auth).send({ hostelId: String(hostel._id), from: 10, to: 5, sharing: 1, rentPerBed: 0 }).expect(400)
    await api().post('/api/rooms/bulk').set(auth).send({ hostelId: String(hostel._id), from: 1, to: 500, sharing: 1, rentPerBed: 0 }).expect(400)
  })

  it('changing sharing adds beds, removes only empty beds and relabels', async () => {
    const w = await makeWorld() // room 101: A occupied, B empty
    const id = String(w.room._id)
    const up = await api().patch(`/api/rooms/${id}`).set(w.auth).send({ sharing: 4, rentPerBed: 7000 }).expect(200)
    expect(up.body.beds.map((b: { label: string }) => b.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(up.body.rentPerBed).toBe(7000)

    // move the hosteler to bed C, then shrink to 2: B and D are removed, C becomes B
    await Bed.updateOne({ roomId: id, label: 'A' }, { hostelerId: null })
    await Bed.updateOne({ roomId: id, label: 'C' }, { hostelerId: w.hosteler._id })
    const down = await api().patch(`/api/rooms/${id}`).set(w.auth).send({ sharing: 2 }).expect(200)
    expect(down.body.beds.map((b: { label: string; hostelerId: string | null }) => [b.label, b.hostelerId])).toEqual([
      ['A', null],
      ['B', String(w.hosteler._id)],
    ])

    await Bed.updateOne({ roomId: id, label: 'A' }, { hostelerId: w.org._id })
    await api().patch(`/api/rooms/${id}`).set(w.auth).send({ sharing: 1 }).expect(409)

    await makeRoom(w.org._id, w.hostel._id, '102', 1)
    await api().patch(`/api/rooms/${id}`).set(w.auth).send({ number: '102' }).expect(409)
    await api().patch(`/api/rooms/${id}`).set(w.auth).send({ hostelId: String(w.hostel._id) }).expect(400)
  })

  it('enforces the plan bed limit with 402 PLAN_LIMIT', async () => {
    const { org, auth } = await makeOrg({ plan: 'free' })
    const hostel = await makeHostel(org._id)
    await makeRoom(org._id, hostel._id, '101', 18)
    const r = await api().post('/api/rooms').set(auth).send({ hostelId: String(hostel._id), number: '102', sharing: 3, rentPerBed: 1 }).expect(402)
    expect(r.body.error.code).toBe('PLAN_LIMIT')
    await api().post('/api/rooms').set(auth).send({ hostelId: String(hostel._id), number: '102', sharing: 2, rentPerBed: 1 }).expect(201)
    expect(await Room.countDocuments({ orgId: org._id })).toBe(2)
    const b = await api().post('/api/rooms/bulk').set(auth).send({ hostelId: String(hostel._id), from: 1, to: 2, sharing: 1, rentPerBed: 1 }).expect(402)
    expect(b.body.error.code).toBe('PLAN_LIMIT')
    expect(await Room.countDocuments({ orgId: org._id })).toBe(2) // transaction rolled back
    const room = await Room.findOne({ orgId: org._id, number: '102' })
    await api().patch(`/api/rooms/${room!._id}`).set(auth).send({ sharing: 3 }).expect(402)
  })

  it('delete refuses occupied rooms', async () => {
    const w = await makeWorld()
    await api().delete(`/api/rooms/${w.room._id}`).set(w.auth).expect(409)
    const { room } = await makeRoom(w.org._id, w.hostel._id, '102', 2)
    await api().delete(`/api/rooms/${room._id}`).set(w.auth).expect(200)
    expect(await Bed.countDocuments({ roomId: room._id })).toBe(0)
    await api().get(`/api/rooms/${room._id}`).set(w.auth).expect(404)
  })

  it('vacant beds in active rooms, sorted', async () => {
    const w = await makeWorld()
    await makeRoom(w.org._id, w.hostel._id, '20', 2)
    const { room: m } = await makeRoom(w.org._id, w.hostel._id, '5', 1)
    await Room.updateOne({ _id: m._id }, { status: 'maintenance' })
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const r = await api().get('/api/beds/vacant').query({ hostelId: String(w.hostel._id) }).set(accountant.auth).expect(200)
    expect(r.body.items.map((b: { label: string; room: { number: string } }) => `${b.room.number}${b.label}`)).toEqual(['20A', '20B', '101B'])
  })

  it('role permissions and organization isolation', async () => {
    const w = await makeWorld()
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get('/api/rooms').set(accountant.auth).expect(403)
    await api().get('/api/rooms').set(warden.auth).expect(200)

    const other = await makeOrg()
    const id = String(w.room._id)
    expect((await api().get('/api/rooms').set(other.auth).expect(200)).body.items).toEqual([])
    expect((await api().get('/api/beds/vacant').set(other.auth).expect(200)).body.items).toEqual([])
    await api().get(`/api/rooms/${id}`).set(other.auth).expect(404)
    await api().patch(`/api/rooms/${id}`).set(other.auth).send({ rentPerBed: 1 }).expect(404)
    await api().delete(`/api/rooms/${id}`).set(other.auth).expect(404)
    await api().post('/api/rooms').set(other.auth).send({ hostelId: String(w.hostel._id), number: '999', sharing: 1, rentPerBed: 1 }).expect(404)
    await api().post('/api/rooms/bulk').set(other.auth).send({ hostelId: String(w.hostel._id), numbers: ['1'], sharing: 1, rentPerBed: 1 }).expect(404)
  })
})
