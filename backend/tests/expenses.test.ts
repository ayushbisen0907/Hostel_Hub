import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'

const today = todayStr()
const month = today.slice(0, 7)

function prevMonth(m: string) {
  const [y, mm] = m.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 7)
}

describe('expenses', () => {
  it('create, list with filters and total, update, delete', async () => {
    const w = await makeWorld()
    const hid = String(w.hostel._id)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'magic', amount: 10, date: today }).expect(400)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'water', amount: 0, date: today }).expect(400)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'water', amount: 10, date: 'today' }).expect(400)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: '000000000000000000000000', category: 'water', amount: 10, date: today }).expect(404)

    const e1 = await api()
      .post('/api/expenses')
      .set(w.auth)
      .send({ hostelId: hid, category: 'electricity', amount: 4200, date: today, paidTo: 'State Electricity Board', mode: 'upi' })
      .expect(201)
    expect(e1.body).toMatchObject({ category: 'electricity', amount: 4200, mode: 'upi', note: '' })
    expect(e1.body.id).toBeTruthy()
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'groceries', amount: 1800, date: today, paidTo: 'Sharma Kirana' }).expect(201)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'groceries', amount: 1000, date: `${prevMonth(month)}-15` }).expect(201)

    const all = await api().get('/api/expenses').set(w.auth).expect(200)
    expect(all.body).toMatchObject({ total: 3, totalAmount: 7000 })
    expect(all.body.items[0].hostelName).toBe('Sunrise Boys Hostel')
    const cur = await api().get(`/api/expenses?month=${month}`).set(w.auth).expect(200)
    expect(cur.body).toMatchObject({ total: 2, totalAmount: 6000 })
    expect((await api().get('/api/expenses?category=groceries').set(w.auth)).body.totalAmount).toBe(2800)
    expect((await api().get('/api/expenses?q=kirana').set(w.auth)).body.total).toBe(1)
    expect((await api().get('/api/expenses?q=electric').set(w.auth)).body.total).toBe(1)
    expect((await api().get('/api/expenses?limit=2&page=2').set(w.auth)).body).toMatchObject({ total: 3, pages: 2, totalAmount: 7000 })
    const other = await makeHostel(w.org._id, 'Other')
    expect((await api().get(`/api/expenses?hostelId=${String(other._id)}`).set(w.auth)).body.total).toBe(0)
    await api().get('/api/expenses?category=nope').set(w.auth).expect(400)

    const upd = await api().patch(`/api/expenses/${e1.body.id}`).set(w.auth).send({ amount: 4500, note: 'Sept bill', hostelId: String(other._id) }).expect(200)
    expect(upd.body).toMatchObject({ amount: 4500, note: 'Sept bill', hostelId: String(other._id) })
    await api().patch(`/api/expenses/${e1.body.id}`).set(w.auth).send({ amount: -1 }).expect(400)
    await api().patch(`/api/expenses/${e1.body.id}`).set(w.auth).send({ hostelId: '000000000000000000000000' }).expect(404)
    await api().patch('/api/expenses/000000000000000000000000').set(w.auth).send({ amount: 5 }).expect(404)

    await api().delete(`/api/expenses/${e1.body.id}`).set(w.auth).expect(200)
    await api().delete(`/api/expenses/${e1.body.id}`).set(w.auth).expect(404)
    expect((await api().get('/api/expenses').set(w.auth)).body.total).toBe(2)
  })

  it('summary: per-month totals and by category', async () => {
    const w = await makeWorld()
    const hid = String(w.hostel._id)
    const prev = prevMonth(month)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'salary', amount: 1000, date: `${month}-01` }).expect(201)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'water', amount: 500, date: `${month}-02` }).expect(201)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'salary', amount: 2000, date: `${prev}-10` }).expect(201)
    await api().post('/api/expenses').set(w.auth).send({ hostelId: hid, category: 'salary', amount: 9999, date: '2020-01-01' }).expect(201)

    const s = await api().get('/api/expenses/summary?months=6').set(w.auth).expect(200)
    expect(s.body.months).toHaveLength(6)
    const last = s.body.months.at(-1)
    expect(last).toMatchObject({ month, total: 1500, count: 2, byCategory: { salary: 1000, water: 500 } })
    expect(s.body.months.at(-2)).toMatchObject({ month: prev, total: 2000 })
    expect(s.body.total).toBe(3500)
    expect(s.body.byCategory[0]).toEqual({ category: 'salary', amount: 3000 })
    expect(s.body.current).toMatchObject({ total: 1500, previousTotal: 2000, change: -25 })
    await api().get('/api/expenses/summary?months=100').set(w.auth).expect(400)
  })

  it('isolation, roles and plan', async () => {
    const w = await makeWorld()
    const e = await api().post('/api/expenses').set(w.auth).send({ hostelId: String(w.hostel._id), category: 'water', amount: 10, date: today }).expect(201)

    const b = await makeOrg()
    await api().patch(`/api/expenses/${e.body.id}`).set(b.auth).send({ amount: 5 }).expect(404)
    await api().delete(`/api/expenses/${e.body.id}`).set(b.auth).expect(404)
    expect((await api().get('/api/expenses').set(b.auth)).body.total).toBe(0)
    await api().post('/api/expenses').set(b.auth).send({ hostelId: String(w.hostel._id), category: 'water', amount: 10, date: today }).expect(404)

    const warden = await makeStaffUser(w.org._id, 'warden')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/expenses').set(warden.auth).expect(403)
    await api().get('/api/expenses').set(accountant.auth).expect(200)
    await api().get('/api/expenses').set(w.hostelerAuth).expect(403)
    await api().get('/api/expenses').expect(401)

    const free = await makeOrg({ plan: 'free' })
    const r = await api().get('/api/expenses').set(free.auth).expect(402)
    expect(r.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')
  })
})
