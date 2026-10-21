import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { Bell, CheckCircle2, Home, Megaphone, QrCode, ReceiptText, RotateCcw, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { cn, formatMoney } from '@/lib/utils'
import { EASE, splitByWeight } from './anim'
import { DEMO_BILL, DEMO_BILL_TOTAL } from './data'
import { CountUp } from './motion'

const money = (n: number) => formatMoney(n)

function TryBadge() {
  return <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white">Try it</span>
}

/* ======================= UPI payment verification ======================= */

const PAY_OPTIONS = [DEMO_BILL_TOTAL, 6500, 4000]

export function PaymentDemo() {
  const [paid, setPaid] = useState(6500)
  const [verified, setVerified] = useState(false)
  const left = DEMO_BILL_TOTAL - paid

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Payment to verify</p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={verified ? 'v' : 'w'}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', verified ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300')}
            >
              {verified ? 'Verified' : 'Waiting'}
            </motion.span>
          </AnimatePresence>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          {[
            ['Hosteler', 'Rahul Verma · SBH-0044'],
            ['Bill', `13 Oct – 12 Nov · ${money(DEMO_BILL_TOTAL)}`],
            ['UTR', '418236907731'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 text-xs font-medium text-slate-500 dark:text-slate-400">Rahul paid</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {PAY_OPTIONS.map((o) => (
            <button
              key={o}
              onClick={() => {
                setPaid(o)
                setVerified(false)
              }}
              className={cn(
                'rounded-xl border px-2 py-2 text-sm font-semibold transition',
                o === paid ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-2 ring-brand-100 dark:ring-brand-500/30' : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600',
              )}
            >
              {money(o)}
              <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">{o === DEMO_BILL_TOTAL ? 'Full' : 'Part'}</span>
            </button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setVerified(true)}
          disabled={verified}
          className={cn(
            'mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-colors',
            verified ? 'bg-emerald-600' : 'bg-brand-600 hover:bg-brand-700',
          )}
        >
          {verified ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Verified
            </>
          ) : left > 0 ? (
            `Verify ${money(paid)} as part payment`
          ) : (
            'Verify full payment'
          )}
        </motion.button>
      </div>

      <AnimatePresence>
        {verified && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <div className="grid grid-cols-2 gap-3 pt-3">
              <motion.div initial={{ y: 12 }} animate={{ y: 0 }} className="rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Receipt</p>
                <p className="mt-1 text-lg font-bold text-emerald-900 dark:text-emerald-200">{money(paid)}</p>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">Sent to Rahul’s app</p>
              </motion.div>
              <motion.div
                initial={{ y: 12 }}
                animate={{ y: 0 }}
                transition={{ delay: 0.12 }}
                className={cn('rounded-2xl border p-4', left > 0 ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900')}
              >
                <p className={cn('text-[11px] font-semibold uppercase tracking-wide', left > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400')}>Next bill</p>
                {left > 0 ? (
                  <>
                    <p className="mt-1 text-lg font-bold text-amber-900 dark:text-amber-200">+ {money(left)}</p>
                    <p className="text-xs text-amber-800 dark:text-amber-300">Previous balance, paid first</p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-lg font-bold">₹0</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">All clear this month</p>
                  </>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Pick what Rahul paid, then verify.</span>
        {verified && (
          <button onClick={() => setVerified(false)} className="flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400 hover:underline">
            <RotateCcw className="h-3 w-3" /> Again
          </button>
        )}
      </div>
    </div>
  )
}

/* ======================= Electricity split ======================= */

const RATES = [6, 7, 8, 10]
const PERIOD_DAYS = 31

export function ElectricityDemo() {
  const [units, setUnits] = useState(62)
  const [rate, setRate] = useState(8)
  const [people, setPeople] = useState([
    { name: 'Aman', days: 31 },
    { name: 'Karan', days: 31 },
    { name: 'Rahul', days: 21 },
  ])
  const total = units * rate
  const shares = splitByWeight(
    total,
    people.map((p) => p.days),
  )
  const max = Math.max(1, ...shares)

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Room 102 · Meter reading</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">1 Oct – 31 Oct</p>
        </div>
        <TryBadge />
      </div>

      <label className="mt-5 block">
        <span className="flex justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
          Units used <b className="text-slate-900 dark:text-white">{units}</b>
        </span>
        <input type="range" min={10} max={200} value={units} onChange={(e) => setUnits(Number(e.target.value))} className="mt-2 w-full accent-brand-600" />
      </label>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Rate</span>
        {RATES.map((r) => (
          <button
            key={r}
            onClick={() => setRate(r)}
            className={cn('rounded-lg border px-2.5 py-1 text-xs font-semibold transition', r === rate ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300')}
          >
            ₹{r}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 dark:bg-amber-500/15 px-4 py-3">
        <span className="text-sm text-amber-900 dark:text-amber-200">
          {units} × ₹{rate}
        </span>
        <CountUp value={total} format={money} duration={0.5} className="text-lg font-bold text-amber-900 dark:text-amber-200" />
      </div>

      <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">Split by days stayed — drag to change</p>
      <div className="mt-2 space-y-3">
        {people.map((p, i) => (
          <div key={p.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{p.name}</span>
              <CountUp value={shares[i]} format={money} duration={0.5} className="font-semibold" />
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
              <motion.div className="h-2 rounded-full bg-amber-400" animate={{ width: `${(shares[i] / max) * 100}%` }} transition={{ duration: 0.5, ease: EASE }} />
            </div>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={PERIOD_DAYS}
                value={p.days}
                onChange={(e) => {
                  const days = Number(e.target.value)
                  setPeople((ps) => ps.map((x, j) => (j === i ? { ...x, days } : x)))
                }}
                aria-label={`${p.name} days stayed`}
                className="h-1 flex-1 accent-amber-500"
              />
              <span className="w-12 text-right text-[11px] text-slate-500 dark:text-slate-400">{p.days} days</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">Each share is added to that hosteler’s next bill automatically.</p>
    </div>
  )
}

/* ======================= Hosteler phone ======================= */

const TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'bills', label: 'Bills', icon: ReceiptText },
  { id: 'mess', label: 'Mess', icon: UtensilsCrossed },
  { id: 'notices', label: 'Notices', icon: Megaphone },
]

export function PhoneDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4 })
  const [tab, setTab] = useState(0)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!inView || touched) return
    const t = window.setTimeout(() => setTab((x) => (x + 1) % TABS.length), 3200)
    return () => window.clearTimeout(t)
  }, [tab, inView, touched])

  return (
    <div ref={ref} className="flex flex-col items-center">
      <motion.div
        className="w-64 rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 dark:border-slate-700 dark:bg-slate-700 shadow-2xl"
        animate={touched ? { y: 0 } : { y: [0, -8, 0] }}
        transition={touched ? { duration: 0.3 } : { duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="flex h-[470px] flex-col overflow-hidden rounded-[1.8rem] bg-slate-50 dark:bg-slate-950">
          <div className="relative flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                className="absolute inset-0"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {tab === 0 && <PhoneHome />}
                {tab === 1 && <PhoneBills />}
                {tab === 2 && <PhoneMess />}
                {tab === 3 && <PhoneNotices />}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="grid grid-cols-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {TABS.map((t, i) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTouched(true)
                    setTab(i)
                  }}
                  className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors', i === tab ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400')}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      </motion.div>
      <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">Tap the tabs on the phone</p>
    </div>
  )
}

function PhoneHome() {
  return (
    <div>
      <div className="bg-brand-600 px-4 pb-5 pt-6 text-white">
        <p className="text-xs text-brand-100">Hi Rahul · SBH-0044</p>
        <p className="mt-3 text-xs text-brand-100">Due by 13 Nov</p>
        <p className="text-2xl font-bold">{money(DEMO_BILL_TOTAL)}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
          <QrCode className="h-3.5 w-3.5" /> Pay by UPI
        </span>
      </div>
      <div className="space-y-2 p-3">
        {[
          { icon: <UtensilsCrossed className="h-4 w-4" />, t: 'Today’s lunch', s: 'Rajma chawal, salad' },
          { icon: <Bell className="h-4 w-4" />, t: 'Bill ready', s: 'Rent, mess & electricity' },
          { icon: <CheckCircle2 className="h-4 w-4" />, t: 'Complaint', s: 'Fan fixed · Resolved' },
        ].map((r) => (
          <div key={r.t} className="flex items-center gap-2.5 rounded-xl bg-white dark:bg-slate-900 p-2.5 shadow-sm">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">{r.icon}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold">{r.t}</p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{r.s}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PhoneBills() {
  const bills = [
    { p: '13 Oct – 12 Nov', a: DEMO_BILL_TOTAL, s: 'Due', c: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300' },
    { p: '13 Sep – 12 Oct', a: 7290, s: 'Paid', c: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300' },
    { p: '13 Aug – 12 Sep', a: 7410, s: 'Paid', c: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300' },
  ]
  return (
    <div className="p-4">
      <p className="text-sm font-bold">My bills</p>
      <div className="mt-3 space-y-2">
        {bills.map((b, i) => (
          <motion.div
            key={b.p}
            className="rounded-xl bg-white dark:bg-slate-900 p-3 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">{b.p}</p>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', b.c)}>{b.s}</span>
            </div>
            <p className="mt-1 text-sm font-bold">{money(b.a)}</p>
            {i === 0 && (
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Rent {money(DEMO_BILL.rent)} · Mess {money(DEMO_BILL.mess)} · Power {money(DEMO_BILL.power)}
              </p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function PhoneMess() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const meals = [
    ['Breakfast', 'Poha, chai'],
    ['Lunch', 'Rajma chawal, salad'],
    ['Dinner', 'Paneer, roti, dal'],
  ]
  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">Mess menu</p>
        <span className="rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">Mess ON</span>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {days.map((d, i) => (
          <span key={i} className={cn('rounded-lg py-1.5 text-center text-[11px] font-semibold', i === 2 ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400')}>
            {d}
          </span>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {meals.map(([k, v], i) => (
          <motion.div key={k} className="rounded-xl bg-white dark:bg-slate-900 p-3 shadow-sm" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.1 }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</p>
            <p className="text-xs font-medium">{v}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function PhoneNotices() {
  const notes = [
    ['Water off on Sunday', '2 pm – 4 pm, tank cleaning'],
    ['Gate closes at 10:30 pm', 'Sign in at the gate after that'],
    ['Diwali dinner', 'Saturday 8 pm on the terrace'],
  ]
  return (
    <div className="p-4">
      <p className="text-sm font-bold">Notices</p>
      <div className="mt-3 space-y-2">
        {notes.map(([t, s], i) => (
          <motion.div key={t} className="rounded-xl bg-white dark:bg-slate-900 p-3 shadow-sm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1 }}>
            <p className="text-xs font-semibold">{t}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{s}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
