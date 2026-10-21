import { useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
} from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BedDouble,
  Check,
  ChevronDown,
  ClipboardCheck,
  DoorOpen,
  FileSignature,
  FileText,
  Menu,
  Moon,
  MessageSquareWarning,
  Minus,
  Plus,
  QrCode,
  Sparkles,
  Sun,
  UserCog,
  UtensilsCrossed,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  LIFETIME_SPOTS,
  PRICING,
  TRIAL_DAYS,
  planTotal,
  type BillingPeriod,
} from "@/lib/pricing";
import { cn, formatMoney } from "@/lib/utils";
import { CtaLink } from "./CtaLink";
import { ElectricityDemo, PaymentDemo, PhoneDemo } from "./Demos";
import { HeroDemo } from "./HeroDemo";
import {
  EASE,
  fadeUp,
  listVariants,
  useLandingTheme,
  useSmoothScroll,
} from "./anim";
import { CountUp, Reveal } from "./motion";
import { ScrollStory } from "./ScrollStory";

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <BedDouble className="h-5 w-5" />,
    title: "Rooms & beds",
    text: "Every floor, room and bed on one screen. See vacant beds and allot in one tap.",
  },
  {
    icon: <DoorOpen className="h-5 w-5" />,
    title: "Check-in / check-out",
    text: "Deposit, Hosteler ID and login in a minute. Check-out only after dues are clear.",
  },
  {
    icon: <Wallet className="h-5 w-5" />,
    title: "Rent on autopilot",
    text: "Bills are made from each hosteler’s check-in date and sent with the due date.",
  },
  {
    icon: <QrCode className="h-5 w-5" />,
    title: "UPI straight to you",
    text: "Hostelers pay to your own UPI ID and send the UTR. You verify. No commission.",
  },
  {
    icon: <Zap className="h-5 w-5" />,
    title: "Electricity split",
    text: "Enter the meter reading; the bill is split by the days each hosteler stayed.",
  },
  {
    icon: <UtensilsCrossed className="h-5 w-5" />,
    title: "Mess",
    text: "Weekly menu, mess on/off per hosteler and mess fees added to the bill.",
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: "Documents",
    text: "Aadhaar, college ID and police verification stored with each hosteler.",
  },
  {
    icon: <ClipboardCheck className="h-5 w-5" />,
    title: "Attendance & leave",
    text: "Night roll-call in seconds and leave requests from the hosteler’s phone.",
  },
  {
    icon: <MessageSquareWarning className="h-5 w-5" />,
    title: "Complaints",
    text: "Hostelers raise issues, staff fix them, everyone sees the status.",
  },
  {
    icon: <UserCog className="h-5 w-5" />,
    title: "Visitors & staff",
    text: "Gate log for visitors, and logins for your manager, warden and accountant.",
  },
  {
    icon: <FileSignature className="h-5 w-5" />,
    title: "Rules & move-out",
    text: "Hostelers sign your rules on first login and give notice before moving out.",
  },
  {
    icon: <BarChart3 className="h-5 w-5" />,
    title: "Reports",
    text: "Collections, dues, expenses and occupancy for every hostel you run.",
  },
];

const BEFORE = [
  "Rent written in a register, dues remembered by heart",
  "Chasing every hosteler on WhatsApp for payment",
  "Splitting the electricity bill on a calculator",
  "Photocopies of ID proofs lost in a drawer",
  "Walking the floor to find a free bed",
];

const AFTER = [
  "Every bill made on time, automatically",
  "Hostelers pay by UPI and report it in the app",
  "Electricity split by stay days in one click",
  "All documents safe with each hosteler",
  "Live view of every room and bed",
];

const KINDS = [
  "Boys hostels",
  "Girls hostels",
  "PGs",
  "Co-living",
  "Student housing",
  "Working professionals",
  "Multi-property owners",
];

const FAQS: { q: string; a: string }[] = [
  {
    q: `What do I get in the ${TRIAL_DAYS}-day free trial?`,
    a: `Everything. All features are open for ${TRIAL_DAYS} days and no card is needed to start. Pick a plan when you are ready.`,
  },
  {
    q: "What happens when the trial or my plan ends?",
    a: "Your data stays safe. You can still see everything, but you cannot add new entries until you choose a plan.",
  },
  {
    q: "How is the price counted?",
    a: "Only by the number of beds you create. ₹30 per bed per month — the same price for a 10-bed PG or a 300-bed hostel. Every plan has every feature.",
  },
  {
    q: "Do you take a cut from the rent I collect?",
    a: "No. Hostelers pay directly to your own UPI ID. HostelHub only records the payment after you verify it.",
  },
  {
    q: "How do my hostelers log in?",
    a: "At check-in each hosteler gets a Hosteler ID and a temporary password. On first login they set their own password and see only their own bills, mess and notices.",
  },
  {
    q: "What is the Lifetime plan?",
    a: `Pay once per bed and use HostelHub for as long as it runs, with no monthly bill. It is only open to the first ${LIFETIME_SPOTS} hostels.`,
  },
  {
    q: "I run more than one hostel. Does that work?",
    a: "Yes. Add all your hostels to one account and switch between them from the top bar.",
  },
];

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export default function Landing() {
  useSmoothScroll();
  const theme = useLandingTheme();

  return (
    <MotionConfig reducedMotion="user">
      {/* dark: styles apply inside a .dark ancestor, so the class goes on a wrapper */}
      <div
        className={cn(theme.dark && "dark")}
        style={{ colorScheme: theme.dark ? "dark" : "light" }}
      >
        <div className="min-h-screen overflow-x-clip bg-white text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-white">
          <Header dark={theme.dark} onToggleTheme={theme.toggle} />
          <Hero />
          <Marquee />
          <BeforeAfter />
          <Features />
          <Showcase />
          <section
            id="how"
            className="scroll-mt-20 bg-slate-50 dark:bg-slate-800/50"
          >
            <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
              <SectionHead
                eyebrow="How it works"
                title="From register to running, in 5 steps"
                text="Scroll to watch HostelHub do the work."
              />
              <ScrollStory />
            </div>
          </section>
          <Pricing />
          <Faq />
          <Cta />
          <Footer />
        </div>
      </div>
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ */

function Header({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 12));

  return (
    <>
      <motion.div
        className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-brand-600"
        style={{ scaleX: progress }}
      />
      <header
        className={cn(
          "sticky top-0 z-40 transition-all duration-300",
          scrolled || menuOpen
            ? "border-b border-slate-200/70 dark:border-slate-800/70 bg-white/85 dark:bg-slate-950/80 shadow-sm backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
            <Link
              to="/portal/login"
              className="px-3 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              Hosteler login
            </Link>
            <CtaLink to="/login" variant="outline" size="sm">
              Owner login
            </CtaLink>
            <CtaLink to="/signup" size="sm">
              Start free trial
            </CtaLink>
          </div>
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
            <button
              className="rounded-lg p-2 text-slate-600 dark:text-slate-300"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="overflow-hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 md:hidden"
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <div className="px-4 pb-4">
                {NAV.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="block py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                  >
                    {l.label}
                  </a>
                ))}
                <Link
                  to="/portal/login"
                  className="block py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                  Hosteler login
                </Link>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <CtaLink to="/login" variant="outline" className="w-full">
                    Owner login
                  </CtaLink>
                  <CtaLink to="/signup" className="w-full">
                    Free trial
                  </CtaLink>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}

function Hero() {
  const line = (text: ReactNode, delay: number, className?: string) => (
    <span className="block overflow-hidden pb-1">
      <motion.span
        className={cn("block", className)}
        initial={{ y: "110%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay }}
      >
        {text}
      </motion.span>
    </span>
  );
  const fade = (delay: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, ease: EASE, delay },
  });

  return (
    <section className="relative -mt-16 overflow-hidden pt-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div
          className="absolute -top-32 right-[-8%] h-[460px] w-[460px] rounded-full bg-brand-200/60 dark:bg-brand-600/25 blur-3xl"
          animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute left-[-10%] top-40 h-[360px] w-[360px] rounded-full bg-emerald-100/70 dark:bg-emerald-500/10 blur-3xl"
          animate={{ x: [0, -30, 0], y: [0, 40, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,theme(colors.slate.100)_1px,transparent_1px),linear-gradient(to_bottom,theme(colors.slate.100)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)] dark:bg-[linear-gradient(to_right,theme(colors.slate.800)_1px,transparent_1px),linear-gradient(to_bottom,theme(colors.slate.800)_1px,transparent_1px)]" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:pb-28 lg:pt-20">
        <div>
          <motion.span
            {...fade(0)}
            className="inline-flex items-center gap-2 rounded-full border border-brand-200 dark:border-brand-500/40 bg-white/70 dark:bg-slate-900/60 px-3 py-1 text-xs font-semibold text-brand-700 dark:text-brand-300 backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5" /> Made for hostels & PGs in India
          </motion.span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            {line("Run your hostel", 0.1)}
            {line("from your phone.", 0.22)}
            {line(
              "Not a register.",
              0.34,
              "bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent",
            )}
          </h1>
          <motion.p
            {...fade(0.5)}
            className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-300"
          >
            Rooms, check-ins, rent, UPI payments, electricity, mess and
            documents — in one simple app. Your hostelers get their own login
            too.
          </motion.p>
          <motion.div
            {...fade(0.62)}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <CtaLink
              to="/signup"
              size="lg"
              className="group w-full shadow-lg shadow-brand-300/50 dark:shadow-black/40 sm:w-auto"
            >
              Start {TRIAL_DAYS}-day free trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </CtaLink>
            <CtaLink
              href="#how"
              size="lg"
              variant="outline"
              className="w-full sm:w-auto"
            >
              See how it works
            </CtaLink>
          </motion.div>
          <motion.ul
            {...fade(0.74)}
            className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600 dark:text-slate-300"
          >
            {[
              "No card needed",
              "₹1 per bed a day",
              "All features included",
            ].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />{" "}
                {t}
              </li>
            ))}
          </motion.ul>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 40, rotate: 1.5 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.3 }}
        >
          <HeroDemo />
        </motion.div>
      </div>
    </section>
  );
}

function Marquee() {
  const items = [...KINDS, ...KINDS];
  return (
    <div className="border-y border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 py-5">
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div className="animate-marquee flex w-max gap-10">
          {items.map((k, i) => (
            <span
              key={i}
              className="flex items-center gap-3 whitespace-nowrap text-sm font-semibold text-slate-400"
            >
              <BedDouble className="h-4 w-4 text-brand-300" /> {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BeforeAfter() {
  return (
    <section className="bg-slate-50 dark:bg-slate-800/50">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <SectionHead
          eyebrow="Why HostelHub"
          title="Register, Excel aur WhatsApp ka jhanjhat khatam"
        />
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Today
              </p>
              <motion.ul
                className="mt-4 space-y-3"
                variants={listVariants}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.3 }}
              >
                {BEFORE.map((t) => (
                  <motion.li
                    key={t}
                    variants={fadeUp}
                    className="flex gap-3 text-slate-500 dark:text-slate-400 line-through decoration-red-300/70"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/15 text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </span>
                    {t}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="h-full rounded-2xl border border-brand-200 dark:border-brand-500/40 bg-white dark:bg-slate-900 p-6 shadow-xl shadow-brand-100/70 dark:shadow-black/40">
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                With HostelHub
              </p>
              <motion.ul
                className="mt-4 space-y-3"
                variants={listVariants}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.3 }}
              >
                {AFTER.map((t) => (
                  <motion.li
                    key={t}
                    variants={fadeUp}
                    className="flex gap-3 text-slate-800 dark:text-slate-100"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {t}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const track = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
  };
  return (
    <section id="features" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <SectionHead
          eyebrow="Features"
          title="Everything your hostel needs"
          text="One app for the owner, the staff and every hosteler."
        />
        <motion.div
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          variants={listVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              onMouseMove={track}
              className="spotlight-card group rounded-2xl border border-slate-200 dark:border-slate-800 p-5 transition-[border-color,box-shadow] hover:border-brand-200 dark:hover:border-brand-500/50 hover:shadow-lg hover:shadow-brand-100/60 dark:hover:shadow-black/40"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 group-hover:bg-brand-600 group-hover:text-white">
                {f.icon}
              </div>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {f.text}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Showcase() {
  return (
    <section className="border-t border-slate-100 dark:border-slate-800">
      <div className="mx-auto max-w-6xl space-y-28 px-4 py-24 sm:px-6">
        <Spotlight
          eyebrow="Payments"
          title="Rent comes straight to your UPI"
          points={[
            "Your UPI ID and QR show on every hosteler’s bill",
            "They pay, enter the UTR and upload a screenshot",
            "You verify in one tap — full or part payment",
            "Whatever is left moves to next month’s bill",
          ]}
          visual={<PaymentDemo />}
        />
        <Spotlight
          reverse
          eyebrow="Electricity"
          title="Fair electricity bills, no calculator"
          points={[
            "Set your rate per unit once",
            "Enter the meter reading with its from–to dates",
            "The bill is split by the days each hosteler stayed",
            "It is added to their next bill automatically",
          ]}
          visual={<ElectricityDemo />}
        />
        <Spotlight
          eyebrow="Hosteler app"
          title="Your hostelers get their own login"
          points={[
            "Unique Hosteler ID at check-in, like SBH-0001",
            "See bills, pay by UPI and download receipts",
            "Mess menu, notices, complaints and leave",
            "Request move-out with your notice period",
          ]}
          visual={<PhoneDemo />}
        />
      </div>
    </section>
  );
}

function Spotlight({
  eyebrow,
  title,
  points,
  visual,
  reverse,
}: {
  eyebrow: string;
  title: string;
  points: string[];
  visual: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2">
      <Reveal className={cn(reverse && "lg:order-2")}>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
          {eyebrow}
        </p>
        <h3 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h3>
        <motion.ul
          className="mt-6 space-y-3"
          variants={listVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
        >
          {points.map((p) => (
            <motion.li
              key={p}
              variants={fadeUp}
              className="flex gap-3 text-slate-700 dark:text-slate-200"
            >
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" />
              {p}
            </motion.li>
          ))}
        </motion.ul>
      </Reveal>
      <Reveal
        delay={0.1}
        y={40}
        className={cn("min-w-0", reverse && "lg:order-1")}
      >
        {visual}
      </Reveal>
    </div>
  );
}

/* ---------------- Pricing ---------------- */

const MIN_BEDS = 1;
const MAX_BEDS = 1000;
const SLIDER_MAX = 300;

function Pricing() {
  const [beds, setBeds] = useState(50);
  const [selected, setSelected] = useState<BillingPeriod>("yearly");
  const set = (n: number) =>
    setBeds(Math.min(MAX_BEDS, Math.max(MIN_BEDS, Math.round(n) || MIN_BEDS)));
  const monthly = PRICING.find((p) => p.id === "monthly");
  const money = (n: number) => formatMoney(n);

  return (
    <section id="pricing" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <SectionHead
          eyebrow="Pricing"
          title="₹30 per bed. That's it."
          text="One simple price. Every feature. Pay only for the beds you have."
        />

        <Reveal className="mx-auto mt-10 max-w-xl">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="beds" className="font-semibold">
                How many beds?
              </label>
              <div className="flex items-center gap-1">
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => set(beds - 1)}
                  aria-label="Fewer beds"
                >
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
                  className="h-9 w-20 rounded-lg border border-slate-200 dark:border-slate-800 text-center font-semibold focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => set(beds + 1)}
                  aria-label="More beds"
                >
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
        </Reveal>

        <motion.div
          className="mt-12 grid gap-6 md:grid-cols-3"
          variants={listVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {PRICING.map((p) => {
            const active = selected === p.id;
            const total = planTotal(p, beds);
            return (
              <motion.div
                key={p.id}
                variants={fadeUp}
                whileHover={{ y: -6 }}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(p.id)}
                onKeyDown={(e) =>
                  (e.key === "Enter" || e.key === " ") && setSelected(p.id)
                }
                className={cn(
                  "relative flex cursor-pointer flex-col rounded-2xl border bg-white dark:bg-slate-900 p-6 transition-[border-color,box-shadow] duration-300",
                  active
                    ? "border-brand-500 shadow-2xl shadow-brand-200/70 dark:shadow-black/40 ring-2 ring-brand-500"
                    : "border-slate-200 dark:border-slate-800 hover:border-brand-200 dark:hover:border-brand-500/50 hover:shadow-lg",
                )}
              >
                {p.id === "yearly" && (
                  <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}
                {p.id === "lifetime" && (
                  <span className="absolute -top-3 left-6 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">
                    Limited
                  </span>
                )}
                <p className="text-lg font-semibold">{p.name}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {p.note}
                </p>
                <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-4xl font-extrabold tracking-tight">
                    {money(p.perBed)}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {p.unit}
                  </span>
                </p>
                <div className="mt-5 rounded-xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    For {beds} {beds === 1 ? "bed" : "beds"}
                  </p>
                  <p className="text-xl font-bold">
                    <CountUp value={total} format={money} duration={0.6} />{" "}
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {p.totalSuffix}
                    </span>
                  </p>
                  {p.id === "yearly" && monthly && (
                    <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      You save{" "}
                      <CountUp
                        value={planTotal(monthly, beds) * 12 - total}
                        format={money}
                        duration={0.6}
                      />{" "}
                      a year
                    </p>
                  )}
                </div>
                <CtaLink
                  to="/signup"
                  variant={active ? "primary" : "outline"}
                  className="mt-6 w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  Start free trial
                </CtaLink>
              </motion.div>
            );
          })}
        </motion.div>

        <Reveal className="mx-auto mt-10 max-w-3xl">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-6">
            <p className="text-center font-semibold">Every plan includes</p>
            <ul className="mt-4 grid gap-x-6 gap-y-2.5 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
              {[
                "Unlimited hostels and rooms",
                "Hosteler app with own login",
                "UPI payments with verification",
                "Auto rent bills from check-in date",
                "Electricity split by stay days",
                "Mess, attendance, complaints",
                "Staff logins with roles",
                "Reports and receipts",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />{" "}
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
              Start with a {TRIAL_DAYS}-day free trial — no card needed. Your
              data stays safe even if you stop.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-20 bg-slate-50 dark:bg-slate-800/50">
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <SectionHead eyebrow="FAQ" title="Questions owners ask" />
        <Reveal className="mt-10">
          <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {FAQS.map((f, i) => (
              <div key={f.q}>
                <button
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-expanded={open === i}
                >
                  <span className="font-medium">{f.q}</span>
                  <motion.span
                    animate={{ rotate: open === i ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open === i && (
                    <motion.div
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                    >
                      <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                        {f.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="px-4 py-24 sm:px-6">
      <Reveal className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-900 px-6 py-16 text-center sm:px-12">
          <motion.div
            aria-hidden
            className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-2xl"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <h2 className="relative text-3xl font-bold text-white sm:text-4xl">
            Close the register. Open HostelHub.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-brand-100">
            Set up your hostel today and try everything free for {TRIAL_DAYS}{" "}
            days.
          </p>
          <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <CtaLink
              to="/signup"
              size="lg"
              variant="white"
              className="group w-full sm:w-auto"
            >
              Start free trial
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </CtaLink>
            <CtaLink
              to="/portal/login"
              size="lg"
              variant="onBrand"
              className="w-full sm:w-auto"
            >
              Hosteler login
            </CtaLink>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            Hostel & PG management for owners, staff and hostelers.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">Product</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-500 dark:text-slate-400">
            {NAV.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="hover:text-slate-900 dark:hover:text-white"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">Account</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-500 dark:text-slate-400">
            <li>
              <Link
                to="/signup"
                className="hover:text-slate-900 dark:hover:text-white"
              >
                Start free trial
              </Link>
            </li>
            <li>
              <Link
                to="/login"
                className="hover:text-slate-900 dark:hover:text-white"
              >
                Owner login
              </Link>
            </li>
            <li>
              <Link
                to="/portal/login"
                className="hover:text-slate-900 dark:hover:text-white"
              >
                Hosteler login
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100 dark:border-slate-800 py-5 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} HostelHub. All rights reserved.
      </div>
    </footer>
  );
}

function ThemeToggle({
  dark,
  onToggle,
}: {
  dark: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? "moon" : "sun"}
          initial={{ y: 14, rotate: -90, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          exit={{ y: -14, rotate: 90, opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {dark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
        <BedDouble className="h-5 w-5" />
      </span>
      <span className="text-lg font-bold">HostelHub</span>
    </Link>
  );
}

function SectionHead({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {text && (
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
          {text}
        </p>
      )}
    </Reveal>
  );
}
