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
npm run seed              # optional demo data
npm run dev               # http://localhost:4000/api
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

> Right now the frontend still stores its data in the browser (demo mode). Connecting it to the backend API is the next step.

## Tests

```bash
cd backend && npm test     # 96 API tests (in-memory MongoDB)
cd frontend && npm test    # UI smoke tests
```
