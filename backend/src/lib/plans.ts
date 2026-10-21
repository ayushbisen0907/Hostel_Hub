/**
 * SaaS plans — mirrors src/lib/plans.ts in the frontend (and the landing page pricing).
 * The server enforces these so locked modules and limits can't be bypassed via the API.
 *
 *   Free      7 beds,   1 hostel,   no staff logins — the basics
 *   Starter   30 beds,  1 hostel,   no staff logins — + electricity, mess, documents, complaints, notices, rules & move-out, WhatsApp bills
 *   Pro       100 beds, 3 hostels,  3 staff logins  — + attendance, visitors & gate log, staff, reports, expenses
 *   Business  unlimited                             — + data export
 *
 * Paid plans are bought monthly, yearly or one time. A monthly/yearly plan whose
 * `planExpiresAt` has passed works like Free until it is renewed — nothing is deleted.
 */
import type { NextFunction, Request, Response } from 'express'
import type { ClientSession, Types } from 'mongoose'
import { Organization } from '../models/Organization.js'
import { AppError } from './errors.js'

export const PLAN_IDS = ['free', 'starter', 'pro', 'business'] as const
export type Plan = (typeof PLAN_IDS)[number]
export const BILLING_CYCLES = ['monthly', 'yearly', 'onetime'] as const
export type BillingCycle = (typeof BILLING_CYCLES)[number]

export type PlanModule =
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

export type PlanLimit = 'beds' | 'hostels' | 'staffLogins'

export interface PlanInfo {
  name: string
  /** null = unlimited */
  limits: Record<PlanLimit, number | null>
  modules: PlanModule[]
}

const FREE: PlanModule[] = ['rooms', 'hostelers', 'checkin', 'fees', 'portal']
const STARTER: PlanModule[] = [...FREE, 'electricity', 'mess', 'documents', 'complaints', 'notices', 'rules', 'whatsapp']
const PRO: PlanModule[] = [...STARTER, 'attendance', 'visitors', 'staff', 'reports', 'expenses']
const BUSINESS: PlanModule[] = [...PRO, 'export']

export const PLANS: Record<Plan, PlanInfo> = {
  free: { name: 'Free', limits: { beds: 7, hostels: 1, staffLogins: 0 }, modules: FREE },
  starter: { name: 'Starter', limits: { beds: 30, hostels: 1, staffLogins: 0 }, modules: STARTER },
  pro: { name: 'Pro', limits: { beds: 100, hostels: 3, staffLogins: 3 }, modules: PRO },
  business: { name: 'Business', limits: { beds: null, hostels: null, staffLogins: null }, modules: BUSINESS },
}

/** The cheapest plan that includes a module (for "Upgrade to …" messages). */
export function planWithModule(m: PlanModule): PlanInfo {
  return PLANS[PLAN_IDS.find((p) => PLANS[p].modules.includes(m)) ?? 'business']
}

export function hasModule(plan: Plan, m: PlanModule) {
  return PLANS[plan].modules.includes(m)
}

const MODULE_LABEL: Record<PlanModule, string> = {
  rooms: 'Rooms',
  hostelers: 'Hostelers',
  checkin: 'Check-in',
  fees: 'Fees',
  portal: 'The hosteler app',
  electricity: 'Electricity billing',
  mess: 'Mess',
  documents: 'Documents',
  complaints: 'Complaints',
  notices: 'Notices',
  rules: 'Hostel rules & move-out requests',
  attendance: 'Attendance & leave',
  visitors: 'Visitors & gate log',
  staff: 'Staff',
  reports: 'Reports',
  expenses: 'Expenses',
  export: 'Data export',
  whatsapp: 'WhatsApp bill messages',
}

const LIMIT_LABEL: Record<PlanLimit, string> = { beds: 'beds', hostels: 'hostels', staffLogins: 'staff logins' }

type OrgPlanFields = { plan?: string | null; planExpiresAt?: Date | null }

/** True when a monthly/yearly plan has run out (one-time and Free never expire). */
export function planExpired(org: OrgPlanFields, now = new Date()) {
  return !!org.planExpiresAt && org.planExpiresAt.getTime() <= now.getTime()
}

/** The plan the organization can use right now: its own plan, or Free once it has expired. */
export function effectivePlan(org: OrgPlanFields | null | undefined, now = new Date()): Plan {
  if (!org) return 'free'
  const plan = (PLAN_IDS as readonly string[]).includes(org.plan ?? '') ? (org.plan as Plan) : 'free'
  return plan !== 'free' && planExpired(org, now) ? 'free' : plan
}

export async function orgPlan(orgId: string | Types.ObjectId, session?: ClientSession): Promise<Plan> {
  const org = await Organization.findById(orgId).select('plan planExpiresAt').session(session ?? null).lean()
  return effectivePlan(org)
}

/** 402 PLAN_UPGRADE_REQUIRED when the plan doesn't include `module`. */
export function assertModule(plan: Plan, module: PlanModule) {
  if (hasModule(plan, module)) return
  const needed = planWithModule(module).name
  throw new AppError(402, `${MODULE_LABEL[module]} is not part of the ${PLANS[plan].name} plan. Upgrade to ${needed} to use it.`, 'PLAN_UPGRADE_REQUIRED', {
    plan,
    module,
    requiredPlan: needed,
  })
}

/** Route middleware: 402 if the organization's plan doesn't include the module. Use after requireStaff/requireHosteler. */
export function requirePlan(module: PlanModule) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const orgId = req.staff?.orgId ?? req.hosteler?.orgId
      assertModule(await orgPlan(orgId!), module)
      next()
    } catch (e) {
      next(e)
    }
  }
}

/** The smallest plan whose limit fits `needed`. */
function planFitting(limit: PlanLimit, needed: number): PlanInfo {
  const id = PLAN_IDS.find((p) => {
    const max = PLANS[p].limits[limit]
    return max === null || max >= needed
  })
  return PLANS[id ?? 'business']
}

/**
 * 402 PLAN_LIMIT if `current + adding` goes over the plan's limit.
 * `current` is counted by the caller (beds, hostels or active staff logins).
 */
export function assertLimit(plan: Plan, limit: PlanLimit, current: number, adding = 1) {
  const max = PLANS[plan].limits[limit]
  if (max === null || adding <= 0 || current + adding <= max) return
  const label = LIMIT_LABEL[limit]
  const next = planFitting(limit, current + adding)
  throw new AppError(
    402,
    max === 0
      ? `The ${PLANS[plan].name} plan doesn't include ${label}. Upgrade to ${next.name} to add them.`
      : `The ${PLANS[plan].name} plan allows up to ${max} ${label} and you have ${current}. Upgrade to ${next.name} to add more.`,
    'PLAN_LIMIT',
    { plan, limit, max, current, adding, requiredPlan: next.name },
  )
}

/** When a paid plan bought on `from` runs out (null = never). */
export function expiryFor(cycle: BillingCycle, from = new Date()): Date | null {
  if (cycle === 'onetime') return null
  const d = new Date(from)
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1)
  else d.setFullYear(d.getFullYear() + 1)
  return d
}

/** Before Starter/Business existed the plans were free/basic/pro: basic → starter. */
export async function migrateLegacyPlans() {
  const r = await Organization.collection.updateMany({ plan: 'basic' }, { $set: { plan: 'starter' } })
  if (r.modifiedCount) console.log(`🔁 ${r.modifiedCount} organization(s) moved from Basic to Starter`)
}
