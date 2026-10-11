import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, BedDouble, Database, Smartphone } from 'lucide-react'
import { useStore } from '@/store'
import { Button, Card, Field, Input, confirm, toast } from '@/components/ui'

const DEMO_PHONE = '9876543210'
const DEMO_PIN = '1234'

export default function PortalLogin() {
  const session = useStore((s) => s.session)
  const org = useStore((s) => s.org)
  const loginHosteler = useStore((s) => s.loginHosteler)
  const loadDemo = useStore((s) => s.loadDemo)
  const logout = useStore((s) => s.logout)
  const navigate = useNavigate()

  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const pinRefs = useRef<(HTMLInputElement | null)[]>([])

  if (session?.kind === 'hosteler') return <Navigate to="/portal" replace />

  const isDemo = org?.email.toLowerCase() === 'demo@hostelhub.in'

  const setPinDigit = (i: number, v: string) => {
    const digits = v.replace(/\D/g, '')
    if (digits.length > 1) {
      // pasted full pin
      const next = digits.slice(0, 4).split('')
      setPin([0, 1, 2, 3].map((k) => next[k] ?? ''))
      pinRefs.current[Math.min(next.length, 3)]?.focus()
      return
    }
    setPin((p) => p.map((d, k) => (k === i ? digits : d)))
    if (digits && i < 3) pinRefs.current[i + 1]?.focus()
  }

  const onPinKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[i] && i > 0) pinRefs.current[i - 1]?.focus()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const digits = phone.replace(/\D/g, '')
    const code = pin.join('')
    if (digits.length < 10) return setError('Enter your 10-digit mobile number.')
    if (code.length !== 4) return setError('Enter your 4-digit PIN.')
    setLoading(true)
    setTimeout(() => {
      const ok = loginHosteler(digits, code)
      setLoading(false)
      if (ok) {
        toast.success('Welcome!')
        navigate('/portal')
      } else {
        setError('Mobile number or PIN is incorrect. Ask your hostel office for your portal PIN.')
      }
    }, 300)
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
    setPhone(DEMO_PHONE)
    setPin(DEMO_PIN.split(''))
    setError('')
    toast.success('Demo data loaded — tap Log in to continue')
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-900 to-slate-800">
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
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/20 text-brand-300">
              <Smartphone className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold text-white">Hosteler login</h1>
            <p className="mt-1 text-sm text-slate-400">Check your dues, mess menu, notices and more</p>
          </div>
          <Card className="p-6">
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Field label="Mobile number">
                <div className="flex">
                  <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm text-slate-500">
                    +91
                  </span>
                  <Input
                    className="rounded-l-none"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="98XXXXXXXX"
                    autoFocus
                  />
                </div>
              </Field>
              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-700">4-digit PIN</span>
                <div className="flex gap-3">
                  {pin.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        pinRefs.current[i] = el
                      }}
                      type="password"
                      inputMode="numeric"
                      aria-label={`PIN digit ${i + 1}`}
                      value={d}
                      onChange={(e) => setPinDigit(i, e.target.value)}
                      onKeyDown={(e) => onPinKey(i, e)}
                      className="h-12 w-12 rounded-lg border border-slate-300 text-center text-lg font-semibold text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Your PIN is shared by the hostel office at check-in.</p>
              </div>
              <Button type="submit" className="w-full" loading={loading}>
                Log in
              </Button>
            </form>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Try the demo</p>
              <p className="mt-1 text-xs text-slate-600">
                Mobile <span className="font-mono font-medium text-slate-800">{DEMO_PHONE}</span> · PIN{' '}
                <span className="font-mono font-medium text-slate-800">{DEMO_PIN}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {isDemo ? 'Demo data is loaded in this browser.' : 'Demo data needs to be loaded in this browser first.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!isDemo && (
                  <Button size="sm" variant="outline" icon={<Database className="h-3.5 w-3.5" />} onClick={loadDemoData}>
                    Load demo data
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPhone(DEMO_PHONE)
                    setPin(DEMO_PIN.split(''))
                    setError('')
                  }}
                >
                  Fill demo login
                </Button>
              </div>
            </div>
          </Card>
          <Link to="/" className="mt-6 flex items-center justify-center gap-1 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </main>
    </div>
  )
}
