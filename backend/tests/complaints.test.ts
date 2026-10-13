import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { Activity, Complaint, Staff } from '../src/models/Operations.js'

describe('complaints', () => {
  it('create, list with filters, get, comment, delete', async () => {
    const w = await makeWorld({ plan: 'free' }) // complaints are on every plan
    const hid = String(w.hostel._id)
    const c = await api()
      .post('/api/complaints')
      .set(w.auth)
      .send({ hostelId: hid, hostelerId: String(w.hosteler._id), category: 'plumbing', title: 'Tap leaking', priority: 'high' })
      .expect(201)
    expect(c.body).toMatchObject({ status: 'open', hostelerName: 'Aarav Sharma', hostelerPhone: '9876543210', roomNumber: '101', priority: 'high', comments: [] })
    expect(c.body.id).toBeTruthy()
    await api().post('/api/complaints').set(w.auth).send({ hostelId: hid, category: 'internet', title: 'WiFi down in common room' }).expect(201)
    await api().post('/api/complaints').set(w.auth).send({ hostelId: hid, category: 'magic', title: 'Bad' }).expect(400)
    await api().post('/api/complaints').set(w.auth).send({ hostelId: hid, category: 'other', title: 'x' }).expect(400)
    expect(await Activity.countDocuments({ orgId: w.org._id, kind: 'complaint' })).toBe(2)

    // hosteler must belong to the hostel
    const h2 = await makeHostel(w.org._id, 'Other')
    await api().post('/api/complaints').set(w.auth).send({ hostelId: String(h2._id), hostelerId: String(w.hosteler._id), category: 'other', title: 'Wrong hostel' }).expect(404)

    let list = await api().get('/api/complaints').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(2)
    list = await api().get('/api/complaints?category=plumbing').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    list = await api().get('/api/complaints?q=wifi').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    list = await api().get('/api/complaints?q=aarav').set(w.auth).expect(200)
    expect(list.body.items[0].title).toBe('Tap leaking')
    list = await api().get(`/api/complaints?hostelId=${h2._id}`).set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(0)

    const cm = await api().post(`/api/complaints/${c.body.id}/comments`).set(w.auth).send({ text: 'Plumber called' }).expect(201)
    expect(cm.body.comments[0]).toMatchObject({ by: 'Owner', byKind: 'staff', text: 'Plumber called' })
    expect(cm.body.comments[0].id).toBeTruthy()
    await api().post(`/api/complaints/${c.body.id}/comments`).set(w.auth).send({ text: '' }).expect(400)

    const one = await api().get(`/api/complaints/${c.body.id}`).set(w.auth).expect(200)
    expect(one.body.comments).toHaveLength(1)

    await api().delete(`/api/complaints/${c.body.id}`).set(w.auth).expect(204)
    await api().get(`/api/complaints/${c.body.id}`).set(w.auth).expect(404)
  })

  it('patch status sets/clears resolvedAt, assignment checks, stats', async () => {
    const w = await makeWorld()
    const hid = String(w.hostel._id)
    const staff = await Staff.create({ orgId: w.org._id, hostelId: w.hostel._id, name: 'Ramu', role: 'cleaner', joinDate: '2026-01-01' })
    const h2 = await makeHostel(w.org._id, 'Other')
    const elsewhere = await Staff.create({ orgId: w.org._id, hostelId: h2._id, name: 'Shyam', role: 'cleaner', joinDate: '2026-01-01' })

    await Staff.create({ orgId: w.org._id, hostelId: w.hostel._id, name: 'Gone', role: 'cook', joinDate: '2026-01-01', active: false })
    const asg = await api().get(`/api/complaints/assignees?hostelId=${hid}`).set(w.auth).expect(200)
    expect(asg.body.items).toEqual([{ id: String(staff._id), name: 'Ramu', role: 'cleaner', hostelId: hid, active: true }])
    const asgAll = await api().get(`/api/complaints/assignees?hostelId=${hid}&includeInactive=true`).set(w.auth).expect(200)
    expect(asgAll.body.items).toHaveLength(2)
    // wardens can't open the staff module but can list assignees
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get(`/api/staff?hostelId=${hid}`).set(warden.auth).expect(403)
    await api().get(`/api/complaints/assignees?hostelId=${hid}`).set(warden.auth).expect(200)
    const acct = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/complaints/assignees').set(acct.auth).expect(403)

    const c = await api().post('/api/complaints').set(w.auth).send({ hostelId: hid, category: 'cleaning', title: 'Corridor dirty' }).expect(201)
    const id = c.body.id
    const p1 = await api().patch(`/api/complaints/${id}`).set(w.auth).send({ status: 'in_progress', assignedStaffId: String(staff._id) }).expect(200)
    expect(p1.body).toMatchObject({ status: 'in_progress', assignedStaffName: 'Ramu', resolvedAt: null })
    await api().patch(`/api/complaints/${id}`).set(w.auth).send({ assignedStaffId: String(elsewhere._id) }).expect(404)
    await api().patch(`/api/complaints/${id}`).set(w.auth).send({ status: 'done' }).expect(400)

    const p2 = await api().patch(`/api/complaints/${id}`).set(w.auth).send({ status: 'resolved' }).expect(200)
    expect(p2.body.resolvedAt).toBeTruthy()

    await api().post('/api/complaints').set(w.auth).send({ hostelId: hid, category: 'food', title: 'Cold food' }).expect(201)
    // make the resolution take 2 hours
    const doc = await Complaint.findById(id)
    await Complaint.collection.updateOne({ _id: doc!._id }, { $set: { createdAt: new Date(doc!.resolvedAt!.getTime() - 2 * 3_600_000) } })
    const st = await api().get('/api/complaints/stats').set(w.auth).expect(200)
    expect(st.body).toMatchObject({ open: 1, inProgress: 0, resolvedThisMonth: 1, avgResolutionHours: 2 })

    const p3 = await api().patch(`/api/complaints/${id}`).set(w.auth).send({ status: 'open', assignedStaffId: null }).expect(200)
    expect(p3.body.resolvedAt).toBeNull()
    expect(p3.body.assignedStaffId).toBeNull()
  })

  it('isolation and roles', async () => {
    const w = await makeWorld()
    const c = await api().post('/api/complaints').set(w.auth).send({ hostelId: String(w.hostel._id), category: 'other', title: 'Noise at night' }).expect(201)
    const other = await makeOrg()
    await api().get(`/api/complaints/${c.body.id}`).set(other.auth).expect(404)
    await api().patch(`/api/complaints/${c.body.id}`).set(other.auth).send({ status: 'resolved' }).expect(404)
    await api().delete(`/api/complaints/${c.body.id}`).set(other.auth).expect(404)
    await api().post('/api/complaints').set(other.auth).send({ hostelId: String(w.hostel._id), category: 'other', title: 'Sneaky one' }).expect(404)
    const list = await api().get('/api/complaints').set(other.auth).expect(200)
    expect(list.body.items).toHaveLength(0)
    await Staff.create({ orgId: w.org._id, hostelId: w.hostel._id, name: 'Ramu', role: 'cleaner', joinDate: '2026-01-01' })
    const asg = await api().get('/api/complaints/assignees').set(other.auth).expect(200)
    expect(asg.body.items).toHaveLength(0)

    const acct = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/complaints').set(acct.auth).expect(403)
    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get('/api/complaints').set(warden.auth).expect(200)
    const cm = await api().post(`/api/complaints/${c.body.id}/comments`).set(warden.auth).send({ text: 'Checked' }).expect(201)
    expect(cm.body.comments[0].by).toBe('warden')
    await api().get('/api/complaints').set(w.hostelerAuth).expect(403)
  })
})
