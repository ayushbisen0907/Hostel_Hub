# HostelHub – Frontend

React website for HostelHub: the owner/staff panel and the mobile-friendly hosteler portal. All data comes from the [HostelHub API](../backend) through **axios** + **TanStack Query**.

## Run

Start the backend first (see `../backend/README.md`), then:

```bash
npm install
npm run dev        # http://localhost:5173  (requests to /api are proxied to http://localhost:4000)
npm run build      # production build
npm test           # full end-to-end check (see below)
```

Optional `.env` (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `/api` | API base URL. Set to your deployed API in production, e.g. `https://api.example.com/api` |
| `API_PROXY_TARGET` | `http://localhost:4000` | Where the dev server forwards `/api` |

## Getting started

1. **Sign up** at `/signup`. This creates your organization and owner account.
2. **Settings → Hostels**: add a hostel. Its ID prefix (e.g. `SBH`) is used for Hosteler IDs.
3. **Rooms & Beds**: add rooms.
4. **Check-in**: admit a hosteler. You get their **Hosteler ID** and a **temporary password**, shown once, with a "Send on WhatsApp" button.
5. The hosteler logs in at `/portal/login`, is asked to set their own password, and then sees only their own data: dues and payments, mess, complaints, leave and profile.
6. **Settings → Team**: give managers, wardens or accountants their own logins (each role sees only its modules).

## How it talks to the API

```
src/api/
  client.ts    axios instance: base URL, Bearer token, error -> ApiError, 401 -> logout,
               403 PASSWORD_CHANGE_REQUIRED -> set-password, protected file helpers
  session.ts   who is logged in (staff or hosteler), role permissions
  query.ts     React Query client + useApiMutation (invalidate + toasts)
  common.ts    org, settings, hostels, top-bar hostel switcher
  auth.ts      login / signup / set-password / logout
  <module>.ts  typed endpoints + hooks per area (rooms, hostelers, fees, mess, portal, …)
```

Query keys start with the resource name (`['hostelers', params]`), and mutations invalidate by prefix so every list stays fresh.

## Tests

`npm test` runs `e2e/full-flow.mjs`. It starts an **in-memory MongoDB**, the real backend and this app, then drives Chromium through the whole product:

- signup
- every owner screen at desktop and phone width, checking for page errors, failed API calls and horizontal overflow
- a check-in through the wizard
- hosteler first login with the temporary password, then a forced password change
- every portal screen
- a rent payment from the portal

It never touches your Atlas database.

## Tech

React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query · axios · Zustand (session only) · React Router · Recharts · date-fns · lucide-react
