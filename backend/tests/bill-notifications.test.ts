/**
 * Every bill tells the hosteler its number, period and due date:
 * the first bill at check-in, custom invoices (POST /api/invoices) and
 * monthly rent cycles (see rent-cycle.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { api, hostelerAuth, makeOrg, makeWorld } from './helpers.js'
import { Hosteler } from '../src/models/Hosteler.js'
import { Invoice } from '../src/models/Invoice.js'
import { Notification } from '../src/models/Notification.js'
import { Organization } from '../src/models/Organization.js'
import { todayStr } from '../src/lib/http.js'
import { addDays, addMonthsAnchored, monthLabel, periodLabel, shortDate } from '../src/lib/dates.js'

const today = todayStr()
type World = Awaited<ReturnType<typeof makeWorld>>

function admission(w: World, extra: Record<string, unknown> = {}) {
  return {
    name: 'Rohan Verma',
    phone: '9876543211',
    hostelId: String(w.hostel._id),
    bedId: String(w.beds[1]!._id),
    checkInDate: today,
    monthlyRent: 6000,
    securityDeposit: 5000,
    messOpted: false,
    generateFirstInvoice: true,
    ...extra,
  }
}

describe('first bill at check-in', () => {
  it('notifies the new hosteler with bill number, period and due date', async () => {
    const w = await makeWorld()
    await Organization.updateOne({ _id: w.org._id }, { 'settings.rentDueDay': 7 })
    const r = await api().post('/api/hostelers').set(w.auth).send(admission(w)).expect(201)
    const id = r.body.hosteler.id as string
    const inv = (await Invoice.findOne({ hostelerId: id }).lean())!
    expect(inv.dueDate).toBe(addDays(today, 7))

    const notes = await Notification.find({ recipientKind: 'hosteler', recipientId: id }).lean()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ type: 'bill_generated', title: 'New bill: ₹11,000', link: '/portal/fees', hostelId: w.hostel._id })
    expect(notes[0]!.body).toContain(inv.number)
    expect(notes[0]!.body).toContain(periodLabel(today, addDays(addMonthsAnchored(today, 1), -1)))
    expect(notes[0]!.body).toContain(`Due by ${shortDate(inv.dueDate, true)}`)
    // no staff notifications for it
    expect(await Notification.countDocuments({ recipientKind: 'staff' })).toBe(0)

    // the hosteler sees it in the portal once activated
    await Hosteler.updateOne({ _id: id }, { mustChangePassword: false })
    const list = await api().get('/api/portal/notifications').set(hostelerAuth((await Hosteler.findById(id))!)).expect(200)
    expect(list.body.items.map((n: { type: string }) => n.type)).toEqual(['bill_generated'])
  })

  it('a back-dated check-in notifies once per bill created', async () => {
    const w = await makeWorld()
    const r = await api().post('/api/hostelers').set(w.auth).send(admission(w, { checkInDate: addMonthsAnchored(today, -1) })).expect(201)
    const bills = await Invoice.countDocuments({ hostelerId: r.body.hosteler.id })
    expect(bills).toBe(2)
    expect(await Notification.countDocuments({ recipientId: r.body.hosteler.id, type: 'bill_generated' })).toBe(2)
  })

  it('no bill, no notification (no first bill / reservation)', async () => {
    const w = await makeWorld()
    const a = await api().post('/api/hostelers').set(w.auth).send(admission(w, { generateFirstInvoice: false })).expect(201)
    expect(await Notification.countDocuments({ recipientId: a.body.hosteler.id })).toBe(0)
    await api().post(`/api/hostelers/${a.body.hosteler.id}/check-out`).set(w.auth).send({ date: today }).expect(200)
    const b = await api().post('/api/hostelers').set(w.auth).send(admission(w, { reserveOnly: true })).expect(201)
    expect(await Notification.countDocuments({ recipientId: b.body.hosteler.id })).toBe(0)
  })
})

describe('custom invoices (POST /api/invoices)', () => {
  it('notifies the hosteler with number, month and due date', async () => {
    const w = await makeWorld()
    const due = addDays(today, 10)
    const r = await api()
      .post('/api/invoices')
      .set(w.auth)
      .send({ hostelerId: String(w.hosteler._id), month: today.slice(0, 7), items: [{ label: 'Broken chair', amount: 750 }], dueDate: due })
      .expect(201)
    const mine = await api().get('/api/portal/notifications').set(w.hostelerAuth).expect(200)
    expect(mine.body.unreadCount).toBe(1)
    const n = mine.body.items[0]
    expect(n).toMatchObject({ type: 'bill_generated', title: 'New bill: ₹750', link: '/portal/fees' })
    expect(n.body).toContain(r.body.number)
    expect(n.body).toContain(monthLabel(today.slice(0, 7)))
    expect(n.body).toContain(`Due by ${shortDate(due, true)}`)
  })

  it('a failed invoice creates no notification; only the billed hosteler is notified', async () => {
    const w = await makeWorld()
    const other = await makeOrg()
    await api()
      .post('/api/invoices')
      .set(other.auth)
      .send({ hostelerId: String(w.hosteler._id), month: today.slice(0, 7), items: [{ label: 'X', amount: 10 }], dueDate: today })
      .expect(404)
    await api().post('/api/invoices').set(w.auth).send({ hostelerId: String(w.hosteler._id), month: today.slice(0, 7), items: [], dueDate: today }).expect(400)
    expect(await Notification.countDocuments({})).toBe(0)
  })

  it('formats the month label', () => {
    expect(monthLabel('2026-10')).toBe('October 2026')
    expect(monthLabel('2027-01')).toBe('January 2027')
  })
})
