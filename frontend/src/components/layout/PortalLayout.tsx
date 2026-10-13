import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BedDouble, BellRing, CalendarDays, Home, Lock, LogOut, MessageSquareWarning, UserRound, UtensilsCrossed, Wallet } from 'lucide-react'
import { logout } from '@/api/auth'
import { NotificationBell } from '@/components/NotificationBell'
import { isPlanError, usePortalHome, usePortalMe, useProfilePhoto } from '@/api/portal'
import { useHostelerSession } from '@/api/session'
import { Avatar, Button, Card } from '@/components/ui'
import { cn } from '@/lib/utils'

export function PortalLayout() {
  const session = useHostelerSession()
  const me = session?.hosteler
  const hostel = session?.hostel
  const navigate = useNavigate()
  usePortalMe() // keeps the session's hosteler fresh
  const home = usePortalHome()
  const photo = useProfilePhoto(me)

  const features = home.data?.features
  const portalLocked = isPlanError(home.error)

  // hide plan-gated sections once we know they're unavailable
  const nav = [
    { to: '/portal', label: 'Home', icon: Home, end: true },
    { to: '/portal/fees', label: 'Fees', icon: Wallet },
    ...(features?.mess === false ? [] : [{ to: '/portal/mess', label: 'Mess', icon: UtensilsCrossed }]),
    { to: '/portal/complaints', label: 'Help', icon: MessageSquareWarning },
    features?.attendance === false
      ? { to: '/portal/leave', label: 'Notices', icon: BellRing }
      : { to: '/portal/leave', label: 'Leave', icon: CalendarDays },
    { to: '/portal/profile', label: 'Profile', icon: UserRound },
  ]

  const doLogout = () => {
    logout()
    navigate('/portal/login')
  }

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
          {!portalLocked && (
            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((n) => (
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
          )}
          <NotificationBell />
          {me && <Avatar name={me.name} src={photo} size="sm" />}
          <button title="Log out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={doLogout}>
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        {portalLocked ? (
          <Card className="mx-auto mt-10 max-w-md p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <Lock className="h-6 w-6" />
            </div>
            <p className="font-semibold text-slate-800">The resident portal isn't available for your hostel</p>
            <p className="mt-1 text-sm text-slate-500">
              {hostel?.name ?? 'Your hostel'} hasn't enabled the online portal. For fees, complaints or leave, please contact the hostel office
              {hostel?.phone ? ` (${hostel.phone})` : ''}.
            </p>
            <Button variant="outline" className="mt-5" onClick={doLogout} icon={<LogOut className="h-4 w-4" />}>
              Log out
            </Button>
          </Card>
        ) : (
          <Outlet />
        )}
      </main>
      {!portalLocked && (
        <nav
          className="no-print fixed inset-x-0 bottom-0 z-20 grid border-t border-slate-200 bg-white md:hidden"
          style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        >
          {nav.map((n) => (
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
      )}
    </div>
  )
}
