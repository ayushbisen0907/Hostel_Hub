# HostelHub

Hostel / PG management SaaS: an owner panel to manage rooms, hostelers, check-in/out, documents, fees, mess, attendance, complaints and more, plus a mobile-friendly portal for hostelers.

```
hostelhub/
├── frontend/   React + Vite + TypeScript + Tailwind (website)
└── backend/    Node + Express + TypeScript + MongoDB (REST API)
```

## Run

**Backend** (needs a MongoDB Atlas connection string, see [backend/README.md](backend/README.md)):

```bash
cd backend
npm install
cp .env.example .env      # paste your Atlas MONGODB_URI and a JWT_SECRET
npm run dev               # http://localhost:4000/api
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

> The frontend talks to the backend through `/api` (Vite proxies it to http://localhost:4000 in development). Start the backend first.

## Tests

```bash
cd backend && npm test     # 96 API tests (in-memory MongoDB)
cd frontend && npm test    # UI smoke tests
```

## Plans

| Plan | Beds | Hostels | Staff logins | Adds |
|---|---|---|---|---|
| Free | 7 | 1 | – | rooms, check-in/out, hosteler app, rent bills, UPI payments |
| Starter | 30 | 1 | – | electricity, mess, documents, complaints, notices, rules & move-out |
| Pro | 100 | 3 | 3 | attendance & leave, visitors & gate log, staff, reports, expenses |
| Business | unlimited | unlimited | unlimited | data export |

The API enforces these (`402 PLAN_UPGRADE_REQUIRED` / `402 PLAN_LIMIT`); see `backend/src/lib/plans.ts`.
New owners start on Free. There is no online checkout yet: after an owner pays, turn their plan on with

```bash
cd backend
npm run plan:set -- owner@example.com pro yearly     # monthly | yearly | onetime
npm run plan:set -- owner@example.com free           # back to Free
```

It uses `MONGODB_URI` from `backend/.env`. Monthly/yearly plans get an end date; when it passes the
account works like Free (nothing is deleted) until the plan is set again. Set `VITE_SUPPORT_WHATSAPP` /
`VITE_SUPPORT_EMAIL` on the website so the Upgrade dialog shows how to reach you.

## WhatsApp bill messages (Pabbly Chatflow)

When a bill is made, the hosteler gets it on WhatsApp with the breakdown, total and due date
(Starter plan and up; each hostel switches it on in Settings → Hostels → WhatsApp).

- **Default:** HostelHub's number for every hostel — set `CHATFLOW_API_KEY` (secret, in the Render
  dashboard), `CHATFLOW_TEMPLATE` (`hostel_bills`), `CHATFLOW_NUMBER` and `CHATFLOW_BASE_URL`
  (`https://testchatflow.pabbly.com` or `https://chatflow.pabbly.com`) on the API.
- **A hostel's own number:** connect it in Chatflow (with the `hostel_bills` template approved), then

```bash
cd backend
npm run whatsapp:set -- SBH pcf_xxxxxxxx "+91 98260 00000"      # [template name]
npm run whatsapp:set -- SBH --default                          # back to HostelHub's number
```

`SBH` is the hostel code (the prefix of its Hosteler IDs). API keys are never shown in the app or exported.

## Deploy on Render

`render.yaml` sets up both services:

| Service | Type | URL |
|---|---|---|
| `hostelhub-api` | Node web service (`backend/`) | `https://hostelhub-api.onrender.com` |
| `hostelhub-web` | Static site (`frontend/`) | `https://hostelhub-web.onrender.com` |

1. Push this repo to GitHub.
2. **MongoDB Atlas → Network Access**: allow `0.0.0.0/0` (Render's outgoing IPs change).
3. **Render → New → Blueprint** → choose the repo → paste `MONGODB_URI` when asked → **Apply**.
4. If Render gives the services different URLs (name taken), update `CORS_ORIGIN` on the API and `VITE_API_URL` on the website (then redeploy the website — Vite bakes it in at build time).

Notes for the free plan:
- The API sleeps after ~15 min without traffic; the first request then takes ~30–60 s. Rent bills are created when it wakes up (and every hour while awake).
- The disk is temporary: uploaded documents, photos and QR images are lost on every redeploy/restart. Use a paid plan with a persistent disk mounted at `backend/uploads`, or move uploads to cloud storage, before real use.
