import type { Plan } from '@/types'

export interface PlanInfo {
  id: Plan
  name: string
  pricePerBed: number // ₹ / bed / month
  maxBeds: number | null
  tagline: string
  features: string[]
  /** Modules unlocked by this plan */
  modules: ModuleKey[]
}

export type ModuleKey =
  | 'rooms'
  | 'hostelers'
  | 'checkin'
  | 'documents'
  | 'fees'
  | 'expenses'
  | 'mess'
  | 'attendance'
  | 'complaints'
  | 'visitors'
  | 'notices'
  | 'staff'
  | 'reports'
  | 'portal'

const BASIC_MODULES: ModuleKey[] = ['rooms', 'hostelers', 'checkin', 'documents', 'fees', 'complaints', 'notices']

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    pricePerBed: 0,
    maxBeds: 20,
    tagline: 'For small PGs getting started',
    features: ['Up to 20 beds', 'Rooms & beds', 'Hosteler records', 'Check-in / check-out', 'Documents', 'Rent tracking'],
    modules: BASIC_MODULES,
  },
  {
    id: 'basic',
    name: 'Basic',
    pricePerBed: 29,
    maxBeds: 200,
    tagline: 'Everything to run one hostel',
    features: ['Up to 200 beds', 'Everything in Free', 'Expenses', 'Visitors log', 'Staff management', 'Hosteler portal'],
    modules: [...BASIC_MODULES, 'expenses', 'visitors', 'staff', 'portal'],
  },
  {
    id: 'pro',
    name: 'Pro',
    pricePerBed: 49,
    maxBeds: null,
    tagline: 'Multi-hostel operators',
    features: ['Unlimited beds & hostels', 'Everything in Basic', 'Mess management', 'Attendance & leave', 'Reports & analytics', 'Priority support'],
    modules: [...BASIC_MODULES, 'expenses', 'visitors', 'staff', 'portal', 'mess', 'attendance', 'reports'],
  },
]

export function planInfo(plan: Plan): PlanInfo {
  return PLANS.find((p) => p.id === plan) ?? PLANS[0]!
}

export function hasModule(plan: Plan | undefined, m: ModuleKey): boolean {
  return planInfo(plan ?? 'free').modules.includes(m)
}
