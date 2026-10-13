import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { Activity, Attendance, Leave } from '../src/models/Operations.js'

const today = todayStr()
const month = today.slice(0, 7)
const tomorrow = todayStr(new Date(Date.now() + 86_400_000))

describe('attendance', () => {
  it('roster, mark, upsert, no future dates', async () => {
    const w = await makeWorld()
    const hid = String(w.hostel._id)
    const roster = await api().get(`/api/attendance?date=${today}&hostelId=${hid}`).set(w.auth).expect(200)
    expect(roster.body.items).toHaveLength(1)
    expect(roster.body.items[0]).toMatchObject({
      name: 'Aarav Sharma',
      status: null,
      onApprovedLeave: false,
      roomNumber: '101',
      phone: '9876543210',
      guardianName: 'Ramesh',
      guardianPhone: '9876500000',
    })

    const hId = String(w.hosteler._id)
    const m = await api().put('/api/attendance').set(w.auth).send({ hostelerId: hId, date: today, status: 'late' }).expect(200)
    expect(m.body.id).toBeTruthy()
    await api().put('/api/attendance').set(w.auth).send({ hostelerId: hId, date: today, status: 'present' }).expect(200)
    expect(await Attendance.countDocuments({ hostelerId: hId })).toBe(1)
    await api().put('/api/attendance').set(w.auth).send({ hostelerId: hId, date: tomorrow, status: 'present' }).expect(400)
    await api().put('/api/attendance').set(w.auth).send({ hostelerId: hId, date: today, status: 'sleeping' }).expect(400)

    const r2 = await api().get(`/api/attendance?date=${today}`).set(w.auth).expect(200)
    expect(r2.body.items[0].status).toBe('present')
    expect(r2.body.summary.present).toBe(1)
  })

  it('mark-all-present marks only unmarked; approved leave -> leave', async () => {
    const w = await makeWorld()
    const b = await makeHosteler(w.org._id, w.hostel, { name: 'Bhavesh' })
    const c = await makeHosteler(w.org._id, w.hostel, { name: 'Chirag' })
    const otherHostel = await makeHostel(w.org._id, 'Other')
    await makeHosteler(w.org._id, otherHostel, { name: 'Elsewhere' })
    await Leave.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: c.hosteler._id, from: today, to: today, reason: 'home', status: 'approved' })
    await api().put('/api/attendance').set(w.auth).send({ hostelerId: String(b.hosteler._id), date: today, status: 'absent' }).expect(200)

    const r = await api().post('/api/attendance/mark-all-present').set(w.auth).send({ date: today, hostelId: String(w.hostel._id) }).expect(200)
    expect(r.body.count).toBe(2)
    const recs = await Attendance.find({ date: today }).lean()
    const byId = new Map(recs.map((x) => [String(x.hostelerId), x.status]))
    expect(byId.get(String(w.hosteler._id))).toBe('present')
    expect(byId.get(String(b.hosteler._id))).toBe('absent')
    expect(byId.get(String(c.hosteler._id))).toBe('leave')
    expect(recs).toHaveLength(3)

    const again = await api().post('/api/attendance/mark-all-present').set(w.auth).send({ date: today }).expect(200)
    expect(again.body.count).toBe(1) // only the other hostel's hosteler
    await api().post('/api/attendance/mark-all-present').set(w.auth).send({ date: tomorrow }).expect(400)
  })

  it('monthly register with percentage', async () => {
    const w = await makeWorld()
    const hId = String(w.hosteler._id)
    await Attendance.create([
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: hId, date: `${month}-01`, status: 'present' },
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: hId, date: `${month}-02`, status: 'late' },
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: hId, date: `${month}-03`, status: 'absent' },
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: hId, date: `${month}-04`, status: 'leave' },
    ])
    const r = await api().get(`/api/attendance/register?month=${month}`).set(w.auth).expect(200)
    expect(r.body.days[0]).toBe(`${month}-01`)
    const row = r.body.items[0]
    expect(row.days[`${month}-02`]).toBe('late')
    expect(row).toMatchObject({ present: 1, late: 1, absent: 1, leave: 1, percentage: 67 })
    await api().get('/api/attendance/register?month=2026-13x').set(w.auth).expect(400)
  })

  it('plan gating, roles and isolation', async () => {
    const basic = await makeWorld({ plan: 'basic' })
    await api().get('/api/attendance').set(basic.auth).expect(402)
    await api().get('/api/leaves').set(basic.auth).expect(402)

    const w = await makeWorld()
    const acct = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/attendance').set(acct.auth).expect(403)
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get('/api/attendance').set(warden.auth).expect(200)

    const other = await makeOrg()
    await api().put('/api/attendance').set(other.auth).send({ hostelerId: String(w.hosteler._id), date: today, status: 'present' }).expect(404)
    await api().post('/api/attendance/mark-all-present').set(other.auth).send({ date: today, hostelId: String(w.hostel._id) }).expect(404)
    const r = await api().get('/api/attendance').set(other.auth).expect(200)
    expect(r.body.items).toHaveLength(0)
    await api().post('/api/leaves').set(other.auth).send({ hostelerId: String(w.hosteler._id), from: today, to: today, reason: 'trip' }).expect(404)
  })
})

describe('leaves', () => {
  it('create, list, approve/reject only once, current', async () => {
    const w = await makeWorld()
    const hId = String(w.hosteler._id)
    const l = await api().post('/api/leaves').set(w.auth).send({ hostelerId: hId, from: today, to: tomorrow, reason: 'Family function' }).expect(201)
    expect(l.body.status).toBe('pending')
    await api().post('/api/leaves').set(w.auth).send({ hostelerId: hId, from: tomorrow, to: today, reason: 'Backwards' }).expect(400)
    await api().post('/api/leaves').set(w.auth).send({ hostelerId: hId, from: today, to: today }).expect(400)

    const list = await api().get('/api/leaves?status=pending').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]).toMatchObject({ hostelerName: 'Aarav Sharma', roomNumber: '101' })

    let cur = await api().get('/api/leaves/current').set(w.auth).expect(200)
    expect(cur.body.items).toHaveLength(0)

    const ap = await api().post(`/api/leaves/${l.body.id}/approve`).set(w.auth).expect(200)
    expect(ap.body.status).toBe('approved')
    expect(ap.body.decidedAt).toBeTruthy()
    await api().post(`/api/leaves/${l.body.id}/reject`).set(w.auth).expect(409)
    await api().post(`/api/leaves/${w.hostel._id}/approve`).set(w.auth).expect(404)

    cur = await api().get('/api/leaves/current').set(w.auth).expect(200)
    expect(cur.body.items).toHaveLength(1)
    const roster = await api().get('/api/attendance').set(w.auth).expect(200)
    expect(roster.body.items[0].onApprovedLeave).toBe(true)

    const pre = await api().post('/api/leaves').set(w.auth).send({ hostelerId: hId, from: tomorrow, to: tomorrow, reason: 'Exam', approve: true }).expect(201)
    expect(pre.body.status).toBe('approved')
    const rj = await api().post('/api/leaves').set(w.auth).send({ hostelerId: hId, from: tomorrow, to: tomorrow, reason: 'Trip' }).expect(201)
    await api().post(`/api/leaves/${rj.body.id}/reject`).set(w.auth).expect(200)

    expect(await Activity.countDocuments({ orgId: w.org._id, kind: 'leave' })).toBeGreaterThanOrEqual(4)

    const other = await makeOrg()
    await api().post(`/api/leaves/${l.body.id}/approve`).set(other.auth).expect(404)
  })
})
