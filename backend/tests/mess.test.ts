import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { Leave, MessFeedback } from '../src/models/Operations.js'

const today = todayStr()
const dow = new Date(`${today}T00:00:00Z`).getUTCDay()

describe('mess', () => {
  it('menu upsert, list, copy', async () => {
    const w = await makeWorld()
    const h2 = await makeHostel(w.org._id, 'Second')
    const hid = String(w.hostel._id)

    await api().put('/api/mess/menu').set(w.auth).send({ hostelId: hid, day: dow, meal: 'lunch', items: 'Dal, Rice' }).expect(200)
    const up = await api().put('/api/mess/menu').set(w.auth).send({ hostelId: hid, day: dow, meal: 'lunch', items: 'Rajma, Rice' }).expect(200)
    expect(up.body.id).toBeTruthy()
    await api().put('/api/mess/menu').set(w.auth).send({ hostelId: hid, day: 0, meal: 'breakfast', items: 'Poha' }).expect(200)
    await api().put('/api/mess/menu').set(w.auth).send({ hostelId: hid, day: 7, meal: 'lunch', items: 'x' }).expect(400)
    await api().put('/api/mess/menu').set(w.auth).send({ hostelId: hid, day: 1, meal: 'brunch', items: 'x' }).expect(400)

    const menu = await api().get(`/api/mess/menu?hostelId=${hid}`).set(w.auth).expect(200)
    expect(menu.body.items).toHaveLength(2)
    expect(menu.body.items.find((m: { meal: string }) => m.meal === 'lunch').items).toBe('Rajma, Rice')
    await api().get('/api/mess/menu').set(w.auth).expect(400)

    const copy = await api().post('/api/mess/menu/copy').set(w.auth).send({ fromHostelId: hid, toHostelId: String(h2._id) }).expect(200)
    expect(copy.body.copied).toBe(2)
    const m2 = await api().get(`/api/mess/menu?hostelId=${h2._id}`).set(w.auth).expect(200)
    expect(m2.body.items).toHaveLength(2)
    await api().post('/api/mess/menu/copy').set(w.auth).send({ fromHostelId: hid, toHostelId: hid }).expect(400)
  })

  it("today's headcount = members - opted out - on leave", async () => {
    const w = await makeWorld()
    const hid = String(w.hostel._id)
    const b = await makeHosteler(w.org._id, w.hostel, { name: 'Bhavesh' })
    const c = await makeHosteler(w.org._id, w.hostel, { name: 'Chirag' })
    await makeHosteler(w.org._id, w.hostel, { name: 'NoMess', messOpted: false })
    await Leave.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: c.hosteler._id, from: today, to: today, reason: 'home', status: 'approved' })
    await api().put('/api/mess/menu').set(w.auth).send({ hostelId: hid, day: dow, meal: 'dinner', items: 'Paneer' }).expect(200)

    const o = await api().post('/api/mess/opt-outs').set(w.auth).send({ hostelerId: String(b.hosteler._id), date: today, meal: 'lunch' }).expect(201)
    await api().post('/api/mess/opt-outs').set(w.auth).send({ hostelerId: String(b.hosteler._id), date: today, meal: 'lunch' }).expect(409)
    // on leave + opted out is only counted once
    await api().post('/api/mess/opt-outs').set(w.auth).send({ hostelerId: String(c.hosteler._id), date: today, meal: 'lunch' }).expect(201)

    const t = await api().get(`/api/mess/today?hostelId=${hid}&date=${today}`).set(w.auth).expect(200)
    expect(t.body.members).toBe(3)
    const lunch = t.body.meals.find((m: { meal: string }) => m.meal === 'lunch')
    expect(lunch.optedOut).toHaveLength(2)
    expect(lunch.onLeave).toBe(0)
    expect(lunch.headcount).toBe(1)
    const dinner = t.body.meals.find((m: { meal: string }) => m.meal === 'dinner')
    expect(dinner.items).toBe('Paneer')
    expect(dinner.onLeave).toBe(1)
    expect(dinner.headcount).toBe(2)

    const list = await api().get(`/api/mess/opt-outs?from=${today}&to=${today}&hostelId=${hid}`).set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(2)
    expect(list.body.items[0].hostelerName).toBeTruthy()

    await api().delete(`/api/mess/opt-outs/${o.body.id}`).set(w.auth).expect(204)
    await api().delete(`/api/mess/opt-outs/${o.body.id}`).set(w.auth).expect(404)
  })

  it('members, opt-out validation, feedback averages and stats', async () => {
    const w = await makeWorld()
    const hid = String(w.hostel._id)
    const nm = await makeHosteler(w.org._id, w.hostel, { name: 'Zed', messOpted: false })

    const mem = await api().get(`/api/mess/members?hostelId=${hid}`).set(w.auth).expect(200)
    expect(mem.body.items).toHaveLength(2)
    expect(mem.body.members).toBe(1)
    expect(mem.body.items[0].roomNumber).toBe('101')

    await api().post('/api/mess/opt-outs').set(w.auth).send({ hostelerId: String(nm.hosteler._id), date: today, meal: 'lunch' }).expect(400)
    await api().patch(`/api/mess/members/${nm.hosteler._id}`).set(w.auth).send({ messOpted: true }).expect(200)
    await api().post('/api/mess/opt-outs').set(w.auth).send({ hostelerId: String(nm.hosteler._id), date: today, meal: 'lunch' }).expect(201)
    await api().post('/api/mess/opt-outs').set(w.auth).send({ hostelerId: String(nm.hosteler._id), date: 'tomorrow', meal: 'lunch' }).expect(400)

    await MessFeedback.create([
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, date: today, meal: 'lunch', rating: 4 },
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: nm.hosteler._id, date: today, meal: 'lunch', rating: 5 },
      { orgId: w.org._id, hostelId: w.hostel._id, hostelerId: nm.hosteler._id, date: today, meal: 'dinner', rating: 2 },
    ])
    const fb = await api().get('/api/mess/feedback?meal=lunch').set(w.auth).expect(200)
    expect(fb.body.items).toHaveLength(2)
    expect(fb.body.averages.lunch).toEqual({ average: 4.5, count: 2 })
    expect(fb.body.averages.dinner).toEqual({ average: 2, count: 1 })
    expect(fb.body.averages.breakfast.average).toBeNull()

    const st = await api().get(`/api/mess/stats?month=${today.slice(0, 7)}`).set(w.auth).expect(200)
    expect(st.body.optOuts).toBe(1)
    expect(st.body.estimatedSavings).toBe(25) // 3000 / 30 / 4
  })

  it('plan gating, roles and cross-org isolation', async () => {
    const free = await makeWorld({ plan: 'free' })
    const r = await api().get(`/api/mess/menu?hostelId=${free.hostel._id}`).set(free.auth).expect(402)
    expect(r.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')
    await api().get('/api/mess/stats').set(free.auth).expect(402)

    const w = await makeWorld()
    const acct = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/mess/stats').set(acct.auth).expect(403)
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get('/api/mess/stats').set(warden.auth).expect(200)
    await api().get('/api/mess/stats').expect(401)

    const other = await makeOrg()
    await api().get(`/api/mess/menu?hostelId=${w.hostel._id}`).set(other.auth).expect(404)
    await api().put('/api/mess/menu').set(other.auth).send({ hostelId: String(w.hostel._id), day: 1, meal: 'lunch', items: 'x' }).expect(404)
    await api().post('/api/mess/opt-outs').set(other.auth).send({ hostelerId: String(w.hosteler._id), date: today, meal: 'lunch' }).expect(404)
    await api().patch(`/api/mess/members/${w.hosteler._id}`).set(other.auth).send({ messOpted: false }).expect(404)
    const mem = await api().get('/api/mess/members').set(other.auth).expect(200)
    expect(mem.body.items).toHaveLength(0)
  })
})
