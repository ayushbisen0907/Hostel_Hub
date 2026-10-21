/**
 * Public pricing — one simple price per bed.
 *  - Monthly:  ₹30 / bed / month
 *  - Yearly:   ₹300 / bed / year (2 months free)
 *  - Lifetime: ₹720 / bed, one time (first 100 hostels only)
 * Every plan includes every feature. New accounts get a free trial first.
 */
export type BillingPeriod = 'monthly' | 'yearly' | 'lifetime'

export const TRIAL_DAYS = 3
export const LIFETIME_SPOTS = 100

export interface PricingPlan {
  id: BillingPeriod
  name: string
  /** ₹ per bed for one billing period */
  perBed: number
  /** shown under the price, e.g. "per bed / month" */
  unit: string
  /** how the total is described, e.g. "/ month" */
  totalSuffix: string
  note: string
}

export const PRICING: PricingPlan[] = [
  { id: 'monthly', name: 'Monthly', perBed: 30, unit: 'per bed / month', totalSuffix: '/ month', note: 'Cancel any time' },
  { id: 'yearly', name: 'Yearly', perBed: 300, unit: 'per bed / year', totalSuffix: '/ year', note: '2 months free' },
  { id: 'lifetime', name: 'Lifetime', perBed: 720, unit: 'per bed, one time', totalSuffix: 'one time', note: `Only for the first ${LIFETIME_SPOTS} hostels` },
]

export function planTotal(plan: PricingPlan, beds: number): number {
  return plan.perBed * Math.max(0, Math.floor(beds))
}
