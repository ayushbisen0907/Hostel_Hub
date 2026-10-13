import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, UserPlus, Users } from 'lucide-react'
import { useScope } from '@/api/common'
import { toastError } from '@/api/query'
import { useCan } from '@/api/session'
import { hostelersApi, useHostelers, type HostelerListParams } from '@/api/hostelers'
import type { Hosteler, HostelerStatus } from '@/api/types'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  toast,
} from '@/components/ui'
import { cn, downloadCsv, formatDate, formatMoney, today } from '@/lib/utils'
import { FilterBar, HostelerAvatar, OCCUPATION_OPTIONS, Pager, bedText, useDebounced } from './_residents'

type Tab = HostelerStatus | 'all'
const PAGE_SIZE = 50

export default function Hostelers() {
  const navigate = useNavigate()
  const can = useCan()
  const scope = useScope()

  const [tab, setTab] = useState<Tab>('active')
  const [q, setQ] = useState('')
  const [occupation, setOccupation] = useState('')
  const [mess, setMess] = useState('')
  const [dues, setDues] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)

  const term = useDebounced(q.trim(), 300)

  // filters shared by the list and the tab counts
  const filters: Omit<HostelerListParams, 'status' | 'page' | 'limit'> = {
    hostelId: scope,
    q: term || undefined,
    occupation: (occupation || undefined) as Hosteler['occupation'] | undefined,
    messOpted: mess === 'yes' ? 'true' : mess === 'no' ? 'false' : undefined,
    hasDues: dues === 'yes' ? 'true' : dues === 'no' ? 'false' : undefined,
  }

  useEffect(() => setPage(1), [tab, term, occupation, mess, dues, scope])

  const list = useHostelers({ ...filters, status: tab, page, limit: PAGE_SIZE })
  const cActive = useHostelers({ ...filters, status: 'active', limit: 1 })
  const cReserved = useHostelers({ ...filters, status: 'reserved', limit: 1 })
  const cOut = useHostelers({ ...filters, status: 'checked_out', limit: 1 })
  const cAll = useHostelers({ ...filters, status: 'all', limit: 1 })

  const rows = list.data?.items ?? []
  const anyFilter = !!(q || occupation || mess || dues)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await hostelersApi.listAll({ ...filters, status: tab })
      if (!all.length) return toast.info('Nothing to export')
      downloadCsv(`hostelers-${today()}.csv`, [
        [
          'Hosteler ID',
          'Name',
          'Phone',
          'Email',
          'Hostel',
          'Room / Bed',
          'Status',
          'Occupation',
          'Institution',
          'Course',
          'Check-in',
          'Check-out',
          'Monthly rent',
          'Security deposit',
          'Dues',
          'Mess',
          'Guardian',
          'Guardian phone',
        ],
        ...all.map((h) => [
          h.loginId,
          h.name,
          h.phone,
          h.email,
          h.hostelName ?? '',
          bedText(h, ''),
          h.status,
          h.occupation,
          h.institution,
          h.course,
          h.checkInDate,
          h.checkOutDate,
          h.monthlyRent,
          h.securityDeposit,
          h.dues,
          h.messOpted ? 'Yes' : 'No',
          h.guardianName,
          h.guardianPhone,
        ]),
      ])
    } catch (e) {
      toastError(e)
    } finally {
      setExporting(false)
    }
  }

  const n = (x: { data?: { total: number } }) => x.data?.total

  return (
    <>
      <PageHeader
        title="Hostelers"
        subtitle={cActive.data && cReserved.data ? `${cActive.data.total} living now · ${cReserved.data.total} reserved` : undefined}
        actions={
          <>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} loading={exporting} disabled={!rows.length}>
              Export CSV
            </Button>
            {can('checkin') && (
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => navigate('/app/check-in')}>
                New check-in
              </Button>
            )}
          </>
        }
      />

      <Card>
        <Tabs<Tab>
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'active', label: 'Active', count: n(cActive) },
            { value: 'reserved', label: 'Reserved', count: n(cReserved) },
            { value: 'checked_out', label: 'Checked out', count: n(cOut) },
            { value: 'all', label: 'All', count: n(cAll) },
          ]}
        />
        <div className="border-b border-slate-100 p-4">
          <FilterBar>
            <SearchInput value={q} onChange={setQ} placeholder="Search name, phone, Hosteler ID, college…" className="col-span-2 sm:w-80" />
            <Select className="sm:w-48" value={occupation} placeholder="All occupations" options={OCCUPATION_OPTIONS} onChange={(e) => setOccupation(e.target.value)} />
            <Select
              className="sm:w-40"
              value={mess}
              placeholder="Mess: any"
              options={[
                { value: 'yes', label: 'Mess opted' },
                { value: 'no', label: 'No mess' },
              ]}
              onChange={(e) => setMess(e.target.value)}
            />
            <Select
              className="sm:w-40"
              value={dues}
              placeholder="Dues: any"
              options={[
                { value: 'yes', label: 'Has dues' },
                { value: 'no', label: 'No dues' },
              ]}
              onChange={(e) => setDues(e.target.value)}
            />
            {anyFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQ('')
                  setOccupation('')
                  setMess('')
                  setDues('')
                }}
              >
                Clear
              </Button>
            )}
          </FilterBar>
        </div>

        {list.isLoading ? (
          <LoadingState label="Loading hostelers…" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={anyFilter ? 'No hostelers match' : tab === 'all' || tab === 'active' ? 'No hostelers yet' : 'Nobody here'}
            description={anyFilter ? 'Try a different search or filter.' : tab === 'active' || tab === 'all' ? 'Check in your first resident to get started.' : undefined}
            action={
              !anyFilter &&
              (tab === 'active' || tab === 'all') &&
              can('checkin') && (
                <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => navigate('/app/check-in')}>
                  New check-in
                </Button>
              )
            }
          />
        ) : (
          <Table className={cn(list.isPlaceholderData && 'opacity-60')}>
            <THead>
              <tr>
                <TH>Hosteler</TH>
                <TH>Room / bed</TH>
                <TH>Institution</TH>
                <TH>Check-in</TH>
                <TH className="text-right">Rent</TH>
                <TH className="text-right">Dues</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((h) => (
                <TR key={h.id} onClick={() => navigate(`/app/hostelers/${h.id}`)}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <HostelerAvatar h={h} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{h.name}</p>
                        <p className="text-xs text-slate-500">
                          {h.phone} · <span className="font-mono">{h.loginId}</span>
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {bedText(h)}
                    {scope === 'all' && <p className="text-xs text-slate-400">{h.hostelName ?? '—'}</p>}
                  </TD>
                  <TD>
                    <p className="max-w-[12rem] truncate">{h.institution || '—'}</p>
                    {h.course && <p className="max-w-[12rem] truncate text-xs text-slate-400">{h.course}</p>}
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(h.checkInDate)}</TD>
                  <TD className="whitespace-nowrap text-right">{formatMoney(h.monthlyRent)}</TD>
                  <TD className={cn('whitespace-nowrap text-right font-medium', h.dues > 0 ? 'text-red-600' : 'text-slate-400')}>
                    {h.dues > 0 ? formatMoney(h.dues) : '—'}
                  </TD>
                  <TD>
                    <StatusBadge status={h.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && (
          <Pager
            page={list.data.page}
            pages={list.data.pages}
            total={list.data.total}
            limit={list.data.limit}
            onPage={setPage}
            busy={list.isFetching}
            noun="hostelers"
          />
        )}
      </Card>
    </>
  )
}
