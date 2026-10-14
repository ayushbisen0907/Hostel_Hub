/**
 * Hostel stay terms (notice period, minimum stay for the deposit, rules),
 * default rules text, and hostelers' signed consent to the rules
 * (CONSENT_REQUIRED gate, /api/portal/auth/rules, /api/portal/auth/consent,
 * staff view).
 */
import { describe, expect, it } from 'vitest'
import { api, makeHosteler, makeOrg, makeStaffUser, makeWorld, TEST_UPI } from './helpers.js'
import { Hostel } from '../src/models/Hostel.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Notification } from '../src/models/Notification.js'
import { Organization } from '../src/models/Organization.js'
import { RulesConsent } from '../src/models/RulesConsent.js'

type World = Awaited<ReturnType<typeof makeWorld>>

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const SIGNATURE = `data:image/png;base64,${PNG_1PX}`
/** a "PNG" just over 200 KB */
const bigPng = () => {
  const head = Buffer.from(PNG_1PX, 'base64')
  return `data:image/png;base64,${Buffer.concat([head, Buffer.alloc(200 * 1024 - head.length + 1, 1)]).toString('base64')}`
}

const RULES = '1. Gate closes at 10 PM.\n2. No smoking.'

async function withRules(w: World, rulesText = RULES) {
  return api().patch(`/api/hostels/${w.hostel._id}`).set(w.auth).send({ rulesText }).expect(200)
}
const sign = (auth: Record<string, string>, body: Record<string, unknown> = {}) =>
  api().post('/api/portal/auth/consent').set(auth).send({ signedName: 'Aarav Sharma', signature: SIGNATURE, accept: true, ...body })

describe('hostel stay terms', () => {
  it('defaults, create and patch validation', async () => {
    const { auth } = await makeOrg()
    const base = { name: 'Terms Hostel', type: 'boys', city: 'Indore', ...TEST_UPI }
    const d = await api().post('/api/hostels').set(auth).send(base).expect(201)
    expect(d.body).toMatchObject({ noticePeriodDays: 30, depositMinStayMonths: 0, rulesText: '', rulesVersion: 0 })

    const c = await api().post('/api/hostels').set(auth).send({ ...base, name: 'Strict Hostel', noticePeriodDays: 15, depositMinStayMonths: 6, rulesText: '  No pets.  ' }).expect(201)
    expect(c.body).toMatchObject({ noticePeriodDays: 15, depositMinStayMonths: 6, rulesText: 'No pets.', rulesVersion: 1 })

    for (const bad of [
      { noticePeriodDays: 91 },
      { noticePeriodDays: -1 },
      { noticePeriodDays: 1.5 },
      { depositMinStayMonths: 13 },
      { depositMinStayMonths: -1 },
      { rulesText: 'x'.repeat(10001) },
      { rulesVersion: 5 }, // read-only
    ])
      await api().patch(`/api/hostels/${c.body.id}`).set(auth).send(bad).expect(400)
    await api().post('/api/hostels').set(auth).send({ ...base, name: 'Bad', depositMinStayMonths: 13 }).expect(400)

    const p = await api().patch(`/api/hostels/${c.body.id}`).set(auth).send({ noticePeriodDays: 0, depositMinStayMonths: 12, rulesText: 'x'.repeat(10000) }).expect(200)
    expect(p.body).toMatchObject({ noticePeriodDays: 0, depositMinStayMonths: 12, rulesVersion: 2 })
  })

  it('rulesVersion goes up only when the rules text changes', async () => {
    const w = await makeWorld()
    expect((await withRules(w)).body.rulesVersion).toBe(1)
    expect((await withRules(w)).body.rulesVersion).toBe(1) // same text
    expect((await api().patch(`/api/hostels/${w.hostel._id}`).set(w.auth).send({ noticePeriodDays: 20 }).expect(200)).body.rulesVersion).toBe(1)
    expect((await withRules(w, `${RULES}\n3. No pets.`)).body.rulesVersion).toBe(2)
    expect((await withRules(w, '')).body).toMatchObject({ rulesVersion: 3, rulesText: '' })
  })

  it('GET /api/hostels/:id/default-rules builds rules from the settings', async () => {
    const w = await makeWorld()
    await Organization.updateOne({ _id: w.org._id }, { 'settings.rentDueDay': 7, 'settings.nightCurfew': '21:30', 'settings.lateFeePerDay': 25, 'settings.defaultSecurityDeposit': 8000 })
    await Hostel.updateOne({ _id: w.hostel._id }, { noticePeriodDays: 45, depositMinStayMonths: 6 })
    const r = await api().get(`/api/hostels/${w.hostel._id}/default-rules`).set(w.auth).expect(200)
    const t: string = r.body.rulesText
    expect(t).toContain('Sunrise Boys Hostel')
    expect(t).toContain('in advance')
    expect(t).toContain('within 7 days')
    expect(t).toContain('₹25 per day')
    expect(t).toContain('₹8,000')
    expect(t).toContain('at least 6 months')
    expect(t).toContain('forfeited')
    expect(t).toContain('45 days of notice')
    expect(t).toContain('9:30 PM')
    expect(t).toMatch(/visitor/i)
    expect(t).toMatch(/mess/i)
    expect(t).toMatch(/damage/i)
    expect(t).toMatch(/ID proof/i)
    expect(t).toContain('Female visitors')
    expect(t.length).toBeLessThanOrEqual(10000)

    // always-refundable deposit
    await Hostel.updateOne({ _id: w.hostel._id }, { depositMinStayMonths: 0, noticePeriodDays: 1 })
    const r2 = await api().get(`/api/hostels/${w.hostel._id}/default-rules`).set(w.auth).expect(200)
    expect(r2.body.rulesText).not.toContain('forfeited')
    expect(r2.body.rulesText).toContain('1 day of notice')

    // can be saved as the hostel's rules
    await withRules(w, r2.body.rulesText)

    const warden = await makeStaffUser(w.org._id, 'warden')
    await api().get(`/api/hostels/${w.hostel._id}/default-rules`).set(warden.auth).expect(403)
    const other = await makeOrg()
    await api().get(`/api/hostels/${w.hostel._id}/default-rules`).set(other.auth).expect(404)
  })
})

describe('consent gate', () => {
  it('no rules -> no gate', async () => {
    const w = await makeWorld()
    await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)
    const me = await api().get('/api/portal/auth/me').set(w.hostelerAuth).expect(200)
    expect(me.body).toMatchObject({ consentRequired: false, rulesVersion: 0 })
    const rules = await api().get('/api/portal/auth/rules').set(w.hostelerAuth).expect(200)
    expect(rules.body).toMatchObject({ hostelName: 'Sunrise Boys Hostel', rulesText: '', rulesVersion: 0, signed: false })
    const r = await sign(w.hostelerAuth).expect(409)
    expect(r.body.error.message).toContain('no rules')
  })

  it('403 CONSENT_REQUIRED on portal endpoints until signed; me/rules/consent stay open', async () => {
    const w = await makeWorld()
    await withRules(w)
    const blocked = await api().get('/api/portal/home').set(w.hostelerAuth).expect(403)
    expect(blocked.body.error.code).toBe('CONSENT_REQUIRED')
    await api().get('/api/portal/invoices').set(w.hostelerAuth).expect(403)
    await api().get('/api/portal/move-out').set(w.hostelerAuth).expect(403)

    const login = await api().post('/api/portal/auth/login').send({ loginId: w.hosteler.loginId, password: w.hostelerPassword }).expect(200)
    expect(login.body).toMatchObject({ mustChangePassword: false, consentRequired: true, rulesVersion: 1 })
    const me = await api().get('/api/portal/auth/me').set(w.hostelerAuth).expect(200)
    expect(me.body).toMatchObject({ consentRequired: true, rulesVersion: 1 })
    const rules = await api().get('/api/portal/auth/rules').set(w.hostelerAuth).expect(200)
    expect(rules.body).toEqual({ hostelName: 'Sunrise Boys Hostel', rulesText: RULES, rulesVersion: 1, signed: false, signedAt: null })

    const s = await sign(w.hostelerAuth, { signedName: '  aarav   SHARMA ' }).expect(201)
    expect(s.body).toMatchObject({ consentRequired: false, rulesVersion: 1, consent: { rulesVersion: 1, signedName: 'aarav   SHARMA' } })
    expect(s.body.consent.signature).toBeUndefined()

    await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)
    expect((await api().get('/api/portal/auth/me').set(w.hostelerAuth).expect(200)).body.consentRequired).toBe(false)
    const after = await api().get('/api/portal/auth/rules').set(w.hostelerAuth).expect(200)
    expect(after.body).toMatchObject({ signed: true, rulesVersion: 1 })
    expect(after.body.signedAt).toBeTruthy()
    await sign(w.hostelerAuth).expect(409) // already signed

    const saved = (await RulesConsent.findOne({ hostelerId: w.hosteler._id }).lean())!
    expect(saved).toMatchObject({ rulesVersion: 1, rulesText: RULES, signature: SIGNATURE, hostelId: w.hostel._id, orgId: w.org._id })
    expect(saved.userAgent).toBeDefined()
    expect((await Hosteler.findById(w.hosteler._id).lean())!.consentVersion).toBe(1)
  })

  it('the temporary password step comes first', async () => {
    const w = await makeWorld()
    await withRules(w)
    const { hosteler, password, auth } = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, mustChangePassword: true, name: 'Vikram Rao' })
    const r = await api().get('/api/portal/home').set(auth).expect(403)
    expect(r.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    // rules / consent also wait for the password
    expect((await api().get('/api/portal/auth/rules').set(auth).expect(403)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    expect((await sign(auth, { signedName: 'Vikram Rao' }).expect(403)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    const me = await api().get('/api/portal/auth/me').set(auth).expect(200)
    expect(me.body).toMatchObject({ mustChangePassword: true, consentRequired: true })

    const sp = await api().post('/api/portal/auth/set-password').set(auth).send({ currentPassword: password, newPassword: 'NewPass@123' }).expect(200)
    expect(sp.body).toMatchObject({ mustChangePassword: false, consentRequired: true })
    const auth2 = { Authorization: `Bearer ${sp.body.token}` }
    expect((await api().get('/api/portal/home').set(auth2).expect(403)).body.error.code).toBe('CONSENT_REQUIRED')
    await sign(auth2, { signedName: 'vikram rao' }).expect(201)
    await api().get('/api/portal/home').set(auth2).expect(200)
    expect((await Hosteler.findById(hosteler._id).lean())!.consentVersion).toBe(1)
  })

  it('validates name, acceptance and signature', async () => {
    const w = await makeWorld()
    await withRules(w)
    const wrongName = await sign(w.hostelerAuth, { signedName: 'Someone Else' }).expect(400)
    expect(wrongName.body.error.message).toContain('Aarav Sharma')
    await sign(w.hostelerAuth, { signedName: 'Aarav' }).expect(400)
    await sign(w.hostelerAuth, { accept: false }).expect(400)
    await sign(w.hostelerAuth, { accept: 'yes' }).expect(400)
    await sign(w.hostelerAuth, { signature: undefined }).expect(400)
    await sign(w.hostelerAuth, { signature: '' }).expect(400)
    await sign(w.hostelerAuth, { signature: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }).expect(400)
    await sign(w.hostelerAuth, { signature: `data:image/png;base64,${Buffer.from('not a png at all, just text').toString('base64')}` }).expect(400)
    const big = await sign(w.hostelerAuth, { signature: bigPng() }).expect(400)
    expect(big.body.error.message).toContain('200 KB')
    expect(await RulesConsent.countDocuments({})).toBe(0)
    expect((await api().get('/api/portal/auth/me').set(w.hostelerAuth).expect(200)).body.consentRequired).toBe(true)
    await sign(w.hostelerAuth).expect(201)
  })

  it('changing the rules asks everyone to sign again (and notifies active hostelers)', async () => {
    const w = await makeWorld()
    const other = await makeHosteler(w.org._id, w.hostel, { bed: w.beds[1]!, name: 'Vikram Rao' })
    await withRules(w)
    // every active hosteler of the hostel was told to sign
    const n1 = await Notification.find({ recipientKind: 'hosteler', type: 'consent_required' }).lean()
    expect(n1.map((n) => String(n.recipientId)).sort()).toEqual([String(w.hosteler._id), String(other.hosteler._id)].sort())
    expect(n1[0]).toMatchObject({ title: 'Hostel rules updated', link: '/portal/rules' })

    await sign(w.hostelerAuth).expect(201)
    await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)
    // the other hosteler has not signed
    expect((await api().get('/api/portal/home').set(other.auth).expect(403)).body.error.code).toBe('CONSENT_REQUIRED')

    // unrelated settings change: nothing new to sign
    await api().patch(`/api/hostels/${w.hostel._id}`).set(w.auth).send({ noticePeriodDays: 10 }).expect(200)
    await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)
    expect(await Notification.countDocuments({ type: 'consent_required' })).toBe(2)

    // new rules -> version 2 -> sign again
    await withRules(w, `${RULES}
3. No pets.`)
    expect(await Notification.countDocuments({ type: 'consent_required' })).toBe(4)
    expect((await api().get('/api/portal/home').set(w.hostelerAuth).expect(403)).body.error.code).toBe('CONSENT_REQUIRED')
    const rules = await api().get('/api/portal/auth/rules').set(w.hostelerAuth).expect(200)
    expect(rules.body).toMatchObject({ rulesVersion: 2, signed: false, signedAt: null })
    expect(rules.body.rulesText).toContain('No pets')
    await sign(w.hostelerAuth).expect(201)
    await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)
    expect((await RulesConsent.find({ hostelerId: w.hosteler._id }).lean()).map((c) => c.rulesVersion).sort()).toEqual([1, 2])

    // rules removed -> no gate, even for those who never signed
    await withRules(w, '')
    await api().get('/api/portal/home').set(other.auth).expect(200)
    expect((await api().get('/api/portal/auth/me').set(other.auth).expect(200)).body).toMatchObject({ consentRequired: false, rulesVersion: 0 })
    await sign(other.auth, { signedName: 'Vikram Rao' }).expect(409)
  })

  it('rules of another hostel do not gate this one', async () => {
    const w = await makeWorld()
    const other = await makeWorld()
    await withRules(other)
    await api().get('/api/portal/home').set(w.hostelerAuth).expect(200)
    await api().get('/api/portal/home').set(other.hostelerAuth).expect(403)
  })
})

describe('staff view of consents', () => {
  it('GET /api/hostelers/:id shows consentStatus; /consents lists signatures newest first', async () => {
    const w = await makeWorld()
    const before = await api().get(`/api/hostelers/${w.hosteler._id}`).set(w.auth).expect(200)
    expect(before.body.consentStatus).toEqual({ required: false, rulesVersion: 0, signedVersion: 0, signedAt: null })

    await withRules(w)
    const pending = await api().get(`/api/hostelers/${w.hosteler._id}`).set(w.auth).expect(200)
    expect(pending.body.consentStatus).toEqual({ required: true, rulesVersion: 1, signedVersion: 0, signedAt: null })
    expect((await api().get(`/api/hostelers/${w.hosteler._id}/consents`).set(w.auth).expect(200)).body.items).toEqual([])

    await sign(w.hostelerAuth).expect(201)
    await withRules(w, 'Version two')
    await sign(w.hostelerAuth, { userAgent: 'ignored' }).set('User-Agent', 'TestPhone/1.0').expect(201)

    const after = await api().get(`/api/hostelers/${w.hosteler._id}`).set(w.auth).expect(200)
    expect(after.body.consentStatus).toMatchObject({ required: false, rulesVersion: 2, signedVersion: 2 })
    expect(after.body.consentStatus.signedAt).toBeTruthy()
    expect(after.body.consentVersion).toBe(2)

    const list = await api().get(`/api/hostelers/${w.hosteler._id}/consents`).set(w.auth).expect(200)
    expect(list.body.items.map((c: { rulesVersion: number }) => c.rulesVersion)).toEqual([2, 1])
    expect(list.body.items[0]).toMatchObject({ rulesText: 'Version two', signedName: 'Aarav Sharma', signature: SIGNATURE, userAgent: 'TestPhone/1.0' })
    expect(list.body.items[0].id).toBeTruthy()
    expect(list.body.items[0].acceptedAt).toBeTruthy()

    // permissions and isolation
    const accountant = await makeStaffUser(w.org._id, 'accountant')
    await api().get(`/api/hostelers/${w.hosteler._id}/consents`).set(accountant.auth).expect(200) // 'hostelers' module
    const otherOrg = await makeOrg()
    await api().get(`/api/hostelers/${w.hosteler._id}/consents`).set(otherOrg.auth).expect(404)
    await api().get(`/api/hostelers/${w.hosteler._id}/consents`).set(w.hostelerAuth).expect(403)
    await api().get(`/api/hostelers/${w.hosteler._id}/consents`).expect(401)
  })

  it('consents survive check-out; the portal account is closed', async () => {
    const w = await makeWorld()
    await withRules(w)
    await sign(w.hostelerAuth).expect(201)
    await api().post(`/api/hostelers/${w.hosteler._id}/check-out`).set(w.auth).send({ date: (await Hosteler.findById(w.hosteler._id).lean())!.checkInDate }).expect(200)
    await api().get('/api/portal/auth/rules').set(w.hostelerAuth).expect(401)
    expect((await api().get(`/api/hostelers/${w.hosteler._id}/consents`).set(w.auth).expect(200)).body.items).toHaveLength(1)
  })
})
