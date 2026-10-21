/**
 * Public plans (landing page).
 *  - Three ways to pay: monthly, yearly (2 months free) or one time (pay once, use for life).
 *  - The same three paid plans in each, sized by beds and hostels, plus a Free plan.
 *  - Every paid plan has a 15-day money-back guarantee.
 */
export type BillingCycle = 'monthly' | 'yearly' | 'onetime'
export type PlanId = 'free' | 'starter' | 'pro' | 'business'

export const MONEY_BACK_DAYS = 15
export const FREE_BEDS = 7

export interface Cycle {
  id: BillingCycle
  label: string
  badge?: string
  /** shown after the price */
  suffix: string
  note: string
}

export const CYCLES: Cycle[] = [
  { id: 'monthly', label: 'Monthly', suffix: '/month', note: 'Billed every month. Cancel any time.' },
  { id: 'yearly', label: 'Yearly', badge: '2 months free', suffix: '/year', note: 'Pay for 10 months, use for 12.' },
  { id: 'onetime', label: 'One-time', badge: 'Best value', suffix: 'one time', note: 'Pay once and use it for life — no renewals, all updates included.' },
]

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  /** most beds allowed; null = unlimited */
  beds: number | null
  /** most hostels allowed; null = unlimited */
  hostels: number | null
  price: Record<BillingCycle, number>
  /** first line of the feature list, e.g. "Everything in Free, plus" */
  includes: string
  features: string[]
  popular?: boolean
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For a small PG getting started',
    beds: FREE_BEDS,
    hostels: 1,
    price: { monthly: 0, yearly: 0, onetime: 0 },
    includes: 'The basics',
    features: ['Rooms & beds', 'Check-in / check-out', 'Hosteler ID & app login', 'Auto rent bills', 'UPI payments & receipts'],
  },
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For a single PG or small hostel',
    beds: 30,
    hostels: 1,
    price: { monthly: 499, yearly: 4990, onetime: 9999 },
    includes: 'Everything in Free, plus',
    features: ['Bills on WhatsApp with breakdown', 'Electricity bill split', 'Mess management', 'Documents', 'Complaints & notices', 'Rules signing & move-out'],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For a growing hostel with staff',
    beds: 100,
    hostels: 3,
    price: { monthly: 1199, yearly: 11990, onetime: 23999 },
    includes: 'Everything in Starter, plus',
    features: ['Attendance & leave', 'Visitors & gate log', '3 staff logins', 'Reports & expenses'],
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'For many hostels & PGs',
    beds: null,
    hostels: null,
    price: { monthly: 2499, yearly: 24990, onetime: 49999 },
    includes: 'Everything in Pro, plus',
    features: ['Unlimited staff logins', 'Priority WhatsApp support', 'Data export & backup', 'Help setting up'],
  },
]

/** The smallest plan that fits this many beds. */
export function planForBeds(beds: number): Plan {
  return PLANS.find((p) => p.beds === null || beds <= p.beds) ?? PLANS[PLANS.length - 1]
}
