import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, UserPlus, Users } from 'lucide-react'
import { useStore } from '@/store'
import { bedLabel, hostelerDues, useHostelName, useScopedHostelers, useScope } from '@/store/selectors'
import type { HostelerStatus } from '@/types'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
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
} from '@/components/ui'
import { cn, downloadCsv, formatDate, formatMoney, today } from '@/lib/utils'
import { FilterBar, OCCUPATION_OPTIONS } from './_residents'

type Tab = HostelerStatus | 'all'

export default function Hostelers() {
  const navigate = useNavigate()
  const scope = useScope()
  const all = useScopedHostelers({ includeCheckedOut: true })
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const hostelName = useHostelName()

  const [tab, setTab] = useState<Tab>('active')
  const [q, setQ] = useState('')
  const [occupation, setOccupation] = useState('')
  const [mess, setMess] = useState('')
  const [dues, setDues] = useState('')

  const rows = useMemo(() => {
    const db = { rooms, beds, invoices, payments }
    return all.map((h) => ({ h, bed: h.status === 'checked_out' ? '—' : bedLabel(db, h.bedId), dues: hostelerDues(db, h.id) }))
  }, [all, rooms, beds, invoices, payments])

  const counts = useMemo(() => {
    const c = { active: 0, reserved: 0, checked_out: 0, all: rows.length }
    for (const r of rows) c[r.h.status]++
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows
      .filter(({ h, bed, dues: d }) => {
        if (tab !== 'all' && h.status !== tab) return false
        if (occupation && h.occupation !== occupation) return false
        if (mess === 'yes' && !h.messOpted) return false
        if (mess === 'no' && h.messOpted) return false
        if (dues === 'yes' && d <= 0) return false
        if (dues === 'no' && d > 0) return false
        if (term) {
          const hay = `${h.name} ${h.phone} ${bed} ${h.institution}`.toLowerCase()
          if (!hay.includes(term)) return false
        }
        return true
      })
      .sort((a, b) => a.h.name.localeCompare(b.h.name))
  }, [rows, tab, q, occupation, mess, dues])

  const exportCsv = () => {
    downloadCsv(`hostelers-${today()}.csv`, [
      ['Name', 'Phone', 'Email', 'Hostel', 'Room / Bed', 'Status', 'Occupation', 'Institution', 'Course', 'Check-in', 'Check-out', 'Monthly rent', 'Security deposit', 'Dues', 'Mess', 'Guardian', 'Guardian phone'],
      ...filtered.map(({ h, bed, dues: d }) => [
        h.name,
        h.phone,
        h.email,
        hostelName(h.hostelId),
        bed,
        h.status,
        h.occupation,
        h.institution,
        h.course,
        h.checkInDate,
        h.checkOutDate,
        h.monthlyRent,
        h.securityDeposit,
        d,
        h.messOpted ? 'Yes' : 'No',
        h.guardianName,
        h.guardianPhone,
      ]),
    ])
  }

  const anyFilter = !!(q || occupation || mess || dues)

  return (
    <>
      <PageHeader
        title="Hostelers"
        subtitle={`${counts.active} living now · ${counts.reserved} reserved`}
        actions={
          <>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!filtered.length}>
              Export CSV
            </Button>
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => navigate('/app/check-in')}>
              New check-in
            </Button>
          </>
        }
      />

      <Card>
        <Tabs<Tab>
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'reserved', label: 'Reserved', count: counts.reserved },
            { value: 'checked_out', label: 'Checked out', count: counts.checked_out },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        <div className="border-b border-slate-100 p-4">
          <FilterBar>
            <SearchInput value={q} onChange={setQ} placeholder="Search name, phone, room, college…" className="col-span-2 sm:w-80" />
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

        {!filtered.length ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={rows.length ? 'No hostelers match' : 'No hostelers yet'}
            description={rows.length ? 'Try a different search or filter.' : 'Check in your first resident to get started.'}
            action={
              !rows.length && (
                <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => navigate('/app/check-in')}>
                  New check-in
                </Button>
              )
            }
          />
        ) : (
          <Table>
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
              {filtered.map(({ h, bed, dues: d }) => (
                <TR key={h.id} onClick={() => navigate(`/app/hostelers/${h.id}`)}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={h.name} src={h.photo} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{h.name}</p>
                        <p className="text-xs text-slate-500">{h.phone}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {bed}
                    {scope === 'all' && <p className="text-xs text-slate-400">{hostelName(h.hostelId)}</p>}
                  </TD>
                  <TD>
                    <p className="max-w-[12rem] truncate">{h.institution || '—'}</p>
                    {h.course && <p className="max-w-[12rem] truncate text-xs text-slate-400">{h.course}</p>}
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(h.checkInDate)}</TD>
                  <TD className="whitespace-nowrap text-right">{formatMoney(h.monthlyRent)}</TD>
                  <TD className={cn('whitespace-nowrap text-right font-medium', d > 0 ? 'text-red-600' : 'text-slate-400')}>
                    {d > 0 ? formatMoney(d) : '—'}
                  </TD>
                  <TD>
                    <StatusBadge status={h.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
        {filtered.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Showing {filtered.length} of {rows.length} hostelers
          </div>
        )}
      </Card>
    </>
  )
}
