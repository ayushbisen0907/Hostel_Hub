import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, BedDouble, KeyRound } from 'lucide-react'
import { staffLogin } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { useStaffSession } from '@/api/session'
import { Button, Card, Field, Input, PasswordInput, toast } from '@/components/ui'

export default function Login() {
  const staff = useStaffSession()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (staff) return <Navigate to="/app/dashboard" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) return setError('Enter your email and password.')
    setLoading(true)
    try {
      const s = await staffLogin(email.trim(), password)
      toast.success(`Welcome back, ${s.user.name.split(' ')[0]}!`)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from?.startsWith('/app') ? from : '/app/dashboard', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-brand-50 to-slate-50">
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
                <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </Field>
              <Button type="submit" size="lg" className="w-full sm:h-11" loading={loading}>
                Log in
              </Button>
              <p className="text-center text-xs text-slate-500">Forgot your password? Ask your hostel owner to reset it from Settings → Team.</p>
            </form>
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
