import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/api/query'
import { useCan, useHostelerSession, useSession, useStaffSession, type StaffModule } from '@/api/session'
import { useOrg } from '@/api/common'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PortalLayout } from '@/components/layout/PortalLayout'
import { Button, Card, ConfirmHost, LoadingState, Toaster } from '@/components/ui'
import { effectivePlan, hasModule, planInfo, planWithModule, type ModuleKey } from '@/lib/plans'

import Login from '@/pages/auth/Login'
import Signup from '@/pages/auth/Signup'
import PortalLogin from '@/pages/auth/PortalLogin'
import SetPassword from '@/pages/auth/SetPassword'
import PortalRules from '@/pages/portal/Rules'

// the landing page (and its animation libraries) loads only for visitors
const Landing = lazy(() => import('@/pages/landing/Landing'))

import Dashboard from '@/pages/admin/Dashboard'
import Rooms from '@/pages/admin/Rooms'
import Hostelers from '@/pages/admin/Hostelers'
import HostelerDetail from '@/pages/admin/HostelerDetail'
import CheckIn from '@/pages/admin/CheckIn'
import CheckOut from '@/pages/admin/CheckOut'
import GateLog from '@/pages/admin/GateLog'
import Documents from '@/pages/admin/Documents'
import Fees from '@/pages/admin/Fees'
import Expenses from '@/pages/admin/Expenses'
import Mess from '@/pages/admin/Mess'
import Attendance from '@/pages/admin/Attendance'
import Complaints from '@/pages/admin/Complaints'
import Visitors from '@/pages/admin/Visitors'
import Notices from '@/pages/admin/Notices'
import Staff from '@/pages/admin/Staff'
import Reports from '@/pages/admin/Reports'
import SettingsPage from '@/pages/admin/Settings'

import InvoicePrint from '@/pages/print/InvoicePrint'
import ReceiptPrint from '@/pages/print/ReceiptPrint'

import PortalHome from '@/pages/portal/Home'
import PortalFees from '@/pages/portal/Fees'
import PortalMess from '@/pages/portal/Mess'
import PortalComplaints from '@/pages/portal/Complaints'
import PortalLeave from '@/pages/portal/Leave'
import PortalProfile from '@/pages/portal/Profile'
import PortalMoveOut from '@/pages/portal/MoveOut'

function RequireAdmin({ children }: { children: ReactNode }) {
  const staff = useStaffSession()
  if (!staff) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireHosteler({ children }: { children: ReactNode }) {
  const h = useHostelerSession()
  if (!h) return <Navigate to="/portal/login" replace />
  if (h.mustChangePassword) return <Navigate to="/portal/set-password" replace />
  if (h.consentRequired) return <Navigate to="/portal/rules" replace />
  return <>{children}</>
}

/** Print pages work for both staff and hostelers. */
function RequireAny({ children }: { children: ReactNode }) {
  const session = useSession((s) => s.session)
  if (!session) return <Navigate to="/login" replace />
  if (session.kind === 'hosteler' && session.mustChangePassword) return <Navigate to="/portal/set-password" replace />
  if (session.kind === 'hosteler' && session.consentRequired) return <Navigate to="/portal/rules" replace />
  return <>{children}</>
}

function LockedCard({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <Lock className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      {action}
    </Card>
  )
}

/**
 * Blocks a module when the staff member's role can't use it, or the
 * organization's plan doesn't include it (the API enforces the same rules).
 */
/** Plan modules that aren't staff permissions of their own map to the permission that covers them. */
const ROLE_MODULE: Partial<Record<ModuleKey, StaffModule>> = { electricity: 'rooms', rules: 'checkin', export: 'org', portal: 'hostelers' }

function Gate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const staff = useStaffSession()
  const { data: org, isLoading } = useOrg()
  const can = useCan()
  if (!can(ROLE_MODULE[module] ?? (module as StaffModule))) {
    return <LockedCard title="No access" message={`Your role (${staff?.user.role}) can't open this section. Ask the owner for access.`} />
  }
  if (isLoading) return <LoadingState />
  const plan = effectivePlan(org ?? staff?.organization)
  if (hasModule(plan, module)) return <>{children}</>
  const needed = planWithModule(module)
  return (
    <LockedCard
      title="Upgrade to unlock"
      message={`This module isn't part of the ${planInfo(plan).name} plan. Upgrade to ${needed?.name ?? 'a higher plan'} to use it.`}
      action={
        staff?.user.role === 'owner' ? (
          <Link to="/app/settings?tab=billing">
            <Button className="mt-6">See plans</Button>
          </Link>
        ) : undefined
      }
    />
  )
}

function Home() {
  const session = useSession((s) => s.session)
  if (session?.kind === 'staff') return <Navigate to="/app/dashboard" replace />
  if (session?.kind === 'hosteler') return <Navigate to="/portal" replace />
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <Landing />
    </Suspense>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/portal/login" element={<PortalLogin />} />
        <Route path="/portal/set-password" element={<SetPassword />} />
        <Route path="/portal/rules" element={<PortalRules />} />

        <Route
          path="/app"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="rooms" element={<Gate module="rooms"><Rooms /></Gate>} />
          <Route path="hostelers" element={<Gate module="hostelers"><Hostelers /></Gate>} />
          <Route path="hostelers/:id" element={<Gate module="hostelers"><HostelerDetail /></Gate>} />
          <Route path="check-in" element={<Gate module="checkin"><CheckIn /></Gate>} />
          <Route path="check-out" element={<Gate module="checkin"><CheckOut /></Gate>} />
          {/* link used by move-out notifications */}
          <Route path="move-out-requests" element={<Navigate to="/app/check-out?view=requests" replace />} />
          <Route path="gate-log" element={<Gate module="visitors"><GateLog /></Gate>} />
          <Route path="documents" element={<Gate module="documents"><Documents /></Gate>} />
          <Route path="fees" element={<Gate module="fees"><Fees /></Gate>} />
          <Route path="expenses" element={<Gate module="expenses"><Expenses /></Gate>} />
          <Route path="mess" element={<Gate module="mess"><Mess /></Gate>} />
          <Route path="attendance" element={<Gate module="attendance"><Attendance /></Gate>} />
          <Route path="complaints" element={<Gate module="complaints"><Complaints /></Gate>} />
          <Route path="visitors" element={<Gate module="visitors"><Visitors /></Gate>} />
          <Route path="notices" element={<Gate module="notices"><Notices /></Gate>} />
          <Route path="staff" element={<Gate module="staff"><Staff /></Gate>} />
          <Route path="reports" element={<Gate module="reports"><Reports /></Gate>} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="/print/invoice/:id" element={<RequireAny><InvoicePrint /></RequireAny>} />
        <Route path="/print/receipt/:id" element={<RequireAny><ReceiptPrint /></RequireAny>} />

        <Route
          path="/portal"
          element={
            <RequireHosteler>
              <PortalLayout />
            </RequireHosteler>
          }
        >
          <Route index element={<PortalHome />} />
          <Route path="fees" element={<PortalFees />} />
          <Route path="mess" element={<PortalMess />} />
          <Route path="complaints" element={<PortalComplaints />} />
          <Route path="leave" element={<PortalLeave />} />
          <Route path="profile" element={<PortalProfile />} />
          <Route path="move-out" element={<PortalMoveOut />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
      <ConfirmHost />
    </BrowserRouter>
    </QueryClientProvider>
  )
}
