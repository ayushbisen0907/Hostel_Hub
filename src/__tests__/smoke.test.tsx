import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import App from '@/App'
import { useStore } from '@/store'
import { buildDemoData, DEMO_FIRST_LOGIN, DEMO_HOSTELER } from '@/store/seed'

// jsdom lacks these
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never
  window.scrollTo = vi.fn() as never
  Element.prototype.scrollIntoView = vi.fn()
})

const ADMIN = ['/', '/app/dashboard', '/app/rooms', '/app/hostelers', '/app/check-in', '/app/check-out', '/app/gate-log',
  '/app/documents', '/app/fees', '/app/fees?tab=payments', '/app/fees?tab=dues', '/app/fees?tab=deposits', '/app/expenses',
  '/app/mess', '/app/attendance', '/app/attendance?tab=leaves', '/app/complaints', '/app/visitors', '/app/notices',
  '/app/staff', '/app/reports', '/app/settings', '/app/settings?tab=hostels', '/app/settings?tab=billing',
  '/app/settings?tab=preferences', '/app/settings?tab=data']
const PORTAL = ['/portal', '/portal/fees', '/portal/mess', '/portal/complaints', '/portal/leave', '/portal/profile']

async function renderAt(path: string) {
  window.history.pushState({}, '', path)
  const errors: unknown[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a) })
  let r!: ReturnType<typeof render>
  await act(async () => { r = render(<App />); await new Promise((res) => setTimeout(res, 30)) })
  const html = r.container.innerHTML
  spy.mockRestore()
  cleanup()
  const real = errors.filter((e) => !String((e as unknown[])[0]).includes('width(0) and height(0)') && !String((e as unknown[])[0]).includes('not wrapped in act'))
  return { html, errors: real }
}

describe('smoke', () => {
  it('public pages render', async () => {
    useStore.setState({ hydrated: true, session: null })
    for (const p of ['/', '/login', '/signup', '/portal/login', '/portal/login?id=SBH-0001']) {
      const { html, errors } = await renderAt(p)
      expect(html.length, p).toBeGreaterThan(200)
      expect(errors, p).toEqual([])
    }
  })

  it('admin pages render with demo data', async () => {
    useStore.setState({ ...buildDemoData(), hydrated: true, session: { kind: 'admin' } })
    const s = useStore.getState()
    const h = s.hostelers[0]!
    const inv = s.invoices[0]!
    const pay = s.payments[0]!
    for (const p of [...ADMIN, `/app/hostelers/${h.id}`, `/app/check-out?h=${h.id}`, `/print/invoice/${inv.id}`, `/print/receipt/${pay.id}`]) {
      const { html, errors } = await renderAt(p)
      expect(html.length, p).toBeGreaterThan(200)
      expect(errors, p).toEqual([])
    }
  })

  it('admin pages render in "single hostel" scope and empty workspace', async () => {
    useStore.setState({ ...buildDemoData(), hydrated: true, session: { kind: 'admin' }, currentHostelId: 'hst_lotus' })
    for (const p of ADMIN) {
      const { errors } = await renderAt(p)
      expect(errors, p).toEqual([])
    }
    useStore.getState().signup({ orgName: 'X', ownerName: 'Y', email: 'a@b.c', phone: '9999999999', password: 'secret1' })
    useStore.getState().setPlan('pro')
    for (const p of ADMIN) {
      const { errors } = await renderAt(p)
      expect(errors, p).toEqual([])
    }
  })

  it('portal pages render', async () => {
    useStore.setState({ ...buildDemoData(), hydrated: true, session: null })
    expect(useStore.getState().loginHosteler(DEMO_HOSTELER.loginId, DEMO_HOSTELER.password)).toEqual({ ok: true, mustChangePassword: false })
    for (const p of PORTAL) {
      const { html, errors } = await renderAt(p)
      expect(html.length, p).toBeGreaterThan(200)
      expect(errors, p).toEqual([])
    }
  })

  it('core flows work', () => {
    useStore.setState({ ...buildDemoData(), hydrated: true, session: { kind: 'admin' } })
    const st = useStore.getState
    const bed = st().beds.find((b) => !b.hostelerId && st().rooms.find((r) => r.id === b.roomId)?.status === 'active')!
    const base = st().hostelers[0]!
    const id = st().admitHosteler({
      hosteler: { ...base, name: 'Test User', phone: '9000000001', hostelId: bed.hostelId },
      bedId: bed.id, reserveOnly: false, depositPayment: { amount: 5000, mode: 'upi', reference: 'x' }, generateFirstInvoice: true,
    })
    expect(st().beds.find((b) => b.id === bed.id)!.hostelerId).toBe(id)
    const inv = st().invoices.find((i) => i.hostelerId === id)!
    expect(inv).toBeTruthy()
    st().recordPayment({ invoiceId: inv.id, hostelerId: id, amount: inv.total, mode: 'cash', reference: '', date: '2026-10-01', note: '' })
    st().checkOut(id, { date: '2026-10-10', depositRefund: 5000, deductionNote: '' })
    expect(st().hostelers.find((h) => h.id === id)!.status).toBe('checked_out')
    expect(st().beds.find((b) => b.id === bed.id)!.hostelerId).toBeNull()
    const month = '2099-01'
    const before = st().invoices.length
    const n = st().generateInvoices(month, 'all')
    expect(n).toBeGreaterThan(10)
    expect(st().generateInvoices(month, 'all')).toBe(0)
    expect(st().invoices.length).toBe(before + n)
  })

  it('hosteler credentials: ID + temp password -> forced password change', async () => {
    useStore.setState({ ...buildDemoData(), hydrated: true, session: { kind: 'admin' } })
    const st = useStore.getState
    const hostel = st().hostels.find((h) => h.code === 'SBH')!
    const bed = st().beds.find((b) => !b.hostelerId && b.hostelId === hostel.id && st().rooms.find((r) => r.id === b.roomId)?.status === 'active')!
    const base = st().hostelers[0]!
    const seqBefore = hostel.hostelerSeq
    const id = st().admitHosteler({
      hosteler: { ...base, name: 'New Kid', phone: '9000000002', hostelId: hostel.id },
      bedId: bed.id, reserveOnly: false, depositPayment: null, generateFirstInvoice: false,
    })
    const h = st().hostelers.find((x) => x.id === id)!
    // unique ID for this hostel, plus a temp password that isn't stored in plain text as the hash
    expect(h.loginId).toBe(`SBH-${String(seqBefore + 1).padStart(4, '0')}`)
    expect(new Set(st().hostelers.map((x) => x.loginId)).size).toBe(st().hostelers.length)
    expect(h.mustChangePassword).toBe(true)
    expect(h.tempPassword).toMatch(/^[A-Za-z2-9]{8}$/)
    expect(h.passwordHash).not.toContain(h.tempPassword!)
    const temp = h.tempPassword!

    st().logout()
    expect(st().loginHosteler(h.loginId, 'wrong')).toMatchObject({ ok: false })
    expect(st().loginHosteler(h.loginId.toLowerCase(), temp)).toEqual({ ok: true, mustChangePassword: true })

    // portal pages bounce to set-password while on temp password
    const { html } = await renderAt('/portal/fees')
    expect(html).toContain('set your password')

    expect(st().changeHostelerPassword(id, temp, 'short')).toMatchObject({ ok: false })
    expect(st().changeHostelerPassword(id, 'nope', 'MyNewPass9')).toMatchObject({ ok: false })
    expect(st().changeHostelerPassword(id, temp, 'MyNewPass9')).toEqual({ ok: true })
    const after = st().hostelers.find((x) => x.id === id)!
    expect(after.tempPassword).toBeNull()
    expect(after.mustChangePassword).toBe(false)

    st().logout()
    expect(st().loginHosteler(h.loginId, temp)).toMatchObject({ ok: false }) // temp no longer works
    expect(st().loginHosteler(h.loginId, 'MyNewPass9')).toEqual({ ok: true, mustChangePassword: false })

    // staff reset issues a new temp password and signs the hosteler out
    const newTemp = st().resetHostelerPassword(id)
    expect(st().session).toBeNull()
    expect(st().loginHosteler(h.loginId, 'MyNewPass9')).toMatchObject({ ok: false })
    expect(st().loginHosteler(h.loginId, newTemp)).toEqual({ ok: true, mustChangePassword: true })

    // demo first-login account
    st().logout()
    expect(st().loginHosteler(DEMO_FIRST_LOGIN.loginId, DEMO_FIRST_LOGIN.tempPassword)).toEqual({ ok: true, mustChangePassword: true })

    // checked-out hostelers cannot log in
    st().checkOut(id, { date: '2026-10-12', depositRefund: 0, deductionNote: '' })
    expect(st().loginHosteler(h.loginId, newTemp)).toMatchObject({ ok: false })
  })
})
