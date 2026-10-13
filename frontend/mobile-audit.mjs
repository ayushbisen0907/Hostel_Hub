// Mobile layout audit: visits every screen at phone width and reports horizontal overflow.
// Usage: node mobile-audit.mjs <baseUrl> <screenshotDir>
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5180'
const OUT = process.argv[3]
const ADMIN = ['/app/dashboard', '/app/rooms', '/app/hostelers', '/app/check-in', '/app/check-out', '/app/gate-log',
  '/app/documents', '/app/fees', '/app/fees?tab=payments', '/app/fees?tab=dues', '/app/fees?tab=deposits', '/app/expenses',
  '/app/mess', '/app/attendance', '/app/attendance?tab=leaves', '/app/complaints', '/app/visitors', '/app/notices',
  '/app/staff', '/app/reports', '/app/settings', '/app/settings?tab=hostels', '/app/settings?tab=billing',
  '/app/settings?tab=preferences', '/app/settings?tab=data']
const PORTAL = ['/portal', '/portal/fees', '/portal/mess', '/portal/complaints', '/portal/leave', '/portal/profile']

const overflowCheck = () => {
  const vw = window.innerWidth
  const bad = []
  const scrollers = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
    }
    return false
  }
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 1 && !scrollers(el)) {
      bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')} right=${Math.round(r.right)} text="${(el.textContent || '').trim().slice(0, 40)}"`)
    }
  }
  return { docWidth: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 6) }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`))

async function audit(path, name) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const res = await page.evaluate(overflowCheck)
  const status = res.docWidth > 376 || res.bad.length ? 'OVERFLOW' : 'ok'
  console.log(`${status.padEnd(8)} ${path}  (doc ${res.docWidth}px)`)
  for (const b of res.bad) console.log('         ', b)
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

// public
for (const p of ['/', '/login', '/signup', '/portal/login']) await audit(p, 'public' + p.replace(/\W+/g, '_'))

// admin via live demo
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /live demo/i }).first().click()
await page.waitForURL('**/app/dashboard')
for (const p of ADMIN) await audit(p, 'admin' + p.replace(/\W+/g, '_'))
// a hosteler profile
await page.goto(BASE + '/app/hostelers', { waitUntil: 'networkidle' })
await page.locator('tbody tr, [data-hosteler-row]').first().click().catch(() => {})
await page.waitForTimeout(300)
const first = new URL(page.url()).pathname
if (first.startsWith('/app/hostelers/')) {
  await audit(first, 'admin_hosteler_detail')
  for (const tab of ['Fees', 'Documents', 'Attendance', 'Gate log']) {
    await page.getByRole('button', { name: new RegExp('^' + tab) }).first().click()
    await page.waitForTimeout(200)
    const res = await page.evaluate(overflowCheck)
    console.log(`${(res.docWidth > 376 || res.bad.length ? 'OVERFLOW' : 'ok').padEnd(8)} ${first} [${tab}] (doc ${res.docWidth}px)`)
    for (const b of res.bad) console.log('         ', b)
  }
} else console.log('could not open hosteler detail; at', first)

// portal: first-login flow, then regular
await page.goto(BASE + '/app/dashboard')
await page.evaluate(() => localStorage.clear())
await page.goto(BASE + '/portal/login?id=SBH-0002', { waitUntil: 'networkidle' })
// log out admin session via store isn't exposed; login page works regardless of admin session
await page.fill('input[autocomplete="current-password"]', 'Welcome8')
await page.getByRole('button', { name: /^log in$/i }).click()
await page.waitForURL('**/portal/set-password')
await page.waitForTimeout(1000) // let the session persist to IndexedDB
await audit('/portal/set-password', 'portal_set_password')
await page.goto(BASE + '/portal/login?id=SBH-0001', { waitUntil: 'networkidle' })
if (!page.url().includes('/portal/login')) {
  // still logged in as SBH-0002 (must change) -> log out
  await page.getByRole('button', { name: /log out/i }).click()
  await page.goto(BASE + '/portal/login?id=SBH-0001', { waitUntil: 'networkidle' })
}
await page.fill('input[autocomplete="current-password"]', 'Hostel@123')
await page.getByRole('button', { name: /^log in$/i }).click()
await page.waitForURL(/\/portal$/)
await page.waitForTimeout(1000)
for (const p of PORTAL) await audit(p, 'portal' + p.replace(/\W+/g, '_'))

console.log('\nPage errors:', errors.length ? errors : 'none')
await browser.close()
