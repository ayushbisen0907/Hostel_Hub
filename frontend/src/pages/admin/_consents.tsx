/**
 * Staff hosteler profile: has the hosteler signed the hostel's current rules?
 * Lists every signed version with the drawn signature, and shows / prints the
 * exact text that was accepted.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, FileSignature, Printer } from 'lucide-react'
import type { ConsentStatus } from '@/api/hostelers'
import { useHostelerConsents, type RulesConsent } from '@/api/rules'
import { useCan } from '@/api/session'
import type { ID } from '@/api/types'
import { Badge, Button, ErrorState, LoadingState, Modal } from '@/components/ui'
import { formatDate, formatDateTime } from '@/lib/utils'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Opens a print-ready page with the accepted rules, the name and the signature. */
function printConsent(c: RulesConsent, who: { name: string; loginId: string; hostelName: string | null }) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Rules consent – ${esc(who.name)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;line-height:1.5}
h1{font-size:18px;margin:0}.muted{color:#64748b;font-size:12px}
pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:13px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:16px 0;margin:16px 0}
img{width:300px;height:100px;border:1px solid #e2e8f0;border-radius:6px}
</style></head><body>
<h1>${esc(who.hostelName ?? 'Hostel')} — rules, version ${c.rulesVersion}</h1>
<p class="muted">Signed by ${esc(who.name)} (${esc(who.loginId)}) on ${esc(formatDateTime(c.acceptedAt))}</p>
<pre>${esc(c.rulesText)}</pre>
<p><b>Name typed:</b> ${esc(c.signedName)}</p>
<p><b>Signature:</b><br><img src="${esc(c.signature)}" alt="Signature"></p>
<p class="muted">Accepted in the HostelHub hosteler app${c.ip ? ` from IP ${esc(c.ip)}` : ''}.</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`)
  win.document.close()
}

export function RulesConsentSection({
  h,
}: {
  h: { id: ID; name: string; loginId: string; hostelName: string | null; status: string; consentStatus?: ConsentStatus }
}) {
  const can = useCan()
  const st = h.consentStatus
  const q = useHostelerConsents(h.id, !!st)
  const [viewing, setViewing] = useState<RulesConsent | null>(null)
  if (!st) return null
  const who = { name: h.name, loginId: h.loginId, hostelName: h.hostelName }
  const items = q.data?.items ?? []

  return (
    <div className="border-b border-slate-100 px-5 py-5 last:border-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-900">Rules consent</h4>
        {st.rulesVersion === 0 ? (
          <Badge>No rules</Badge>
        ) : st.required ? (
          <Badge tone="amber">Waiting for signature</Badge>
        ) : (
          <Badge tone="green">Signed v{st.signedVersion}</Badge>
        )}
      </div>

      <p className="text-sm text-slate-600">
        {st.rulesVersion === 0 ? (
          <>
            {h.hostelName ?? 'This hostel'} has no rules for hostelers to sign.{' '}
            {can('hostels') && (
              <Link to="/app/settings?tab=hostels" className="font-medium text-brand-600 hover:underline">
                Add rules
              </Link>
            )}
          </>
        ) : st.required ? (
          h.status === 'checked_out' ? (
            `Did not sign version ${st.rulesVersion} of the rules before checking out.`
          ) : (
            <>
              Version {st.rulesVersion} of the rules is not signed yet. {h.name.split(' ')[0]} is asked to sign it on the next app login and can't use the
              app until they do.
              {st.signedVersion > 0 && ` Last signed version ${st.signedVersion}${st.signedAt ? ` on ${formatDate(st.signedAt)}` : ''}.`}
            </>
          )
        ) : (
          `Signed version ${st.signedVersion} of the rules${st.signedAt ? ` on ${formatDateTime(st.signedAt)}` : ''}.`
        )}
      </p>

      {q.isLoading ? (
        <LoadingState className="py-6" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-6" />
      ) : (
        items.length > 0 && (
          <ul className="mt-4 space-y-3">
            {items.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center">
                <img src={c.signature} alt={`Signature of ${c.signedName}`} className="h-16 w-48 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-slate-900">
                    Version {c.rulesVersion} · {c.signedName}
                  </p>
                  <p className="text-xs text-slate-500">Signed {formatDateTime(c.acceptedAt)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setViewing(c)}>
                    View signed rules
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-brand-600" /> Signed rules · version {viewing?.rulesVersion}
          </span>
        }
        description={viewing ? `${viewing.signedName} · ${formatDateTime(viewing.acceptedAt)}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
            {viewing && (
              <Button icon={<Printer className="h-4 w-4" />} onClick={() => printConsent(viewing, who)}>
                Print
              </Button>
            )}
          </>
        }
      >
        {viewing && (
          <div>
            <div className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">{viewing.rulesText}</div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="text-sm">
                <p className="text-xs text-slate-500">Name typed</p>
                <p className="font-medium text-slate-900">{viewing.signedName}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {who.name} ({who.loginId}){viewing.ip ? ` · IP ${viewing.ip}` : ''}
                </p>
              </div>
              <img src={viewing.signature} alt="Signature" className="h-20 w-60 rounded-lg border border-slate-200 bg-white object-contain" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
