/**
 * Full-stack end-to-end check (does NOT touch MongoDB Atlas):
 *   in-memory MongoDB  ->  real backend (tsx)  ->  real frontend (vite, proxied)  ->  Chromium
 *
 *   cd frontend && node e2e/full-flow.mjs
 *
 * 1. Owner signs up in the UI, then the rest of the setup is done through the API
 *    (hostel, rooms, two check-ins, invoices, notices…) with the owner's token.
 * 2. Every owner screen is opened (desktop + phone width): fails on page errors,
 *    console errors, failed /api calls, or horizontal overflow on phones.
 * 3. Hosteler logs in with the temporary password in the UI, is forced to set a
 *    new password, then every portal screen is opened the same way.
 */
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const BACKEND = path.resolve(FRONTEND, '..', 'backend')
const requireBackend = createRequire(path.join(BACKEND, 'package.json'))
const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server')

const API_PORT = 4100
const WEB_PORT = 5190
const WEB = `http://localhost:${WEB_PORT}`
const API = `http://localhost:${API_PORT}/api`

/** shell:true on Windows wraps the process in cmd.exe — kill the whole tree so ports are freed */
function killTree(p) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'])
  else p.kill('SIGTERM')
}

const results = []
const ok = (label, cond, extra = '') => {
  results.push(!!cond)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

function start(cmd, args, cwd, env, readyText) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: true })
  let out = ''
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${cmd} ${args.join(' ')} did not start:\n${out}`)), 90_000)
    const onData = (d) => {
      out += d
      if (out.includes(readyText)) {
        clearTimeout(t)
        resolve(p)
      }
    }
    p.stdout.on('data', onData)
    p.stderr.on('data', onData)
  })
}

async function apiCall(method, url, body, token) {
  const r = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = r.status === 204 ? null : await r.json().catch(() => null)
  if (r.status >= 400) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(j)}`)
  return j
}

const today = new Date().toISOString().slice(0, 10)
const month = today.slice(0, 7)

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
const procs = []
const browser = await chromium.launch()
try {
  procs.push(
    await start('npx', ['tsx', 'src/server.ts'], BACKEND, {
      MONGODB_URI: rs.getUri('hostelhub-e2e'),
      PORT: String(API_PORT),
      JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret',
      NODE_ENV: 'development',
      CORS_ORIGIN: WEB,
      UPLOAD_DIR: path.join(BACKEND, 'uploads', 'e2e'),
    }, 'running'),
  )
  procs.push(await start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], FRONTEND, { API_PROXY_TARGET: `http://localhost:${API_PORT}` }, 'Local'))

  /* ------------------------------------------------------------ */
  /* 1. Owner signs up through the UI                              */
  /* ------------------------------------------------------------ */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/auth/')) problems.push(`api ${r.status()} ${r.request().method()} ${r.url().replace(WEB, '')}`)
  })

  await page.goto(`${WEB}/signup`)
  await page.getByPlaceholder('e.g. Sunrise Hostels').fill('Sunrise Hostels')
  await page.getByPlaceholder('Full name').fill('Rajesh Malhotra')
  await page.getByPlaceholder('98XXXXXXXX').fill('9826000000')
  await page.getByPlaceholder('you@hostel.com').fill('owner@sunrise.test')
  const pw = page.locator('input[autocomplete="new-password"]')
  await pw.nth(0).fill('Owner@1234')
  await pw.nth(1).fill('Owner@1234')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/app/dashboard', { timeout: 15000 })
  ok('owner signup in UI -> dashboard', page.url().endsWith('/app/dashboard'))

  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('hostelhub-session') || '{}').state?.session?.token)
  ok('session token stored', !!token)

  /* ------------------------------------------------------------ */
  /* 2. Setup through the API with the owner's token               */
  /* ------------------------------------------------------------ */
  await apiCall('PATCH', '/org/plan', { plan: 'pro' }, token)
  const hostel = await apiCall('POST', '/hostels', { name: 'Sunrise Boys Hostel', type: 'boys', city: 'Indore', address: '12 Vijay Nagar', phone: '9826012345', code: 'SBH' }, token)
  await apiCall('POST', '/rooms/bulk', { hostelId: hostel.id, numbers: ['101', '102', '103'], floor: 1, type: 'ac', sharing: 2, rentPerBed: 6500, amenities: ['AC', 'Wi-Fi'] }, token)
  const vacant = (await apiCall('GET', `/beds/vacant?hostelId=${hostel.id}`, null, token)).items
  const admit = (name, phone, bed) =>
    apiCall('POST', '/hostelers', {
      name, phone, gender: 'male', guardianName: 'Mr ' + name.split(' ')[1], guardianPhone: '9876500000', guardianRelation: 'Father',
      occupation: 'student', institution: 'IIT Indore', course: 'B.Tech', idProofType: 'Aadhaar', idProofNumber: '1234 5678 9012',
      hostelId: hostel.id, bedId: bed.id, reserveOnly: false, checkInDate: today, monthlyRent: 6500, securityDeposit: 5000,
      messOpted: true, depositPayment: { amount: 5000, mode: 'upi', reference: 'UTR123' }, generateFirstInvoice: true,
    }, token)
  const a1 = await admit('Aarav Sharma', '9876543210', vacant[0])
  await admit('Rohan Gupta', '9876543211', vacant[1])
  ok('check-in via API returns Hosteler ID + temp password', /^SBH-0001$/.test(a1.credentials.loginId) && a1.credentials.tempPassword.length === 8, a1.credentials.loginId)
  await apiCall('POST', '/notices', { title: 'Rent due by 5th', body: 'Please pay on time.', priority: 'high', pinned: true, hostelId: null }, token)
  await apiCall('POST', '/expenses', { hostelId: hostel.id, category: 'electricity', amount: 12000, date: today, paidTo: 'MPEB', mode: 'bank', note: '' }, token)
  await apiCall('PUT', '/mess/menu', { hostelId: hostel.id, day: new Date().getDay(), meal: 'dinner', items: 'Paneer, Roti, Dal' }, token)
  await apiCall('POST', '/staff', { hostelId: hostel.id, name: 'Ramesh Patel', phone: '9893011111', role: 'warden', salary: 18000, joinDate: today }, token)
  await apiCall('POST', '/complaints', { hostelId: hostel.id, hostelerId: a1.hosteler.id, category: 'electrical', priority: 'high', title: 'Fan not working', description: 'Since last night' }, token)

  /* ------------------------------------------------------------ */
  /* 3. Open every owner screen                                    */
  /* ------------------------------------------------------------ */
  const ADMIN = ['/app/dashboard', '/app/rooms', '/app/hostelers', `/app/hostelers/${a1.hosteler.id}`, '/app/check-in', `/app/check-out?h=${a1.hosteler.id}`,
    '/app/gate-log', '/app/documents', '/app/fees', '/app/fees?tab=invoices', '/app/fees?tab=payments', '/app/fees?tab=dues', '/app/fees?tab=deposits',
    '/app/expenses', '/app/mess', '/app/attendance', '/app/attendance?tab=leaves', '/app/complaints', '/app/visitors', '/app/notices', '/app/staff',
    '/app/reports', '/app/settings', '/app/settings?tab=hostels', '/app/settings?tab=team', '/app/settings?tab=billing', '/app/settings?tab=preferences', '/app/settings?tab=data']

  async function visit(p, path, label) {
    const before = problems.length
    await p.goto(WEB + path, { waitUntil: 'networkidle' })
    await p.waitForTimeout(300)
    const text = await p.evaluate(() => document.body.innerText)
    const stuck = /Couldn't load this/.test(text)
    const overflow = await p.evaluate(() => {
      const vw = window.innerWidth
      if (document.documentElement.scrollWidth <= vw + 1) return ''
      const scrolls = (el) => {
        for (let x = el.parentElement; x; x = x.parentElement) if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(x).overflowX)) return true
        return false
      }
      const bad = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width && r.right > vw + 1 && !scrolls(el)
      })
      return bad.slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`).join(' ; ') || 'overflow'
    })
    const issues = problems.slice(before)
    ok(`${label} ${path}`, !issues.length && !stuck && !overflow, [...issues, stuck ? 'error state shown' : '', overflow ? `horizontal overflow: ${overflow}` : ''].filter(Boolean).join(' | '))
  }

  for (const p of ADMIN) await visit(page, p, 'owner desktop')
  await page.setViewportSize({ width: 375, height: 812 })
  for (const p of ADMIN) await visit(page, p, 'owner phone')

  // print pages (find a payment + invoice)
  const pays = (await apiCall('GET', '/payments', null, token)).items
  const invs = (await apiCall('GET', '/invoices', null, token)).items
  await visit(page, `/print/receipt/${pays[0].id}`, 'print')
  await visit(page, `/print/invoice/${invs[0].id}`, 'print')

  /* ------------------------------------------------------------ */
  /* 4. Hosteler: temp password -> forced password change -> portal */
  /* ------------------------------------------------------------ */
  const hctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const hp = await hctx.newPage()
  hp.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  hp.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`))
  hp.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/auth/')) problems.push(`api ${r.status()} ${r.request().method()} ${r.url().replace(WEB, '')}`)
  })
  await hp.goto(`${WEB}/portal/login?id=${a1.credentials.loginId}`)
  await hp.locator('input[autocomplete="current-password"]').fill(a1.credentials.tempPassword)
  await hp.getByRole('button', { name: /^log in$/i }).click()
  await hp.waitForURL('**/portal/set-password', { timeout: 15000 })
  ok('hosteler with temp password is sent to set-password', hp.url().endsWith('/portal/set-password'))
  await hp.locator('input[autocomplete="current-password"]').fill(a1.credentials.tempPassword)
  await hp.locator('input[autocomplete="new-password"]').nth(0).fill('Aarav@2026')
  await hp.locator('input[autocomplete="new-password"]').nth(1).fill('Aarav@2026')
  await hp.getByRole('button', { name: /save & continue/i }).click()
  await hp.waitForURL(/\/portal$/, { timeout: 15000 })
  ok('password set -> portal home', /\/portal$/.test(hp.url()))

  for (const p of ['/portal', '/portal/fees', '/portal/mess', '/portal/complaints', '/portal/leave', '/portal/profile']) await visit(hp, p, 'hosteler phone')

  // the old temporary password must no longer work
  const tempLogin = await fetch(API + '/portal/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: a1.credentials.loginId, password: a1.credentials.tempPassword }) })
  ok('temporary password stops working', tempLogin.status === 401)
  const newLogin = await fetch(API + '/portal/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: a1.credentials.loginId, password: 'Aarav@2026' }) })
  ok('new password works', newLogin.status === 200)

  /* ------------------------------------------------------------ */
  /* 5. UI flows: owner checks someone in with the wizard, then   */
  /*    that hosteler logs in, sets a password and pays rent       */
  /* ------------------------------------------------------------ */
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.goto(`${WEB}/app/check-in`, { waitUntil: 'networkidle' })
  const next = () => page.getByRole('button', { name: /^Next/ }).click()
  await page.getByPlaceholder('e.g. Rahul Sharma').fill('Vivaan Patel')
  await page.getByPlaceholder('10-digit mobile').fill('9123456700')
  await next()
  await page.getByLabel(/Guardian name/).fill('Suresh Patel')
  await page.getByLabel(/Guardian phone/).fill('9123456701')
  await next()
  await next() // ID & documents (optional)
  await page.getByRole('button', { name: /Bed [A-Z]/ }).first().click()
  await next()
  await next() // rent & payment defaults
  await page.getByRole('button', { name: /^Confirm check-in/ }).click()
  await page.getByText('Hosteler portal login').waitFor({ timeout: 15000 })
  const uiLoginId = (await page.locator('p:text-is("Hosteler ID") + p').first().innerText()).trim()
  const uiTemp = (await page.locator('p:text-is("Temporary password") + p').first().innerText()).trim()
  ok('check-in wizard (UI) shows Hosteler ID + temporary password', /^SBH-\d{4}$/.test(uiLoginId) && uiTemp.length === 8, `${uiLoginId} / ${uiTemp}`)

  const pctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const pp = await pctx.newPage()
  pp.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await pp.goto(`${WEB}/portal/login?id=${uiLoginId}`)
  await pp.locator('input[autocomplete="current-password"]').fill(uiTemp)
  await pp.getByRole('button', { name: /^log in$/i }).click()
  await pp.waitForURL('**/portal/set-password')
  await pp.locator('input[autocomplete="current-password"]').fill(uiTemp)
  await pp.locator('input[autocomplete="new-password"]').nth(0).fill('Vivaan@2026')
  await pp.locator('input[autocomplete="new-password"]').nth(1).fill('Vivaan@2026')
  await pp.getByRole('button', { name: /save & continue/i }).click()
  await pp.waitForURL(/\/portal$/)
  await pp.goto(`${WEB}/portal/fees`, { waitUntil: 'networkidle' })
  await pp.getByRole('button', { name: /^Pay now/ }).first().click()
  await pp.getByPlaceholder('e.g. 412345678901').fill('412345678901')
  await pp.getByRole('button', { name: /^Pay ₹/ }).click()
  await pp.getByText('Payment successful').waitFor({ timeout: 15000 })
  ok('hosteler pays rent from the portal (UI)', true)
  const hTok = await pp.evaluate(() => JSON.parse(localStorage.getItem('hostelhub-session') || '{}').state?.session?.token)
  const myInv = (await apiCall('GET', '/portal/invoices', null, hTok)).items
  ok('invoice is marked paid on the server', myInv.length > 0 && myInv.every((i) => i.balance === 0), myInv.map((i) => `${i.number}:${i.status}`).join(','))
  const ownerView = (await apiCall('GET', `/payments?q=${encodeURIComponent('Vivaan')}`, null, token)).items
  ok('owner sees the portal payment', ownerView.some((p) => p.recordedBy === 'hosteler'))
} catch (e) {
  results.push(false)
  console.log('FAIL  crashed:', e.message)
} finally {
  await browser.close()
  for (const p of procs) killTree(p)
  await rs.stop()
}
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
