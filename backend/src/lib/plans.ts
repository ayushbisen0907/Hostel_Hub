/**
 * SaaS plans — mirrors src/lib/plans.ts in the frontend.
 * The server enforces these so locked modules can't be used via the API.
 */
import type { NextFunction, Request, Response } from 'express'
import { Organization } from '../models/Organization.js'
import { AppError } from './errors.js'

export type Plan = 'free' | 'basic' | 'pro'
export type PlanModule =
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

const BASIC: PlanModule[] = ['rooms', 'hostelers', 'checkin', 'documents', 'fees', 'complaints', 'notices']

export const PLANS: Record<Plan, { name: string; pricePerBed: number; maxBeds: number | null; modules: PlanModule[] }> = {
  free: { name: 'Free', pricePerBed: 0, maxBeds: 20, modules: BASIC },
  basic: { name: 'Basic', pricePerBed: 29, maxBeds: 200, modules: [...BASIC, 'expenses', 'visitors', 'staff', 'portal'] },
  pro: {
    name: 'Pro',
    pricePerBed: 49,
    maxBeds: null,
    modules: [...BASIC, 'expenses', 'visitors', 'staff', 'portal', 'mess', 'attendance', 'reports'],
  },
}

export function hasModule(plan: Plan, m: PlanModule) {
  return PLANS[plan].modules.includes(m)
}

/** Route middleware: 402 if the organization's plan doesn't include the module. Use after requireStaff/requireHosteler. */
export function requirePlan(module: PlanModule) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const orgId = req.staff?.orgId ?? req.hosteler?.orgId
      const org = await Organization.findById(orgId).select('plan').lean()
      const plan = (org?.plan ?? 'free') as Plan
      if (!hasModule(plan, module))
        throw new AppError(402, `The ${PLANS[plan].name} plan doesn't include ${module}. Upgrade to use it.`, 'PLAN_UPGRADE_REQUIRED')
      next()
    } catch (e) {
      next(e)
    }
  }
}
