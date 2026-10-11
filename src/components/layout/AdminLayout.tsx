import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BedDouble,
  Bell,
  Building2,
  ClipboardCheck,
  DoorOpen,
  FileText,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareWarning,
  Receipt,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react'
import { useStore } from '@/store'
import { Avatar, Badge, Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { hasModule, planInfo, type ModuleKey } from '@/lib/plans'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  module?: ModuleKey
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Overview',
    items: [{ to: '/app/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> }],
  },
  {
    section: 'Residents',
    items: [
      { to: '/app/rooms', label: 'Rooms & Beds', icon: <BedDouble className="h-4 w-4" />, module: 'rooms' },
      { to: '/app/hostelers', label: 'Hostelers', icon: <Users className="h-4 w-4" />, module: 'hostelers' },
      { to: '/app/check-in', label: 'Check-in', icon: <LogIn className="h-4 w-4" />, module: 'checkin' },
      { to: '/app/check-out', label: 'Check-out', icon: <DoorOpen className="h-4 w-4" />, module: 'checkin' },
      { to: '/app/gate-log', label: 'Gate Log', icon: <ShieldCheck className="h-4 w-4" />, module: 'checkin' },
      { to: '/app/documents', label: 'Documents', icon: <FileText className="h-4 w-4" />, module: 'documents' },
    ],
  },
  {
    section: 'Money',
    items: [
      { to: '/app/fees', label: 'Fees & Payments', icon: <Wallet className="h-4 w-4" />, module: 'fees' },
      { to: '/app/expenses', label: 'Expenses', icon: <Receipt className="h-4 w-4" />, module: 'expenses' },
    ],
  },
  {
    section: 'Operations',
    items: [
      { to: '/app/mess', label: 'Mess', icon: <UtensilsCrossed className="h-4 w-4" />, module: 'mess' },
      { to: '/app/attendance', label: 'Attendance & Leave', icon: <ClipboardCheck className="h-4 w-4" />, module: 'attendance' },
      { to: '/app/complaints', label: 'Complaints', icon: <MessageSquareWarning className="h-4 w-4" />, module: 'complaints' },
      { to: '/app/visitors', label: 'Visitors', icon: <UserCog className="h-4 w-4" />, module: 'visitors' },
      { to: '/app/notices', label: 'Notices', icon: <Megaphone className="h-4 w-4" />, module: 'notices' },
      { to: '/app/staff', label: 'Staff', icon: <Building2 className="h-4 w-4" />, module: 'staff' },
    ],
  },
  {
    section: 'Business',
    items: [
      { to: '/app/reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, module: 'reports' },
      { to: '/app/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
    ],
  },
]

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const plan = useStore((s) => s.org?.plan)
  const openComplaints = useStore((s) => s.complaints.filter((c) => c.status !== 'resolved').length)
  const pendingLeaves = useStore((s) => s.leaves.filter((l) => l.status === 'pending').length)
  const badges: Record<string, number> = { '/app/complaints': openComplaints, '/app/attendance': pendingLeaves }

  return (
    <nav className="flex h-full flex-col">
      <Link to="/app/dashboard" onClick={onNavigate} className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
          <BedDouble className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-slate-900">HostelHub</span>
      </Link>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.section}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const locked = item.module ? !hasModule(plan, item.module) : false
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )
                    }
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {locked ? (
                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                    ) : badges[item.to] ? (
                      <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {badges[item.to]}
                      </span>
                    ) : null}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 p-4">
        <Link to="/app/settings?tab=billing" onClick={onNavigate} className="block rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 p-3 text-white">
          <p className="text-xs opacity-80">Current plan</p>
          <p className="font-semibold">{planInfo(plan ?? 'free').name}</p>
          {plan !== 'pro' && <p className="mt-1 text-xs underline opacity-90">Upgrade →</p>}
        </Link>
      </div>
    </nav>
  )
}

export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const org = useStore((s) => s.org)
  const hostels = useStore((s) => s.hostels)
  const current = useStore((s) => s.currentHostelId)
  const setCurrent = useStore((s) => s.setCurrentHostel)
  const logout = useStore((s) => s.logout)
  const pendingLeaves = useStore((s) => s.leaves.filter((l) => l.status === 'pending').length)
  const openComplaints = useStore((s) => s.complaints.filter((c) => c.status === 'open').length)
  const navigate = useNavigate()
  const location = useLocation()
  const [userMenu, setUserMenu] = useState(false)

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button className="absolute right-3 top-4 p-1 text-slate-500" onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="w-44 sm:w-64">
            <Select
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              options={[{ value: 'all', label: 'All hostels' }, ...hostels.map((h) => ({ value: h.id, label: h.name }))]}
            />
          </div>
          <div className="flex-1" />
          <button
            className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            title="Pending items"
            onClick={() => navigate(pendingLeaves ? '/app/attendance?tab=leaves' : '/app/complaints')}
          >
            <Bell className="h-5 w-5" />
            {pendingLeaves + openComplaints > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
            )}
          </button>
          <div className="relative">
            <button className="flex items-center gap-2 rounded-lg p-1 hover:bg-slate-100" onClick={() => setUserMenu((v) => !v)}>
              <Avatar name={org?.ownerName ?? 'Owner'} size="sm" />
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-tight text-slate-800">{org?.ownerName}</p>
                <p className="text-xs leading-tight text-slate-500">{org?.name}</p>
              </div>
            </button>
            {userMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="text-sm font-medium">{org?.ownerName}</p>
                    <p className="truncate text-xs text-slate-500">{org?.email}</p>
                    <Badge tone="blue" className="mt-1">
                      {planInfo(org?.plan ?? 'free').name} plan
                    </Badge>
                  </div>
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setUserMenu(false)
                      navigate('/app/settings')
                    }}
                  >
                    <Settings className="h-4 w-4" /> Settings
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    onClick={() => {
                      logout()
                      navigate('/login')
                    }}
                  >
                    <LogOut className="h-4 w-4" /> Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>
        <main key={location.pathname} className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
