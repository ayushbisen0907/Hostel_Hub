import type { Organization, OrgDetails, Plan } from '@/api/types'
import { PLANS as PRICED, type Plan as PricedPlan } from '@/lib/pricing'

/**
 * What each plan unlocks — mirrors backend/src/lib/plans.ts (the API enforces it).
 * Names, prices and feature lists come from lib/pricing.ts (the landing page).
 */
export type ModuleKey =
  | 'rooms'
  | 'hostelers'
  | 'checkin'
  | 'fees'
  | 'portal'
  | 'electricity'
  | 'mess'
  | 'documents'
  | 'complaints'
  | 'notices'
  | 'rules'
  | 'attendance'
  | 'visitors'
  | 'staff'
  | 'reports'
  | 'expenses'
  | 'export'
  | 'whatsapp'

export interface PlanInfo extends PricedPlan {
  id: Plan
  /** staff logins besides the owner; null = unlimited */
  staffLogins: number | null
  modules: ModuleKey[]
}

const FREE: ModuleKey[] = ['rooms', 'hostelers', 'checkin', 'fees', 'portal']
const STARTER: ModuleKey[] = [...FREE, 'electricity', 'mess', 'documents', 'complaints', 'notices', 'rules', 'whatsapp']
const PRO: ModuleKey[] = [...STARTER, 'attendance', 'visitors', 'staff', 'reports', 'expenses']
const BUSINESS: ModuleKey[] = [...PRO, 'export']

const EXTRA: Record<Plan, { staffLogins: number | null; modules: ModuleKey[] }> = {
  free: { staffLogins: 0, modules: FREE },
  starter: { staffLogins: 0, modules: STARTER },
  pro: { staffLogins: 3, modules: PRO },
  business: { staffLogins: null, modules: BUSINESS },
}

export const PLANS: PlanInfo[] = PRICED.map((p) => ({ ...p, ...EXTRA[p.id] }))

export function planInfo(plan: Plan | undefined): PlanInfo {
  return PLANS.find((p) => p.id === plan) ?? PLANS[0]!
}

export function hasModule(plan: Plan | undefined, m: ModuleKey): boolean {
  return planInfo(plan ?? 'free').modules.includes(m)
}

/** The cheapest plan that includes a module. */
export function planWithModule(m: ModuleKey): PlanInfo {
  return PLANS.find((p) => p.modules.includes(m)) ?? PLANS[PLANS.length - 1]!
}

type PlanSource = Pick<Organization, 'plan' | 'planExpiresAt'> & { limits?: OrgDetails['limits'] }

/**
 * The plan that works right now: the API's `limits.plan` when we have it, otherwise
 * worked out from the bought plan (a monthly/yearly plan past its expiry works like Free).
 */
export function effectivePlan(org: PlanSource | null | undefined): Plan {
  if (!org) return 'free'
  if (org.limits) return org.limits.plan
  if (org.plan !== 'free' && org.planExpiresAt && new Date(org.planExpiresAt).getTime() <= Date.now()) return 'free'
  return PLANS.some((p) => p.id === org.plan) ? org.plan : 'free'
}
