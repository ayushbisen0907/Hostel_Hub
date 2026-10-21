import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { BedDouble, Bell, Building2, Check, CheckCircle2, IndianRupee, KeyRound, ReceiptText, Smartphone, UserPlus } from 'lucide-react'
import { cn, formatMoney } from '@/lib/utils'
import { Appear, DemoButton, FakeQr, Initials } from './bits'
import { EASE, useMediaQuery, useScramble, useStage, useTyped } from './anim'
import { DEMO_BILL, DEMO_BILL_TOTAL, DEMO_PAID } from './data'
import { CountUp } from './motion'

/**
 * "How it works" as a scroll story: on desktop the steps scroll by on the left while a
 * sticky app window on the right acts each one out. On phones every step shows its
 * own window, played when it scrolls into view.
 */

const STEPS: { title: string; text: string; points: string[] }[] = [
  {
    title: 'Add your hostel',
    text: 'Enter your UPI ID, electricity rate and stay rules once. Every bill and receipt uses them.',
    points: ['Your own UPI ID & QR', 'Rate per unit', 'Notice period & deposit rules'],
  },
  {
    title: 'Create rooms & beds',
    text: 'Fix the rent when you create a room. Its beds are ready to fill straight away.',
    points: ['Rent per room', 'Any number of floors', 'Live vacant beds'],
  },
  {
    title: 'Check in a hosteler',
    text: 'Pick a bed and collect the deposit. HostelHub makes their Hosteler ID and login on the spot.',
    points: ['Unique Hosteler ID', 'Temporary password', 'Mess on by default'],
  },
  {
    title: 'Bills make themselves',
    text: 'Every month from each hosteler’s check-in date, a bill with rent, mess and electricity is made and sent with the due date.',
    points: ['From check-in date', 'Rent + mess + electricity', 'Due date reminder'],
  },
  {
    title: 'Get paid on UPI',
    text: 'The hosteler pays to your UPI and enters the UTR. You verify in one tap — full or part payment.',
    points: ['No gateway fees', 'Part payments carry forward', 'Receipt sent instantly'],
  },
]

export function ScrollStory() {
  const [active, setActive] = useState(0)
  const desktop = useMediaQuery('(min-width: 1024px)')

  return (
    <div className="mt-14 lg:grid lg:grid-cols-[1fr_1.15fr] lg:gap-16">
      <div className="relative">
        {desktop && (
          <div className="absolute bottom-[12vh] left-5 top-[12vh] w-px bg-slate-200">
            <motion.div
              className="h-full w-full origin-top bg-brand-600"
              animate={{ scaleY: active / (STEPS.length - 1) }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          </div>
        )}
        {STEPS.map((s, i) => (
          <StepBlock key={s.title} i={i} step={s} active={!desktop || active === i} desktop={desktop} onActive={setActive} />
        ))}
      </div>

      {desktop && (
        <div>
          <div className="sticky top-24 flex h-[calc(100vh-8rem)] max-h-[620px] items-center">
            <AppWindow step={active}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 24, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -16, filter: 'blur(4px)' }}
                  transition={{ duration: 0.45, ease: EASE }}
                >
                  <Screen step={active} />
                </motion.div>
              </AnimatePresence>
            </AppWindow>
          </div>
        </div>
      )}
    </div>
  )
}

function StepBlock({
  i,
  step,
  active,
  desktop,
  onActive,
}: {
  i: number
  step: (typeof STEPS)[number]
  active: boolean
  desktop: boolean
  onActive: (i: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const centered = useInView(ref, { margin: '-45% 0px -45% 0px' })
  useEffect(() => {
    if (centered) onActive(i)
  }, [centered, i, onActive])

  return (
    <div ref={ref} className={cn('relative py-8', desktop && 'flex min-h-[72vh] items-center')}>
      <div className={cn('transition-opacity duration-500', desktop && 'pl-16', active ? 'opacity-100' : 'opacity-40')}>
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all duration-500',
            desktop && 'absolute left-0 top-1/2 -translate-y-1/2',
            active ? 'bg-brand-600 text-white shadow-lg shadow-brand-200 dark:shadow-black/40' : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700',
          )}
        >
          {i + 1}
        </span>
        <h3 className={cn('text-2xl font-bold tracking-tight', !desktop && 'mt-4')}>{step.title}</h3>
        <p className="mt-2 max-w-md text-slate-600 dark:text-slate-300">{step.text}</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {step.points.map((p) => (
            <li key={p} className="flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200">
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {p}
            </li>
          ))}
        </ul>
        {!desktop && (
          <div className="mt-6">
            <PlayWhenSeen>
              <AppWindow step={i}>
                <Screen step={i} />
              </AppWindow>
            </PlayWhenSeen>
          </div>
        )}
      </div>
    </div>
  )
}

function PlayWhenSeen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.35 })
  return (
    <div ref={ref} className="min-h-[420px]">
      {seen && children}
    </div>
  )
}

const TITLES = ['New hostel', 'Rooms', 'Check in', 'Bills', 'Payments']

function AppWindow({ step, children }: { step: number; children: ReactNode }) {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl shadow-brand-200/50 dark:shadow-black/40">
      <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        <span className="ml-3 truncate text-xs font-medium text-slate-500 dark:text-slate-400">HostelHub · {TITLES[step]}</span>
      </div>
      <div className="min-h-[400px] p-5">{children}</div>
    </div>
  )
}

function Screen({ step }: { step: number }) {
  if (step === 0) return <SetupScreen />
  if (step === 1) return <RoomsScreen />
  if (step === 2) return <CheckInScreen />
  if (step === 3) return <BillScreen />
  return <UpiScreen />
}

function ScreenTitle({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">{icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </div>
  )
}

function FakeField({ label, value, focus }: { label: string; value: string; focus: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <div
        className={cn(
          'flex h-10 items-center rounded-lg border px-3 text-sm transition-colors',
          focus ? 'border-brand-500 ring-2 ring-brand-100 dark:ring-brand-500/30' : 'border-slate-200 dark:border-slate-800',
        )}
      >
        <span className="truncate">{value}</span>
        {focus && <span className="ml-0.5 h-4 w-px animate-pulse bg-brand-600" />}
      </div>
    </div>
  )
}

/* ---------- 1. hostel ---------- */
function SetupScreen() {
  const name = useTyped('Shree Balaji Boys Hostel', 300)
  const upi = useTyped('balajihostel@okicici', 1700, 40)
  const rate = useTyped('8', 2800)
  const stage = useStage([3200, 3900, 4500])
  return (
    <div>
      <ScreenTitle icon={<Building2 className="h-5 w-5" />} title="New hostel" sub="Set once, used on every bill" />
      <div className="space-y-3.5">
        <FakeField label="Hostel name" value={name.typed} focus={!name.done} />
        <FakeField label="UPI ID (hostelers pay here)" value={upi.typed} focus={name.done && !upi.done} />
        <div className="grid grid-cols-2 gap-3">
          <FakeField label="Electricity rate" value={rate.typed ? `₹${rate.typed} per unit` : ''} focus={upi.done && !rate.done} />
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Split electricity</p>
            <div className="relative grid h-10 grid-cols-2 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
              <motion.span
                className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-white dark:bg-slate-900 shadow"
                animate={{ x: stage >= 1 ? '100%' : '0%' }}
                transition={{ duration: 0.4, ease: EASE }}
              />
              <span className="relative z-10 flex items-center justify-center text-slate-600 dark:text-slate-300">Per room</span>
              <span className={cn('relative z-10 flex items-center justify-center', stage >= 1 ? 'text-brand-700 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300')}>Per bed</span>
            </div>
          </div>
        </div>
        <div className="pt-2">
          <DemoButton done={stage >= 3} label="Save hostel" doneLabel="Hostel created" className="w-full py-2.5 text-sm" pointerDelay={2.6} />
        </div>
      </div>
    </div>
  )
}

/* ---------- 2. rooms ---------- */
const ROOMS = [
  { n: '101', beds: 3, rent: 5000 },
  { n: '102', beds: 3, rent: 5000 },
  { n: '103', beds: 2, rent: 6500 },
  { n: '201', beds: 4, rent: 4500 },
  { n: '202', beds: 2, rent: 6500 },
  { n: '203', beds: 1, rent: 9000 },
]

function RoomsScreen() {
  const total = ROOMS.reduce((a, r) => a + r.beds, 0)
  return (
    <div>
      <ScreenTitle icon={<BedDouble className="h-5 w-5" />} title="Rooms & beds" sub="Rent is fixed per room" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ROOMS.map((r, i) => (
          <motion.div
            key={r.n}
            className="rounded-xl border border-slate-200 dark:border-slate-800 p-3"
            initial={{ opacity: 0, scale: 0.9, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.18, duration: 0.45, ease: EASE }}
          >
            <div className="flex items-baseline justify-between">
              <p className="font-semibold">Room {r.n}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatMoney(r.rent)}</p>
            </div>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: r.beds }, (_, b) => (
                <motion.span
                  key={b}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5 + i * 0.18 + b * 0.08, type: 'spring', stiffness: 400, damping: 18 }}
                >
                  <BedDouble className="h-3.5 w-3.5" />
                </motion.span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="mt-4 flex items-center justify-between rounded-xl bg-emerald-50 dark:bg-emerald-500/15 px-4 py-3 text-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6 }}
      >
        <span className="font-medium text-emerald-800 dark:text-emerald-300">Beds ready to fill</span>
        <CountUp value={total} className="text-lg font-bold text-emerald-700 dark:text-emerald-300" duration={1.4} />
      </motion.div>
    </div>
  )
}

/* ---------- 3. check-in ---------- */
function CheckInScreen() {
  const name = useTyped('Rahul Verma', 300, 60)
  const id = useScramble('SBH-0044', 1500)
  const pwd = useScramble('K7Q2-MP9X', 2300)
  const stage = useStage([1100, 3200, 3700, 4200])
  return (
    <div>
      <ScreenTitle icon={<UserPlus className="h-5 w-5" />} title="Check in" sub="Shree Balaji Boys Hostel" />
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
        <Initials name={name.typed || 'R'} />
        <div className="min-w-0 flex-1">
          <p className="h-5 font-semibold">{name.typed}</p>
          <Appear show={stage >= 1} className="text-xs text-slate-500 dark:text-slate-400">
            Room 102 · Bed C · from 11 Oct
          </Appear>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Hosteler ID</p>
          <p className="mt-0.5 h-6 font-mono text-base font-bold tracking-wider text-brand-700 dark:text-brand-300">{id}</p>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <KeyRound className="h-3 w-3" /> Temporary password
          </p>
          <p className="mt-0.5 h-6 font-mono text-base font-bold tracking-wider">{pwd}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {['Deposit ₹5,000 collected', 'Mess ON', 'Login sent on WhatsApp'].map((t, i) => (
          <li key={t} className="h-6">
            <Appear show={stage >= i + 2} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {t}
            </Appear>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- 4. bill ---------- */
function BillScreen() {
  const stage = useStage([400, 900, 1400, 2000, 3200])
  const lines: [string, string, number][] = [
    ['Room rent', 'Room 102', DEMO_BILL.rent],
    ['Mess', '13 Oct – 12 Nov', DEMO_BILL.mess],
    ['Electricity', '21 of 31 days', DEMO_BILL.power],
  ]
  return (
    <div>
      <ScreenTitle icon={<ReceiptText className="h-5 w-5" />} title="Bill · 13 Oct – 12 Nov" sub="Rahul Verma · SBH-0044" />
      <div className="rounded-xl border border-slate-200 dark:border-slate-800">
        {lines.map(([k, sub, v], i) => (
          <div key={k} className="h-14 border-b border-slate-100 dark:border-slate-800 px-4 last:border-0">
            <Appear show={stage >= i + 1} className="flex h-14 items-center justify-between">
              <div>
                <p className="text-sm font-medium">{k}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>
              </div>
              <p className="font-semibold">{formatMoney(v)}</p>
            </Appear>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white dark:bg-slate-800">
        <div>
          <p className="text-[11px] text-slate-400">Total</p>
          <p className="text-xl font-bold">{stage >= 4 ? <CountUp value={DEMO_BILL_TOTAL} format={(n) => formatMoney(n)} /> : '—'}</p>
        </div>
        <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-slate-900">Due 13 Nov</span>
      </div>
      <Appear show={stage >= 5} className="mt-3 flex justify-center">
        <span className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold shadow-lg">
          <Bell className="h-4 w-4 text-brand-600 dark:text-brand-400" /> Sent to Rahul’s app
        </span>
      </Appear>
    </div>
  )
}

/* ---------- 5. UPI ---------- */
function UpiScreen() {
  const utr = useTyped('418236907731', 900, 55)
  const stage = useStage([2100, 2700, 4300])
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl bg-slate-900 p-1.5 dark:bg-slate-700">
        <div className="rounded-xl bg-white dark:bg-slate-900 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <Smartphone className="h-3.5 w-3.5" /> Rahul’s phone
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Pay to balajihostel@okicici</p>
          <FakeQr className="mx-auto mt-2 w-24 border border-slate-200 dark:border-slate-800" />
          <p className="mt-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">Amount paid</p>
          <p className="text-sm font-bold">{formatMoney(DEMO_PAID)}</p>
          <p className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">UTR / transaction ID</p>
          <p className="h-5 font-mono text-sm">{utr.typed}</p>
          <DemoButton done={stage >= 1} label="I have paid" doneLabel="Sent for checking" className="mt-3 w-full" pointerDelay={0.8} />
        </div>
      </div>
      <div className="flex flex-col justify-center">
        <AnimatePresence>
          {stage >= 2 && (
            <motion.div
              className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-lg"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <IndianRupee className="h-3.5 w-3.5" /> Owner · payment to verify
              </p>
              <p className="mt-2 text-lg font-bold">{formatMoney(DEMO_PAID)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Rahul · UTR 4182…7731</p>
              <DemoButton done={stage >= 3} label="Verify" doneLabel="Verified" className="mt-3 w-full" pointerDelay={0.4} />
              <Appear show={stage >= 3} className="mt-3 space-y-1 text-xs">
                <p className="text-emerald-700 dark:text-emerald-300">✓ Receipt sent to Rahul</p>
                <p className="text-amber-700 dark:text-amber-300">{formatMoney(DEMO_BILL_TOTAL - DEMO_PAID)} added to next bill</p>
              </Appear>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
