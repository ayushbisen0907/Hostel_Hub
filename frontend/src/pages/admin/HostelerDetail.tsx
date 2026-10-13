import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRightLeft,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  IndianRupee,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  Pencil,
  Phone,
  Printer,
  Trash2,
  Upload,
  UserCheck,
  UserX,
} from 'lucide-react'
import { ApiError } from '@/api/client'
import { useHostels, useOrg } from '@/api/common'
import { toastError, useApiMutation } from '@/api/query'
import { useCan, useStaffSession } from '@/api/session'
import { useProtectedFileUrl } from '@/api/files'
import { useVacantBeds } from '@/api/rooms'
import { useGateLogs } from '@/api/gate'
import { DOCUMENT_INVALIDATE, documentsApi, downloadDocument, useDocuments, type DocumentRow } from '@/api/documents'
import {
  HOSTELER_INVALIDATE,
  PROFILE_INVALIDATE,
  hostelerPhotoPath,
  hostelersApi,
  useAttendanceRegister,
  useHosteler,
  useHostelerComplaints,
  useHostelerLeaves,
  type Credentials,
  type HostelerDetail as HostelerDetailT,
} from '@/api/hostelers'
import { useInvoices, usePayments } from '@/api/fees'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  Select,
  StatusBadge,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { cn, currentMonth, daysBetween, formatBytes, formatDate, formatDateTime, formatMoney, formatMonth, titleCase, today } from '@/lib/utils'
import {
  AcademicFields,
  DOC_TYPE_LABELS,
  DocPreviewModal,
  GuardianFields,
  IdProofFields,
  PHOTO_ACCEPT,
  PersonalFields,
  SectionTitle,
  UploadDocModal,
  acceptFile,
  bedText,
  copyText,
  expiryState,
  portalInviteText,
  portalInviteWhatsApp,
  profileBody,
  profileOf,
  validateGuardian,
  validatePersonal,
  whatsappLink,
  type ProfileErrors,
  type ProfileForm,
  type SetProfile,
} from './_residents'
import { RecordPaymentModal } from './_fees'

type Tab = 'overview' | 'fees' | 'documents' | 'attendance' | 'gate' | 'requests'

/* ------------------------------------------------------------------ */
/* Edit modal                                                          */
/* ------------------------------------------------------------------ */

type EditForm = ProfileForm & {
  monthlyRent: string
  securityDeposit: string
  expectedCheckOut: string
  messOpted: boolean
  notes: string
}

function toEditForm(h: HostelerDetailT): EditForm {
  return {
    ...profileOf(h),
    monthlyRent: String(h.monthlyRent),
    securityDeposit: String(h.securityDeposit),
    expectedCheckOut: h.expectedCheckOut ?? '',
    messOpted: h.messOpted,
    notes: h.notes,
  }
}

function EditModal({ open, onClose, h }: { open: boolean; onClose: () => void; h: HostelerDetailT }) {
  const [f, setF] = useState<EditForm>(() => toEditForm(h))
  const [errors, setErrors] = useState<ProfileErrors>({})
  const save = useApiMutation(hostelersApi.update, { invalidate: PROFILE_INVALIDATE, success: 'Profile updated', onSuccess: () => onClose() })

  useEffect(() => {
    if (open) {
      setF(toEditForm(h))
      setErrors({})
    }
    // re-init only when the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const setProfile: SetProfile = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const submit = () => {
    const e = { ...validatePersonal(f), ...validateGuardian(f) }
    setErrors(e)
    if (Object.keys(e).length) return toast.error('Please fix the highlighted fields')
    const rent = Number(f.monthlyRent)
    const dep = Number(f.securityDeposit)
    if (f.monthlyRent.trim() === '' || !(rent >= 0)) return toast.error('Enter a valid monthly rent')
    if (f.securityDeposit.trim() === '' || !(dep >= 0)) return toast.error('Enter a valid security deposit')
    const { monthlyRent: _r, securityDeposit: _d, expectedCheckOut, messOpted, notes, ...profile } = f
    void _r
    void _d
    save.mutate({
      id: h.id,
      ...profileBody(profile),
      monthlyRent: rent,
      securityDeposit: dep,
      expectedCheckOut: expectedCheckOut || null,
      messOpted,
      notes: notes.trim(),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Edit profile"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <SectionTitle>Personal details</SectionTitle>
          <PersonalFields f={f} set={setProfile} errors={errors} />
        </section>
        <section>
          <SectionTitle>Academic / work</SectionTitle>
          <AcademicFields f={f} set={setProfile} />
        </section>
        <section>
          <SectionTitle>Guardian</SectionTitle>
          <GuardianFields f={f} set={setProfile} errors={errors} />
        </section>
        <section>
          <SectionTitle>ID proof</SectionTitle>
          <IdProofFields f={f} set={setProfile} />
        </section>
        <section>
          <SectionTitle hint={`Checked in on ${formatDate(h.checkInDate)}`}>Stay & rent</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Monthly rent">
              <Input type="number" min={0} value={f.monthlyRent} onChange={(e) => set('monthlyRent', e.target.value)} />
            </Field>
            <Field label="Security deposit">
              <Input type="number" min={0} value={f.securityDeposit} onChange={(e) => set('securityDeposit', e.target.value)} />
            </Field>
            <Field label="Expected check-out">
              <Input type="date" value={f.expectedCheckOut} onChange={(e) => set('expectedCheckOut', e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <Switch checked={f.messOpted} onChange={(v) => set('messOpted', v)} label="Opted for mess" />
          </div>
          <Field label="Notes" className="mt-4">
            <Textarea value={f.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </section>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Transfer modal                                                      */
/* ------------------------------------------------------------------ */

function TransferModal({ open, onClose, h }: { open: boolean; onClose: () => void; h: HostelerDetailT }) {
  const { data: hostels = [] } = useHostels()
  const [hostelId, setHostelId] = useState(h.hostelId)
  const [bedId, setBedId] = useState('')
  const [updateRent, setUpdateRent] = useState(false)
  const vacantQ = useVacantBeds(hostelId, open)
  const vacant = vacantQ.data ?? []

  useEffect(() => {
    if (open) {
      setHostelId(h.hostelId)
      setBedId('')
      setUpdateRent(false)
    }
  }, [open, h.hostelId])

  const selected = vacant.find((v) => v.id === bedId)
  const transfer = useApiMutation(hostelersApi.transfer, {
    invalidate: HOSTELER_INVALIDATE,
    success: () => (selected ? `Moved to Room ${selected.room.number} · Bed ${selected.label}` : 'Bed changed'),
    onSuccess: () => onClose(),
  })

  const save = () => {
    if (!selected) return toast.error('Choose a vacant bed')
    transfer.mutate({ id: h.id, bedId: selected.id, updateRent })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Transfer bed"
      description={`Currently: ${bedText(h)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!selected} loading={transfer.isPending}>
            Transfer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {hostels.length > 1 && (
          <Field label="Hostel">
            <Select
              value={hostelId}
              options={hostels.map((x) => ({ value: x.id, label: x.name }))}
              onChange={(e) => {
                setHostelId(e.target.value)
                setBedId('')
              }}
            />
          </Field>
        )}
        {vacantQ.isLoading ? (
          <LoadingState label="Finding vacant beds…" className="py-8" />
        ) : vacantQ.error ? (
          <ErrorState error={vacantQ.error} onRetry={() => void vacantQ.refetch()} className="py-8" />
        ) : vacant.length ? (
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {vacant.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBedId(b.id)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition',
                  bedId === b.id ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <p className="font-semibold text-slate-900">
                  Room {b.room.number} · {b.label}
                </p>
                <p className="text-xs text-slate-500">
                  {b.room.type === 'ac' ? 'AC' : 'Non-AC'} · {formatMoney(b.room.rentPerBed)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No vacant beds in this hostel.</p>
        )}
        {selected && selected.room.rentPerBed !== h.monthlyRent && (
          <div className="rounded-lg bg-amber-50 px-4 py-3">
            <Switch
              checked={updateRent}
              onChange={setUpdateRent}
              label={`Update monthly rent from ${formatMoney(h.monthlyRent)} to ${formatMoney(selected.room.rentPerBed)}`}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-b border-slate-100 px-5 py-5 last:border-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  )
}

function Inline({ children }: { children: ReactNode }) {
  return <div className="px-5 py-8 text-center text-sm text-slate-500">{children}</div>
}

function QueryBlock<T>({ q, children }: { q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (d: T) => ReactNode }) {
  if (q.isLoading) return <LoadingState className="py-10" />
  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 402) return <Inline>{q.error.message}</Inline>
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-10" />
  }
  if (q.data === undefined) return null
  return <>{children(q.data)}</>
}

function FeesTab({ h }: { h: HostelerDetailT }) {
  const invoicesQ = useInvoices({ hostelerId: h.id, limit: 500 })
  const paymentsQ = usePayments({ hostelerId: h.id, limit: 500 })
  const [payOpen, setPayOpen] = useState(false)
  const openInvoices = useMemo(
    () => (invoicesQ.data?.items ?? []).filter((i) => i.balance > 0 && !i.cancelled).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [invoicesQ.data],
  )
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="text-sm text-slate-600">
          Outstanding <b className={h.dues > 0 ? 'text-red-600' : 'text-emerald-600'}>{formatMoney(h.dues)}</b>
          {invoicesQ.data && ` across ${openInvoices.length} invoice(s)`}
        </div>
        <Button size="sm" icon={<IndianRupee className="h-4 w-4" />} onClick={() => setPayOpen(true)} disabled={h.status === 'checked_out' && h.dues <= 0}>
          Record payment
        </Button>
      </div>
      <CardHeader title="Invoices" className="border-t" />
      <QueryBlock q={invoicesQ}>
        {({ items: invoices }) =>
          invoices.length ? (
            <Table>
              <THead>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Month</TH>
                  <TH>Due date</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Balance</TH>
                  <TH>Status</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {invoices.map((inv) => (
                  <TR key={inv.id}>
                    <TD className="font-medium text-slate-900">{inv.number}</TD>
                    <TD>{formatMonth(inv.month)}</TD>
                    <TD className="whitespace-nowrap">{formatDate(inv.dueDate)}</TD>
                    <TD className="text-right">{formatMoney(inv.total)}</TD>
                    <TD className={cn('text-right', inv.balance > 0 && 'font-medium text-red-600')}>{formatMoney(inv.balance)}</TD>
                    <TD>
                      <StatusBadge status={inv.status} />
                    </TD>
                    <TD className="text-right">
                      <Link to={`/print/invoice/${inv.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                        <Printer className="h-3.5 w-3.5" /> Invoice
                      </Link>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <Inline>No invoices yet.</Inline>
          )
        }
      </QueryBlock>
      <CardHeader title="Payments" className="border-t" />
      <QueryBlock q={paymentsQ}>
        {({ items: payments }) =>
          payments.length ? (
            <Table>
              <THead>
                <tr>
                  <TH>Receipt</TH>
                  <TH>Date</TH>
                  <TH>Mode</TH>
                  <TH>For</TH>
                  <TH className="text-right">Amount</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {payments.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-slate-900">{p.receiptNo}</TD>
                    <TD className="whitespace-nowrap">{formatDate(p.date)}</TD>
                    <TD>
                      {p.mode.toUpperCase()}
                      {p.reference && <p className="text-xs text-slate-400">{p.reference}</p>}
                    </TD>
                    <TD className="text-slate-500">
                      {p.invoice ? p.invoice.number : p.kind === 'deposit' ? 'Security deposit' : p.note || titleCase(p.kind)}
                    </TD>
                    <TD className="text-right font-medium text-emerald-700">{formatMoney(p.amount)}</TD>
                    <TD className="text-right">
                      <Link to={`/print/receipt/${p.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                        <Printer className="h-3.5 w-3.5" /> Receipt
                      </Link>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <Inline>No payments recorded.</Inline>
          )
        }
      </QueryBlock>
      <RecordPaymentModal open={payOpen} onClose={() => setPayOpen(false)} hostelerId={h.id} />
    </div>
  )
}

function DocThumb({ d }: { d: DocumentRow }) {
  const isImg = d.mimeType.startsWith('image/')
  const { url } = useProtectedFileUrl(isImg ? `/documents/${d.id}/file` : null)
  if (isImg && url) return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
      <FileText className="h-5 w-5" />
    </div>
  )
}

function DocumentsTab({ h }: { h: HostelerDetailT }) {
  const docsQ = useDocuments({ hostelerId: h.id, limit: 200 })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [preview, setPreview] = useState<DocumentRow | null>(null)
  const update = useApiMutation(documentsApi.update, {
    invalidate: DOCUMENT_INVALIDATE,
    success: (d) => (d.verified ? 'Marked verified' : 'Marked unverified'),
  })
  const remove = useApiMutation(documentsApi.remove, { invalidate: DOCUMENT_INVALIDATE, success: 'Document deleted' })

  const removeDoc = async (d: DocumentRow) => {
    const ok = await confirm({ title: 'Delete document?', message: `${DOC_TYPE_LABELS[d.type]} (${d.fileName}) will be removed.`, danger: true, confirmText: 'Delete' })
    if (ok) remove.mutate(d.id)
  }
  const download = (d: DocumentRow) => downloadDocument(d).catch((e) => toastError(e, 'Download failed'))
  const docs = docsQ.data?.items ?? []

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-slate-600">
          {docsQ.data ? `${docsQ.data.total} document(s) · ${docs.filter((d) => d.verified).length} verified` : ' '}
        </p>
        <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
          Upload document
        </Button>
      </div>
      <QueryBlock q={docsQ}>
        {() =>
          docs.length ? (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {docs.map((d) => {
                const ex = expiryState(d.expiryDate)
                return (
                  <li key={d.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <DocThumb d={d} />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">
                          {DOC_TYPE_LABELS[d.type]}
                          {d.uploadedBy === 'hosteler' && <span className="ml-2 text-xs font-normal text-slate-400">via portal</span>}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {d.fileName} · {formatBytes(d.size)} · uploaded {formatDate(d.uploadedAt)}
                          {d.expiryDate && (
                            <span className={cn(ex === 'expired' && 'font-medium text-red-600', ex === 'soon' && 'font-medium text-amber-600')}>
                              {' '}
                              · {ex === 'expired' ? 'expired' : 'expires'} {formatDate(d.expiryDate)}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={d.verified}
                        disabled={update.isPending && update.variables?.id === d.id}
                        onChange={(v) => update.mutate({ id: d.id, verified: v })}
                        label={d.verified ? 'Verified' : 'Unverified'}
                      />
                      <IconButton label="Preview" onClick={() => setPreview(d)}>
                        <Eye className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Download" onClick={() => void download(d)}>
                        <Download className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label="Delete"
                        onClick={() => removeDoc(d)}
                        disabled={remove.isPending && remove.variables === d.id}
                        className="hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState icon={<FileText className="h-6 w-6" />} title="No documents" description="Upload Aadhaar, ID cards, police verification and more." />
          )
        }
      </QueryBlock>
      <UploadDocModal open={uploadOpen} onClose={() => setUploadOpen(false)} hostelerId={h.id} hostelerName={h.name} />
      <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function AttendanceTab({ h }: { h: HostelerDetailT }) {
  const [month, setMonth] = useState(currentMonth())
  const regQ = useAttendanceRegister(month, h.hostelId)
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <p className="text-sm text-slate-600">Monthly register</p>
        <Input type="month" className="w-44" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      <QueryBlock q={regQ}>
        {(reg) => {
          const row = reg.items.find((r) => r.hostelerId === h.id)
          const marked = row ? reg.days.filter((d) => row.days[d]).sort((a, b) => b.localeCompare(a)) : []
          const summary = { present: row?.present ?? 0, absent: row?.absent ?? 0, late: row?.late ?? 0, leave: row?.leave ?? 0 }
          return (
            <>
              <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
                {(
                  [
                    ['present', 'Present', 'text-emerald-600'],
                    ['absent', 'Absent', 'text-red-600'],
                    ['late', 'Late', 'text-amber-600'],
                    ['leave', 'On leave', 'text-violet-600'],
                  ] as const
                ).map(([k, label, color]) => (
                  <div key={k} className="rounded-lg border border-slate-200 px-4 py-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className={cn('text-xl font-bold', color)}>{summary[k]}</p>
                  </div>
                ))}
              </div>
              <p className="px-5 pb-2 text-xs text-slate-500">
                {formatMonth(reg.month)}
                {row?.percentage != null && ` · ${row.percentage}% attendance`}
              </p>
              {marked.length && row ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>Date</TH>
                      <TH>Day</TH>
                      <TH>Status</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {marked.map((d) => (
                      <TR key={d}>
                        <TD>{formatDate(d)}</TD>
                        <TD>{formatDate(d, 'EEEE')}</TD>
                        <TD>
                          <StatusBadge status={row.days[d]!} />
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Inline>No attendance marked in {formatMonth(reg.month)}.</Inline>
              )}
            </>
          )
        }}
      </QueryBlock>
    </div>
  )
}

function GateTab({ h }: { h: HostelerDetailT }) {
  const gateQ = useGateLogs({ hostelerId: h.id, limit: 100 })
  return (
    <QueryBlock q={gateQ}>
      {(data) =>
        data.items.length ? (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Direction</TH>
                  <TH>Note</TH>
                </tr>
              </THead>
              <tbody>
                {data.items.map((g) => (
                  <TR key={g.id} className={cn(g.late && 'bg-red-50/60')}>
                    <TD className="whitespace-nowrap">{formatDateTime(g.time)}</TD>
                    <TD>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={g.direction === 'in' ? 'green' : 'amber'}>{g.direction === 'in' ? 'IN' : 'OUT'}</Badge>
                        {g.late && <Badge tone="red">Late</Badge>}
                      </div>
                    </TD>
                    <TD className="text-slate-500">{g.note || '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {data.total > data.items.length && (
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                Showing latest {data.items.length} of {data.total}. See the gate log for everything.
              </p>
            )}
          </>
        ) : (
          <Inline>No gate entries.</Inline>
        )
      }
    </QueryBlock>
  )
}

function RequestsTab({ h, showComplaints, showLeaves }: { h: HostelerDetailT; showComplaints: boolean; showLeaves: boolean }) {
  const complaintsQ = useHostelerComplaints(h.id, showComplaints)
  const leavesQ = useHostelerLeaves(h.id, showLeaves)
  return (
    <div className={cn('grid grid-cols-1', showComplaints && showLeaves && 'lg:grid-cols-2')}>
      {showComplaints && (
        <div className={cn(showLeaves && 'border-b border-slate-100 lg:border-b-0 lg:border-r')}>
          <CardHeader title="Complaints" subtitle={complaintsQ.data ? `${complaintsQ.data.length} raised` : undefined} />
          <QueryBlock q={complaintsQ}>
            {(items) =>
              items.length ? (
                <ul className="divide-y divide-slate-100">
                  {items.map((c) => (
                    <li key={c.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">{c.title}</p>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {titleCase(c.category)} · {titleCase(c.priority)} priority · {formatDate(c.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Inline>No complaints.</Inline>
              )
            }
          </QueryBlock>
        </div>
      )}
      {showLeaves && (
        <div>
          <CardHeader title="Leave requests" subtitle={leavesQ.data ? `${leavesQ.data.length} requests` : undefined} />
          <QueryBlock q={leavesQ}>
            {(items) =>
              items.length ? (
                <ul className="divide-y divide-slate-100">
                  {items.map((l) => (
                    <li key={l.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {formatDate(l.from)} – {formatDate(l.to)}
                        </p>
                        <StatusBadge status={l.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {l.reason}
                        {l.destination && ` · ${l.destination}`}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Inline>No leave requests.</Inline>
              )
            }
          </QueryBlock>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Header photo                                                        */
/* ------------------------------------------------------------------ */

function ProfilePhoto({ h }: { h: HostelerDetailT }) {
  const { url } = useProtectedFileUrl(hostelerPhotoPath(h), h.updatedAt)
  const uploadPhoto = useApiMutation(hostelersApi.uploadPhoto, { invalidate: DOCUMENT_INVALIDATE, success: 'Photo updated' })
  return (
    <label className={cn('group relative shrink-0 cursor-pointer', uploadPhoto.isPending && 'pointer-events-none')} title="Change photo">
      <Avatar name={h.name} src={url} size="xl" />
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50 text-white transition',
          uploadPhoto.isPending ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {uploadPhoto.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
      </span>
      <input
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file && acceptFile(file, { photo: true })) uploadPhoto.mutate({ id: h.id, file })
        }}
      />
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HostelerDetail() {
  const { id = '' } = useParams()
  const q = useHosteler(id)

  if (q.isLoading) return <LoadingState />
  if (q.error || !q.data) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)
    return (
      <Card>
        {notFound ? (
          <EmptyState
            icon={<UserX className="h-6 w-6" />}
            title="Hosteler not found"
            description="This record may have been deleted."
            action={
              <Link to="/app/hostelers">
                <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />}>
                  Back to hostelers
                </Button>
              </Link>
            }
          />
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )}
      </Card>
    )
  }
  return <Profile h={q.data} />
}

function Profile({ h }: { h: HostelerDetailT }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const can = useCan()
  const role = useStaffSession()?.user.role
  const { data: org } = useOrg()
  const planHas = (m: string) => !org || org.limits.modules.includes(m)

  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [creds, setCreds] = useState<Credentials | null>(null)

  const canFees = can('fees') && planHas('fees')
  const canDocs = can('documents') && planHas('documents')
  const canAttendance = can('attendance') && planHas('attendance')
  const canGate = can('checkin') && planHas('checkin')
  const canComplaints = can('complaints') && planHas('complaints')
  const canCheckin = can('checkin')
  const canDelete = role === 'owner' || role === 'manager'

  // total paid (fees roles only)
  const paymentsQ = usePayments({ hostelerId: h.id, limit: 1 }, { enabled: canFees })
  const totalPaid = paymentsQ.data?.totals.amount ?? 0

  const confirmIn = useApiMutation(hostelersApi.confirmCheckIn, { invalidate: HOSTELER_INVALIDATE, success: `${h.name} checked in` })
  const messToggle = useApiMutation(hostelersApi.update, {
    invalidate: PROFILE_INVALIDATE,
    success: (r) => (r.messOpted ? 'Mess enabled' : 'Mess disabled'),
  })
  const reset = useApiMutation(hostelersApi.resetPassword, { invalidate: PROFILE_INVALIDATE, onSuccess: (c) => setCreds(c) })
  const remove = useMutation({
    mutationFn: hostelersApi.remove,
    onSuccess: () => {
      toast.success(`${h.name} deleted`)
      navigate('/app/hostelers', { replace: true })
      qc.removeQueries({ queryKey: ['hosteler', h.id] })
      for (const queryKey of HOSTELER_INVALIDATE.filter((k) => k[0] !== 'hosteler')) void qc.invalidateQueries({ queryKey })
    },
    onError: (e) => toastError(e),
  })

  const daysStayed =
    h.status === 'active'
      ? Math.max(daysBetween(h.checkInDate, today()), 0)
      : h.checkOutDate
        ? Math.max(daysBetween(h.checkInDate, h.checkOutDate), 0)
        : 0

  const doDelete = async () => {
    const ok = await confirm({
      title: `Delete ${h.name}?`,
      message:
        'This permanently removes the hosteler with all invoices, payments, documents, attendance and gate records. Prefer "Check out" for residents who are leaving.',
      danger: true,
      confirmText: 'Delete permanently',
    })
    if (ok) remove.mutate(h.id)
  }

  const doConfirm = async () => {
    const ok = await confirm({ title: 'Confirm check-in?', message: `${h.name} will be marked as checked in today.`, confirmText: 'Confirm check-in' })
    if (ok) confirmIn.mutate({ id: h.id, date: today() })
  }

  const resetPassword = async () => {
    const ok = await confirm({
      title: 'Reset & share portal login?',
      message: `${h.name}'s current password will stop working and they'll be signed out of the portal. A new temporary password is created, and they'll set their own on next login.`,
      confirmText: 'Reset password',
    })
    if (ok) reset.mutate(h.id)
  }

  const invite = (c: Credentials) => ({ name: h.name, phone: h.phone, loginId: c.loginId, tempPassword: c.tempPassword, hostelName: h.hostelName ?? 'the hostel' })

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    ...(canFees ? [{ value: 'fees' as Tab, label: 'Fees', count: h.counts.invoices || undefined }] : []),
    ...(canDocs ? [{ value: 'documents' as Tab, label: 'Documents', count: h.counts.documents }] : []),
    ...(canAttendance ? [{ value: 'attendance' as Tab, label: 'Attendance' }] : []),
    ...(canGate ? [{ value: 'gate' as Tab, label: 'Gate log' }] : []),
    ...(canComplaints || canAttendance
      ? [
          {
            value: 'requests' as Tab,
            label: canComplaints && canAttendance ? 'Complaints & leaves' : canComplaints ? 'Complaints' : 'Leaves',
            count: (canComplaints ? h.counts.complaints : 0) + (canAttendance ? h.counts.leaves : 0) || undefined,
          },
        ]
      : []),
  ]
  const activeTab = tabs.some((t) => t.value === tab) ? tab : 'overview'

  return (
    <>
      <Link to="/app/hostelers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> All hostelers
      </Link>

      {/* Header card */}
      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <ProfilePhoto h={h} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{h.name}</h1>
                <StatusBadge status={h.status} />
                {h.dues > 0 && <Badge tone="red">Dues {formatMoney(h.dues)}</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-mono font-medium text-slate-800">{h.loginId}</span> ·{' '}
                {h.status === 'checked_out' ? `Checked out on ${formatDate(h.checkOutDate)}` : bedText(h)} · {h.hostelName ?? '—'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`tel:${h.phone}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Phone className="h-3.5 w-3.5" /> {h.phone}
                </a>
                <a
                  href={whatsappLink(h.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            {h.status === 'reserved' && canCheckin && (
              <Button variant="success" size="sm" icon={<UserCheck className="h-4 w-4" />} onClick={doConfirm} loading={confirmIn.isPending}>
                Confirm check-in
              </Button>
            )}
            <Button variant="outline" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            {h.status !== 'checked_out' && canCheckin && (
              <Button variant="outline" size="sm" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTransferOpen(true)}>
                Transfer bed
              </Button>
            )}
            {h.status === 'active' && canCheckin && (
              <Button variant="outline" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={() => navigate(`/app/check-out?h=${h.id}`)}>
                Check out
              </Button>
            )}
            {h.status !== 'checked_out' && (
              <Button variant="outline" size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={resetPassword} loading={reset.isPending}>
                Reset & share login
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={doDelete}
                loading={remove.isPending}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Monthly rent</p>
            <p className="font-semibold text-slate-900">{formatMoney(h.monthlyRent)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Outstanding</p>
            <p className={cn('font-semibold', h.dues > 0 ? 'text-red-600' : 'text-emerald-600')}>{formatMoney(h.dues)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{canFees ? 'Total paid' : 'Deposit collected'}</p>
            <p className="font-semibold text-slate-900">{canFees ? (paymentsQ.data ? formatMoney(totalPaid) : '…') : formatMoney(h.depositCollected)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{h.status === 'reserved' ? 'Expected check-in' : 'Days stayed'}</p>
            <p className="font-semibold text-slate-900">{h.status === 'reserved' ? formatDate(h.checkInDate) : `${daysStayed} days`}</p>
          </div>
        </div>
      </Card>

      <Card>
        <Tabs<Tab> className="px-2" tabs={tabs} value={activeTab} onChange={setTab} />

        {activeTab === 'overview' && (
          <div>
            <Section title="Personal">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Full name', value: h.name },
                  { label: 'Phone', value: h.phone },
                  { label: 'Email', value: h.email },
                  { label: 'Gender', value: titleCase(h.gender) },
                  { label: 'Date of birth', value: h.dob ? formatDate(h.dob) : '' },
                  { label: 'Blood group', value: h.bloodGroup },
                  { label: 'Permanent address', value: h.permanentAddress },
                ]}
              />
            </Section>
            <Section title={h.occupation === 'working' ? 'Work' : 'Academic'}>
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Occupation', value: titleCase(h.occupation) },
                  { label: h.occupation === 'working' ? 'Company' : 'Institution', value: h.institution },
                  { label: h.occupation === 'working' ? 'Designation' : 'Course', value: h.course },
                ]}
              />
            </Section>
            <Section title="Guardian">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Name', value: h.guardianName },
                  { label: 'Relation', value: h.guardianRelation },
                  {
                    label: 'Phone',
                    value: h.guardianPhone ? (
                      <a href={`tel:${h.guardianPhone}`} className="text-brand-600 hover:underline">
                        {h.guardianPhone}
                      </a>
                    ) : (
                      ''
                    ),
                  },
                ]}
              />
            </Section>
            <Section title="ID proof">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Type', value: h.idProofType },
                  { label: 'Number', value: h.idProofNumber },
                ]}
              />
            </Section>
            <Section title="Stay & rent">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Hostel', value: h.hostelName ?? '' },
                  { label: 'Room / bed', value: bedText(h) },
                  { label: 'Check-in date', value: formatDate(h.checkInDate) },
                  { label: 'Expected check-out', value: h.expectedCheckOut ? formatDate(h.expectedCheckOut) : '' },
                  { label: 'Checked out', value: h.checkOutDate ? formatDate(h.checkOutDate) : '' },
                  { label: 'Monthly rent', value: formatMoney(h.monthlyRent) },
                  {
                    label: 'Mess',
                    value: (
                      <Switch
                        checked={h.messOpted}
                        disabled={h.status === 'checked_out' || messToggle.isPending}
                        onChange={(v) => messToggle.mutate({ id: h.id, messOpted: v })}
                        label={h.messOpted ? 'Opted' : 'Not opted'}
                      />
                    ),
                  },
                  {
                    label: 'Last gate entry',
                    value: h.lastGateLog ? `${h.lastGateLog.direction.toUpperCase()} · ${formatDateTime(h.lastGateLog.time)}` : '',
                  },
                ]}
              />
            </Section>
            <Section
              title="Portal account"
              action={
                h.status !== 'checked_out' && (
                  <Button size="sm" variant="outline" icon={<KeyRound className="h-4 w-4" />} onClick={resetPassword} loading={reset.isPending}>
                    Reset & share login
                  </Button>
                )
              }
            >
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Hosteler ID', value: <span className="font-mono font-semibold">{h.loginId}</span> },
                  {
                    label: 'Status',
                    value:
                      h.status === 'checked_out' ? (
                        <Badge>Closed</Badge>
                      ) : h.mustChangePassword ? (
                        <Badge tone="amber">Waiting for first login</Badge>
                      ) : (
                        <Badge tone="green">Active</Badge>
                      ),
                  },
                  { label: 'Password set on', value: h.passwordChangedAt ? formatDate(h.passwordChangedAt) : h.mustChangePassword ? 'Not yet' : '' },
                  { label: 'Last login', value: h.lastLoginAt ? formatDateTime(h.lastLoginAt) : 'Never' },
                ]}
              />
              {h.mustChangePassword && h.status !== 'checked_out' && (
                <p className="mt-3 text-xs text-slate-500">
                  The temporary password is shown only once. If the resident lost it, use “Reset & share login” to send a new one.
                </p>
              )}
            </Section>
            <Section title="Security deposit">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Deposit amount', value: formatMoney(h.securityDeposit) },
                  { label: 'Collected', value: formatMoney(h.depositCollected) },
                  { label: 'Refunded', value: h.depositRefunded !== null ? formatMoney(h.depositRefunded) : '' },
                ]}
              />
            </Section>
            <Section title="Notes">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{h.notes || <span className="text-slate-400">No notes.</span>}</p>
            </Section>
          </div>
        )}

        {activeTab === 'fees' && <FeesTab h={h} />}
        {activeTab === 'documents' && <DocumentsTab h={h} />}
        {activeTab === 'attendance' && <AttendanceTab h={h} />}
        {activeTab === 'gate' && <GateTab h={h} />}
        {activeTab === 'requests' && <RequestsTab h={h} showComplaints={canComplaints} showLeaves={canAttendance} />}
      </Card>

      <EditModal open={editOpen} onClose={() => setEditOpen(false)} h={h} />
      {canCheckin && <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} h={h} />}
      <Modal
        open={!!creds}
        onClose={() => setCreds(null)}
        size="sm"
        title="Password reset"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreds(null)}>
              Done
            </Button>
            {creds && (
              <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => void copyText(portalInviteText(invite(creds)), 'Login details copied')}>
                Copy
              </Button>
            )}
            {creds && (
              <a href={portalInviteWhatsApp(invite(creds))} target="_blank" rel="noreferrer">
                <Button variant="success" icon={<MessageCircle className="h-4 w-4" />}>
                  Send on WhatsApp
                </Button>
              </a>
            )}
          </>
        }
      >
        {creds && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
            <p className="text-sm text-slate-600">Share these with {h.name}. They'll create a new password when they log in.</p>
            <p className="mt-4 text-xs text-slate-500">Hosteler ID</p>
            <p className="font-mono text-xl font-bold text-slate-900">{creds.loginId}</p>
            <p className="mt-3 text-xs text-slate-500">Temporary password</p>
            <p className="font-mono text-2xl font-bold tracking-wider text-brand-700">{creds.tempPassword}</p>
            <p className="mt-4 text-xs text-amber-700">This password won't be shown again — share it now.</p>
          </div>
        )}
      </Modal>
    </>
  )
}

