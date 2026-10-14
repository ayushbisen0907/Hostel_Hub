import { Link } from 'react-router-dom'
import { ChevronRight, ScrollText } from 'lucide-react'
import { usePortalRules } from '@/api/rules'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'

/** Profile: "Hostel rules — signed on …" with a link to read them. */
export function RulesCard() {
  const q = usePortalRules()
  const d = q.data
  if (q.isLoading || q.error || !d || d.rulesVersion === 0) return null
  return (
    <Link to="/portal/rules" className="block">
      <Card className="flex items-center gap-3 p-4 transition hover:bg-slate-50">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <ScrollText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">Hostel rules</p>
          <p className="truncate text-xs text-slate-500">
            {d.signed && d.signedAt ? `Signed on ${formatDate(d.signedAt)} · version ${d.rulesVersion}` : 'Not signed yet — tap to read and sign'}
          </p>
        </div>
        <span className="shrink-0 text-xs font-medium text-brand-600">View</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </Card>
    </Link>
  )
}
