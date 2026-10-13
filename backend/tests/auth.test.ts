import { describe, expect, it } from 'vitest'
import { api, makeWorld } from './helpers.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { hashPassword } from '../src/lib/auth.js'

describe('staff auth', () => {
  it('signs up, logs in, reads /me, rejects bad credentials', async () => {
    const signup = await api()
      .post('/api/auth/signup')
      .send({ orgName: 'Sunrise Hostels', ownerName: 'Rajesh', email: 'Raj@Example.com', phone: '9826000000', password: 'Secret123' })
      .expect(201)
    expect(signup.body.token).toBeTruthy()
    expect(signup.body.user).not.toHaveProperty('passwordHash')
    expect(signup.body.user.role).toBe('owner')
    expect(signup.body.organization.plan).toBe('free')

    await api().post('/api/auth/signup').send({ orgName: 'X', ownerName: 'Y', email: 'raj@example.com', password: 'Secret123' }).expect(400) // orgName too short
    await api().post('/api/auth/signup').send({ orgName: 'Another', ownerName: 'Yash', email: 'raj@example.com', password: 'Secret123' }).expect(409)
    await api().post('/api/auth/signup').send({ orgName: 'Another', ownerName: 'Yash', email: 'new@example.com', password: 'weak' }).expect(400)

    const login = await api().post('/api/auth/login').send({ email: 'raj@example.com', password: 'Secret123' }).expect(200)
    await api().post('/api/auth/login').send({ email: 'raj@example.com', password: 'nope' }).expect(401)
    await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'Secret123' }).expect(401)

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(200)
    expect(me.body.user.email).toBe('raj@example.com')
    expect(me.body.organization.name).toBe('Sunrise Hostels')

    await api().get('/api/auth/me').expect(401)
    await api().get('/api/auth/me').set('Authorization', 'Bearer garbage').expect(401)
  })

  it('change-password revokes old tokens', async () => {
    const s = await api().post('/api/auth/signup').send({ orgName: 'Lotus PG', ownerName: 'Sunita', email: 's@x.in', password: 'Secret123' })
    const old = `Bearer ${s.body.token}`
    const r = await api().post('/api/auth/change-password').set('Authorization', old).send({ currentPassword: 'Secret123', newPassword: 'Better456' }).expect(200)
    await api().get('/api/auth/me').set('Authorization', old).expect(401)
    await api().get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`).expect(200)
    await api().post('/api/auth/login').send({ email: 's@x.in', password: 'Better456' }).expect(200)
  })
})

describe('hosteler portal auth', () => {
  it('temporary password -> must set own password -> temp stops working', async () => {
    const w = await makeWorld()
    await Hosteler.updateOne({ _id: w.hosteler._id }, { passwordHash: await hashPassword('Temp1234'), mustChangePassword: true })
    const loginId = w.hosteler.loginId

    await api().post('/api/portal/auth/login').send({ loginId, password: 'wrong' }).expect(401)
    const login = await api().post('/api/portal/auth/login').send({ loginId: loginId.toLowerCase(), password: 'Temp1234' }).expect(200)
    expect(login.body.mustChangePassword).toBe(true)
    expect(login.body.hosteler).not.toHaveProperty('passwordHash')
    const tempAuth = `Bearer ${login.body.token}`

    // /me works, but other portal endpoints are blocked until password is set
    await api().get('/api/portal/auth/me').set('Authorization', tempAuth).expect(200)

    await api().post('/api/portal/auth/set-password').set('Authorization', tempAuth).send({ currentPassword: 'Temp1234', newPassword: 'short' }).expect(400)
    await api().post('/api/portal/auth/set-password').set('Authorization', tempAuth).send({ currentPassword: 'bad', newPassword: 'MyPass123' }).expect(400)
    const set = await api().post('/api/portal/auth/set-password').set('Authorization', tempAuth).send({ currentPassword: 'Temp1234', newPassword: 'MyPass123' }).expect(200)
    expect(set.body.mustChangePassword).toBe(false)

    // old token revoked, temp password dead, new password works
    await api().get('/api/portal/auth/me').set('Authorization', tempAuth).expect(401)
    await api().post('/api/portal/auth/login').send({ loginId, password: 'Temp1234' }).expect(401)
    const again = await api().post('/api/portal/auth/login').send({ loginId, password: 'MyPass123' }).expect(200)
    expect(again.body.mustChangePassword).toBe(false)
  })

  it('checked-out hosteler cannot log in; staff token cannot use portal and vice versa', async () => {
    const w = await makeWorld()
    await api().get('/api/portal/auth/me').set(w.auth).expect(403)
    await api().get('/api/auth/me').set(w.hostelerAuth).expect(403)
    await Hosteler.updateOne({ _id: w.hosteler._id }, { status: 'checked_out' })
    await api().post('/api/portal/auth/login').send({ loginId: w.hosteler.loginId, password: w.hostelerPassword }).expect(401)
    await api().get('/api/portal/auth/me').set(w.hostelerAuth).expect(401)
  })
})

describe('api basics', () => {
  it('health, 404 and malformed json', async () => {
    await api().get('/api/health').expect(200)
    const r = await api().get('/api/nope').expect(404)
    expect(r.body.error.code).toBe('ROUTE_NOT_FOUND')
    await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{bad').expect(400)
  })
})
