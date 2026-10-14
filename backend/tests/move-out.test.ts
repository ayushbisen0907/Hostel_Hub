/**
 * Move-out requests: portal notice (GET/POST/DELETE /api/portal/move-out) and
 * staff decisions (/api/move-out-requests), notifications, and completion at check-out.
 */
import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeStaffUser, makeWorld } from './helpers.js'
import { Hostel } from '../src/models/Hostel.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { MoveOutRequest } from '../src/models/MoveOutRequest.js'
import { Notification } from '../src/models/Notification.js'
import { Organization } from '../src/models/Organization.js'
import { todayStr } from '../src/lib/http.js'
import { addDays, shortDate } from '../src/lib/dates.js'

const today = todayStr()
type World = Awaited<ReturnType<typeof makeWorld>>

const request = (w: World, body: Record<string, unknown>) => api().post('/api/portal/move-out').set(w.hostelerAuth).send(body)

describe('portal: request a move-out', () => {
  it('needs the hostel notice period (default 30 days)', async () => {
    const w = await makeWorld()
    const info = await api().get('/api/portal/move-out').set(w.hostelerAuth).expect(200)
    expect(info.body).toMatchObject({ items: [], active: null, noticePeriodDays: 30, earliestDate: addDays(today, 30), today })

    const early = await request(w, { moveOutDate: addDays(today, 29) }).expect(400)
    expect(early.body.error.message).toContain('30 days of notice')
    expect(early.body.error.message).toContain(shortDate(addDays(today, 30), true))
    await request(w, { moveOutDate: 'tomorrow' }).expect(400)
    await request(w, { moveOutDate: addDays(today, 30), reason: 'x'.repeat(501) }).expect(400)

    const r = await request(w, { moveOutDate: addDays(today, 30), reason: '  Got a job in Pune ' }).expect(201)
    expect(r.body).toMatchObject({ moveOutDate: addDays(today, 30), reason: 'Got a job in Pune', status: 'pending', response: '', decidedByName: null })
    expect(r.body.active).toBeUndefined()
    const after = await api().get('/api/portal/move-out').set(w.hostelerAuth).expect(200)
    expect(after.body.items).toHaveLength(1)
    expect(after.body.active.id).toBe(r.body.id)
  })

  it('uses the hostel setting (e.g. 0 or 15 days)', async () => {
    const w = await makeWorld()
    await Hostel.updateOne({ _id: w.hostel._id }, { noticePeriodDays: 15 })
    await request(w, { moveOutDate: addDays(today, 14) }).expect(400)
    await request(w, { moveOutDate: addDays(today, 15) }).expect(201)

    const w2 = await makeWorld()
    await Hostel.updateOne({ _id: w2.hostel._id }, { noticePeriodDays: 0 })
    expect((await api().get('/api/portal/move-out').set(w2.hostelerAuth).expect(200)).body.earliestDate).toBe(today)
    await request(w2, { moveOutDate: addDays(today, -1) }).expect(400)
    await request(w2, { moveOutDate: today }).expect(201)
  })

  it('only one pending/approved request at a time; cancel frees it', async () => {
    const w = await makeWorld()
    const first = await request(w, { moveOutDate: addDays(today, 40) }).expect(201)
    const dup = await request(w, { moveOutDate: addDays(today, 45) }).expect(409)
    expect(dup.body.error.message).toContain('already have a move-out request')

    // approved still counts as active
    await api().post(`/api/move-out-requests/${first.body.id}/approve`).set(w.auth).send({}).expect(200)
    await request(w, { moveOutDate: addDays(today, 45) }).expect(409)
    expect((await Hosteler.findById(w.hosteler._id).lean())!.expectedCheckOut).toBe(addDays(today, 40))

    // cancelling an approved request clears the expected check-out
    const c = await api().delete(`/api/portal/move-out/${first.body.id}`).set(w.hostelerAuth).expect(200)
    expect(c.body.status).toBe('cancelled')
    expect((await Hosteler.findById(w.hosteler._id).lean())!.expectedCheckOut).toBeNull()
    await api().delete(`/api/portal/move-out/${first.body.id}`).set(w.hostelerAuth).expect(409)

    const second = await request(w, { moveOutDate: addDays(today, 45) }).expect(201)
    expect(second.body.status).toBe('pending')
    const all = await api().get('/api/portal/move-out').set(w.hostelerAuth).expect(200)
    expect(all.body.items.map((i: { status: string }) => i.status)).toEqual(['pending', 'cancelled'])
  })

  it('the database allows only one active request even under concurrency', async () => {
    const w = await makeWorld()
    const rs = await Promise.all(Array.from({ length: 4 }, (_, i) => request(w, { moveOutDate: addDays(today, 31 + i) })))
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1)
    expect(rs.filter((r) => r.status === 409)).toHaveLength(3)
    expect(await MoveOutRequest.countDocuments({ hostelerId: w.hosteler._id, active: true })).toBe(1)
  })

  it("isolation: hostelers can't see or cancel each other's requests", async () => {
    const w = await makeWorld()
    const other = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Vikram Rao' })
    const mine = await request(w, { moveOutDate: addDays(today, 31) }).expect(201)
    expect((await api().get('/api/portal/move-out').set(other.auth).expect(200)).body.items).toEqual([])
    await api().delete(`/api/portal/move-out/${mine.body.id}`).set(other.auth).expect(404)
    await api().delete('/api/portal/move-out/not-an-id').set(other.auth).expect(400)
    expect((await MoveOutRequest.findById(mine.body.id).lean())!.status).toBe('pending')
    // staff tokens can't use the portal endpoint
    await api().get('/api/portal/move-out').set(w.auth).expect(403)
    await api().get('/api/portal/move-out').expect(401)
  })

  it('needs the portal plan', async () => {
    const w = await makeWorld({ plan: 'free' })
    await api().get('/api/portal/move-out').set(w.hostelerAuth).expect(402)
  })
})

describe('staff: list, approve, reject', () => {
  it('notifies owner/manager/warden of a new request (not the accountant)', async () => {
    const w = await makeWorld()
    const manager = await makeStaffUser(w.org._id, 'manager')
    const warden = await makeStaffUser(w.org._id, 'warden')
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await request(w, { moveOutDate: addDays(today, 30), reason: 'Exams over' }).expect(201)
    for (const who of [w, manager, warden]) {
      const n = await api().get('/api/notifications').set(who.auth).expect(200)
      expect(n.body.unreadCount).toBe(1)
      expect(n.body.items[0]).toMatchObject({ type: 'move_out_requested', title: 'Move-out request: Aarav Sharma' })
      expect(n.body.items[0].body).toContain(shortDate(addDays(today, 30), true))
      expect(n.body.items[0].body).toContain('Exams over')
    }
    expect((await api().get('/api/notifications').set(accountant.auth).expect(200)).body.unreadCount).toBe(0)
  })

  it('lists requests with hosteler info, filters by status and hostel', async () => {
    const w = await makeWorld()
    const hostel2 = await makeHostel(w.org._id, 'Second Hostel')
    const h2 = await makeHosteler(w.org._id, hostel2, { name: 'Kabir Das' })
    const a = await request(w, { moveOutDate: addDays(today, 30) }).expect(201)
    await api().post('/api/portal/move-out').set(h2.auth).send({ moveOutDate: addDays(today, 35) }).expect(201)

    const all = await api().get('/api/move-out-requests').set(w.auth).expect(200)
    expect(all.body.items).toHaveLength(2)
    const mine = all.body.items.find((i: { id: string }) => i.id === a.body.id)
    expect(mine).toMatchObject({
      status: 'pending',
      hosteler: { id: String(w.hosteler._id), name: 'Aarav Sharma', loginId: w.hosteler.loginId },
      roomNumber: '101',
      bedLabel: 'A',
      hostelName: 'Sunrise Boys Hostel',
    })
    expect(mine.active).toBeUndefined()
    const scoped = await api().get('/api/move-out-requests').query({ hostelId: String(hostel2._id) }).set(w.auth).expect(200)
    expect(scoped.body.items.map((i: { hosteler: { name: string } }) => i.hosteler.name)).toEqual(['Kabir Das'])

    await api().post(`/api/move-out-requests/${a.body.id}/reject`).set(w.auth).send({ response: 'Pay dues first' }).expect(200)
    expect((await api().get('/api/move-out-requests?status=pending').set(w.auth).expect(200)).body.items).toHaveLength(1)
    expect((await api().get('/api/move-out-requests?status=rejected').set(w.auth).expect(200)).body.items).toHaveLength(1)
    expect((await api().get('/api/move-out-requests?status=all').set(w.auth).expect(200)).body.items).toHaveLength(2)
    await api().get('/api/move-out-requests?status=bogus').set(w.auth).expect(400)
  })

  it('approve sets expectedCheckOut and notifies the hosteler', async () => {
    const w = await makeWorld()
    const warden = await makeStaffUser(w.org._id, 'warden')
    const r = await request(w, { moveOutDate: addDays(today, 31) }).expect(201)
    const a = await api().post(`/api/move-out-requests/${r.body.id}/approve`).set(warden.auth).send({ response: 'Return keys at the office' }).expect(200)
    expect(a.body).toMatchObject({ status: 'approved', response: 'Return keys at the office', decidedByName: 'warden' })
    expect(a.body.decidedAt).toBeTruthy()
    expect((await Hosteler.findById(w.hosteler._id).lean())!.expectedCheckOut).toBe(addDays(today, 31))

    const n = await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)
    expect(n.body.items[0]).toMatchObject({ type: 'move_out_approved', title: 'Move-out approved', link: '/portal/move-out' })
    expect(n.body.items[0].body).toContain(shortDate(addDays(today, 31), true))
    expect(n.body.items[0].body).toContain('Return keys at the office')

    // decided once only
    await api().post(`/api/move-out-requests/${r.body.id}/approve`).set(w.auth).send({}).expect(409)
    await api().post(`/api/move-out-requests/${r.body.id}/reject`).set(w.auth).send({ response: 'no' }).expect(409)
  })

  it('reject needs a reason, notifies the hosteler and frees a new request', async () => {
    const w = await makeWorld()
    const r = await request(w, { moveOutDate: addDays(today, 31) }).expect(201)
    await api().post(`/api/move-out-requests/${r.body.id}/reject`).set(w.auth).send({}).expect(400)
    await api().post(`/api/move-out-requests/${r.body.id}/reject`).set(w.auth).send({ response: '   ' }).expect(400)
    const rej = await api().post(`/api/move-out-requests/${r.body.id}/reject`).set(w.auth).send({ response: 'Lock-in till March' }).expect(200)
    expect(rej.body).toMatchObject({ status: 'rejected', response: 'Lock-in till March', decidedByName: 'Owner' })
    expect((await Hosteler.findById(w.hosteler._id).lean())!.expectedCheckOut).toBeNull()
    const n = await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)
    expect(n.body.items[0]).toMatchObject({ type: 'move_out_rejected', title: 'Move-out request rejected' })
    expect(n.body.items[0].body).toContain('Lock-in till March')
    await api().delete(`/api/portal/move-out/${r.body.id}`).set(w.hostelerAuth).expect(409)
    await request(w, { moveOutDate: addDays(today, 60) }).expect(201)
  })

  it('permissions and org isolation', async () => {
    const w = await makeWorld()
    const r = await request(w, { moveOutDate: addDays(today, 31) }).expect(201)
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await api().get('/api/move-out-requests').set(accountant.auth).expect(403)
    await api().post(`/api/move-out-requests/${r.body.id}/approve`).set(accountant.auth).send({}).expect(403)
    await api().get('/api/move-out-requests').set(w.hostelerAuth).expect(403)
    await api().get('/api/move-out-requests').expect(401)

    const other = await makeOrg()
    expect((await api().get('/api/move-out-requests').set(other.auth).expect(200)).body.items).toEqual([])
    await api().post(`/api/move-out-requests/${r.body.id}/approve`).set(other.auth).send({}).expect(404)
    await api().post(`/api/move-out-requests/${r.body.id}/reject`).set(other.auth).send({ response: 'x' }).expect(404)
    await api().post('/api/move-out-requests/bad/approve').set(w.auth).send({}).expect(400)
    expect((await MoveOutRequest.findById(r.body.id).lean())!.status).toBe('pending')

    // free plan has check-in but no portal; staff routes still work there
    await Organization.updateOne({ _id: w.org._id }, { plan: 'free' })
    await api().get('/api/move-out-requests').set(w.auth).expect(200)
  })
})

describe('check-out completes the request', () => {
  it('an approved request becomes completed at check-out and shows in the preview', async () => {
    const w = await makeWorld()
    const r = await request(w, { moveOutDate: addDays(today, 31) }).expect(201)
    await api().post(`/api/move-out-requests/${r.body.id}/approve`).set(w.auth).send({}).expect(200)
    const p = await api().get(`/api/hostelers/${w.hosteler._id}/check-out-preview`).set(w.auth).expect(200)
    expect(p.body.moveOutRequest).toEqual({ id: r.body.id, moveOutDate: addDays(today, 31), status: 'approved' })

    await api().post(`/api/hostelers/${w.hosteler._id}/check-out`).set(w.auth).send({ date: today }).expect(200)
    const done = (await MoveOutRequest.findById(r.body.id).lean())!
    expect(done).toMatchObject({ status: 'completed', active: false })
    // portal account is closed
    await api().get('/api/portal/move-out').set(w.hostelerAuth).expect(401)
  })

  it('a pending request is completed too; earlier closed ones are untouched', async () => {
    const w = await makeWorld()
    const old = await request(w, { moveOutDate: addDays(today, 31) }).expect(201)
    await api().delete(`/api/portal/move-out/${old.body.id}`).set(w.hostelerAuth).expect(200)
    const r = await request(w, { moveOutDate: addDays(today, 32) }).expect(201)
    await api().post(`/api/hostelers/${w.hosteler._id}/check-out`).set(w.auth).send({ date: today }).expect(200)
    expect((await MoveOutRequest.findById(r.body.id).lean())!.status).toBe('completed')
    expect((await MoveOutRequest.findById(old.body.id).lean())!.status).toBe('cancelled')
  })

  it('move-out notifications are hosteler/staff scoped', async () => {
    const w = await makeWorld()
    await request(w, { moveOutDate: addDays(today, 31) }).expect(201)
    expect(await Notification.countDocuments({ recipientKind: 'hosteler' })).toBe(0)
    expect(await Notification.countDocuments({ recipientKind: 'staff', type: 'move_out_requested' })).toBe(1)
  })
})
