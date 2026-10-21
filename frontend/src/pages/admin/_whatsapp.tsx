import { useState } from 'react'
import { CheckCircle2, Copy, MessageCircle, Send } from 'lucide-react'
import { errorMessage } from '@/api/client'
import { SUPPORT, useHasModule } from '@/api/plan'
import type { Hostel } from '@/api/types'
import { useHostelWhatsApp, useSaveHostelWhatsApp, useTestHostelWhatsApp, type HostelWhatsApp, type InvoiceWhatsApp } from '@/api/whatsapp'
import { ModuleNote } from '@/components/PlanGate'
import { Button, Input, LoadingState, Modal, Switch, toast } from '@/components/ui'
import { cn, formatDateTime } from '@/lib/utils'

/**
 * WhatsApp bill messages for one hostel, sent as soon as a bill is made — from HostelHub's
 * WhatsApp number, or the hostel's own number once HostelHub has connected it in Pabbly Chatflow.
 * The owner switches them on, sends a test, and can ask for their own number.
 */
export function WhatsAppModal({ hostel, onClose }: { hostel: Hostel | null; onClose: () => void }) {
  const allowed = useHasModule('whatsapp')
  const q = useHostelWhatsApp(hostel && allowed ? hostel.id : null)
  return (
    <Modal open={!!hostel} onClose={onClose} title="WhatsApp bill messages" description={hostel?.name} size="lg">
      {!allowed ? (
        <ModuleNote module="whatsapp" what="Sending bills on WhatsApp" />
      ) : q.isLoading || !q.data || !hostel ? (
        <LoadingState />
      ) : (
        <WhatsAppForm key={hostel.id} hostel={hostel} settings={q.data} />
      )}
    </Modal>
  )
}

function WhatsAppForm({ hostel, settings }: { hostel: Hostel; settings: HostelWhatsApp }) {
  const hostelId = hostel.id
  const save = useSaveHostelWhatsApp()
  const test = useTestHostelWhatsApp()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [testError, setTestError] = useState('')

  const toggle = (enabled: boolean) => {
    setError('')
    save.mutate({ hostelId, enabled }, { onError: (e) => setError(errorMessage(e)) })
  }
  const sendTest = () => {
    setTestError('')
    test.mutate({ hostelId, phone }, { onError: (e) => setTestError(errorMessage(e)) })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        As soon as a bill is made — automatically, at check-in or by staff — the hosteler gets it on WhatsApp with the full breakdown, the total and the due
        date. Hostelers without a valid phone number are skipped.
      </p>

      {!settings.ready && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">WhatsApp messages aren&apos;t set up yet. Please try again later.</p>
      )}

      {settings.ready && <SenderCard hostel={hostel} settings={settings} />}

      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
        <div>
          <p className="flex items-center gap-2 font-medium text-slate-900">
            Send bills on WhatsApp {settings.enabled && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          </p>
          <p className="text-sm text-slate-500">{settings.enabled ? 'On for this hostel' : 'Off for this hostel'}</p>
        </div>
        <Switch checked={settings.enabled} onChange={toggle} disabled={save.isPending || (!settings.ready && !settings.enabled)} />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="rounded-xl border border-slate-200 bg-slate-50">
        <p className="border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">What the hosteler gets</p>
        <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm text-slate-800">{settings.templateText}</pre>
        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          {'{{1}}'} name · {'{{2}}'} hostel · {'{{3}}'} bill period · {'{{4}}'} breakdown (rent, mess, electricity, deposit, previous balance) · {'{{5}}'} total ·{' '}
          {'{{6}}'} due date · {'{{7}}'} UPI ID
        </p>
      </div>

      <div className="border-t border-slate-100 pt-5">
        <p className="font-medium text-slate-900">Send a test message</p>
        <p className="text-sm text-slate-500">Sends a sample bill to any WhatsApp number.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input className="sm:max-w-xs" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" />
          <Button
            variant="outline"
            icon={<Send className="h-4 w-4" />}
            loading={test.isPending}
            disabled={!settings.ready || phone.replace(/\D/g, '').length < 10}
            onClick={sendTest}
          >
            Send test
          </Button>
        </div>
        {testError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{testError}</p>}
      </div>
    </div>
  )
}

/** Which number the messages come from, and how to get the hostel's own number. */
function SenderCard({ hostel, settings }: { hostel: Hostel; settings: HostelWhatsApp }) {
  const own = settings.sender === 'own'
  const request = `Hi HostelHub, we want WhatsApp bills for ${hostel.name} (hostel code ${hostel.code}) to go from our own WhatsApp number: `
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(request)
      toast.success('Message copied')
    } catch {
      toast.error('Could not copy. Select the text and copy it.')
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sent from</p>
      <p className="mt-1 font-medium text-slate-900">
        {own ? 'Your own WhatsApp number' : "HostelHub's WhatsApp number"}
        {settings.number && <span className="ml-2 font-mono text-slate-700">{settings.number}</span>}
      </p>
      {own ? (
        <p className="mt-1 text-sm text-slate-500">Connected and managed by HostelHub. Ask HostelHub to change it or to move back to the default number.</p>
      ) : (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Want bills to come from your own number?</p>
          <p className="mt-1">Send us your WhatsApp number. HostelHub connects it for you — no setup on your side — and your hostelers then get bills from your number.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUPPORT.whatsapp && (
              <a href={`https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(request)}`} target="_blank" rel="noreferrer">
                <Button size="sm" icon={<MessageCircle className="h-3.5 w-3.5" />}>
                  Ask on WhatsApp
                </Button>
              </a>
            )}
            {SUPPORT.email && (
              <a href={`mailto:${SUPPORT.email}?subject=${encodeURIComponent(`Own WhatsApp number for ${hostel.name}`)}&body=${encodeURIComponent(request)}`}>
                <Button size="sm" variant="outline">
                  Email us
                </Button>
              </a>
            )}
            <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copy()}>
              Copy request
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

const WA_TONE: Record<InvoiceWhatsApp['status'], string> = {
  sent: 'text-emerald-600',
  failed: 'text-red-600',
  pending: 'text-amber-500',
  sending: 'text-amber-500',
}

/** Small WhatsApp icon on a bill row: green sent, amber waiting, red failed (reason in the tooltip). */
export function BillWhatsAppIcon({ wa }: { wa: InvoiceWhatsApp | null | undefined }) {
  if (!wa) return null
  const title =
    wa.status === 'sent'
      ? `Sent on WhatsApp${wa.sentAt ? ` · ${formatDateTime(wa.sentAt)}` : ''}`
      : wa.status === 'failed'
        ? `WhatsApp failed: ${wa.error}`
        : `WhatsApp message waiting to be sent${wa.error ? ` (${wa.error})` : ''}`
  return (
    <span title={title} aria-label={title} className={cn('inline-flex', WA_TONE[wa.status])}>
      <MessageCircle className="h-4 w-4" />
    </span>
  )
}
