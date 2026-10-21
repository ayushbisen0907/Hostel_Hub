import { describe, expect, it } from 'vitest'
import { api, makeOrg, makeStaffUser, makeWorld, staffAuth } from './helpers.js'
import { User } from '../src/models/User.js'
import { HDocument } from '../src/models/Document.js'

describe('organization', () => {
  it('GET returns org, settings, usage and plan limits to any staff', async () => {
    const w = await makeWorld({ plan: 'pro' })
    const warden = await makeStaffUser(w.org._id, 'warden')
    const r = await api().get('/api/org').set(warden.auth).expect(200)
    expect(r.body.id).toBe(String(w.org._id))
    expect(r.body.settings.rentDueDay).toBe(5)
    expect(r.body.usage).toEqual({ hostels: 1, beds: 2, activeHostelers: 1, staffLogins: 1 })
    expect(r.body.limits).toMatchObject({ plan: 'pro', name: 'Pro', beds: 100, hostels: 3, staffLogins: 3, expired: false })
    expect(r.body.limits.modules).toContain('attendance')
    expect(r.body.limits.modules).not.toContain('export')
    expect(r.body).not.toHaveProperty('invoiceSeq')
    await api().get('/api/org').expect(401)
  })

  it('owner updates profile and settings; validation; other roles forbidden', async () => {
    const { org, auth } = await makeOrg()
    const r = await api().patch('/api/org').set(auth).send({ name: 'Lotus Stays', phone: '9826000000' }).expect(200)
    expect(r.body.name).toBe('Lotus Stays')
    await api().patch('/api/org').set(auth).send({ email: 'not-an-email' }).expect(400)
    await api().patch('/api/org').set(auth).send({ plan: 'pro' }).expect(400) // unknown key

    const s = await api().patch('/api/org/settings').set(auth).send({ rentDueDay: 10, nightCurfew: '23:30', receiptPrefix: 'lot' }).expect(200)
    expect(s.body).toMatchObject({ rentDueDay: 10, nightCurfew: '23:30', receiptPrefix: 'LOT', lateFeePerDay: 50 })
    await api().patch('/api/org/settings').set(auth).send({ rentDueDay: 31 }).expect(400)
    await api().patch('/api/org/settings').set(auth).send({ nightCurfew: '25:00' }).expect(400)
    await api().patch('/api/org/settings').set(auth).send({ lateFeePerDay: -1 }).expect(400)

    const manager = await makeStaffUser(org._id, 'manager')
    await api().patch('/api/org').set(manager.auth).send({ name: 'Hacked' }).expect(403)
    await api().patch('/api/org/settings').set(manager.auth).send({ rentDueDay: 3 }).expect(403)
  })

  it('owners cannot change their own plan from the app', async () => {
    const { auth } = await makeOrg({ plan: 'free' })
    await api().patch('/api/org/plan').set(auth).send({ plan: 'business' }).expect(404)
    await api().patch('/api/org').set(auth).send({ plan: 'business' }).expect(400)
  })
})

describe('staff logins', () => {
  it('creates logins with a one-time temp password or a given password', async () => {
    const { org, auth } = await makeOrg()
    const c = await api().post('/api/org/users').set(auth).send({ name: 'Meena', email: 'Meena@X.in', role: 'warden' }).expect(201)
    expect(c.body.tempPassword).toMatch(/^.{8}$/)
    expect(c.body.user).not.toHaveProperty('passwordHash')
    expect(c.body.user.email).toBe('meena@x.in')
    await api().post('/api/auth/login').send({ email: 'meena@x.in', password: c.body.tempPassword }).expect(200)

    const p = await api().post('/api/org/users').set(auth).send({ name: 'Ravi', email: 'ravi@x.in', role: 'accountant', password: 'Account123' }).expect(201)
    expect(p.body.tempPassword).toBeNull()
    await api().post('/api/auth/login').send({ email: 'ravi@x.in', password: 'Account123' }).expect(200)

    await api().post('/api/org/users').set(auth).send({ name: 'Dup', email: 'ravi@x.in', role: 'warden' }).expect(409)
    await api().post('/api/org/users').set(auth).send({ name: 'Boss', email: 'b@x.in', role: 'owner' }).expect(400)
    await api().post('/api/org/users').set(auth).send({ name: 'Weak', email: 'w@x.in', role: 'warden', password: 'weak' }).expect(400)

    const list = await api().get('/api/org/users').set(auth).expect(200)
    expect(list.body.items).toHaveLength(3)
    expect(list.body.items.every((u: Record<string, unknown>) => !('passwordHash' in u))).toBe(true)

    const manager = await makeStaffUser(org._id, 'manager')
    await api().get('/api/org/users').set(manager.auth).expect(403)
    await api().post('/api/org/users').set(manager.auth).send({ name: 'X Y', email: 'xy@x.in', role: 'warden' }).expect(403)
  })

  it('updates, deactivates, resets and deletes; owner and self are protected', async () => {
    const { org, owner, auth } = await makeOrg()
    const w = await makeStaffUser(org._id, 'warden')
    const id = String(w.user._id)

    const u = await api().patch(`/api/org/users/${id}`).set(auth).send({ role: 'manager', name: 'Meena K' }).expect(200)
    expect(u.body).toMatchObject({ role: 'manager', name: 'Meena K' })
    await api().patch(`/api/org/users/${id}`).set(auth).send({ role: 'owner' }).expect(400)

    // deactivation revokes their session immediately
    await api().patch(`/api/org/users/${id}`).set(auth).send({ active: false }).expect(200)
    await api().get('/api/auth/me').set(w.auth).expect(401)
    await api().patch(`/api/org/users/${id}`).set(auth).send({ active: true }).expect(200)

    const fresh = (await User.findById(id))!
    const before = staffAuth(fresh)
    await api().get('/api/auth/me').set(before).expect(200)
    const reset = await api().post(`/api/org/users/${id}/reset-password`).set(auth).expect(200)
    expect(reset.body.tempPassword).toHaveLength(8)
    await api().get('/api/auth/me').set(before).expect(401)
    await api().post('/api/auth/login').send({ email: fresh.email, password: reset.body.tempPassword }).expect(200)

    const ownerId = String(owner._id)
    await api().patch(`/api/org/users/${ownerId}`).set(auth).send({ active: false }).expect(403)
    await api().post(`/api/org/users/${ownerId}/reset-password`).set(auth).expect(403)
    await api().delete(`/api/org/users/${ownerId}`).set(auth).expect(403)
    await api().patch('/api/org/users/not-an-id').set(auth).send({ name: 'Abc' }).expect(400)

    await api().delete(`/api/org/users/${id}`).set(auth).expect(200)
    expect(await User.exists({ _id: id })).toBeNull()
  })

  it('isolates organizations', async () => {
    const a = await makeOrg()
    const b = await makeOrg()
    const w = await makeStaffUser(a.org._id, 'warden')
    const id = String(w.user._id)
    await api().patch(`/api/org/users/${id}`).set(b.auth).send({ name: 'Stolen' }).expect(404)
    await api().post(`/api/org/users/${id}/reset-password`).set(b.auth).expect(404)
    await api().delete(`/api/org/users/${id}`).set(b.auth).expect(404)
    const list = await api().get('/api/org/users').set(b.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    const org = await api().get('/api/org').set(b.auth).expect(200)
    expect(org.body.id).toBe(String(b.org._id))
  })
})

describe('export', () => {
  it('exports only this org, without secrets', async () => {
    const w = await makeWorld()
    await makeWorld() // another org
    await HDocument.create({
      orgId: w.org._id,
      hostelId: w.hostel._id,
      hostelerId: w.hosteler._id,
      type: 'aadhaar',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      size: 10,
      storageKey: 'secret-key.pdf',
    })
    const r = await api().get('/api/org/export').set(w.auth).expect(200)
    expect(r.body.organization.id).toBe(String(w.org._id))
    const c = r.body.collections
    expect(c.hostels).toHaveLength(1)
    expect(c.rooms).toHaveLength(1)
    expect(c.beds).toHaveLength(2)
    expect(c.hostelers).toHaveLength(1)
    expect(c.users).toHaveLength(1)
    expect(c.documents).toHaveLength(1)
    const text = JSON.stringify(r.body)
    expect(text).not.toContain('passwordHash')
    expect(text).not.toContain('storageKey')
    expect(text).not.toContain('secret-key')

    const manager = await makeStaffUser(w.org._id, 'manager')
    await api().get('/api/org/export').set(manager.auth).expect(403)
  })
})
