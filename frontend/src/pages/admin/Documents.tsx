import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, Clock, Download, Eye, FileText, Files, ShieldAlert, Trash2, Upload } from 'lucide-react'
import { useStore } from '@/store'
import { inScope, useHostelerMap, useScope } from '@/store/selectors'
import type { DocumentType, HDocument, ID } from '@/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  Table,
  TD,
  TH,
  THead,
  TR,
  confirm,
  toast,
} from '@/components/ui'
import { cn, formatBytes, formatDate } from '@/lib/utils'
import { DOC_TYPE_LABELS, DOC_TYPE_OPTIONS, DocPreviewModal, FilterBar, UploadDocModal, expiryState } from './_residents'

const REQUIRED: DocumentType[] = ['aadhaar', 'police_verification']

export default function Documents() {
  const scope = useScope()
  const documents = useStore((s) => s.documents)
  const hostelers = useStore((s) => s.hostelers)
  const updateDocument = useStore((s) => s.updateDocument)
  const deleteDocument = useStore((s) => s.deleteDocument)
  const hostelerMap = useHostelerMap()

  const [type, setType] = useState('')
  const [verified, setVerified] = useState('')
  const [expiry, setExpiry] = useState('')
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<HDocument | null>(null)
  const [upload, setUpload] = useState<{ hostelerId: ID | null; type: DocumentType } | null>(null)

  const docs = useMemo(
    () =>
      documents
        .filter((d) => {
          const h = hostelerMap.get(d.hostelerId)
          return h && inScope(h.hostelId, scope)
        })
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [documents, hostelerMap, scope],
  )

  const stats = useMemo(() => {
    let v = 0
    let soon = 0
    let expired = 0
    for (const d of docs) {
      if (d.verified) v++
      const e = expiryState(d.expiryDate)
      if (e === 'soon') soon++
      if (e === 'expired') expired++
    }
    return { total: docs.length, verified: v, pending: docs.length - v, soon, expired }
  }, [docs])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return docs.filter((d) => {
      if (type && d.type !== type) return false
      if (verified === 'yes' && !d.verified) return false
      if (verified === 'no' && d.verified) return false
      if (expiry) {
        const e = expiryState(d.expiryDate)
        if (expiry === 'attention' ? e !== 'expired' && e !== 'soon' : e !== expiry) return false
      }
      if (term) {
        const h = hostelerMap.get(d.hostelerId)
        if (!`${h?.name ?? ''} ${h?.phone ?? ''} ${d.fileName}`.toLowerCase().includes(term)) return false
      }
      return true
    })
  }, [docs, type, verified, expiry, q, hostelerMap])

  const missing = useMemo(() => {
    const have = new Map<ID, Set<DocumentType>>()
    for (const d of documents) {
      const s = have.get(d.hostelerId) ?? new Set<DocumentType>()
      s.add(d.type)
      have.set(d.hostelerId, s)
    }
    return hostelers
      .filter((h) => h.status === 'active' && inScope(h.hostelId, scope))
      .map((h) => ({ h, lacks: REQUIRED.filter((t) => !have.get(h.id)?.has(t)) }))
      .filter((x) => x.lacks.length > 0)
      .sort((a, b) => b.lacks.length - a.lacks.length || a.h.name.localeCompare(b.h.name))
  }, [documents, hostelers, scope])

  const toggleVerify = (d: HDocument) => {
    updateDocument(d.id, { verified: !d.verified })
    toast.success(d.verified ? 'Marked as unverified' : 'Document verified')
  }

  const remove = async (d: HDocument) => {
    const h = hostelerMap.get(d.hostelerId)
    const ok = await confirm({
      title: 'Delete document?',
      message: `${DOC_TYPE_LABELS[d.type]} of ${h?.name ?? 'this resident'} (${d.fileName}) will be permanently removed.`,
      danger: true,
      confirmText: 'Delete',
    })
    if (!ok) return
    deleteDocument(d.id)
    toast.success('Document deleted')
  }

  const anyFilter = !!(type || verified || expiry || q)

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle="KYC and verification records of your residents."
        actions={
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => setUpload({ hostelerId: null, type: 'aadhaar' })}>
            Upload document
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total documents" value={stats.total} icon={<Files className="h-5 w-5" />} />
        <StatCard label="Verified" value={stats.verified} icon={<BadgeCheck className="h-5 w-5" />} tone="green" onClick={() => setVerified('yes')} />
        <StatCard label="Pending verification" value={stats.pending} icon={<Clock className="h-5 w-5" />} tone="amber" onClick={() => setVerified('no')} />
        <StatCard
          label="Expiring / expired"
          value={stats.soon + stats.expired}
          hint={`${stats.soon} in 30 days · ${stats.expired} expired`}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="red"
          onClick={() => setExpiry('attention')}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="border-b border-slate-100 p-4">
            <FilterBar>
              <SearchInput value={q} onChange={setQ} placeholder="Search by resident or file…" className="col-span-2 sm:w-64" />
              <Select className="sm:w-48" value={type} placeholder="All types" options={DOC_TYPE_OPTIONS} onChange={(e) => setType(e.target.value)} />
              <Select
                className="sm:w-40"
                value={verified}
                placeholder="Any status"
                options={[
                  { value: 'yes', label: 'Verified' },
                  { value: 'no', label: 'Pending' },
                ]}
                onChange={(e) => setVerified(e.target.value)}
              />
              <Select
                className="sm:w-44"
                value={expiry}
                placeholder="Any expiry"
                options={[
                  { value: 'attention', label: 'Expired or expiring' },
                  { value: 'expired', label: 'Expired' },
                  { value: 'soon', label: 'Expiring in 30 days' },
                  { value: 'ok', label: 'Valid' },
                  { value: 'none', label: 'No expiry' },
                ]}
                onChange={(e) => setExpiry(e.target.value)}
              />
              {anyFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setType('')
                    setVerified('')
                    setExpiry('')
                    setQ('')
                  }}
                >
                  Clear
                </Button>
              )}
            </FilterBar>
          </div>
          {filtered.length ? (
            <Table>
              <THead>
                <tr>
                  <TH>Hosteler</TH>
                  <TH>Type</TH>
                  <TH>File</TH>
                  <TH>Uploaded</TH>
                  <TH>Expiry</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <tbody>
                {filtered.map((d) => {
                  const h = hostelerMap.get(d.hostelerId)
                  const e = expiryState(d.expiryDate)
                  return (
                    <TR key={d.id}>
                      <TD>
                        {h ? (
                          <Link to={`/app/hostelers/${h.id}`} className="flex items-center gap-2 hover:underline">
                            <Avatar name={h.name} src={h.photo} size="sm" />
                            <span className="whitespace-nowrap font-medium text-slate-900">{h.name}</span>
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">{DOC_TYPE_LABELS[d.type]}</TD>
                      <TD>
                        <button type="button" onClick={() => setPreview(d)} className="flex max-w-[11rem] items-center gap-1.5 text-left text-brand-600 hover:underline">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate">{d.fileName}</span>
                        </button>
                        <p className="text-xs text-slate-400">{formatBytes(d.size)}</p>
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(d.uploadedAt)}</TD>
                      <TD className={cn('whitespace-nowrap', e === 'expired' && 'font-medium text-red-600', e === 'soon' && 'font-medium text-amber-600')}>
                        {d.expiryDate ? formatDate(d.expiryDate) : '—'}
                        {e === 'expired' && <p className="text-xs">Expired</p>}
                        {e === 'soon' && <p className="text-xs">Expiring soon</p>}
                      </TD>
                      <TD>
                        <button type="button" onClick={() => toggleVerify(d)} title="Toggle verification">
                          {d.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Pending</Badge>}
                        </button>
                      </TD>
                      <TD className="text-right">
                        <div className="inline-flex items-center">
                          <IconButton label="Preview" onClick={() => setPreview(d)}>
                            <Eye className="h-4 w-4" />
                          </IconButton>
                          <a
                            href={d.dataUrl}
                            download={d.fileName}
                            title="Download"
                            aria-label="Download"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                          <IconButton label={d.verified ? 'Mark unverified' : 'Verify'} onClick={() => toggleVerify(d)} className={d.verified ? 'text-emerald-600' : ''}>
                            <BadgeCheck className="h-4 w-4" />
                          </IconButton>
                          <IconButton label="Delete" onClick={() => remove(d)} className="hover:text-red-600">
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              icon={<Files className="h-6 w-6" />}
              title={docs.length ? 'No documents match' : 'No documents yet'}
              description={docs.length ? 'Try clearing a filter.' : 'Upload Aadhaar, ID cards and police verification for your residents.'}
            />
          )}
        </Card>

        <Card className="self-start">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-500" /> Missing documents
              </span>
            }
            subtitle="Active residents without Aadhaar or police verification"
          />
          {missing.length ? (
            <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
              {missing.map(({ h, lacks }) => (
                <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={h.name} src={h.photo} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/app/hostelers/${h.id}`} className="block truncate text-sm font-medium text-slate-900 hover:underline">
                      {h.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {lacks.map((t) => (
                        <Badge key={t} tone="red">
                          {DOC_TYPE_LABELS[t]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setUpload({ hostelerId: h.id, type: lacks[0]! })}>
                    Upload
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <BadgeCheck className="mb-2 h-8 w-8 text-emerald-500" />
              <p className="text-sm text-slate-600">All active residents have the required documents.</p>
            </div>
          )}
        </Card>
      </div>

      <UploadDocModal open={!!upload} onClose={() => setUpload(null)} hostelerId={upload?.hostelerId ?? null} defaultType={upload?.type ?? 'aadhaar'} />
      <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />
    </>
  )
}
