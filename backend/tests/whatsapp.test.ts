/**
 * WhatsApp bill messages through Pabbly Chatflow (lib/whatsapp.ts): hostel settings,
 * queueing when bills are created, sending / retrying, re-sending and the test message.
 * Chatflow itself is never called: fetch is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { api, makeOrg, makeWorld } from './helpers.js'
import { CHATFLOW_URL, MAX_ATTEMPTS, billBreakdown, chatflow, cleanParam, flushWhatsApp, waNumber } from '../src/lib/whatsapp.js'
import { generateDueBills } from '../src/lib/rentCycle.js'
import { Hostel } from '../src/models/Hostel.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Invoice } from '../src/models/Invoice.js'
import { WhatsAppMessage } from '../src/models/WhatsAppMessage.js'

const ok = (id = 'wamid.TEST') =>
  new Response(JSON.stringify({ status: 'success', message: 'Message sent', data: { to: '919876543210', metaResponse: { messages: [{ id }] } } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
const fail = (status: number, message: string) => new Response(JSON.stringify({ status: 'error', message }), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: MockInstance<typeof fetch>
beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok())
  // HostelHub's one Chatflow account (normally CHATFLOW_API_KEY / CHATFLOW_TEMPLATE)
  chatflow.apiKey = 'cf-secret-key'
  chatflow.templateName = 'hostel_bill'
  chatflow.number = '+91 96913 03358'
})
afterEach(() => fetchMock.mockRestore())

/** A world whose hostel has WhatsApp bill messages switched on. */
async function connected(plan: 'free' | 'starter' | 'business' = 'starter') {
  const w = await makeWorld({ plan })
  await Hostel.updateOne({ _id: w.hostel._id }, { whatsappEnabled: true })
  return w
}

describe('helpers', () => {
  it('numbers, params and the breakdown line', () => {
    expect(waNumber('98765 43210')).toBe('919876543210')
    expect(waNumber('+91 98765-43210')).toBe('919876543210')
    expect(waNumber('09876543210')).toBe('919876543210')
    expect(waNumber('12345')).toBeNull()
    expect(cleanParam('a\nb\t  c    d')).toBe('a b c d')
    expect(cleanParam('  ')).toBe('-')
    expect(billBreakdown([{ label: 'Room rent (1 Sep – 30 Sep 2026)', amount: 6000 }, { label: 'Mess fees', amount: 3000 }, { label: 'Waived', amount: 0 }], 1500)).toBe(
      'Room rent ₹6,000 · Mess fees ₹3,000 · Previous balance ₹1,500',
    )
  })
})

describe('hostel settings', () => {
  it('each hostel switches messages on or off; the key never leaves the server', async () => {
    const w = await makeWorld({ plan: 'starter' })
    const url = `/api/hostels/${w.hostel._id}/whatsapp`
    const g = await api().get(url).set(w.auth).expect(200)
    expect(g.body).toMatchObject({ enabled: false, ready: true, sender: 'default', number: '+91 96913 03358' })
    expect(g.body.templateText).toMatch(/\{\{7\}\}/)

    await api().put(url).set(w.auth).send({ enabled: true, apiKey: 'x' }).expect(400) // only the switch
    const r = await api().put(url).set(w.auth).send({ enabled: true }).expect(200)
    expect(r.body).toMatchObject({ enabled: true, ready: true })
    const one = await api().get(`/api/hostels/${w.hostel._id}`).set(w.auth).expect(200)
    expect(one.body.whatsapp).toEqual({ enabled: true, ownNumber: null })
    for (const body of [g.body, r.body, one.body, (await api().get('/api/hostels').set(w.auth).expect(200)).body])
      expect(JSON.stringify(body)).not.toContain('cf-secret-key')

    // without a key on the server nothing can be switched on (switching off still works)
    chatflow.apiKey = ''
    expect((await api().get(url).set(w.auth).expect(200)).body.ready).toBe(false)
    await api().put(url).set(w.auth).send({ enabled: true }).expect(409)
    expect((await api().put(url).set(w.auth).send({ enabled: false }).expect(200)).body.enabled).toBe(false)
  })

  it("a hostel's own number (connected by HostelHub) is used instead of the default", async () => {
    const w = await connected('business')
    await Hostel.updateOne({ _id: w.hostel._id }, { whatsappApiKey: 'own-secret-key', whatsappNumber: '+91 98260 00000', whatsappTemplate: 'own_bill' })
    const g = await api().get(`/api/hostels/${w.hostel._id}/whatsapp`).set(w.auth).expect(200)
    expect(g.body).toMatchObject({ enabled: true, ready: true, sender: 'own', number: '+91 98260 00000' })
    const one = await api().get(`/api/hostels/${w.hostel._id}`).set(w.auth).expect(200)
    expect(one.body.whatsapp).toEqual({ enabled: true, ownNumber: '+91 98260 00000' })
    for (const body of [g.body, one.body, (await api().get('/api/org/export').set(w.auth).expect(200)).body])
      expect(JSON.stringify(body)).not.toContain('own-secret-key')

    // works even without a default key on the server
    chatflow.apiKey = ''
    await generateDueBills(w.org._id)
    await flushWhatsApp()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer own-secret-key')
    expect(JSON.parse(String(init.body)).templateName).toBe('own_bill')
  })

  it('Starter and up', async () => {
    const free = await makeWorld({ plan: 'free' })
    const r = await api().put(`/api/hostels/${free.hostel._id}/whatsapp`).set(free.auth).send({ enabled: true }).expect(402)
    expect(r.body.error.details.requiredPlan).toBe('Starter')
  })
})

describe('bill messages', () => {
  it('a new bill is queued with its breakdown and sent to Chatflow', async () => {
    const w = await connected()
    // checked in 1 Sep: two monthly bills are due; the second carries the first as previous balance
    await generateDueBills(w.org._id, { notify: true })
    const bills = await Invoice.find({ hostelerId: w.hosteler._id }).sort({ dueDate: 1 }).lean()
    expect(bills).toHaveLength(2)
    const queued = await WhatsAppMessage.find({ hostelerId: w.hosteler._id }).sort({ createdAt: 1 }).lean()
    expect(queued.map((m) => m.status)).toEqual(['pending', 'pending'])

    const [name, hostel, period, breakdown, total, due, upi] = queued[1]!.params
    expect([name, hostel, upi]).toEqual(['Aarav Sharma', 'Sunrise Boys Hostel', 'sunrise.hostel@okhdfc'])
    expect(period).toMatch(/Oct/)
    expect(breakdown).toBe(`Room rent ₹6,000 · Mess fees ₹3,000 · Previous balance ₹${bills[0]!.total.toLocaleString('en-IN')}`)
    expect(total).toBe(`₹${(bills[0]!.total + bills[1]!.total).toLocaleString('en-IN')}`)
    expect(due).toMatch(/2026/)

    expect(await flushWhatsApp()).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(CHATFLOW_URL)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer cf-secret-key')
    expect(JSON.parse(String(init.body))).toMatchObject({ to: '919876543210', type: 'template', templateName: 'hostel_bill' })
    const sent = await WhatsAppMessage.find({ hostelerId: w.hosteler._id }).lean()
    expect(sent.every((m) => m.status === 'sent' && m.providerMessageId === 'wamid.TEST' && m.sentAt)).toBe(true)
  })

  it('nothing is queued on Free, when switched off, or without a valid number', async () => {
    const free = await connected('free')
    await generateDueBills(free.org._id)
    expect(await WhatsAppMessage.countDocuments({ orgId: free.org._id })).toBe(0)

    const off = await connected()
    await Hostel.updateOne({ _id: off.hostel._id }, { whatsappEnabled: false })
    await generateDueBills(off.org._id)
    expect(await WhatsAppMessage.countDocuments({ orgId: off.org._id })).toBe(0)

    const noPhone = await connected()
    await Hosteler.updateOne({ _id: noPhone.hosteler._id }, { phone: '123' })
    await generateDueBills(noPhone.org._id)
    expect(await WhatsAppMessage.countDocuments({ orgId: noPhone.org._id })).toBe(0)

    // no key on the server: nothing is queued
    chatflow.apiKey = ''
    const noKey = await connected()
    await generateDueBills(noKey.org._id)
    expect(await WhatsAppMessage.countDocuments({ orgId: noKey.org._id })).toBe(0)
    chatflow.apiKey = 'cf-secret-key'

    // bills made without notifying (notify: false) send nothing either
    const quiet = await connected()
    await generateDueBills(quiet.org._id, { notify: false })
    expect(await WhatsAppMessage.countDocuments({ orgId: quiet.org._id })).toBe(0)
  })

  it('a rejected key fails at once; server errors are retried, then given up', async () => {
    const w = await connected()
    await generateDueBills(w.org._id)
    const [first, second] = await WhatsAppMessage.find({ orgId: w.org._id }).sort({ createdAt: 1 })

    fetchMock.mockImplementation(async () => fail(401, 'Unauthorized'))
    await WhatsAppMessage.updateOne({ _id: second!._id }, { nextAttemptAt: new Date(Date.now() + 3_600_000) }) // only the first now
    await flushWhatsApp()
    const a = (await WhatsAppMessage.findById(first!._id).lean())!
    expect(a).toMatchObject({ status: 'failed', attempts: 1, error: 'Pabbly Chatflow rejected the API key' })

    fetchMock.mockImplementation(async () => fail(503, 'Service unavailable'))
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await WhatsAppMessage.updateOne({ _id: second!._id }, { nextAttemptAt: new Date(0) })
      await flushWhatsApp()
      const m = (await WhatsAppMessage.findById(second!._id).lean())!
      expect(m.attempts).toBe(i)
      expect(m.status).toBe(i < MAX_ATTEMPTS ? 'pending' : 'failed')
      if (i < MAX_ATTEMPTS) expect(m.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    }

    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed')
    })
    const third = await WhatsAppMessage.create({ orgId: w.org._id, hostelId: w.hostel._id, hostelerId: w.hosteler._id, auto: false, to: '919876543210', templateName: 'hostel_bill' })
    await flushWhatsApp()
    expect((await WhatsAppMessage.findById(third._id).lean())!).toMatchObject({ status: 'pending', attempts: 1, error: 'Could not reach Pabbly Chatflow (fetch failed)' })
  })

  it('switching WhatsApp off stops messages already waiting', async () => {
    const w = await connected()
    await generateDueBills(w.org._id)
    await Hostel.updateOne({ _id: w.hostel._id }, { whatsappEnabled: false })
    await flushWhatsApp()
    expect(fetchMock).not.toHaveBeenCalled()
    const all = await WhatsAppMessage.find({ orgId: w.org._id }).lean()
    expect(all.every((m) => m.status === 'failed' && m.error === 'WhatsApp is switched off for this hostel')).toBe(true)
  })
})

describe('per-bill status, send again and the test message', () => {
  it('staff see the status and can send a bill again', async () => {
    const w = await connected()
    await generateDueBills(w.org._id)
    await flushWhatsApp()
    const bill = (await Invoice.findOne({ hostelerId: w.hosteler._id }).sort({ dueDate: 1 }).lean())!
    const list = await api().get(`/api/invoices/${bill._id}/whatsapp`).set(w.auth).expect(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]).toMatchObject({ status: 'sent', auto: true, to: '919876543210' })
    expect(list.body.items[0]).not.toHaveProperty('params')
    const rows = await api().get(`/api/invoices?hostelerId=${w.hosteler._id}`).set(w.auth).expect(200)
    expect(rows.body.items.every((r: { whatsapp: { status: string } | null }) => r.whatsapp?.status === 'sent')).toBe(true)

    const again = await api().post(`/api/invoices/${bill._id}/whatsapp`).set(w.auth).expect(200)
    expect(again.body).toMatchObject({ status: 'sent', auto: false })
    expect((await api().get(`/api/invoices/${bill._id}/whatsapp`).set(w.auth).expect(200)).body.items).toHaveLength(2)

    await Hosteler.updateOne({ _id: w.hosteler._id }, { phone: '12' })
    const bad = await api().post(`/api/invoices/${bill._id}/whatsapp`).set(w.auth).expect(409)
    expect(bad.body.error.message).toMatch(/not a valid WhatsApp number/)

    const other = await makeOrg()
    await api().get(`/api/invoices/${bill._id}/whatsapp`).set(other.auth).expect(404)
  })

  it('the test message uses sample values; a rejection is shown', async () => {
    const w = await connected()
    const url = `/api/hostels/${w.hostel._id}/whatsapp/test`
    const r = await api().post(url).set(w.auth).send({ phone: '98260 00000' }).expect(200)
    expect(r.body).toMatchObject({ ok: true, to: '919826000000', messageId: 'wamid.TEST' })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.bodyParams).toHaveLength(7)
    expect(body.bodyParams[3]).toBe('Room rent ₹5,000 · Mess fees ₹2,200 · Electricity ₹126')

    fetchMock.mockImplementation(async () => fail(400, 'Template hostel_bill does not exist'))
    const e = await api().post(url).set(w.auth).send({ phone: '9826000000' }).expect(502)
    expect(e.body.error.message).toBe('WhatsApp test failed: Template hostel_bill does not exist')
    await api().post(url).set(w.auth).send({ phone: '12345' }).expect(400)
  })
})
