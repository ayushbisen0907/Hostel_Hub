import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { api, makeHosteler, makeStaffUser, makeWorld } from './helpers.js'
import { HDocument } from '../src/models/Document.js'
import { uploadRoot } from '../src/lib/upload.js'

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const filesOnDisk = () => fs.readdirSync(uploadRoot).length
const stored = (key: string) => fs.existsSync(path.join(uploadRoot, key))

// don't leave test uploads behind in UPLOAD_DIR
afterEach(async () => {
  for (const d of await HDocument.find().select('storageKey').lean()) fs.rmSync(path.join(uploadRoot, d.storageKey), { force: true })
})

function uploadReq(auth: Record<string, string>, fields: Record<string, string>) {
  let r = api().post('/api/documents').set(auth)
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
  return r.attach('file', PNG, { filename: 'aadhaar.png', contentType: 'image/png' })
}

describe('documents', () => {
  it('uploads, lists, views, downloads, verifies and deletes', async () => {
    const w = await makeWorld()
    const r = await uploadReq(w.auth, { hostelerId: String(w.hosteler._id), type: 'aadhaar', expiryDate: '2026-10-20' }).expect(201)
    expect(r.body.fileName).toBe('aadhaar.png')
    expect(r.body.mimeType).toBe('image/png')
    expect(r.body.size).toBe(PNG.length)
    expect(r.body.uploadedBy).toBe('staff')
    expect(r.body.verified).toBe(false)
    expect(r.body).not.toHaveProperty('storageKey')
    const id = r.body.id
    const key = (await HDocument.findById(id))!.storageKey
    expect(stored(key)).toBe(true)

    const list = await api().get('/api/documents').set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0].hostelerName).toBe('Aarav Sharma')
    expect(list.body.items[0]).not.toHaveProperty('storageKey')
    expect((await api().get('/api/documents?type=pan').set(w.auth)).body.items).toHaveLength(0)
    expect((await api().get(`/api/documents?hostelerId=${w.hosteler._id}`).set(w.auth)).body.items).toHaveLength(1)
    expect((await api().get('/api/documents?verified=false').set(w.auth)).body.items).toHaveLength(1)
    await api().get('/api/documents?expiring=36500').set(w.auth).expect(400)
    // expiring: 2026-10-20 is expired or within any window from the test date onwards
    const exp = await api().get('/api/documents?expiring=3650').set(w.auth).expect(200)
    expect(exp.body.items).toHaveLength(1)

    const view = await api().get(`/api/documents/${id}/file`).set(w.auth).expect(200)
    expect(view.headers['content-type']).toBe('image/png')
    expect(view.headers['content-disposition']).toMatch(/^inline/)
    expect(Buffer.compare(view.body as Buffer, PNG)).toBe(0)
    const dl = await api().get(`/api/documents/${id}/download`).set(w.auth).expect(200)
    expect(dl.headers['content-disposition']).toMatch(/^attachment/)

    const p = await api().patch(`/api/documents/${id}`).set(w.auth).send({ verified: true, expiryDate: null, type: 'pan' }).expect(200)
    expect(p.body.verified).toBe(true)
    expect(p.body.expiryDate).toBeNull()
    expect(p.body.type).toBe('pan')
    await api().patch(`/api/documents/${id}`).set(w.auth).send({ type: 'passport' }).expect(400)
    await api().patch(`/api/documents/${id}`).set(w.auth).send({ storageKey: '../x' }).expect(400)

    await api().delete(`/api/documents/${id}`).set(w.auth).expect(204)
    expect(await HDocument.countDocuments()).toBe(0)
    await new Promise((r) => setTimeout(r, 50))
    expect(stored(key)).toBe(false)
    await api().get(`/api/documents/${id}/file`).set(w.auth).expect(404)
  })

  it('validates input and cleans up the uploaded file on failure', async () => {
    const w = await makeWorld()
    const before = filesOnDisk()
    await uploadReq(w.auth, { hostelerId: String(w.hosteler._id), type: 'passport' }).expect(400)
    await uploadReq(w.auth, { hostelerId: 'nope', type: 'aadhaar' }).expect(400)
    await uploadReq(w.auth, { hostelerId: String(w.hosteler._id), type: 'aadhaar', expiryDate: '20-10-2026' }).expect(400)
    const other = await makeWorld()
    await uploadReq(w.auth, { hostelerId: String(other.hosteler._id), type: 'aadhaar' }).expect(404)
    await api().post('/api/documents').set(w.auth).field('hostelerId', String(w.hosteler._id)).field('type', 'aadhaar').expect(400) // no file
    await api()
      .post('/api/documents')
      .set(w.auth)
      .field('hostelerId', String(w.hosteler._id))
      .field('type', 'aadhaar')
      .attach('file', Buffer.from('MZ'), { filename: 'evil.exe', contentType: 'application/x-msdownload' })
      .expect(400)
    await new Promise((r) => setTimeout(r, 50))
    expect(filesOnDisk()).toBe(before)
    expect(await HDocument.countDocuments()).toBe(0)
  })

  it('isolates organizations and enforces roles', async () => {
    const a = await makeWorld()
    const b = await makeWorld()
    const up = await uploadReq(b.auth, { hostelerId: String(b.hosteler._id), type: 'aadhaar' }).expect(201)
    expect((await api().get('/api/documents').set(a.auth)).body.items).toHaveLength(0)
    await api().get(`/api/documents/${up.body.id}/file`).set(a.auth).expect(404)
    await api().get(`/api/documents/${up.body.id}/download`).set(a.auth).expect(404)
    await api().patch(`/api/documents/${up.body.id}`).set(a.auth).send({ verified: true }).expect(404)
    await api().delete(`/api/documents/${up.body.id}`).set(a.auth).expect(404)

    const acct = await makeStaffUser(a.org._id, 'accountant')
    const before = filesOnDisk()
    await uploadReq(acct.auth, { hostelerId: String(a.hosteler._id), type: 'aadhaar' }).expect(403)
    await api().get('/api/documents').set(acct.auth).expect(403)
    expect(filesOnDisk()).toBe(before) // rejected before multer wrote the file
    const warden = await makeStaffUser(a.org._id, 'warden')
    await uploadReq(warden.auth, { hostelerId: String(a.hosteler._id), type: 'aadhaar' }).expect(201)
    await api().get('/api/documents').expect(401)
  })

  it('lists active hostelers missing required documents', async () => {
    const w = await makeWorld()
    const z = await makeHosteler(w.org._id, w.hostel, { name: 'Zoya Khan' })
    await uploadReq(w.auth, { hostelerId: String(w.hosteler._id), type: 'aadhaar' }).expect(201)
    await uploadReq(w.auth, { hostelerId: String(w.hosteler._id), type: 'police_verification' }).expect(201)
    await uploadReq(w.auth, { hostelerId: String(z.hosteler._id), type: 'aadhaar' }).expect(201)
    const r = await api().get('/api/documents/missing').set(w.auth).expect(200)
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0].hosteler.name).toBe('Zoya Khan')
    expect(r.body.items[0].lacks).toEqual(['police_verification'])
  })
})
