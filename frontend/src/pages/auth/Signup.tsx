import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BedDouble, Check, Info } from 'lucide-react'
import { useStore } from '@/store'
import { Button, Card, Field, Input, confirm, toast } from '@/components/ui'

interface FormState {
  orgName: string
  ownerName: string
  email: string
  phone: string
  password: string
  confirm: string
}

type Errors = Partial<Record<keyof FormState, string>>

function validate(f: FormState): Errors {
  const e: Errors = {}
  if (f.orgName.trim().length < 2) e.orgName = 'Enter your hostel or business name.'
  if (f.ownerName.trim().length < 2) e.ownerName = 'Enter your full name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Enter a valid email address.'
  const digits = f.phone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 12) e.phone = 'Enter a valid 10-digit mobile number.'
  if (f.password.length < 6) e.password = 'Password must be at least 6 characters.'
  if (f.confirm !== f.password) e.confirm = 'Passwords do not match.'
  return e
}

export default function Signup() {
  const session = useStore((s) => s.session)
  const org = useStore((s) => s.org)
  const signup = useStore((s) => s.signup)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>({ orgName: '', ownerName: '', email: '', phone: '', password: '', confirm: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [loading, setLoading] = useState(false)

  if (session?.kind === 'admin') return <Navigate to="/app/dashboard" replace />

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length) return
    if (org) {
      const ok = await confirm({
        title: 'Start a fresh workspace?',
        message: `This browser already holds the workspace "${org.name}". Creating a new account will replace all of its data.`,
        confirmText: 'Create new workspace',
        danger: true,
      })
      if (!ok) return
    }
    setLoading(true)
    setTimeout(() => {
      signup({
        orgName: form.orgName.trim(),
        ownerName: form.ownerName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      })
      setLoading(false)
      toast.success('Your workspace is ready. Let\'s add your first hostel!')
      navigate('/app/dashboard')
    }, 300)
  }

  const perks = ['Free up to 20 beds', 'No credit card required', 'Hosteler portal included']

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
      <main className="flex flex-1 justify-center px-4 py-8">
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-900">Create your HostelHub account</h1>
            <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
              {perks.map((p) => (
                <span key={p} className="flex items-center gap-1 text-xs text-slate-600">
                  <Check className="h-3.5 w-3.5 text-emerald-500" /> {p}
                </span>
              ))}
            </div>
          </div>
          <Card className="p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Hostel / business name" required error={errors.orgName}>
                <Input value={form.orgName} onChange={set('orgName')} placeholder="e.g. Sunrise Boys Hostel" autoFocus />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name" required error={errors.ownerName}>
                  <Input value={form.ownerName} onChange={set('ownerName')} placeholder="Full name" autoComplete="name" />
                </Field>
                <Field label="Mobile number" required error={errors.phone}>
                  <Input value={form.phone} onChange={set('phone')} placeholder="98XXXXXXXX" inputMode="tel" autoComplete="tel" />
                </Field>
              </div>
              <Field label="Email" required error={errors.email}>
                <Input type="email" value={form.email} onChange={set('email')} placeholder="you@hostel.com" autoComplete="email" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Password" required error={errors.password} hint="At least 6 characters">
                  <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
                </Field>
                <Field label="Confirm password" required error={errors.confirm}>
                  <Input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
                </Field>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Signing up starts a fresh workspace stored in this browser. Any existing workspace or demo data in this browser
                  will be replaced.
                </span>
              </div>

              <Button type="submit" className="w-full" loading={loading}>
                Create account
              </Button>
            </form>
          </Card>
          <p className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
              Log in
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
