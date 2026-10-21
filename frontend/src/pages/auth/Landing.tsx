import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BedDouble,
  Bell,
  Check,
  ChevronDown,
  ClipboardCheck,
  DoorOpen,
  FileSignature,
  FileText,
  IndianRupee,
  Menu,
  MessageSquareWarning,
  Minus,
  Plus,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { LIFETIME_SPOTS, PRICING, TRIAL_DAYS, planTotal, type BillingPeriod } from '@/lib/pricing'
import { cn, formatMoney } from '@/lib/utils'

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <BedDouble className="h-5 w-5" />, title: 'Rooms & beds', text: 'Every floor, room and bed on one screen. See vacant beds and allot in one tap.' },
  { icon: <DoorOpen className="h-5 w-5" />, title: 'Check-in / check-out', text: 'Admission with deposit, Hosteler ID and login in a minute. Check-out only after dues are clear.' },
  { icon: <Wallet className="h-5 w-5" />, title: 'Rent on autopilot', text: 'Bills are made automatically from each hosteler’s check-in date, with the due date sent to them.' },
  { icon: <QrCode className="h-5 w-5" />, title: 'UPI straight to you', text: 'Hostelers pay to your own UPI ID and send the UTR. You verify. No gateway, no commission.' },
  { icon: <Zap className="h-5 w-5" />, title: 'Electricity split', text: 'Enter the meter reading; the bill is split by the days each hosteler stayed in the room.' },
  { icon: <UtensilsCrossed className="h-5 w-5" />, title: 'Mess', text: 'Weekly menu, mess on/off per hosteler and mess fees added to the bill.' },
  { icon: <FileText className="h-5 w-5" />, title: 'Documents', text: 'Aadhaar, college ID and police verification stored safely with each hosteler.' },
  { icon: <ClipboardCheck className="h-5 w-5" />, title: 'Attendance & leave', text: 'Night roll-call in seconds and leave requests from the hosteler’s phone.' },
  { icon: <MessageSquareWarning className="h-5 w-5" />, title: 'Complaints', text: 'Hostelers raise issues, staff fix them, everyone sees the status.' },
  { icon: <UserCog className="h-5 w-5" />, title: 'Visitors & staff', text: 'Gate log for visitors, and logins for your manager, warden and accountant.' },
  { icon: <FileSignature className="h-5 w-5" />, title: 'Rules & move-out', text: 'Hostelers sign your rules on first login and give notice before moving out.' },
  { icon: <BarChart3 className="h-5 w-5" />, title: 'Reports', text: 'Collections, dues, expenses and occupancy for every hostel you run.' },
]

const BEFORE = [
  'Rent written in a register, dues remembered by heart',
  'Chasing every hosteler on WhatsApp for payment',
  'Splitting the electricity bill on a calculator',
  'Photocopies of ID proofs lost in a drawer',
  'No idea which bed is free without walking the floor',
]

const AFTER = [
  'Every bill made on time, automatically',
  'Hostelers pay by UPI and report it in the app',
  'Electricity split by stay days in one click',
  'All documents safe with each hosteler',
  'Live view of every room and bed',
]

const STEPS = [
  { title: 'Add your hostel', text: 'Enter your UPI ID, rent rules and electricity rate once.' },
  { title: 'Create rooms & beds', text: 'Set the rent per room. Add as many floors as you have.' },
  { title: 'Check in hostelers', text: 'Each one gets a Hosteler ID and login. Bills start on their own.' },
]

const FAQS: { q: string; a: string }[] = [
  {
    q: `What do I get in the ${TRIAL_DAYS}-day free trial?`,
    a: `Everything. All features are open for ${TRIAL_DAYS} days and no card is needed to start. Pick a plan when you are ready.`,
  },
  {
    q: 'What happens when the trial or my plan ends?',
    a: 'Your data stays safe. You can still see everything, but you cannot add new entries until you choose a plan.',
  },
  {
    q: 'How is the price counted?',
    a: 'Only by the number of beds you create. ₹30 per bed per month — the same price for a 10-bed PG or a 300-bed hostel. Every plan has every feature.',
  },
  {
    q: 'Do you take a cut from the rent I collect?',
    a: 'No. Hostelers pay directly to your own UPI ID. HostelHub only records the payment after you verify it.',
  },
  {
    q: 'How do my hostelers log in?',
    a: 'At check-in each hosteler gets a Hosteler ID and a temporary password. On first login they set their own password and see only their own bills, mess and notices.',
  },
  {
    q: 'What is the Lifetime plan?',
    a: `Pay once per bed and use HostelHub for as long as it runs, with no monthly bill. It is only open to the first ${LIFETIME_SPOTS} hostels.`,
  },
  {
    q: 'I run more than one hostel. Does that work?',
    a: 'Yes. Add all your hostels to one account and switch between them from the top bar.',
  },
]

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-medium text-slate-600 hover:text-slate-900">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Link to="/portal/login" className="px-3 text-sm font-medium text-slate-600 hover:text-slate-900">
              Hosteler login
            </Link>
            <Link to="/login">
              <Button variant="outline" size="sm">
                Owner login
              </Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">Start free trial</Button>
            </Link>
          </div>
          <button className="ml-auto rounded-lg p-2 text-slate-600 md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" aria-expanded={menuOpen}>
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 pb-4 md:hidden">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="block py-3 text-sm font-medium text-slate-700">
                {l.label}
              </a>
            ))}
            <Link to="/portal/login" className="block py-3 text-sm font-medium text-slate-700">
              Hosteler login
            </Link>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link to="/login">
                <Button variant="outline" className="w-full">
                  Owner login
                </Button>
              </Link>
              <Link to="/signup">
                <Button className="w-full">Free trial</Button>
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative isolate">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_70%_0%,theme(colors.brand.100),transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-2 lg:pb-24 lg:pt-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              <Sparkles className="h-3.5 w-3.5" /> Made for hostels & PGs in India
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Run your hostel from your phone.
              <span className="block text-brand-600">Not from a register.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              Rooms, check-ins, rent, UPI payments, electricity, mess and documents — in one simple app. Your hostelers get their own login too.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup">
                <Button size="lg" className="w-full sm:w-auto" icon={<ArrowRight className="h-4 w-4" />}>
                  Start {TRIAL_DAYS}-day free trial
                </Button>
              </Link>
              <a href="#pricing">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  See pricing
                </Button>
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
              {['No card needed', '₹1 per bed a day', 'All features included'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-600" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroMock />
        </div>
      </section>

      {/* Before / after */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="Why HostelHub" title="Register, Excel aur WhatsApp ka jhanjhat khatam" />
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Today</p>
              <ul className="mt-4 space-y-3">
                {BEFORE.map((t) => (
                  <li key={t} className="flex gap-3 text-slate-600">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-brand-200 bg-white p-6 shadow-lg shadow-brand-100/60">
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">With HostelHub</p>
              <ul className="mt-4 space-y-3">
                {AFTER.map((t) => (
                  <li key={t} className="flex gap-3 text-slate-800">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="Features" title="Everything your hostel needs" text="One app for the owner, the staff and every hosteler." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{f.icon}</div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Deep dives */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl space-y-20 px-4 py-20 sm:px-6">
          <Spotlight
            eyebrow="Payments"
            title="Rent comes straight to your UPI"
            points={[
              'Your UPI ID and QR show on every hosteler’s bill',
              'They pay, enter the UTR and upload a screenshot',
              'You verify in one tap — full or part payment',
              'Whatever is left moves to next month’s bill',
            ]}
            visual={<PaymentMock />}
          />
          <Spotlight
            reverse
            eyebrow="Electricity"
            title="Fair electricity bills, no calculator"
            points={[
              'Set your rate per unit once',
              'Enter the meter reading with its from–to dates',
              'The bill is split by the days each hosteler stayed',
              'It is added to their next bill automatically',
            ]}
            visual={<ElectricityMock />}
          />
          <Spotlight
            eyebrow="Hosteler app"
            title="Your hostelers get their own login"
            points={[
              'Unique Hosteler ID at check-in, like SBH-0001',
              'See bills, pay by UPI and download receipts',
              'Mess menu, notices, complaints and leave',
              'Request move-out with your notice period',
            ]}
            visual={<PhoneMock />}
          />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="How it works" title="Ready in 10 minutes" />
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-slate-200 p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Pricing />

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="FAQ" title="Questions owners ask" />
          <Faq />
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-3xl bg-gradient-to-br from-brand-600 to-brand-900 px-6 py-14 text-center sm:px-12">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Close the register. Open HostelHub.</h2>
          <p className="mx-auto mt-4 max-w-xl text-brand-100">Set up your hostel today and try everything free for {TRIAL_DAYS} days.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/signup">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                Start free trial
              </Button>
            </Link>
            <Link to="/portal/login">
              <Button size="lg" variant="outline" className="w-full border-white/40 bg-transparent text-white hover:bg-white/10 sm:w-auto">
                Hosteler login
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-slate-500">Hostel & PG management for owners, staff and hostelers.</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-500">
              {NAV.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="hover:text-slate-900">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Account</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-500">
              <li>
                <Link to="/signup" className="hover:text-slate-900">
                  Start free trial
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-slate-900">
                  Owner login
                </Link>
              </li>
              <li>
                <Link to="/portal/login" className="hover:text-slate-900">
                  Hosteler login
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100 py-5 text-center text-xs text-slate-400">© {new Date().getFullYear()} HostelHub. All rights reserved.</div>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
        <BedDouble className="h-5 w-5" />
      </span>
      <span className="text-lg font-bold">HostelHub</span>
    </Link>
  )
}

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-lg text-slate-600">{text}</p>}
    </div>
  )
}

function Spotlight({ eyebrow, title, points, visual, reverse }: { eyebrow: string; title: string; points: string[]; visual: ReactNode; reverse?: boolean }) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2">
      <div className={cn(reverse && 'lg:order-2')}>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>
        <h3 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h3>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-slate-700">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={cn('min-w-0', reverse && 'lg:order-1')}>{visual}</div>
    </div>
  )
}

/* ---------------- Pricing ---------------- */

const MIN_BEDS = 1
const MAX_BEDS = 1000
const SLIDER_MAX = 300

function Pricing() {
  const [beds, setBeds] = useState(50)
  const [selected, setSelected] = useState<BillingPeriod>('yearly')
  const set = (n: number) => setBeds(Math.min(MAX_BEDS, Math.max(MIN_BEDS, Math.round(n) || MIN_BEDS)))
  const monthly = PRICING.find((p) => p.id === 'monthly')!

  return (
    <section id="pricing" className="scroll-mt-16 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHead eyebrow="Pricing" title="₹30 per bed. That's it." text="One simple price. Every feature. Pay only for the beds you have." />

        {/* Bed counter */}
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="beds" className="font-semibold">
              How many beds?
            </label>
            <div className="flex items-center gap-1">
              <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={() => set(beds - 1)} aria-label="Fewer beds">
                <Minus className="h-4 w-4" />
              </button>
              <input
                id="beds"
                type="number"
                inputMode="numeric"
                min={MIN_BEDS}
                max={MAX_BEDS}
                value={beds}
                onChange={(e) => set(Number(e.target.value))}
                className="h-9 w-20 rounded-lg border border-slate-200 text-center font-semibold focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={() => set(beds + 1)} aria-label="More beds">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min={MIN_BEDS}
            max={SLIDER_MAX}
            value={Math.min(beds, SLIDER_MAX)}
            onChange={(e) => set(Number(e.target.value))}
            className="mt-5 w-full accent-brand-600"
            aria-label="Beds"
          />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>1</span>
            <span>100</span>
            <span>200</span>
            <span>300+</span>
          </div>
        </div>

        {/* Plans */}
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PRICING.map((p) => {
            const active = selected === p.id
            const total = planTotal(p, beds)
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(p.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(p.id)}
                className={cn(
                  'relative flex cursor-pointer flex-col rounded-2xl border bg-white p-6 transition',
                  active ? 'border-brand-500 shadow-xl shadow-brand-100 ring-2 ring-brand-500' : 'border-slate-200 hover:border-brand-200',
                )}
              >
                {p.id === 'yearly' && <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
                {p.id === 'lifetime' && <span className="absolute -top-3 left-6 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">Limited</span>}
                <p className="text-lg font-semibold">{p.name}</p>
                <p className="mt-1 text-sm text-slate-500">{p.note}</p>
                <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-4xl font-extrabold tracking-tight">{formatMoney(p.perBed)}</span>
                  <span className="text-sm text-slate-500">{p.unit}</span>
                </p>
                <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">
                    For {beds} {beds === 1 ? 'bed' : 'beds'}
                  </p>
                  <p className="text-xl font-bold">
                    {formatMoney(total)} <span className="text-sm font-medium text-slate-500">{p.totalSuffix}</span>
                  </p>
                  {p.id === 'yearly' && <p className="mt-0.5 text-xs font-medium text-emerald-600">You save {formatMoney(planTotal(monthly, beds) * 12 - total)} a year</p>}
                </div>
                <Link to="/signup" className="mt-6" onClick={(e) => e.stopPropagation()}>
                  <Button variant={active ? 'primary' : 'outline'} className="w-full">
                    Start free trial
                  </Button>
                </Link>
              </div>
            )
          })}
        </div>

        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-center font-semibold">Every plan includes</p>
          <ul className="mt-4 grid gap-x-6 gap-y-2.5 text-sm text-slate-700 sm:grid-cols-2">
            {[
              'Unlimited hostels and rooms',
              'Hosteler app with own login',
              'UPI payments with verification',
              'Auto rent bills from check-in date',
              'Electricity split by stay days',
              'Mess, attendance, complaints',
              'Staff logins with roles',
              'Reports and receipts',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" /> {t}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-center text-sm text-slate-500">Start with a {TRIAL_DAYS}-day free trial — no card needed. Your data stays safe even if you stop.</p>
        </div>
      </div>
    </section>
  )
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {FAQS.map((f, i) => (
        <div key={f.q}>
          <button className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span className="font-medium">{f.q}</span>
            <ChevronDown className={cn('h-5 w-5 shrink-0 text-slate-400 transition', open === i && 'rotate-180')} />
          </button>
          {open === i && <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>}
        </div>
      ))}
    </div>
  )
}

/* ---------------- Illustrations (pure CSS, sample values) ---------------- */

// o = occupied, v = vacant, r = reserved
const BED_STATES = 'ooooovoooooooroooovoooooooooooooooooovooooooroooovo'.slice(0, 50).split('')

function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-lg pb-10 sm:pb-0">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-brand-200/50 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Shree Balaji Hostel</p>
            <p className="font-semibold">Dashboard</p>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Bell className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { k: 'Beds filled', v: '44/50', c: 'text-brand-600' },
            { k: 'Collected', v: '₹2.1L', c: 'text-emerald-600' },
            { k: 'Due', v: '₹18,400', c: 'text-amber-600' },
          ].map((s) => (
            <div key={s.k} className="rounded-xl bg-slate-50 p-2.5 sm:p-3">
              <p className="text-[11px] text-slate-500">{s.k}</p>
              <p className={cn('mt-0.5 text-sm font-bold sm:text-base', s.c)}>{s.v}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs font-medium text-slate-500">Beds</p>
        <div className="mt-2 grid grid-cols-10 gap-1.5">
          {BED_STATES.map((s, i) => (
            <span key={i} className={cn('h-5 rounded', s === 'o' ? 'bg-brand-500' : s === 'v' ? 'border border-dashed border-slate-300 bg-white' : 'bg-amber-400')} />
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> Occupied
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-300" /> Vacant
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Reserved
          </span>
        </div>
      </div>
      <div className="absolute -bottom-2 left-0 w-64 sm:-bottom-12 rounded-xl border border-slate-200 bg-white p-3 shadow-xl sm:-left-8">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <IndianRupee className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">₹6,500 paid by UPI</p>
            <p className="truncate text-xs text-slate-500">Room 204 · UTR 4182…7731</p>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <span className="rounded-lg bg-emerald-600 py-1.5 text-center text-xs font-semibold text-white">Verify</span>
          <span className="rounded-lg border border-slate-200 py-1.5 text-center text-xs font-semibold text-slate-600">Part paid</span>
        </div>
      </div>
      <div className="absolute -right-2 -top-5 hidden rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg sm:block">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Users className="h-3.5 w-3.5 text-brand-600" /> 3 new check-ins today
        </p>
      </div>
    </div>
  )
}

function PaymentMock() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
      <p className="text-sm font-semibold">Payment to verify</p>
      <div className="mt-4 space-y-2 text-sm">
        {[
          ['Hosteler', 'SBH-0012 · Room 204'],
          ['Bill', '13 Oct – 12 Nov'],
          ['Paid', '₹6,500'],
          ['UTR', '418236907731'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <span className="text-slate-500">{k}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
        {[
          ['Room rent', '₹5,000'],
          ['Mess', '₹2,200'],
          ['Electricity', '₹312'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-slate-500">{k}</span>
            <span>{v}</span>
          </div>
        ))}
        <div className="!mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
          <span>Total</span>
          <span>₹7,512</span>
        </div>
      </div>
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">₹1,012 left — added to next month’s bill</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <span className="rounded-lg bg-brand-600 py-2 text-center text-sm font-semibold text-white">Verify part</span>
        <span className="rounded-lg border border-slate-200 py-2 text-center text-sm font-semibold text-slate-600">Reject</span>
      </div>
    </div>
  )
}

function ElectricityMock() {
  // 62 units × ₹8 = ₹496, split 31 : 31 : 21 days
  const rows = [
    { name: 'Rahul', days: 31, amt: 185 },
    { name: 'Aman', days: 31, amt: 185 },
    { name: 'Karan', days: 21, amt: 126 },
  ]
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Room 105 · Meter reading</p>
        <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">₹8 / unit</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Period', '1–31 Oct'],
          ['Units', '62'],
          ['Bill', '₹496'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[11px] text-slate-500">{k}</p>
            <p className="text-sm font-bold">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs font-medium text-slate-500">Split by days stayed</p>
      <div className="mt-2 space-y-2.5">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="flex justify-between text-sm">
              <span>{r.name}</span>
              <span className="font-semibold">₹{r.amt}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-amber-400" style={{ width: `${(r.days / 31) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">{r.days} days</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PhoneMock() {
  return (
    <div className="mx-auto w-64 rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl">
      <div className="overflow-hidden rounded-[1.8rem] bg-slate-50">
        <div className="bg-brand-600 px-4 pb-5 pt-6 text-white">
          <p className="text-xs text-brand-100">Hi Rahul · SBH-0012</p>
          <p className="mt-3 text-xs text-brand-100">Due by 13 Nov</p>
          <p className="text-2xl font-bold">₹7,512</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-700">
            <QrCode className="h-3.5 w-3.5" /> Pay by UPI
          </span>
        </div>
        <div className="space-y-2 p-3">
          {[
            { icon: <UtensilsCrossed className="h-4 w-4" />, t: 'Today’s mess', s: 'Rajma chawal, salad' },
            { icon: <Bell className="h-4 w-4" />, t: 'Notice', s: 'Water off 2–4 pm Sunday' },
            { icon: <MessageSquareWarning className="h-4 w-4" />, t: 'Complaint', s: 'Fan fixed · Resolved' },
            { icon: <ShieldCheck className="h-4 w-4" />, t: 'Receipts', s: '3 payments verified' },
          ].map((r) => (
            <div key={r.t} className="flex items-center gap-2.5 rounded-xl bg-white p-2.5 shadow-sm">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{r.icon}</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold">{r.t}</p>
                <p className="truncate text-[11px] text-slate-500">{r.s}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-around border-t border-slate-200 bg-white py-2.5 text-slate-400">
          <Smartphone className="h-4 w-4 text-brand-600" />
          <Wallet className="h-4 w-4" />
          <UtensilsCrossed className="h-4 w-4" />
          <Users className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}
