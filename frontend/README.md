# HostelHub – Hostel Management SaaS (Frontend)

A fully functional frontend for a hostel / PG management SaaS. There is no backend yet: all data is stored in the browser (IndexedDB), so everything you create, edit or delete is saved and survives a page refresh.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build
npm test           # smoke tests (renders every screen + core flows)
```

## Demo logins

| Who | Where | Credentials |
|---|---|---|
| Hostel owner | `/login` | `demo@hostelhub.in` / `demo123` (or click **Try live demo** on the home page) |
| Hosteler (resident) | `/portal/login` | mobile `9876543210`, PIN `1234` (load demo data first) |

Signing up creates a fresh, empty workspace in this browser. **Settings → Data** lets you load the demo, reset, or export/import a JSON backup.

## Modules

**Owner / staff panel (`/app`)**
- Dashboard: occupancy, collections, dues, mess headcount, charts, pending approvals, activity
- Rooms & beds: floor-wise bed grid, bulk room creation, AC/non-AC, sharing, maintenance
- Hostelers: list, full profile, bed transfer, portal PIN, WhatsApp/call
- Check-in: 6-step admission wizard (details → guardian → documents → bed → rent & deposit → confirm), reservations
- Check-out: dues and deposit settlement, deductions, checklist, printable summary
- Gate log: in/out register, late entries after curfew, who is outside
- Documents: upload, preview, verify, expiry tracking, missing-document alerts
- Fees & payments: monthly rent generation, custom invoices, late fees, partial payments, receipts, dues, deposits, WhatsApp reminders, printable invoices and receipts (amount in words)
- Expenses: categories, charts, CSV
- Mess: today's headcount (after opt-outs and leaves), weekly menu editor, members, opt-outs, feedback ratings
- Attendance & leave: daily roll call, monthly register, guardian alerts, leave approvals
- Complaints: Kanban board, staff assignment, comments
- Visitors, notices, staff (with salary payouts)
- Reports: P&L, collection %, occupancy, dues aging, expense breakdown (CSV + print)
- Settings: profile, hostels, plans & billing (Free / Basic / Pro, per-bed pricing, module gating), preferences, backup

**Hosteler portal (`/portal`, mobile-first)**
- Home with dues, today's menu, notices, attendance
- Pay rent (simulated UPI / card / net banking) and download receipts
- Skip meals (with cut-off times), rate meals
- Raise and track complaints, apply for leave, notices
- Profile, documents upload, change PIN

## Tech

React 18 · TypeScript · Vite · Tailwind CSS · Zustand (persisted to IndexedDB) · React Router · Recharts · date-fns · lucide-react

## Code map

```
src/
  types/          data model
  store/          zustand store (all actions), selectors, demo seed data
  components/ui/  UI kit (buttons, forms, tables, modals, toasts, confirm)
  components/layout/  admin sidebar layout, portal layout
  lib/            utils, plans (pricing + module gating)
  pages/auth      landing, login, signup, hosteler login
  pages/admin     owner/staff modules
  pages/portal    hosteler portal
  pages/print     printable invoice & receipt
```

## Connecting a real backend later

Every read and write goes through `src/store/index.ts`. To add a backend (e.g. Supabase/Node), replace those actions with API calls one module at a time. The screens don't need to change.
