import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, LogOut, ShieldCheck } from 'lucide-react'
import { useStore } from '@/store'
import { useCurrentHosteler } from '@/store/selectors'
import { Button, Card, Field, PasswordInput, toast } from '@/components/ui'
import { PasswordRules } from '@/components/PasswordRules'
import { checkPasswordStrength } from '@/lib/auth'

/**
 * First login: the hosteler signed in with the temporary password from the
 * hostel office and must replace it with their own before using the portal.
 */
export default function SetPassword() {
  const me = useCurrentHosteler()
  const hostel = useStore((s) => s.hostels.find((h) => h.id === me?.hostelId))
  const changePassword = useStore((s) => s.changeHostelerPassword)
  const logout = useStore((s) => s.logout)
  const navigate = useNavigate()

  const [temp, setTemp] = useState('')
  const [next, setNext] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!me) return <Navigate to="/portal/login" replace />
  if (!me.mustChangePassword) return <Navigate to="/portal" replace />

  const strong = checkPasswordStrength(next).ok
  const matches = next.length > 0 && next === confirmPw

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!temp) return setError('Enter the temporary password you logged in with.')
    if (!strong) return setError('Your new password does not meet the rules below.')
    if (!matches) return setError("Passwords don't match.")
    setLoading(true)
    setTimeout(() => {
      const res = changePassword(me.id, temp, next)
      setLoading(false)
      if (!res.ok) return setError(res.error ?? 'Could not set password')
      toast.success('Password set! Use it next time you log in.')
      navigate('/portal', { replace: true })
    }, 300)
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <span className="truncate text-sm font-semibold text-slate-800">{hostel?.name ?? 'HostelHub'}</span>
        <button
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          onClick={() => {
            logout()
            navigate('/portal/login', { replace: true })
          }}
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </header>
      <main className="flex flex-1 justify-center px-4 py-6 sm:items-center">
        <div className="w-full max-w-sm">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Hi {me.name.split(' ')[0]}, set your password</h1>
            <p className="mt-1 text-sm text-slate-500">
              You logged in with a temporary password. Create your own to keep your account safe.
            </p>
          </div>

          <Card className="p-5">
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-center">
              <p className="text-xs text-slate-500">Your Hosteler ID</p>
              <p className="font-mono text-lg font-bold tracking-wide text-slate-900">{me.loginId}</p>
            </div>
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Field label="Temporary password">
                <PasswordInput autoComplete="current-password" value={temp} onChange={(e) => setTemp(e.target.value)} autoFocus />
              </Field>
              <Field label="New password">
                <PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
              <PasswordRules password={next} />
              <Field
                label="Confirm new password"
                error={confirmPw && !matches ? "Passwords don't match" : undefined}
              >
                <PasswordInput autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
              </Field>
              <Button type="submit" size="lg" className="w-full sm:h-11" loading={loading} disabled={!strong || !matches || !temp}>
                Save & continue
              </Button>
            </form>
          </Card>
          <p className="mt-4 text-center text-xs text-slate-500">
            After this, your temporary password will stop working.
          </p>
        </div>
      </main>
    </div>
  )
}
