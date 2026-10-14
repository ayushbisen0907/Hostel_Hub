import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, FileSignature, LogOut, Printer, ScrollText } from 'lucide-react'
import { logout } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { usePortalRules, useSignRules } from '@/api/rules'
import { useHostelerSession, useSession } from '@/api/session'
import { Button, Card, ErrorState, Field, Input, LoadingState, toast } from '@/components/ui'
import { SignaturePad, type SignaturePadHandle } from '@/components/SignaturePad'
import { formatDateTime } from '@/lib/utils'

/** "  Aarav   SHARMA " ~ "aarav sharma" (same check as the API) */
const looseName = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/**
 * The hostel's rules. When the current version isn't signed yet (first login
 * after check-in, or the hostel changed its rules) the hosteler must sign here
 * before using the portal — the API answers 403 CONSENT_REQUIRED until then.
 * Otherwise it is a read-only view (linked from Profile).
 */
export default function PortalRules() {
  const session = useHostelerSession()
  const navigate = useNavigate()
  const rulesQ = usePortalRules()
  const sign = useSignRules()
  const padRef = useRef<SignaturePadHandle>(null)

  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; signature?: string; agree?: string }>({})
  const [apiError, setApiError] = useState('')

  const data = rulesQ.data
  const needsSignature = !!data && data.rulesVersion > 0 && !data.signed

  // the session can be out of date (rules signed on another device, or removed by the hostel)
  useEffect(() => {
    if (data && !needsSignature && session?.consentRequired) useSession.getState().patchSession({ consentRequired: false })
  }, [data, needsSignature, session?.consentRequired])

  if (!session) return <Navigate to="/portal/login" replace />
  if (session.mustChangePassword) return <Navigate to="/portal/set-password" replace />
  const me = session.hosteler
  const blocking = !!session.consentRequired

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setApiError('')
    const err: typeof errors = {}
    if (name.trim().length < 2) err.name = 'Type your full name.'
    else if (looseName(name) !== looseName(me.name)) err.name = `Type your name exactly as registered: ${me.name}`
    const signature = padRef.current?.toDataUrl() ?? null
    if (!signature) err.signature = 'Draw your signature in the box.'
    if (!agree) err.agree = 'Tick the box to accept the rules.'
    setErrors(err)
    if (Object.keys(err).length || !signature) return
    sign.mutate(
      { signedName: name.trim(), signature, accept: true },
      {
        onSuccess: () => {
          toast.success('Thank you! The hostel rules are signed.')
          navigate('/portal', { replace: true })
        },
        onError: (er) => setApiError(errorMessage(er)),
      },
    )
  }

  const doLogout = () => {
    logout()
    navigate('/portal/login', { replace: true })
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50">
      <header className="no-print sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4">
        {blocking ? (
          <span className="truncate text-sm font-semibold text-slate-800">{session.hostel?.name ?? 'HostelHub'}</span>
        ) : (
          <Link to="/portal/profile" className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        )}
        <div className="flex items-center gap-1">
          {data && !needsSignature && data.rulesVersion > 0 && (
            <button className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </button>
          )}
          {blocking && (
            <button className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100" onClick={doLogout}>
              <LogOut className="h-4 w-4" /> Log out
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {rulesQ.isLoading ? (
          <LoadingState />
        ) : rulesQ.error || !data ? (
          <Card>
            <ErrorState error={rulesQ.error} onRetry={() => void rulesQ.refetch()} />
          </Card>
        ) : data.rulesVersion === 0 ? (
          <Card className="p-8 text-center">
            <ScrollText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-800">{data.hostelName} hasn't published any rules yet</p>
            <Link to="/portal" className="mt-4 inline-block">
              <Button variant="outline">Go to home</Button>
            </Link>
          </Card>
        ) : (
          <>
            <div className="no-print mb-5 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
                {needsSignature ? <FileSignature className="h-7 w-7" /> : <ScrollText className="h-7 w-7" />}
              </div>
              <h1 className="text-xl font-bold text-slate-900">{needsSignature ? 'Read and sign the hostel rules' : 'Hostel rules'}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {needsSignature
                  ? `Please read ${data.hostelName}'s rules carefully and sign them to continue using the app. When the hostel changes its rules, you'll be asked to sign again.`
                  : `${data.hostelName} · version ${data.rulesVersion}`}
              </p>
            </div>

            {!needsSignature && data.signedAt && (
              <div className="no-print mb-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>You signed these rules on {formatDateTime(data.signedAt)}.</span>
              </div>
            )}

            <Card className="overflow-hidden print:border-0 print:shadow-none">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <p className="truncate font-semibold text-slate-900">{data.hostelName}</p>
                <span className="shrink-0 text-xs text-slate-500">Version {data.rulesVersion}</span>
              </div>
              <div
                className={
                  needsSignature
                    ? 'max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words px-4 py-4 text-sm leading-relaxed text-slate-700 print:max-h-none print:overflow-visible'
                    : 'whitespace-pre-wrap break-words px-4 py-4 text-sm leading-relaxed text-slate-700'
                }
                tabIndex={0}
              >
                {data.rulesText}
              </div>
            </Card>

            {needsSignature && (
              <Card className="no-print mt-4 p-4 sm:p-5">
                <form onSubmit={submit} className="space-y-4" noValidate>
                  {apiError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{apiError}</span>
                    </div>
                  )}
                  <Field label="Your full name" required error={errors.name} hint={`As registered with the hostel: ${me.name}`}>
                    <Input
                      value={name}
                      maxLength={80}
                      autoComplete="name"
                      onChange={(e) => {
                        setName(e.target.value)
                        if (errors.name) setErrors((x) => ({ ...x, name: undefined }))
                      }}
                      placeholder={me.name}
                    />
                  </Field>
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-slate-700">
                      Your signature <span className="text-red-500">*</span>
                    </p>
                    <SignaturePad
                      ref={padRef}
                      invalid={!!errors.signature}
                      disabled={sign.isPending}
                      onChange={(isEmpty) => {
                        setHasSignature(!isEmpty)
                        if (!isEmpty && errors.signature) setErrors((x) => ({ ...x, signature: undefined }))
                      }}
                    />
                    {errors.signature && <p className="text-xs text-red-600">{errors.signature}</p>}
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-brand-600"
                      checked={agree}
                      onChange={(e) => {
                        setAgree(e.target.checked)
                        if (e.target.checked && errors.agree) setErrors((x) => ({ ...x, agree: undefined }))
                      }}
                    />
                    <span className="text-sm text-slate-700">
                      I have read and agree to follow the rules of <b>{data.hostelName}</b>.
                    </span>
                  </label>
                  {errors.agree && <p className="-mt-2 text-xs text-red-600">{errors.agree}</p>}
                  <Button type="submit" size="lg" className="w-full" loading={sign.isPending} disabled={!agree || !hasSignature || !name.trim()}>
                    Sign and continue
                  </Button>
                  <p className="text-center text-xs text-slate-500">Your name, signature and the date are saved with this version of the rules.</p>
                </form>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  )
}
