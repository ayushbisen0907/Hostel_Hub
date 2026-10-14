import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BedDouble,
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
import { useQuery } from '@tanstack/react-query'
import { NotificationBell } from '@/components/NotificationBell'
import { get } from '@/api/client'
import { usePendingClaimCount } from '@/api/claims'
import { logout } from '@/api/auth'
import { useHostels, useOrg, useScope, useScopeStore } from '@/api/common'
import { roleCan, useStaffSession, type StaffModule } from '@/api/session'
import type { ListResponse } from '@/api/types'
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

/** Counts for the sidebar badges & bell. Query keys share prefixes with the modules, so they refresh after changes. */
function usePendingCounts() {
  const staff = useStaffSession()
  const { data: org } = useOrg()
  const role = staff?.user.role
  const plan = org?.plan ?? staff?.organization.plan
  const complaints = useQuery({
    queryKey: ['complaints', 'stats'],
    queryFn: () => get<{ open: number; inProgress: number }>('/complaints/stats'),
    enabled: roleCan(role, 'complaints'),
    refetchInterval: 60_000,
  })
  const leaves = useQuery({
    queryKey: ['leaves', { status: 'pending' }],
    queryFn: () => get<ListResponse<unknown>>('/leaves', { status: 'pending' }),
    enabled: roleCan(role, 'attendance') && hasModule(plan, 'attendance'),
    refetchInterval: 60_000,
  })
  // UPI payments reported by hostelers, waiting for staff to verify (all hostels)
  const claims = usePendingClaimCount('all', { enabled: hasModule(plan, 'fees') })
  // move-out requests from the portal, waiting for approval (same key as the Check-out page's list)
  const moveOuts = useQuery({
    queryKey: ['move-out-requests', { status: 'pending' }],
    queryFn: () => get<ListResponse<unknown>>('/move-out-requests', { status: 'pending' }),
    enabled: roleCan(role, 'checkin') && hasModule(plan, 'checkin'),
    refetchInterval: 60_000,
  })
  const openComplaints = (complaints.data?.open ?? 0) + (complaints.data?.inProgress ?? 0)
  return {
    pendingMoveOuts: moveOuts.data?.items.length ?? 0,
    openComplaints,
    newComplaints: complaints.data?.open ?? 0,
    pendingLeaves: leaves.data?.items.length ?? 0,
    pendingPayments: claims.data ?? 0,
  }
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const staff = useStaffSession()
  const { data: org } = useOrg()
  const plan = org?.plan ?? staff?.organization.plan
  const role = staff?.user.role
  const { openComplaints, pendingLeaves, pendingPayments, pendingMoveOuts } = usePendingCounts()
  const badges: Record<string, number> = {
    '/app/complaints': openComplaints,
    '/app/attendance': pendingLeaves,
    '/app/fees': pendingPayments,
    '/app/check-out': pendingMoveOuts,
  }
  // modules the role can't use are hidden; plan-locked ones show a lock
  const visible = (item: NavItem) => !item.module || item.module === 'portal' || roleCan(role, item.module as StaffModule)

  return (
    <nav className="flex h-full flex-col">
      <Link to="/app/dashboard" onClick={onNavigate} className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
          <BedDouble className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-slate-900">HostelHub</span>
      </Link>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
        {NAV.map((group) => ({ ...group, items: group.items.filter(visible) }))
          .filter((group) => group.items.length > 0)
          .map((group) => (
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
      {role === 'owner' && <div className="border-t border-slate-200 p-4">
        <Link to="/app/settings?tab=billing" onClick={onNavigate} className="block rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 p-3 text-white">
          <p className="text-xs opacity-80">Current plan</p>
          <p className="font-semibold">{planInfo(plan ?? 'free').name}</p>
          {plan !== 'pro' && <p className="mt-1 text-xs underline opacity-90">Upgrade →</p>}
        </Link>
      </div>}
    </nav>
  )
}

export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const staff = useStaffSession()
  const { data: orgDetails } = useOrg()
  const org = orgDetails ?? staff?.organization
  const user = staff?.user
  const { data: hostels = [] } = useHostels()
  const current = useScope()
  const setCurrent = useScopeStore((s) => s.setHostelId)
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
          <NotificationBell />
          <div className="relative">
            <button className="flex items-center gap-2 rounded-lg p-1 hover:bg-slate-100" onClick={() => setUserMenu((v) => !v)}>
              <Avatar name={user?.name ?? 'User'} size="sm" />
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-tight text-slate-800">{user?.name}</p>
                <p className="text-xs leading-tight text-slate-500">{org?.name}</p>
              </div>
            </button>
            {userMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-2">
                    <p className="text-sm font-medium">{user?.name}</p>
                    <p className="truncate text-xs text-slate-500">{user?.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{user?.role ? user.role[0]!.toUpperCase() + user.role.slice(1) : ''}</Badge>
                      <Badge tone="blue">{planInfo(org?.plan ?? 'free').name} plan</Badge>
                    </div>
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
