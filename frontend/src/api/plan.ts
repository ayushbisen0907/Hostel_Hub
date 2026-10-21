/**
 * The organization's plan in the owner app: the plan that works now and its limits.
 * The API enforces the same rules (402) — these only drive what the UI shows.
 */
import { useOrg } from './common'
import { useStaffSession } from './session'
import type { Plan } from './types'
import { effectivePlan, hasModule, planInfo, PLANS, type ModuleKey, type PlanInfo } from '@/lib/plans'

/** The plan that works right now (Free once a monthly/yearly plan has run out). */
export function useEffectivePlan(): Plan {
  const org = useOrg().data
  const staff = useStaffSession()
  return effectivePlan(org ?? staff?.organization)
}

export function useHasModule(m: ModuleKey): boolean {
  return hasModule(useEffectivePlan(), m)
}

export type PlanLimit = 'beds' | 'hostels' | 'staffLogins'

const limitOf = (p: PlanInfo, limit: PlanLimit) => (limit === 'staffLogins' ? p.staffLogins : p[limit])

/** Usage against one plan limit; `reached` = adding one more is blocked. */
export function usePlanLimit(limit: PlanLimit) {
  const org = useOrg().data
  const plan = useEffectivePlan()
  const used = org?.usage[limit] ?? 0
  const max = org ? org.limits[limit] : limitOf(planInfo(plan), limit)
  const nextPlan = PLANS.find((p) => {
    const m = limitOf(p, limit)
    return m === null || m > used
  })
  return { used, max, plan, reached: !!org && max !== null && used >= max, nextPlan: nextPlan ?? PLANS[PLANS.length - 1]! }
}

/** HostelHub's own contact for buying or renewing a plan (set at build time). */
export const SUPPORT = {
  whatsapp: (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined)?.replace(/\D/g, '') || '',
  email: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || '',
}
