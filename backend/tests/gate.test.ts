import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeStaffUser, makeWorld } from './helpers.js'
import { GateLog } from '../src/models/Operations.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Organization } from '../src/models/Organization.js'
import { todayStr } from '../src/lib/http.js'

/** Local Date for YYYY-MM-DD HH:MM */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`)

describe('gate log', () => {
  it('records in/out, lists with hosteler info, filters and late flag', async () => {
    const w = await makeWorld()
    await Organization.updateOne({ _id: w.org._id }, { 'settings.nightCurfew': '22:00' })

    const out = await api().post('/api/gate-logs').set(w.auth).send({ hostelerId: String(w.hosteler._id), direction: 'out', note: 'Market' }).expect(201)
    expect(out.body.direction).toBe('out')
    expect(out.body.hostelId).toBe(String(w.hostel._id))
    expect(out.body.late).toBe(false)

    const today = await api().get(`/api/gate-logs?date=${todayStr()}`).set(w.auth).expect(200)
    expect(today.body.items).toHaveLength(1)
    expect(today.body.items[0].hostelerName).toBe('Aarav Sharma')
    expect(today.body.items[0].roomNumber).toBe('101')
    expect(today.body.items[0].bedLabel).toBe('A')

    const base = { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id }
    await GateLog.create([
      { ...base, direction: 'in', time: at('2026-10-01', '21:30') },
      { ...base, direction: 'in', time: at('2026-10-01', '22:15') },
      { ...base, direction: 'in', time: at('2026-10-02', '02:00') },
      { ...base, direction: 'out', time: at('2026-10-01', '23:00') },
    ])
    const d1 = await api().get('/api/gate-logs?date=2026-10-01').set(w.auth).expect(200)
    expect(d1.body.items).toHaveLength(3)
    const byTime = (hhmm: string) => d1.body.items.find((g: { time: string }) => new Date(g.time).getTime() === at('2026-10-01', hhmm).getTime())
    expect(byTime('21:30').late).toBe(false)
    expect(byTime('22:15').late).toBe(true)
    expect(byTime('23:00').late).toBe(false) // 'out' is never late
    const d2 = await api().get('/api/gate-logs?date=2026-10-02').set(w.auth).expect(200)
    expect(d2.body.items[0].late).toBe(true) // before 05:00

    expect((await api().get('/api/gate-logs?direction=in').set(w.auth)).body.total).toBe(3)
    expect((await api().get(`/api/gate-logs?hostelerId=${w.hosteler._id}&limit=2`).set(w.auth)).body).toMatchObject({ total: 5, pages: 3 })
    const h2 = await makeHostel(w.org._id, 'Other')
    expect((await api().get(`/api/gate-logs?hostelId=${h2._id}`).set(w.auth)).body.items).toHaveLength(0)
  })

  it('validates input', async () => {
    const w = await makeWorld()
    await api().post('/api/gate-logs').set(w.auth).send({ hostelerId: String(w.hosteler._id), direction: 'sideways' }).expect(400)
    await api().post('/api/gate-logs').set(w.auth).send({ hostelerId: 'x', direction: 'in' }).expect(400)
    await api().get('/api/gate-logs?date=yesterday').set(w.auth).expect(400)
    await Hosteler.updateOne({ _id: w.hosteler._id }, { status: 'checked_out' })
    await api().post('/api/gate-logs').set(w.auth).send({ hostelerId: String(w.hosteler._id), direction: 'in' }).expect(400)
  })

  it('lists hostelers currently outside', async () => {
    const w = await makeWorld()
    const z = await makeHosteler(w.org._id, w.hostel, { name: 'Zoya Khan', bed: w.beds[1]! })
    const base = { orgId: w.org._id, hostelId: w.hostel._id }
    await GateLog.create([
      { ...base, hostelerId: w.hosteler._id, direction: 'out', time: at('2026-10-01', '10:00') },
      { ...base, hostelerId: w.hosteler._id, direction: 'in', time: at('2026-10-01', '12:00') },
      { ...base, hostelerId: z.hosteler._id, direction: 'in', time: at('2026-10-01', '09:00') },
      { ...base, hostelerId: z.hosteler._id, direction: 'out', time: at('2026-10-01', '18:00') },
    ])
    const r = await api().get('/api/gate-logs/outside').set(w.auth).expect(200)
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0].hosteler.name).toBe('Zoya Khan')
    expect(r.body.items[0].hosteler.roomNumber).toBe('101')
    expect(r.body.items[0].log.direction).toBe('out')

    // checked-out hostelers are not "outside"
    await Hosteler.updateOne({ _id: z.hosteler._id }, { status: 'checked_out' })
    expect((await api().get('/api/gate-logs/outside').set(w.auth)).body.items).toHaveLength(0)
  })

  it('isolates organizations and enforces roles', async () => {
    const a = await makeWorld()
    const b = await makeWorld()
    await api().post('/api/gate-logs').set(b.auth).send({ hostelerId: String(b.hosteler._id), direction: 'out' }).expect(201)
    expect((await api().get('/api/gate-logs').set(a.auth)).body.items).toHaveLength(0)
    expect((await api().get('/api/gate-logs/outside').set(a.auth)).body.items).toHaveLength(0)
    await api().post('/api/gate-logs').set(a.auth).send({ hostelerId: String(b.hosteler._id), direction: 'in' }).expect(404)

    const acct = await makeStaffUser(a.org._id, 'accountant')
    await api().get('/api/gate-logs').set(acct.auth).expect(403)
    await api().post('/api/gate-logs').set(acct.auth).send({ hostelerId: String(a.hosteler._id), direction: 'in' }).expect(403)
    const warden = await makeStaffUser(a.org._id, 'warden')
    await api().post('/api/gate-logs').set(warden.auth).send({ hostelerId: String(a.hosteler._id), direction: 'in' }).expect(201)
    await api().get('/api/gate-logs').set(a.hostelerAuth).expect(403)
  })
})
