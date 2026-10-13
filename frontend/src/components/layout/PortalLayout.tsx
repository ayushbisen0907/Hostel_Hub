import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BedDouble, CalendarDays, Home, LogOut, MessageSquareWarning, UserRound, UtensilsCrossed, Wallet } from 'lucide-react'
import { logout } from '@/api/auth'
import { useHostelerSession } from '@/api/session'
import { Avatar } from '@/components/ui'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/portal', label: 'Home', icon: Home, end: true },
  { to: '/portal/fees', label: 'Fees', icon: Wallet },
  { to: '/portal/mess', label: 'Mess', icon: UtensilsCrossed },
  { to: '/portal/complaints', label: 'Help', icon: MessageSquareWarning },
  { to: '/portal/leave', label: 'Leave', icon: CalendarDays },
  { to: '/portal/profile', label: 'Profile', icon: UserRound },
]

export function PortalLayout() {
  const session = useHostelerSession()
  const me = session?.hosteler
  const hostel = session?.hostel
  const navigate = useNavigate()

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <BedDouble className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight text-slate-900">{hostel?.name ?? 'HostelHub'}</p>
            <p className="text-xs leading-tight text-slate-500">Hosteler portal</p>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn('rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          {me && <Avatar name={me.name} size="sm" />}
          <button
            title="Log out"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            onClick={() => {
              logout()
              navigate('/portal/login')
            }}
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <Outlet />
      </main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-slate-200 bg-white md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-600' : 'text-slate-500')
            }
          >
            <n.icon className="h-5 w-5" />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
