import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Sparkles } from 'lucide-react'
import { usePlanLimit, type PlanLimit } from '@/api/plan'
import { useStaffSession } from '@/api/session'
import { planInfo, planWithModule, type ModuleKey } from '@/lib/plans'
import { cn } from '@/lib/utils'

/** Small "upgrade" notes for the owner app. The API enforces the same rules (402) — these only explain them. */

const LIMIT_WORD: Record<PlanLimit, [string, string]> = { beds: ['bed', 'beds'], hostels: ['hostel', 'hostels'], staffLogins: ['staff login', 'staff logins'] }

/** "Your Free plan allows 1 hostel. Upgrade to Pro to add more." — only when the limit is reached. */
export function LimitNote({ limit, className }: { limit: PlanLimit; className?: string }) {
  const l = usePlanLimit(limit)
  if (!l.reached) return null
  const [one, many] = LIMIT_WORD[limit]
  const planName = planInfo(l.plan).name
  return (
    <UpgradeNote className={className} target={l.nextPlan.name}>
      {l.max === 0 ? `The ${planName} plan doesn't include ${many}.` : `Your ${planName} plan allows ${l.max} ${l.max === 1 ? one : many}.`} Upgrade to{' '}
      {l.nextPlan.name} to add {l.max === 0 ? 'them' : 'more'}.
    </UpgradeNote>
  )
}

/** "Data export is part of the Business plan." */
export function ModuleNote({ module, what, className }: { module: ModuleKey; what: string; className?: string }) {
  const target = planWithModule(module).name
  return (
    <UpgradeNote className={className} target={target}>
      {what} is part of the {target} plan{target === 'Business' ? '' : ' and up'}.
    </UpgradeNote>
  )
}

export function UpgradeNote({ children, target, className }: { children: ReactNode; target?: string; className?: string }) {
  const owner = useStaffSession()?.user.role === 'owner'
  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center', className)}>
      <Lock className="hidden h-4 w-4 shrink-0 sm:block" />
      <p className="flex-1">{children}</p>
      {owner ? (
        <Link to="/app/settings?tab=billing" className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-brand-700 hover:underline">
          <Sparkles className="h-4 w-4" /> {target ? `Upgrade to ${target}` : 'See plans'}
        </Link>
      ) : (
        <span className="shrink-0 text-xs text-amber-800">Ask the owner to upgrade.</span>
      )}
    </div>
  )
}
