import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { todayStr } from '../src/lib/http.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Activity, Expense, Visitor } from '../src/models/Operations.js'

const today = todayStr()
const month = today.slice(0, 7)

describe('visitors', () => {
  it('log, list with filters, check out once', async () => {
    const w = await makeWorld({ plan: 'basic' })
    const hId = String(w.hosteler._id)
    const v = await api()
      .post('/api/visitors')
      .set(w.auth)
      .send({ hostelerId: hId, name: 'Ramesh Sharma', phone: '+91 98765 43210', relation: 'Father', purpose: 'Meeting', idProof: 'Aadhaar' })
      .expect(201)
    expect(v.body).toMatchObject({ name: 'Ramesh Sharma', phone: '9876543210', outTime: null, hostelerName: 'Aarav Sharma', roomNumber: '101' })
    await api().post('/api/visitors').set(w.auth).send({ hostelerId: hId, name: 'Suresh' }).expect(201)
    await api().post('/api/visitors').set(w.auth).send({ hostelerId: hId, name: 'Bad Phone', phone: '12345' }).expect(400)
    await api().post('/api/visitors').set(w.auth).send({ hostelerId: hId, name: '' }).expect(400)

    const gone = await makeHosteler(w.org._id, w.hostel, { name: 'Gone' })
    await Hosteler.updateOne({ _id: gone.hosteler._id }, { status: 'checked_out' })
    await api().post('/api/visitors').set(w.auth).send({ hostelerId: String(gone.hosteler._id), name: 'Late visitor' }).expect(404)

    let list = await api().get('/api/visitors').set(w.auth).expect(200)
    expect(list.body).toMatchObject({ total: 2, page: 1 })
    list = await api().get('/api/visitors?q=ramesh').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    list = await api().get(`/api/visitors?from=${today}&to=${today}`).set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(2)
    list = await api().get('/api/visitors?from=2020-01-01&to=2020-01-31').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(0)
    list = await api().get('/api/visitors?limit=1&page=2').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.pages).toBe(2)

    const out = await api().post(`/api/visitors/${v.body.id}/check-out`).set(w.auth).expect(200)
    expect(out.body.outTime).toBeTruthy()
    await api().post(`/api/visitors/${v.body.id}/check-out`).set(w.auth).expect(409)
    list = await api().get('/api/visitors?inside=true').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0].name).toBe('Suresh')
  })

  it('plan gating and isolation', async () => {
    const free = await makeWorld({ plan: 'free' })
    await api().get('/api/visitors').set(free.auth).expect(402)

    const w = await makeWorld()
    const v = await Visitor.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, name: 'Guest' })
    const other = await makeOrg()
    await api().post(`/api/visitors/${v._id}/check-out`).set(other.auth).expect(404)
    await api().post('/api/visitors').set(other.auth).send({ hostelerId: String(w.hosteler._id), name: 'Sneaky' }).expect(404)
    const list = await api().get('/api/visitors').set(other.auth).expect(200)
    expect(list.body.total).toBe(0)
    const acct = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/visitors').set(acct.auth).expect(403)
  })
})

describe('notices', () => {
  it('CRUD, hostel scope incl. all-hostel notices, pinned first', async () => {
    const w = await makeWorld({ plan: 'free' })
    const hid = String(w.hostel._id)
    const h2 = await makeHostel(w.org._id, 'Second')
    const a = await api().post('/api/notices').set(w.auth).send({ title: 'Holi holiday', body: 'Office closed' }).expect(201)
    expect(a.body).toMatchObject({ hostelId: null, priority: 'medium', pinned: false })
    const b = await api().post('/api/notices').set(w.auth).send({ hostelId: hid, title: 'Water cut tomorrow', priority: 'high' }).expect(201)
    await api().post('/api/notices').set(w.auth).send({ hostelId: String(h2._id), title: 'Other hostel only' }).expect(201)
    await api().post('/api/notices').set(w.auth).send({ title: 'x' }).expect(400)

    let list = await api().get(`/api/notices?hostelId=${hid}`).set(w.auth).expect(200)
    expect(list.body.items.map((n: { title: string }) => n.title)).toEqual(['Water cut tomorrow', 'Holi holiday'])

    await api().patch(`/api/notices/${a.body.id}`).set(w.auth).send({ pinned: true }).expect(200)
    list = await api().get(`/api/notices?hostelId=${hid}`).set(w.auth).expect(200)
    expect(list.body.items[0].id).toBe(a.body.id)
    list = await api().get('/api/notices').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(3)

    await api().patch(`/api/notices/${b.body.id}`).set(w.auth).send({ priority: 'urgent' }).expect(400)
    await api().delete(`/api/notices/${b.body.id}`).set(w.auth).expect(204)
    await api().delete(`/api/notices/${b.body.id}`).set(w.auth).expect(404)

    const other = await makeOrg()
    await api().patch(`/api/notices/${a.body.id}`).set(other.auth).send({ title: 'Hacked notice' }).expect(404)
    await api().post('/api/notices').set(other.auth).send({ hostelId: hid, title: 'Cross org' }).expect(404)
    expect((await api().get('/api/notices').set(other.auth).expect(200)).body.items).toHaveLength(0)
    const acct = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/notices').set(acct.auth).expect(403)
  })
})

describe('staff', () => {
  it('CRUD with filters', async () => {
    const w = await makeWorld({ plan: 'basic' })
    const hid = String(w.hostel._id)
    const s = await api().post('/api/staff').set(w.auth).send({ hostelId: hid, name: 'Ramu Kaka', role: 'cook', salary: 12000, joinDate: '2026-01-01' }).expect(201)
    expect(s.body).toMatchObject({ active: true, salary: 12000 })
    await api().post('/api/staff').set(w.auth).send({ hostelId: hid, name: 'Shyam', role: 'security', salary: 10000 }).expect(201)
    await api().post('/api/staff').set(w.auth).send({ hostelId: hid, name: 'Bad', role: 'pilot', salary: 1 }).expect(400)
    await api().post('/api/staff').set(w.auth).send({ hostelId: hid, name: 'Neg', role: 'cook', salary: -5 }).expect(400)

    let list = await api().get('/api/staff?role=cook').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0].paidThisMonth).toBe(false)

    await api().patch(`/api/staff/${s.body.id}`).set(w.auth).send({ active: false, salary: 13000 }).expect(200)
    list = await api().get('/api/staff?active=true').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    await api().delete(`/api/staff/${s.body.id}`).set(w.auth).expect(204)
    await api().delete(`/api/staff/${s.body.id}`).set(w.auth).expect(404)

    const other = await makeOrg({ plan: 'pro' })
    await api().post('/api/staff').set(other.auth).send({ hostelId: hid, name: 'X Y', role: 'cook', salary: 1 }).expect(404)
    expect((await api().get('/api/staff').set(other.auth).expect(200)).body.items).toHaveLength(0)
  })

  it('pay salaries: one expense per active staff, skips already paid', async () => {
    const w = await makeWorld({ plan: 'basic' })
    const hid = String(w.hostel._id)
    const a = await api().post('/api/staff').set(w.auth).send({ hostelId: hid, name: 'Ramu', role: 'cook', salary: 12000 }).expect(201)
    const b = await api().post('/api/staff').set(w.auth).send({ hostelId: hid, name: 'Shyam', role: 'security', salary: 10000 }).expect(201)
    await api().post('/api/staff').set(w.auth).send({ hostelId: hid, name: 'Inactive', role: 'cleaner', salary: 8000, active: false }).expect(201)

    const first = await api().post('/api/staff/pay-salaries').set(w.auth).send({ month, mode: 'upi', staffIds: [a.body.id] }).expect(201)
    expect(first.body).toMatchObject({ created: 1, skipped: 0, total: 12000 })
    const second = await api().post('/api/staff/pay-salaries').set(w.auth).send({ month, mode: 'cash' }).expect(201)
    expect(second.body).toMatchObject({ created: 1, skipped: 1, total: 10000 })
    const third = await api().post('/api/staff/pay-salaries').set(w.auth).send({ month }).expect(200)
    expect(third.body).toMatchObject({ created: 0, skipped: 2, total: 0 })

    const exps = await Expense.find({ orgId: w.org._id, category: 'salary' }).lean()
    expect(exps).toHaveLength(2)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    expect(exps[0]!.note).toBe(`Salary ${months[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`)
    expect(exps.find((e) => e.paidTo === 'Ramu')!.mode).toBe('upi')
    expect(exps[0]!.date).toBe(today)

    const past = await api().post('/api/staff/pay-salaries').set(w.auth).send({ month: '2026-02', staffIds: [b.body.id] }).expect(201)
    expect(past.body.created).toBe(1)
    expect((await Expense.findOne({ note: 'Salary Feb 2026' }).lean())!.date).toBe('2026-02-28')

    const list = await api().get('/api/staff').set(w.auth).expect(200)
    const paid = Object.fromEntries(list.body.items.map((s: { name: string; paidThisMonth: boolean }) => [s.name, s.paidThisMonth]))
    expect(paid).toEqual({ Ramu: true, Shyam: true, Inactive: false })

    await api().post('/api/staff/pay-salaries').set(w.auth).send({ month: 'Oct 2026' }).expect(400)
    const other = await makeOrg({ plan: 'pro' })
    await api().post('/api/staff/pay-salaries').set(other.auth).send({ month, staffIds: [a.body.id] }).expect(404)
  })

  it('plan gating, roles, activities feed', async () => {
    const free = await makeWorld({ plan: 'free' })
    await api().get('/api/staff').set(free.auth).expect(402)
    // activities are available to any staff on any plan
    await api().get('/api/activities').set(free.auth).expect(200)

    const w = await makeWorld()
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get('/api/staff').set(warden.auth).expect(403)
    const manager = await makeStaffUser(w.org._id, 'manager')
    await api().get('/api/staff').set(manager.auth).expect(200)

    const h2 = await makeHostel(w.org._id, 'Second')
    await Activity.create([
      { orgId: w.org._id, hostelId: w.hostel._id, message: 'first' },
      { orgId: w.org._id, hostelId: h2._id, message: 'other hostel' },
      { orgId: w.org._id, hostelId: null, message: 'org wide' },
      { orgId: free.org._id, hostelId: null, message: 'other org' },
    ])
    const acct = await makeStaffUser(w.org._id, 'accountant')
    const all = await api().get('/api/activities?limit=10').set(acct.auth).expect(200)
    expect(all.body.items).toHaveLength(3)
    const scoped = await api().get(`/api/activities?hostelId=${w.hostel._id}`).set(w.auth).expect(200)
    expect(scoped.body.items.map((a: { message: string }) => a.message).sort()).toEqual(['first', 'org wide'])
    const lim = await api().get('/api/activities?limit=1').set(w.auth).expect(200)
    expect(lim.body.items).toHaveLength(1)
    await api().get('/api/activities').set(w.hostelerAuth).expect(403)
    await api().get('/api/activities').expect(401)
  })
})
