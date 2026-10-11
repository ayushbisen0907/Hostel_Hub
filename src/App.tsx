import type { ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useStore } from '@/store'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PortalLayout } from '@/components/layout/PortalLayout'
import { Button, Card, ConfirmHost, Spinner, Toaster } from '@/components/ui'
import { hasModule, planInfo, PLANS, type ModuleKey } from '@/lib/plans'

import Landing from '@/pages/auth/Landing'
import Login from '@/pages/auth/Login'
import Signup from '@/pages/auth/Signup'
import PortalLogin from '@/pages/auth/PortalLogin'

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

function RequireAdmin({ children }: { children: ReactNode }) {
  const session = useStore((s) => s.session)
  if (session?.kind !== 'admin') return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireHosteler({ children }: { children: ReactNode }) {
  const session = useStore((s) => s.session)
  if (session?.kind !== 'hosteler') return <Navigate to="/portal/login" replace />
  return <>{children}</>
}

function RequireAny({ children }: { children: ReactNode }) {
  const session = useStore((s) => s.session)
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Shows an upgrade prompt when the current plan doesn't include a module. */
function Gate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const plan = useStore((s) => s.org?.plan)
  if (hasModule(plan, module)) return <>{children}</>
  const needed = PLANS.find((p) => p.modules.includes(module))
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <Lock className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Upgrade to unlock</h2>
      <p className="mt-2 text-sm text-slate-500">
        This module isn't part of the {planInfo(plan ?? 'free').name} plan. Upgrade to {needed?.name ?? 'a higher plan'} to use it.
      </p>
      <Link to="/app/settings?tab=billing">
        <Button className="mt-6">See plans</Button>
      </Link>
    </Card>
  )
}

export default function App() {
  const hydrated = useStore((s) => s.hydrated)
  const session = useStore((s) => s.session)

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            session?.kind === 'admin' ? (
              <Navigate to="/app/dashboard" replace />
            ) : session?.kind === 'hosteler' ? (
              <Navigate to="/portal" replace />
            ) : (
              <Landing />
            )
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/portal/login" element={<PortalLogin />} />

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
          <Route path="gate-log" element={<Gate module="checkin"><GateLog /></Gate>} />
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
      <ConfirmHost />
    </BrowserRouter>
  )
}
