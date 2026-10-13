import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, Clock, Download, Eye, FileText, Files, ShieldAlert, Trash2, Upload } from 'lucide-react'
import { useScope } from '@/api/common'
import { toastError, useApiMutation } from '@/api/query'
import {
  DOCUMENT_INVALIDATE,
  documentsApi,
  downloadDocument,
  useDocuments,
  useMissingDocuments,
  type DocumentListParams,
  type DocumentRow,
} from '@/api/documents'
import type { DocumentType, ID } from '@/api/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
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
} from '@/components/ui'
import { cn, formatBytes, formatDate } from '@/lib/utils'
import { DOC_TYPE_LABELS, DOC_TYPE_OPTIONS, DocPreviewModal, FilterBar, Pager, UploadDocModal, expiryState } from './_residents'

const PAGE_SIZE = 50

export default function Documents() {
  const scope = useScope()

  const [type, setType] = useState('')
  const [verified, setVerified] = useState('')
  const [expiry, setExpiry] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState<DocumentRow | null>(null)
  const [upload, setUpload] = useState<{ hostelerId: ID | null; hostelerName?: string; type: DocumentType } | null>(null)

  useEffect(() => setPage(1), [type, verified, expiry, scope])

  // expiry filters: 'attention' / 'soon' / 'expired' all use the server's "expiring within 30 days" filter
  const params: DocumentListParams = {
    hostelId: scope,
    type: (type || undefined) as DocumentType | undefined,
    verified: verified === 'yes' ? 'true' : verified === 'no' ? 'false' : undefined,
    expiring: expiry ? 30 : undefined,
  }
  const list = useDocuments({ ...params, page, limit: PAGE_SIZE })
  const totalQ = useDocuments({ hostelId: scope, limit: 1 })
  const verifiedQ = useDocuments({ hostelId: scope, verified: 'true', limit: 1 })
  const pendingQ = useDocuments({ hostelId: scope, verified: 'false', limit: 1 })
  const attentionQ = useDocuments({ hostelId: scope, expiring: 30, limit: 500 })
  const missingQ = useMissingDocuments(scope)

  const update = useApiMutation(documentsApi.update, {
    invalidate: DOCUMENT_INVALIDATE,
    success: (d) => (d.verified ? 'Document verified' : 'Marked as unverified'),
  })
  const del = useApiMutation(documentsApi.remove, { invalidate: DOCUMENT_INVALIDATE, success: 'Document deleted' })

  const attention = useMemo(() => {
    let soon = 0
    let expired = 0
    for (const d of attentionQ.data?.items ?? []) {
      const e = expiryState(d.expiryDate)
      if (e === 'soon') soon++
      if (e === 'expired') expired++
    }
    return { soon, expired }
  }, [attentionQ.data])

  const term = q.trim().toLowerCase()
  const rows = useMemo(
    () =>
      (list.data?.items ?? []).filter((d) => {
        if (expiry === 'soon' && expiryState(d.expiryDate) !== 'soon') return false
        if (expiry === 'expired' && expiryState(d.expiryDate) !== 'expired') return false
        if (term && !`${d.hostelerName ?? ''} ${d.hostelerLoginId ?? ''} ${d.fileName}`.toLowerCase().includes(term)) return false
        return true
      }),
    [list.data, expiry, term],
  )

  const toggleVerify = (d: DocumentRow) => update.mutate({ id: d.id, verified: !d.verified })

  const remove = async (d: DocumentRow) => {
    const ok = await confirm({
      title: 'Delete document?',
      message: `${DOC_TYPE_LABELS[d.type]} of ${d.hostelerName ?? 'this resident'} (${d.fileName}) will be permanently removed.`,
      danger: true,
      confirmText: 'Delete',
    })
    if (ok) del.mutate(d.id)
  }

  const download = (d: DocumentRow) => downloadDocument(d).catch((e) => toastError(e, 'Download failed'))

  const anyFilter = !!(type || verified || expiry || q)
  const n = (x: { data?: { total: number } }) => (x.data ? x.data.total : '…')

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
        <StatCard label="Total documents" value={n(totalQ)} icon={<Files className="h-5 w-5" />} />
        <StatCard label="Verified" value={n(verifiedQ)} icon={<BadgeCheck className="h-5 w-5" />} tone="green" onClick={() => setVerified('yes')} />
        <StatCard label="Pending verification" value={n(pendingQ)} icon={<Clock className="h-5 w-5" />} tone="amber" onClick={() => setVerified('no')} />
        <StatCard
          label="Expiring / expired"
          value={attentionQ.data ? attention.soon + attention.expired : '…'}
          hint={`${attention.soon} in 30 days · ${attention.expired} expired`}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="red"
          onClick={() => setExpiry('attention')}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="border-b border-slate-100 p-4">
            <FilterBar>
              <SearchInput value={q} onChange={setQ} placeholder="Filter by resident or file…" className="col-span-2 sm:w-64" />
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
          {list.isLoading ? (
            <LoadingState />
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : rows.length ? (
            <Table className={cn(list.isPlaceholderData && 'opacity-60')}>
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
                {rows.map((d) => {
                  const e = expiryState(d.expiryDate)
                  const busy = (update.isPending && update.variables?.id === d.id) || (del.isPending && del.variables === d.id)
                  return (
                    <TR key={d.id}>
                      <TD>
                        <Link to={`/app/hostelers/${d.hostelerId}`} className="flex items-center gap-2 hover:underline">
                          <Avatar name={d.hostelerName ?? '?'} size="sm" />
                          <div className="min-w-0">
                            <span className="block whitespace-nowrap font-medium text-slate-900">{d.hostelerName ?? 'Unknown'}</span>
                            {d.hostelerLoginId && <span className="font-mono text-xs text-slate-500">{d.hostelerLoginId}</span>}
                          </div>
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap">
                        {DOC_TYPE_LABELS[d.type]}
                        {d.uploadedBy === 'hosteler' && <p className="text-xs text-slate-400">via portal</p>}
                      </TD>
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
                        <button type="button" onClick={() => toggleVerify(d)} disabled={busy} title="Toggle verification">
                          {d.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Pending</Badge>}
                        </button>
                      </TD>
                      <TD className="text-right">
                        <div className="inline-flex items-center">
                          <IconButton label="Preview" onClick={() => setPreview(d)}>
                            <Eye className="h-4 w-4" />
                          </IconButton>
                          <IconButton label="Download" onClick={() => void download(d)}>
                            <Download className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={d.verified ? 'Mark unverified' : 'Verify'}
                            onClick={() => toggleVerify(d)}
                            disabled={busy}
                            className={d.verified ? 'text-emerald-600' : ''}
                          >
                            <BadgeCheck className="h-4 w-4" />
                          </IconButton>
                          <IconButton label="Delete" onClick={() => remove(d)} disabled={busy} className="hover:text-red-600">
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
              title={anyFilter ? 'No documents match' : 'No documents yet'}
              description={anyFilter ? 'Try clearing a filter.' : 'Upload Aadhaar, ID cards and police verification for your residents.'}
            />
          )}
          {list.data && (
            <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={setPage} busy={list.isFetching} noun="documents" />
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
          {missingQ.isLoading ? (
            <LoadingState className="py-10" />
          ) : missingQ.error ? (
            <ErrorState error={missingQ.error} onRetry={() => void missingQ.refetch()} className="py-10" />
          ) : missingQ.data?.length ? (
            <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
              {missingQ.data.map(({ hosteler: h, lacks }) => (
                <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={h.name} size="sm" />
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
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Upload className="h-3.5 w-3.5" />}
                    onClick={() => setUpload({ hostelerId: h.id, hostelerName: h.name, type: lacks[0]! })}
                  >
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

      <UploadDocModal
        open={!!upload}
        onClose={() => setUpload(null)}
        hostelerId={upload?.hostelerId ?? null}
        hostelerName={upload?.hostelerName}
        defaultType={upload?.type ?? 'aadhaar'}
      />
      <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />
    </>
  )
}
