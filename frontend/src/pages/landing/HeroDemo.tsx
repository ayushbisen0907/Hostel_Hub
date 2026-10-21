import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { Bell, CheckCircle2, IndianRupee, ReceiptText, UserPlus, Zap, type LucideIcon } from 'lucide-react'
import { cn, formatMoney } from '@/lib/utils'
import { Appear, DemoButton, Initials } from './bits'
import { EASE, splitByWeight } from './anim'
import { DEMO_BILL, DEMO_BILL_TOTAL, DEMO_PAID } from './data'
import { CountUp } from './motion'

/**
 * Auto-playing product demo for the hero: a dashboard where a hosteler checks in,
 * a bill is made, a UPI payment is verified and the electricity bill is split.
 * Plays only while on screen; the pills below jump to any step.
 */

const SCENES: { label: string; icon: LucideIcon }[] = [
  { label: 'Check-in', icon: UserPlus },
  { label: 'Auto bill', icon: ReceiptText },
  { label: 'UPI verify', icon: IndianRupee },
  { label: 'Electricity', icon: Zap },
]
const SCENE_MS = 4600
const ACTION_MS = 1800

const VACANT = new Set([6, 14, 29, 35, 49])
const RESERVED = new Set([19, 42])
const TARGET_BED = 14

const POWER = { units: 62, rate: 8, people: [{ name: 'Aman', days: 31 }, { name: 'Karan', days: 31 }, { name: 'Rahul', days: 21 }] }

export function HeroDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.3 })
  const [scene, setScene] = useState(0)
  const [acted, setActed] = useState(false)

  useEffect(() => {
    if (!inView) return
    setActed(false)
    const a = window.setTimeout(() => setActed(true), ACTION_MS)
    const n = window.setTimeout(() => setScene((s) => (s + 1) % SCENES.length), SCENE_MS)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(n)
    }
  }, [scene, inView])

  const checkedIn = scene > 0 || acted
  const billed = scene >= 1
  const paid = scene > 2 || (scene === 2 && acted)
  const powered = scene === 3 && acted
  const filled = 43 + (checkedIn ? 1 : 0)
  const collected = 204500 + (paid ? DEMO_PAID : 0)
  const due = 24900 + (billed ? DEMO_BILL_TOTAL : 0) - (paid ? DEMO_PAID : 0) + (powered ? POWER.units * POWER.rate : 0)

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-lg">
      <div className="absolute -top-4 right-4 z-10 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Live demo
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-brand-200/60 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Shree Balaji Hostel</p>
            <p className="font-semibold">Dashboard</p>
          </div>
          <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Bell className="h-4 w-4" />
            <AnimatePresence>
              {acted && (
                <motion.span
                  key={scene}
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500"
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.6, 1] }}
                  exit={{ scale: 0 }}
                  transition={{ duration: 0.4 }}
                />
              )}
            </AnimatePresence>
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Beds filled" className="text-brand-600">
            <CountUp value={filled} duration={0.6} />
            /50
          </Stat>
          <Stat label="Collected" className="text-emerald-600">
            <CountUp value={collected} format={(n) => formatMoney(n)} />
          </Stat>
          <Stat label="Due" className="text-amber-600">
            <CountUp value={due} format={(n) => formatMoney(n)} />
          </Stat>
        </div>

        <p className="mt-4 text-xs font-medium text-slate-500">Beds</p>
        <div className="mt-2 grid grid-cols-10 gap-1.5">
          {Array.from({ length: 50 }, (_, i) => {
            const isTarget = i === TARGET_BED
            const state = isTarget ? (checkedIn ? 'o' : 'v') : VACANT.has(i) ? 'v' : RESERVED.has(i) ? 'r' : 'o'
            return (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: isTarget && checkedIn ? [1, 1.35, 1] : 1 }}
                transition={{ delay: isTarget ? 0 : i * 0.012, duration: 0.4 }}
                className={cn(
                  'h-4 rounded transition-colors duration-500 sm:h-5',
                  state === 'o' ? 'bg-brand-500' : state === 'v' ? 'border border-dashed border-slate-300 bg-white' : 'bg-amber-400',
                  isTarget && scene === 0 && !acted && 'ring-2 ring-brand-300 ring-offset-1',
                )}
              />
            )
          })}
        </div>

        <div className="relative mt-4 h-[124px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={scene}
              className="absolute inset-0"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              {scene === 0 && <CheckInPanel acted={acted} />}
              {scene === 1 && <BillPanel acted={acted} />}
              {scene === 2 && <UpiPanel acted={acted} />}
              {scene === 3 && <PowerPanel acted={acted} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2" role="tablist" aria-label="Demo steps">
        {SCENES.map((s, i) => {
          const Icon = s.icon
          const active = i === scene
          return (
            <button
              key={s.label}
              role="tab"
              aria-selected={active}
              onClick={() => setScene(i)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border px-1 py-2 text-[11px] font-semibold transition-colors sm:flex-row sm:text-xs',
                active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {s.label}
              {active && inView && (
                <motion.span
                  key={scene}
                  className="absolute bottom-0 left-0 h-0.5 bg-brand-600"
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: SCENE_MS / 1000, ease: 'linear' }}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2.5 sm:p-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={cn('mt-0.5 truncate text-sm font-bold sm:text-base', className)}>{children}</p>
    </div>
  )
}

const panel = 'flex h-full flex-col justify-center rounded-xl border border-slate-200 bg-slate-50 p-3'

function CheckInPanel({ acted }: { acted: boolean }) {
  return (
    <div className={panel}>
      <div className="flex items-center gap-3">
        <Initials name="Rahul Verma" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Rahul Verma</p>
          <p className="truncate text-xs text-slate-500">Room 102 · Bed C · Deposit ₹5,000</p>
        </div>
        <DemoButton done={acted} label="Check in" doneLabel="Done" />
      </div>
      <Appear show={acted} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Hosteler ID SBH-0044 · login sent on WhatsApp
      </Appear>
    </div>
  )
}

function BillPanel({ acted }: { acted: boolean }) {
  const lines: [string, number][] = [
    ['Rent', DEMO_BILL.rent],
    ['Mess', DEMO_BILL.mess],
    ['Electricity', DEMO_BILL.power],
  ]
  return (
    <div className={panel}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold">Bill made · Rahul · 13 Oct – 12 Nov</p>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Due 13 Nov</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {lines.map(([k, v], i) => (
          <motion.div
            key={k}
            className="rounded-lg bg-white px-2 py-1.5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.25, duration: 0.4 }}
          >
            <p className="text-[10px] text-slate-500">{k}</p>
            <p className="text-xs font-semibold">{formatMoney(v)}</p>
          </motion.div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold">
          Total <CountUp value={DEMO_BILL_TOTAL} format={(n) => formatMoney(n)} duration={1.2} />
        </span>
        <Appear show={acted} className="flex items-center gap-1 font-medium text-brand-700">
          <Bell className="h-3.5 w-3.5" /> Sent to Rahul’s app
        </Appear>
      </div>
    </div>
  )
}

function UpiPanel({ acted }: { acted: boolean }) {
  return (
    <div className={panel}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <IndianRupee className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{formatMoney(DEMO_PAID)} paid by UPI</p>
          <p className="truncate text-xs text-slate-500">Rahul · UTR 4182…7731</p>
        </div>
        <DemoButton done={acted} label="Verify" doneLabel="Verified" />
      </div>
      <Appear show={acted} className="mt-2 text-xs font-medium text-slate-600">
        Receipt sent · <span className="text-amber-700">{formatMoney(DEMO_BILL_TOTAL - DEMO_PAID)} moves to next bill</span>
      </Appear>
    </div>
  )
}

function PowerPanel({ acted }: { acted: boolean }) {
  const total = POWER.units * POWER.rate
  const shares = splitByWeight(
    total,
    POWER.people.map((p) => p.days),
  )
  const max = Math.max(...shares)
  return (
    <div className={panel}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <p className="font-semibold">
          Room 102 · {POWER.units} units × ₹{POWER.rate} = {formatMoney(total)}
        </p>
        <Appear show={acted} className="shrink-0 font-medium text-emerald-700">
          ✓ Added to bills
        </Appear>
      </div>
      <div className="mt-2 space-y-1.5">
        {POWER.people.map((p, i) => (
          <div key={p.name} className="flex items-center gap-2 text-[11px]">
            <span className="w-11 shrink-0 text-slate-600">{p.name}</span>
            <div className="h-2 flex-1 rounded-full bg-white">
              <motion.div
                className="h-2 rounded-full bg-amber-400"
                initial={{ width: 0 }}
                animate={{ width: `${(shares[i] / max) * 100}%` }}
                transition={{ delay: 0.2 + i * 0.2, duration: 0.8, ease: EASE }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-slate-500">
              {p.days}d · <b className="text-slate-800">₹{shares[i]}</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
