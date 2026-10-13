import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, BedDouble, Eye, EyeOff, KeyRound, Sparkles } from 'lucide-react'
import { useStore } from '@/store'
import { Button, Card, Field, Input, confirm, toast } from '@/components/ui'

const DEMO_EMAIL = 'demo@hostelhub.in'
const DEMO_PASSWORD = 'demo123'

export default function Login() {
  const session = useStore((s) => s.session)
  const org = useStore((s) => s.org)
  const login = useStore((s) => s.login)
  const loadDemo = useStore((s) => s.loadDemo)
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (session?.kind === 'admin') return <Navigate to="/app/dashboard" replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setLoading(true)
    // small delay so the button feedback is visible
    setTimeout(() => {
      const ok = login(email, password)
      setLoading(false)
      if (ok) {
        toast.success(`Welcome back${org?.ownerName ? `, ${org.ownerName.split(' ')[0]}` : ''}!`)
        navigate('/app/dashboard')
      } else if (!org) {
        setError('No account exists in this browser yet. Sign up or try the demo account.')
      } else {
        setError('Incorrect email or password.')
      }
    }, 300)
  }

  const enterDemo = async () => {
    const isDemo = org?.email.toLowerCase() === DEMO_EMAIL
    if (isDemo) {
      if (login(DEMO_EMAIL, org?.password ?? DEMO_PASSWORD)) {
        navigate('/app/dashboard')
        return
      }
    }
    if (org && !isDemo) {
      const ok = await confirm({
        title: 'Replace your workspace?',
        message: `Loading the demo will replace the data of "${org.name}" stored in this browser. Export a backup from Settings first if you need it.`,
        confirmText: 'Load demo',
        danger: true,
      })
      if (!ok) return
    }
    loadDemo()
    toast.success('Demo workspace loaded')
    navigate('/app/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 to-slate-50">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <BedDouble className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold text-slate-900">HostelHub</span>
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-900">Log in to your workspace</h1>
            <p className="mt-1 text-sm text-slate-500">For hostel owners, managers and staff</p>
          </div>
          <Card className="p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Field label="Email">
                <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hostel.com" autoFocus />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <Input
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Button type="submit" className="w-full" loading={loading}>
                Log in
              </Button>
            </form>

            <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-brand-800">
                <Sparkles className="h-4 w-4" /> Just exploring?
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Demo login: <span className="font-mono font-medium text-slate-800">{DEMO_EMAIL}</span> /{' '}
                <span className="font-mono font-medium text-slate-800">{DEMO_PASSWORD}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={enterDemo}>
                  Use demo account
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEmail(DEMO_EMAIL)
                    setPassword(DEMO_PASSWORD)
                    setError('')
                  }}
                >
                  Fill credentials
                </Button>
              </div>
            </div>
          </Card>
          <div className="mt-6 space-y-2 text-center text-sm text-slate-600">
            <p>
              New to HostelHub?{' '}
              <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-700">
                Create an account
              </Link>
            </p>
            <p>
              <Link to="/portal/login" className="inline-flex items-center gap-1 font-medium text-slate-500 hover:text-slate-800">
                <KeyRound className="h-3.5 w-3.5" /> Hosteler? Log in to the resident portal
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
