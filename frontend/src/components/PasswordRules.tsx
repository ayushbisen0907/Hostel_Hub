import { Check, Circle } from 'lucide-react'
import { checkPasswordStrength } from '@/lib/auth'
import { cn } from '@/lib/utils'

/** Live checklist of password rules shown under a "new password" field. */
export function PasswordRules({ password }: { password: string }) {
  const { rules } = checkPasswordStrength(password)
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {rules.map((r) => (
        <li key={r.label} className={cn('flex items-center gap-1.5 text-xs', r.ok ? 'text-emerald-600' : 'text-slate-500')}>
          {r.ok ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
          {r.label}
        </li>
      ))}
    </ul>
  )
}
