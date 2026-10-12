import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, BedDouble, Database, HelpCircle, IdCard, KeyRound, Smartphone } from 'lucide-react'
import { useStore } from '@/store'
import { DEMO_FIRST_LOGIN, DEMO_HOSTELER } from '@/store/seed'
import { Button, Card, Field, Input, Modal, PasswordInput, confirm, toast } from '@/components/ui'
import { normalizeLoginId } from '@/lib/auth'

export default function PortalLogin() {
  const session = useStore((s) => s.session)
  const org = useStore((s) => s.org)
  const mustChange = useStore((s) =>
    s.session?.kind === 'hosteler' ? s.hostelers.find((h) => h.id === s.session!.hostelerId)?.mustChangePassword : false,
  )
  const loginHosteler = useStore((s) => s.loginHosteler)
  const loadDemo = useStore((s) => s.loadDemo)
  const logout = useStore((s) => s.logout)
  const navigate = useNavigate()

  const [params] = useSearchParams()
  const [loginId, setLoginId] = useState(() => normalizeLoginId(params.get('id') ?? ''))
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  if (session?.kind === 'hosteler') return <Navigate to={mustChange ? '/portal/set-password' : '/portal'} replace />

  const isDemo = org?.email.toLowerCase() === 'demo@hostelhub.in'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!loginId.trim()) return setError('Enter your Hosteler ID.')
    if (!password) return setError('Enter your password.')
    setLoading(true)
    setTimeout(() => {
      const res = loginHosteler(loginId, password)
      setLoading(false)
      if (!res.ok) return setError(res.error)
      if (res.mustChangePassword) {
        navigate('/portal/set-password', { replace: true })
      } else {
        toast.success('Welcome back!')
        navigate('/portal', { replace: true })
      }
    }, 300)
  }

  const fill = (id: string, pw: string) => {
    setLoginId(id)
    setPassword(pw)
    setError('')
  }

  const loadDemoData = async () => {
    if (org && !isDemo) {
      const ok = await confirm({
        title: 'Load demo data?',
        message: `This replaces the "${org.name}" workspace stored in this browser with demo data.`,
        confirmText: 'Load demo',
        danger: true,
      })
      if (!ok) return
    }
    loadDemo()
    logout()
    fill(DEMO_HOSTELER.loginId, DEMO_HOSTELER.password)
    toast.success('Demo data loaded — tap Log in to continue')
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-slate-900 to-slate-800">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <BedDouble className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-white">HostelHub</span>
        </Link>
        <Link to="/login" className="text-sm font-medium text-slate-300 hover:text-white">
          Owner login
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:py-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/20 text-brand-300">
              <Smartphone className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold text-white">Hosteler login</h1>
            <p className="mt-1 text-sm text-slate-400">Pay rent, check the mess menu, raise complaints</p>
          </div>
          <Card className="p-5 sm:p-6">
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Field label="Hosteler ID" hint="Given by your hostel at check-in, e.g. SBH-0007">
                <div className="relative">
                  <IdCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="h-11 pl-9 font-mono uppercase tracking-wide sm:h-10"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="username"
                    spellCheck={false}
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                    placeholder="SBH-0001"
                    autoFocus={!loginId}
                  />
                </div>
              </Field>
              <Field label="Password">
                <PasswordInput
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password or temporary password"
                  autoFocus={!!loginId}
                />
              </Field>
              <Button type="submit" size="lg" className="w-full sm:h-11" loading={loading}>
                Log in
              </Button>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
              >
                <HelpCircle className="h-4 w-4" /> First time here / forgot password?
              </button>
            </form>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Try the demo</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {isDemo ? 'Demo data is loaded in this browser.' : 'Load the demo data in this browser first.'}
              </p>
              <div className="mt-3 space-y-2">
                {!isDemo && (
                  <Button size="sm" variant="outline" className="w-full" icon={<Database className="h-3.5 w-3.5" />} onClick={loadDemoData}>
                    Load demo data
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => fill(DEMO_HOSTELER.loginId, DEMO_HOSTELER.password)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-brand-300"
                >
                  <span>
                    <span className="block text-xs font-medium text-slate-800">Regular hosteler</span>
                    <span className="font-mono text-xs text-slate-500">
                      {DEMO_HOSTELER.loginId} · {DEMO_HOSTELER.password}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-600">Fill</span>
                </button>
                <button
                  type="button"
                  onClick={() => fill(DEMO_FIRST_LOGIN.loginId, DEMO_FIRST_LOGIN.tempPassword)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-brand-300"
                >
                  <span>
                    <span className="block text-xs font-medium text-slate-800">First login (temporary password)</span>
                    <span className="font-mono text-xs text-slate-500">
                      {DEMO_FIRST_LOGIN.loginId} · {DEMO_FIRST_LOGIN.tempPassword}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-600">Fill</span>
                </button>
              </div>
            </div>
          </Card>
          <Link to="/" className="mt-6 flex items-center justify-center gap-1 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </main>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} size="sm" title="How to log in" footer={<Button onClick={() => setHelpOpen(false)}>Got it</Button>}>
        <ol className="space-y-4 text-sm text-slate-600">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">1</span>
            <span>
              At check-in, the hostel office gives you a <b>Hosteler ID</b> (like <span className="font-mono">SBH-0007</span>) and a{' '}
              <b>temporary password</b>, usually on WhatsApp.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">2</span>
            <span>Log in with them. You'll be asked to create your own password right away.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">3</span>
            <span>From then on, use your Hosteler ID with your new password. The temporary one stops working.</span>
          </li>
        </ol>
        <div className="mt-5 flex gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Forgot your password? Ask the hostel office to reset it. They'll send you a new temporary password.</span>
        </div>
      </Modal>
    </div>
  )
}
