import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  BedDouble,
  Check,
  ChevronDown,
  ClipboardCheck,
  DoorOpen,
  FileText,
  LogIn,
  Menu,
  MessageSquareWarning,
  PlayCircle,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react'
import { useStore } from '@/store'
import { Badge, Button, toast } from '@/components/ui'
import { PLANS } from '@/lib/plans'
import { cn, formatMoney } from '@/lib/utils'

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <BedDouble className="h-5 w-5" />, title: 'Rooms & beds', text: 'Map every floor, room and bed. See vacant beds at a glance and allot in one click.' },
  { icon: <Users className="h-5 w-5" />, title: 'Hosteler records', text: 'Complete profiles with guardian details, ID proofs, course or company and notes.' },
  { icon: <DoorOpen className="h-5 w-5" />, title: 'Check-in / check-out', text: 'Guided admission with deposits, bed reservation and settlement on check-out.' },
  { icon: <FileText className="h-5 w-5" />, title: 'Documents', text: 'Store Aadhaar, college IDs and police verification. Track expiry and verification.' },
  { icon: <Wallet className="h-5 w-5" />, title: 'Fees & receipts', text: 'Generate monthly rent in bulk, record payments by UPI or cash and print receipts.' },
  { icon: <UtensilsCrossed className="h-5 w-5" />, title: 'Mess management', text: 'Weekly menu, meal opt-outs for accurate headcounts and food feedback.' },
  { icon: <ClipboardCheck className="h-5 w-5" />, title: 'Attendance & leave', text: 'Night roll-call in seconds and a leave approval flow the warden actually uses.' },
  { icon: <MessageSquareWarning className="h-5 w-5" />, title: 'Complaints', text: 'Residents raise issues, staff get assigned, everyone sees progress till it is resolved.' },
  { icon: <UserCog className="h-5 w-5" />, title: 'Visitors & gate log', text: 'Log every visitor and every in/out movement at the gate with timestamps.' },
  { icon: <BarChart3 className="h-5 w-5" />, title: 'Reports', text: 'Profit & loss, collections, dues ageing and occupancy across all your hostels.' },
  { icon: <Smartphone className="h-5 w-5" />, title: 'Hosteler portal', text: 'Residents check dues, mess menu, notices and apply for leave from their phone.' },
  { icon: <ShieldCheck className="h-5 w-5" />, title: 'Multi-hostel', text: 'Run boys, girls and co-ed properties from a single account with one switcher.' },
]

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Is HostelHub really free for small hostels?',
    a: 'Yes. The Free plan covers up to 20 beds with rooms, hosteler records, check-in/out, documents and rent tracking. No card needed.',
  },
  {
    q: 'How is pricing calculated on paid plans?',
    a: 'You pay per bed per month, based on the total beds configured across your hostels. Add or remove rooms and your bill adjusts automatically.',
  },
  {
    q: 'Can my residents log in?',
    a: 'Yes. At check-in every hosteler gets a unique Hosteler ID and a temporary password (sent on WhatsApp). On first login they set their own password. They can view dues, the mess menu, notices and raise complaints or leave requests.',
  },
  {
    q: 'Where is my data stored?',
    a: 'In this version, everything is stored in your own browser. You can export a full backup any time from Settings → Data and import it on another device.',
  },
  {
    q: 'I run more than one hostel. Does that work?',
    a: 'Absolutely. Add as many hostels as you like and switch between them from the top bar, or view everything combined.',
  },
]

export default function Landing() {
  const loadDemo = useStore((s) => s.loadDemo)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const tryDemo = () => {
    loadDemo()
    toast.success('Demo workspace loaded')
    navigate('/app/dashboard')
  }

  const navLinks = [
    { href: '#features', label: 'Features' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#faq', label: 'FAQ' },
  ]

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <BedDouble className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold text-slate-900">HostelHub</span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-medium text-slate-600 hover:text-slate-900">
                {l.label}
              </a>
            ))}
            <Link to="/portal/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Hosteler login
            </Link>
          </nav>
          <div className="flex-1" />
          <div className="hidden items-center gap-2 md:flex">
            <Link to="/login">
              <Button variant="ghost">Log in</Button>
            </Link>
            <Link to="/signup">
              <Button>Start free</Button>
            </Link>
          </div>
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 py-3 md:hidden">
            <div className="flex flex-col gap-1">
              {navLinks.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {l.label}
                </a>
              ))}
              <Link to="/portal/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Hosteler login
              </Link>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link to="/login">
                  <Button variant="outline" className="w-full">Log in</Button>
                </Link>
                <Link to="/signup">
                  <Button className="w-full">Start free</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white" />
        <div className="absolute -right-40 -top-40 -z-10 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-2 lg:pb-24 lg:pt-20">
          <div>
            <Badge tone="blue" className="mb-5">
              <Sparkles className="h-3 w-3" /> Built for Indian hostels & PGs
            </Badge>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Run your hostel <span className="text-brand-600">from one place</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Rooms, residents, rent, mess, attendance and complaints — all in one simple dashboard. Stop juggling registers,
              spreadsheets and WhatsApp groups.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup">
                <Button size="lg" className="w-full sm:w-auto" icon={<ArrowRight className="h-4 w-4" />}>
                  Start free
                </Button>
              </Link>
              <Button size="lg" variant="outline" icon={<PlayCircle className="h-5 w-5" />} onClick={tryDemo}>
                Try live demo
              </Button>
            </div>
            <p className="mt-4 text-sm text-slate-500">Free up to 20 beds · No credit card · Set up in 10 minutes</p>
          </div>

          {/* Product preview */}
          <div className="relative">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-brand-900/10 sm:p-5">
              <div className="mb-4 flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="ml-3 truncate text-xs text-slate-400">app.hostelhub.in/dashboard</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { l: 'Occupancy', v: '92%', s: '138 / 150 beds', c: 'text-brand-600' },
                  { l: 'Collected', v: formatMoney(412500), s: 'this month', c: 'text-emerald-600' },
                  { l: 'Dues', v: formatMoney(38200), s: '14 hostelers', c: 'text-amber-600' },
                  { l: 'Complaints', v: '3', s: 'open', c: 'text-red-600' },
                ].map((s) => (
                  <div key={s.l} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{s.l}</p>
                    <p className={cn('mt-1 text-xl font-bold', s.c)}>{s.v}</p>
                    <p className="text-[11px] text-slate-400">{s.s}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-slate-100 p-3">
                <p className="mb-3 text-xs font-medium text-slate-500">Collection vs expenses</p>
                <div className="flex h-24 items-end gap-2">
                  {[55, 62, 58, 70, 74, 88].map((h, i) => (
                    <div key={i} className="flex h-full flex-1 items-end gap-0.5">
                      <div className="flex-1 rounded-t bg-brand-500" style={{ height: `${h}%` }} />
                      <div className="flex-1 rounded-t bg-slate-300" style={{ height: `${h * 0.55}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-3 hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg sm:block">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {formatMoney(8500)} received from Aarav via UPI
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 text-center sm:px-6 md:grid-cols-4">
          {[
            ['11+', 'modules in one app'],
            ['2 min', 'to check in a resident'],
            ['0', 'registers to maintain'],
            ['₹0', 'to start, up to 20 beds'],
          ].map(([v, l]) => (
            <div key={l}>
              <p className="text-3xl font-extrabold text-slate-900">{v}</p>
              <p className="mt-1 text-sm text-slate-500">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Everything you need</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">One app for the whole hostel</h2>
            <p className="mt-4 text-slate-600">From the day a resident books a bed to the day they collect their deposit back.</p>
          </div>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-brand-200 hover:shadow-md">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{f.icon}</div>
                <h3 className="mt-4 font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Portal callout */}
      <section className="bg-slate-900">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-300">Hosteler portal</p>
            <h2 className="mt-2 text-3xl font-bold text-white">Your residents get their own app</h2>
            <p className="mt-4 text-slate-300">
              Fewer calls to the warden. Residents log in with their own Hosteler ID and password to see their dues and receipts,
              this week's mess menu, notices, and to raise complaints or apply for leave.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-200">
              {['Dues and receipt history', 'Skip a meal to save food', 'Track complaint status', 'Leave requests with approval'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400" /> {t}
                </li>
              ))}
            </ul>
            <Link to="/portal/login" className="mt-8 inline-block">
              <Button variant="secondary" icon={<LogIn className="h-4 w-4" />}>
                Hosteler login
              </Button>
            </Link>
          </div>
          <div className="mx-auto w-64 rounded-[2rem] border-8 border-slate-700 bg-white p-4 shadow-2xl">
            <p className="text-xs text-slate-500">Hi Aarav</p>
            <p className="text-lg font-bold text-slate-900">Room 101 · Bed A</p>
            <div className="mt-3 rounded-xl bg-brand-600 p-3 text-white">
              <p className="text-xs opacity-80">Due this month</p>
              <p className="text-2xl font-bold">{formatMoney(8500)}</p>
              <p className="text-[11px] opacity-80">Due on 05 Nov</p>
            </div>
            <div className="mt-3 space-y-2">
              {['Tonight: Paneer, Roti, Rice', 'Notice: Water tank cleaning', 'Leave approved · 12–14 Nov'].map((t) => (
                <div key={t} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{t}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Pricing</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Simple, per-bed pricing</h2>
            <p className="mt-4 text-slate-600">Free up to 20 beds. Pay only for the beds you run, billed monthly.</p>
          </div>
          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {PLANS.map((p) => {
              const featured = p.id === 'basic'
              return (
                <div
                  key={p.id}
                  className={cn(
                    'relative flex flex-col rounded-2xl border bg-white p-7',
                    featured ? 'border-brand-600 shadow-xl shadow-brand-900/10 ring-1 ring-brand-600' : 'border-slate-200',
                  )}
                >
                  {featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-slate-900">{p.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{p.tagline}</p>
                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold text-slate-900">{formatMoney(p.pricePerBed)}</span>
                    <span className="text-sm text-slate-500">/ bed / month</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {p.maxBeds ? `Up to ${p.maxBeds} beds` : 'Unlimited beds'}
                    {p.pricePerBed > 0 && ` · e.g. 50 beds = ${formatMoney(p.pricePerBed * 50)}/mo`}
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Link to="/signup" className="mt-7">
                    <Button variant={featured ? 'primary' : 'outline'} className="w-full">
                      {p.pricePerBed === 0 ? 'Start free' : `Choose ${p.name}`}
                    </Button>
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Frequently asked questions</h2>
          <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {FAQS.map((f, i) => (
              <div key={f.q}>
                <button
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                >
                  <span className="font-medium text-slate-900">{f.q}</span>
                  <ChevronDown className={cn('h-5 w-5 shrink-0 text-slate-400 transition', openFaq === i && 'rotate-180')} />
                </button>
                {openFaq === i && <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-14 text-center sm:px-12">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to ditch the register?</h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-100">
              Create your workspace in a minute, or explore a fully loaded demo hostel first.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signup">
                <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                  Create free account
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10" onClick={tryDemo}>
                Try live demo
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                <BedDouble className="h-4 w-4" />
              </div>
              <span className="font-bold text-slate-900">HostelHub</span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-slate-500">Hostel & PG management software for owners, wardens and residents.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-500">
              <li><a href="#features" className="hover:text-slate-900">Features</a></li>
              <li><a href="#pricing" className="hover:text-slate-900">Pricing</a></li>
              <li><a href="#faq" className="hover:text-slate-900">FAQ</a></li>
              <li><button onClick={tryDemo} className="hover:text-slate-900">Live demo</button></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Account</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-500">
              <li><Link to="/login" className="hover:text-slate-900">Owner login</Link></li>
              <li><Link to="/signup" className="hover:text-slate-900">Sign up</Link></li>
              <li><Link to="/portal/login" className="hover:text-slate-900">Hosteler login</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100 py-5 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} HostelHub. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
