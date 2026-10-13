# HostelHub API

REST API for HostelHub: **Node.js + Express + TypeScript + MongoDB (Mongoose)**.

## 1. Connect MongoDB Atlas

1. In **Atlas** → your cluster → **Connect** → **Drivers**, copy the connection string.
2. **Database Access**: make sure you have a database user with a password.
3. **Network Access**: add your current IP (or `0.0.0.0/0` while developing).
4. Create the env file and paste the string, replacing `<password>` and adding the database name `hostelhub`:

```bash
cd backend
cp .env.example .env
# edit .env:
# MONGODB_URI=mongodb+srv://myuser:mypassword@cluster0.xxxxx.mongodb.net/hostelhub?retryWrites=true&w=majority
# JWT_SECRET=<long random string>
```

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `.env` is git-ignored. Never commit it or share the connection string.

To browse the data in **MongoDB Compass**, paste the same connection string into Compass → *New connection*.

## 2. Run

```bash
npm install
npm run seed      # optional: demo data (prints the logins)
npm run dev       # http://localhost:4000/api
```

| Script | What it does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` and run in production |
| `npm test` | Full test suite against an in-memory MongoDB (doesn't touch Atlas) |
| `npm run typecheck` | TypeScript check |
| `npm run seed` / `npm run seed -- --reset` | Create / recreate the demo organization |

Demo logins after seeding:

| Who | Login |
|---|---|
| Owner | `demo@hostelhub.in` / `Demo@1234` |
| Hosteler (activated) | `SBH-0001` / `Hostel@123` |
| Hosteler (first login) | `SBH-0002` / `Welcome8` (the API forces a password change) |

## 3. How auth works

- **Staff** (owner / manager / warden / accountant): `POST /api/auth/login` → JWT. Each role can reach only certain modules (see `src/middleware/auth.ts`).
- **Hostelers**: at check-in (`POST /api/hostelers`) the API generates a **Hosteler ID** (e.g. `SBH-0007`, unique across the platform) and a **temporary password**. The temporary password is returned **once** in that response and never stored in plain text.
  - `POST /api/portal/auth/login` with ID + temporary password returns `mustChangePassword: true`.
  - Until `POST /api/portal/auth/set-password` is called, every other portal endpoint answers `403 PASSWORD_CHANGE_REQUIRED`.
  - After that, the temporary password stops working and old tokens are revoked.
- Passwords are hashed with **bcrypt**. Tokens carry a version number, so a password change, a staff reset or a check-out logs the person out everywhere.
- Every query is scoped to the caller's organization. A hosteler can only ever read their own data.
- Plan limits (Free / Basic / Pro) are enforced on the server too: `402 PLAN_UPGRADE_REQUIRED` / `PLAN_LIMIT`.

All errors use one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "phone: Enter a valid 10-digit mobile number" } }
```

## 4. Endpoints

All routes are under `/api`. Send `Authorization: Bearer <token>`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password` |
| Portal auth | `POST /portal/auth/login`, `POST /portal/auth/set-password`, `GET /portal/auth/me` |
| Organization | `GET/PATCH /org`, `PATCH /org/settings`, `PATCH /org/plan`, `/org/users…` (staff logins), `GET /org/export` |
| Hostels & rooms | `/hostels…`, `/rooms…`, `POST /rooms/bulk`, `GET /beds/vacant` |
| Residents | `/hostelers…` (check-in = `POST /hostelers`), `/:id/confirm-check-in`, `/:id/transfer`, `/:id/check-out`, `/:id/reset-password` |
| Documents | `/documents…` (multipart upload, view, download, verify), `GET /documents/missing` |
| Gate | `/gate-logs…`, `GET /gate-logs/outside` |
| Fees | `/invoices…`, `POST /invoices/generate`, `/:id/late-fee`, `/:id/cancel`, `/payments…`, `GET /dues`, `GET /deposits`, `GET /fees/summary` |
| Expenses | `/expenses…`, `GET /expenses/summary` |
| Mess | `/mess/menu`, `/mess/today`, `/mess/members`, `/mess/opt-outs`, `/mess/feedback`, `/mess/stats` |
| Attendance & leave | `/attendance…`, `/attendance/mark-all-present`, `/attendance/register`, `/leaves…` |
| Complaints, visitors, notices | `/complaints…`, `/visitors…`, `/notices…` |
| Staff & activity | `/staff…`, `POST /staff/pay-salaries`, `GET /activities` |
| Dashboard & reports | `GET /dashboard`, `/reports/pnl`, `/reports/collection`, `/reports/occupancy`, `/reports/dues-aging` |
| Hosteler portal | `/portal/home`, `/portal/profile`, `/portal/invoices`, `/portal/payments`, `POST /portal/pay`, `/portal/mess/…`, `/portal/complaints`, `/portal/leaves`, `/portal/notices`, `/portal/documents`, `/portal/attendance`, `/portal/gate-logs` |

## 5. Code map

```
src/
  config/       env (validated), db connection + transactions
  middleware/   auth: staff roles, hosteler portal guard
  lib/          errors, validation helpers, auth (bcrypt/JWT/IDs), money (invoices & payments), plans, uploads
  models/       Mongoose schemas
  modules/      one folder per area, each with routes.ts
  scripts/      seed
tests/          API tests (vitest + supertest + in-memory MongoDB)
```

## Notes for production

- Online payments in the portal are **simulated**; `POST /portal/pay` marks where a Razorpay order/verify step goes.
- Uploaded documents are stored on local disk (`UPLOAD_DIR`). For a hosted deployment, move them to S3 or Cloudinary.
