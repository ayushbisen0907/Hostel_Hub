import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { BedDouble, Building2, Check, ShieldCheck } from 'lucide-react'
import { CYCLES, FREE_BEDS, MONEY_BACK_DAYS, PLANS, planForBeds, type BillingCycle, type Plan } from '@/lib/pricing'
import { cn, formatMoney } from '@/lib/utils'
import { fadeUp, listVariants } from './anim'
import { CtaLink } from './CtaLink'
import { CountUp, Reveal } from './motion'

const money = (n: number) => formatMoney(n)
const SLIDER_MAX = 150

/** Pricing: Monthly / Yearly / One-time tabs, each with Free + three paid plans. */
export function Pricing({ head }: { head: ReactNode }) {
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const [beds, setBeds] = useState(40)
  const fit = planForBeds(beds)
  const current = CYCLES.find((c) => c.id === cycle) ?? CYCLES[0]

  return (
    <section id="pricing" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        {head}

        {/* Cycle tabs */}
        <Reveal className="mt-10 flex justify-center">
          <div role="tablist" aria-label="Billing" className="relative inline-grid grid-cols-3 rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-800">
            {CYCLES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={cycle === c.id}
                onClick={() => setCycle(c.id)}
                className={cn(
                  'relative z-10 flex flex-col items-center rounded-xl px-4 py-2 text-sm font-semibold transition-colors sm:min-w-[140px] sm:px-6',
                  cycle === c.id ? 'text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                {cycle === c.id && (
                  <motion.span layoutId="cycle-pill" className="absolute inset-0 -z-10 rounded-xl bg-white shadow-sm dark:bg-slate-950" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                )}
                {c.label}
                <span className={cn('mt-0.5 h-4 text-[10px] font-semibold', c.id === 'onetime' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                  {c.badge ?? ''}
                </span>
              </button>
            ))}
          </div>
        </Reveal>
        <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">{current.note}</p>

        {/* Bed finder */}
        <Reveal className="mx-auto mt-8 max-w-xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-4 text-sm">
              <label htmlFor="beds" className="font-semibold">
                How many beds do you have?
              </label>
              <span className="rounded-lg bg-brand-50 px-2.5 py-1 font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                {beds >= SLIDER_MAX ? `${SLIDER_MAX}+` : beds} beds
              </span>
            </div>
            <input id="beds" type="range" min={1} max={SLIDER_MAX} value={beds} onChange={(e) => setBeds(Number(e.target.value))} className="mt-4 w-full accent-brand-600" />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              <b className="text-slate-800 dark:text-slate-100">{fit.name}</b> fits your hostel
              {fit.beds ? ` (up to ${fit.beds} beds)` : ' (unlimited beds)'}.
            </p>
          </div>
        </Reveal>

        {/* Plans */}
        <motion.div
          // rows of every card share one grid (subgrid), so prices, limits, features and buttons line up
          className="mt-14 grid gap-x-5 sm:grid-cols-2 lg:grid-cols-4"
          variants={listVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
        >
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} cycle={cycle} suffix={current.suffix} fits={fit.id === p.id} />
          ))}
        </motion.div>

        <Reveal className="mx-auto mt-4 max-w-3xl">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center sm:flex-row sm:text-left dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div>
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">{MONEY_BACK_DAYS}-day money-back guarantee</p>
              <p className="text-sm text-emerald-800 dark:text-emerald-300">
                Not happy with a paid plan? Ask within {MONEY_BACK_DAYS} days of paying and get your full money back. The Free plan stays free for up to {FREE_BEDS} beds.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function PlanCard({ plan: p, cycle, suffix, fits }: { plan: Plan; cycle: BillingCycle; suffix: string; fits: boolean }) {
  const price = p.price[cycle]
  const free = price === 0
  const featured = p.popular
  const detail = free
    ? `Up to ${FREE_BEDS} beds, 1 hostel`
    : cycle === 'yearly'
      ? `${money(Math.round(price / 12))}/month · save ${money(p.price.monthly * 12 - price)}`
      : cycle === 'onetime'
        ? p.beds
          ? `Just ${money(Math.round(price / p.beds))} per bed, for life`
          : 'Unlimited beds, for life'
        : p.beds
          ? `About ${money(Math.round(price / p.beds))} per bed a month`
          : 'Unlimited beds and hostels'

  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -6 }}
      className={cn(
        'relative row-span-5 mb-8 grid grid-rows-subgrid gap-y-5 rounded-2xl border bg-white p-6 transition-[border-color,box-shadow] duration-300 dark:bg-slate-900',
        featured
          ? 'border-brand-500 shadow-2xl shadow-brand-200/70 ring-2 ring-brand-500 dark:shadow-black/40'
          : fits
            ? 'border-emerald-400 ring-2 ring-emerald-400/60 dark:border-emerald-500'
            : 'border-slate-200 hover:border-brand-200 hover:shadow-lg dark:border-slate-800 dark:hover:border-brand-500/50',
      )}
    >
      <div className="absolute -top-3 left-6 flex gap-1.5">
        {featured && <span className="rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
        {fits && <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Fits your beds</span>}
      </div>

      <div>
        <p className="text-lg font-semibold">{p.name}</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{p.tagline}</p>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-4xl font-extrabold tracking-tight">{free ? '₹0' : <CountUp value={price} format={money} duration={0.6} />}</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">{free ? 'forever' : suffix}</span>
        </div>
        <p className={cn('mt-1 text-xs font-medium', cycle === 'monthly' || free ? 'text-slate-500 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400')}>{detail}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Limit icon={<BedDouble className="h-4 w-4" />} value={p.beds} unit={p.beds === 1 ? 'bed' : 'beds'} />
        <Limit icon={<Building2 className="h-4 w-4" />} value={p.hostels} unit={p.hostels === 1 ? 'hostel' : 'hostels'} />
      </div>

      <ul className="space-y-2.5 text-sm">
        <li className="font-medium text-slate-500 dark:text-slate-400">{p.includes}</li>
        {p.features.map((f) => (
          <li key={f} className="flex gap-2 text-slate-700 dark:text-slate-200">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> {f}
          </li>
        ))}
      </ul>

      <div className="self-end">
        <CtaLink to="/signup" variant={featured ? 'primary' : 'outline'} className="w-full">
          {free ? 'Start free' : `Choose ${p.name}`}
        </CtaLink>
        <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">{free ? 'Free forever · no card needed' : `${MONEY_BACK_DAYS}-day money-back guarantee`}</p>
      </div>
    </motion.div>
  )
}

function Limit({ icon, value, unit }: { icon: ReactNode; value: number | null; unit: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
      <span className="text-brand-600 dark:text-brand-400">{icon}</span>
      <div className="leading-tight">
        <p className="text-sm font-bold">{value ?? 'Unlimited'}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">{unit}</p>
      </div>
    </div>
  )
}
