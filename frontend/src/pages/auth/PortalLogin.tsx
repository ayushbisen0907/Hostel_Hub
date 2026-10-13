import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, BedDouble, HelpCircle, IdCard, KeyRound, Smartphone } from 'lucide-react'
import { hostelerLogin } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { useHostelerSession } from '@/api/session'
import { Button, Card, Field, Input, Modal, PasswordInput, toast } from '@/components/ui'
import { normalizeLoginId } from '@/lib/auth'

export default function PortalLogin() {
  const session = useHostelerSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [loginId, setLoginId] = useState(() => normalizeLoginId(params.get('id') ?? ''))
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  if (session) return <Navigate to={session.mustChangePassword ? '/portal/set-password' : '/portal'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!loginId.trim()) return setError('Enter your Hosteler ID.')
    if (!password) return setError('Enter your password.')
    setLoading(true)
    try {
      const s = await hostelerLogin(loginId, password)
      if (s.mustChangePassword) {
        navigate('/portal/set-password', { replace: true })
      } else {
        toast.success(`Welcome back, ${s.hosteler.name.split(' ')[0]}!`)
        navigate('/portal', { replace: true })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
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
