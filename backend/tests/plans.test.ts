/**
 * Plan restrictions (lib/plans.ts): modules per plan, bed / hostel / staff-login
 * limits, expired monthly/yearly plans working like Free, and what each plan bills.
 */
import { describe, expect, it } from 'vitest'
import { api, makeHostel, makeHosteler, makeOrg, makeRoom, makeStaffUser, makeWorld } from './helpers.js'
import { effectivePlan, expiryFor } from '../src/lib/plans.js'
import { generateDueBills } from '../src/lib/rentCycle.js'
import { Hostel } from '../src/models/Hostel.js'
import { Invoice } from '../src/models/Invoice.js'
import { Organization } from '../src/models/Organization.js'
import { User } from '../src/models/User.js'

const newHostel = (name: string) => ({ name, type: 'boys', city: 'Pune', upiId: 'stay@ybl', payeeName: name })

describe('modules per plan', () => {
  it('Free locks everything beyond the basics', async () => {
    const w = await makeWorld({ plan: 'free' })
    const hid = String(w.hostel._id)
    for (const path of [
      `/api/electricity?hostelId=${hid}`,
      `/api/mess/menu?hostelId=${hid}`,
      '/api/documents',
      '/api/complaints',
      '/api/notices',
      '/api/move-out-requests',
      '/api/attendance',
      '/api/visitors',
      '/api/gate-logs',
      '/api/expenses',
      '/api/reports/pnl',
      '/api/org/export',
    ]) {
      const r = await api().get(path).set(w.auth)
      expect(r.status, path).toBe(402)
      expect(r.body.error.code, path).toBe('PLAN_UPGRADE_REQUIRED')
    }
    // the basics work
    await api().get('/api/hostelers').set(w.auth).expect(200)
    await api().get(`/api/rooms?hostelId=${hid}`).set(w.auth).expect(200)
    await api().get('/api/invoices').set(w.auth).expect(200)
    await api().get('/api/payment-claims').set(w.auth).expect(200)
  })

  it('the 402 names the plan to upgrade to', async () => {
    const free = await makeWorld({ plan: 'free' })
    const e = await api().get(`/api/electricity?hostelId=${free.hostel._id}`).set(free.auth).expect(402)
    expect(e.body.error.message).toMatch(/Upgrade to Starter/)
    expect(e.body.error.details).toMatchObject({ requiredPlan: 'Starter' })

    const starter = await makeWorld({ plan: 'starter' })
    await api().get(`/api/electricity?hostelId=${starter.hostel._id}`).set(starter.auth).expect(200)
    await api().get('/api/notices').set(starter.auth).expect(200)
    const v = await api().get('/api/visitors').set(starter.auth).expect(402)
    expect(v.body.error.message).toMatch(/Upgrade to Pro/)

    const pro = await makeWorld({ plan: 'pro' })
    await api().get('/api/gate-logs').set(pro.auth).expect(200)
    await api().get('/api/reports/pnl').set(pro.auth).expect(200)
    const x = await api().get('/api/org/export').set(pro.auth).expect(402)
    expect(x.body.error.message).toMatch(/Upgrade to Business/)

    const business = await makeWorld({ plan: 'business' })
    await api().get('/api/org/export').set(business.auth).expect(200)
  })
})

describe('limits', () => {
  it('beds: Free allows 7', async () => {
    const { org, auth } = await makeOrg({ plan: 'free' })
    const hostel = await makeHostel(org._id)
    await makeRoom(org._id, hostel._id, '101', 4)
    await api().post('/api/rooms').set(auth).send({ hostelId: String(hostel._id), number: '102', sharing: 3, rentPerBed: 1 }).expect(201)
    const r = await api().post('/api/rooms').set(auth).send({ hostelId: String(hostel._id), number: '103', sharing: 1, rentPerBed: 1 }).expect(402)
    expect(r.body.error).toMatchObject({ code: 'PLAN_LIMIT', details: { limit: 'beds', max: 7, current: 7, requiredPlan: 'Starter' } })
  })

  it('hostels: Free and Starter allow 1, Pro 3, Business any', async () => {
    const free = await makeOrg({ plan: 'free' })
    await api().post('/api/hostels').set(free.auth).send(newHostel('First')).expect(201)
    const r = await api().post('/api/hostels').set(free.auth).send(newHostel('Second')).expect(402)
    expect(r.body.error).toMatchObject({ code: 'PLAN_LIMIT', details: { limit: 'hostels', max: 1, requiredPlan: 'Pro' } })

    const pro = await makeOrg({ plan: 'pro' })
    for (const n of ['A', 'B', 'C']) await api().post('/api/hostels').set(pro.auth).send(newHostel(`Pro ${n}`)).expect(201)
    await api().post('/api/hostels').set(pro.auth).send(newHostel('Pro D')).expect(402)

    const biz = await makeOrg({ plan: 'business' })
    for (const n of ['A', 'B', 'C', 'D']) await api().post('/api/hostels').set(biz.auth).send(newHostel(`Biz ${n}`)).expect(201)
  })

  it('staff logins: none on Starter, 3 on Pro (switched-off logins do not count)', async () => {
    const starter = await makeOrg({ plan: 'starter' })
    const s = await api().post('/api/org/users').set(starter.auth).send({ name: 'Meena', email: 'meena@starter.in', role: 'warden' }).expect(402)
    expect(s.body.error.message).toMatch(/doesn't include staff logins/)

    const pro = await makeOrg({ plan: 'pro' })
    const ids: string[] = []
    for (const n of [1, 2, 3]) ids.push((await api().post('/api/org/users').set(pro.auth).send({ name: `Staff ${n}`, email: `s${n}@pro.in`, role: 'warden' }).expect(201)).body.user.id)
    await api().post('/api/org/users').set(pro.auth).send({ name: 'Staff 4', email: 's4@pro.in', role: 'warden' }).expect(402)
    // switch one off -> room for another; switching it back on is then blocked
    await api().patch(`/api/org/users/${ids[0]}`).set(pro.auth).send({ active: false }).expect(200)
    await api().post('/api/org/users').set(pro.auth).send({ name: 'Staff 4', email: 's4@pro.in', role: 'warden' }).expect(201)
    await api().patch(`/api/org/users/${ids[0]}`).set(pro.auth).send({ active: true }).expect(402)
  })

  it('staff logins stop working when the plan no longer includes them; the owner keeps working', async () => {
    const w = await makeWorld({ plan: 'pro' })
    const warden = await makeStaffUser(w.org._id, 'warden')
    await User.updateOne({ _id: warden.user._id }, { email: 'warden@pro.in' })
    await api().get('/api/hostelers').set(warden.auth).expect(200)

    await Organization.updateOne({ _id: w.org._id }, { plan: 'starter' })
    const r = await api().get('/api/hostelers').set(warden.auth).expect(402)
    expect(r.body.error.code).toBe('PLAN_UPGRADE_REQUIRED')
    const login = await api().post('/api/auth/login').send({ email: 'warden@pro.in', password: 'Staff@123' }).expect(402)
    expect(login.body.error.message).toMatch(/upgrade to Pro/)
    await api().get('/api/hostelers').set(w.auth).expect(200)
  })
})

describe('plan expiry', () => {
  it('a monthly/yearly plan that has run out works like Free; one-time never expires', async () => {
    const w = await makeWorld({ plan: 'pro' })
    await Organization.updateOne({ _id: w.org._id }, { billingCycle: 'monthly', planExpiresAt: new Date(Date.now() + 86_400_000) })
    await api().get('/api/visitors').set(w.auth).expect(200)

    await Organization.updateOne({ _id: w.org._id }, { planExpiresAt: new Date(Date.now() - 1000) })
    await api().get('/api/visitors').set(w.auth).expect(402)
    const org = await api().get('/api/org').set(w.auth).expect(200)
    expect(org.body.plan).toBe('pro') // what was bought
    expect(org.body.limits).toMatchObject({ plan: 'free', name: 'Free', expired: true, beds: 7 })
    // nothing is deleted
    await api().get(`/api/hostelers/${w.hosteler._id}`).set(w.auth).expect(200)

    await Organization.updateOne({ _id: w.org._id }, { billingCycle: 'onetime', planExpiresAt: null })
    await api().get('/api/visitors').set(w.auth).expect(200)
  })

  it('effectivePlan and expiryFor', () => {
    const now = new Date('2026-10-21T10:00:00Z')
    expect(effectivePlan({ plan: 'pro', planExpiresAt: null }, now)).toBe('pro')
    expect(effectivePlan({ plan: 'pro', planExpiresAt: new Date('2026-10-21T09:59:59Z') }, now)).toBe('free')
    expect(effectivePlan({ plan: 'basic' }, now)).toBe('free') // unknown -> free
    expect(effectivePlan(null)).toBe('free')
    expect(expiryFor('onetime', now)).toBeNull()
    expect(expiryFor('monthly', now)!.toISOString()).toBe('2026-11-21T10:00:00.000Z')
    expect(expiryFor('yearly', now)!.toISOString()).toBe('2027-10-21T10:00:00.000Z')
  })
})

describe('what each plan does to hostelers', () => {
  it('Free: rules are not enforced and mess fees are not billed', async () => {
    const w = await makeWorld({ plan: 'free' })
    await Hostel.updateOne({ _id: w.hostel._id }, { rulesText: 'No smoking.', rulesVersion: 1, 'charges.mess': 2500 })
    // hostelers can use the app without signing
    await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)

    const { hosteler } = await makeHosteler(w.org._id, (await Hostel.findById(w.hostel._id))!, { bed: w.beds[1]!, messOpted: true, name: 'Mess Lover' })
    await generateDueBills(w.org._id, { notify: false })
    const bill = await Invoice.findOne({ hostelerId: hosteler._id }).lean()
    expect(bill).not.toBeNull()
    expect(bill!.items.map((i) => i.key)).not.toContain('mess')

    // on Starter both apply
    await Organization.updateOne({ _id: w.org._id }, { plan: 'starter' })
    const r = await api().get('/api/portal/home').set(w.hostelerAuth).expect(403)
    expect(r.body.error.code).toBe('CONSENT_REQUIRED')
  })
})
