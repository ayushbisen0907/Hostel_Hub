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
