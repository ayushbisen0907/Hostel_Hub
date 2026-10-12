/**
 * All API routes, mounted under /api.
 * Each module exports a `router` from its routes.ts.
 *
 * RULE: routers mounted at '/' must NOT call router.use(middleware) without a
 * path - that would run for every request (including /portal). Attach auth
 * middleware per route or under the module's own path prefix.
 */
import { Router } from 'express'
import { portalAuthRouter, staffAuthRouter } from './auth/routes.js'
import { router as orgRouter } from './org/routes.js'
import { router as hostelsRouter } from './hostels/routes.js'
import { router as roomsRouter } from './rooms/routes.js'
import { router as dashboardRouter } from './dashboard/routes.js'
import { router as reportsRouter } from './reports/routes.js'
import { router as hostelersRouter } from './hostelers/routes.js'
import { router as documentsRouter } from './documents/routes.js'
import { router as gateRouter } from './gate/routes.js'
import { router as feesRouter } from './fees/routes.js'
import { router as expensesRouter } from './expenses/routes.js'
import { router as messRouter } from './mess/routes.js'
import { router as attendanceRouter } from './attendance/routes.js'
import { router as complaintsRouter } from './complaints/routes.js'
import { router as visitorsRouter } from './visitors/routes.js'
import { router as noticesRouter } from './notices/routes.js'
import { router as staffRouter } from './staff/routes.js'
import { router as portalRouter } from './portal/routes.js'

export const apiRouter = Router()

// auth
apiRouter.use('/auth', staffAuthRouter)
apiRouter.use('/portal/auth', portalAuthRouter)

// hosteler portal (everything is scoped to the logged-in hosteler)
apiRouter.use('/portal', portalRouter)

// owner / staff panel
apiRouter.use('/org', orgRouter) // organization, settings, plan, staff logins (/org/users)
apiRouter.use('/hostels', hostelsRouter)
apiRouter.use('/', roomsRouter) // /rooms, /beds
apiRouter.use('/dashboard', dashboardRouter)
apiRouter.use('/reports', reportsRouter)
apiRouter.use('/hostelers', hostelersRouter) // incl. check-in, check-out, transfer, reset-password
apiRouter.use('/documents', documentsRouter)
apiRouter.use('/gate-logs', gateRouter)
apiRouter.use('/', feesRouter) // /invoices, /payments, /dues, /deposits
apiRouter.use('/expenses', expensesRouter)
apiRouter.use('/mess', messRouter)
apiRouter.use('/', attendanceRouter) // /attendance, /leaves
apiRouter.use('/complaints', complaintsRouter)
apiRouter.use('/visitors', visitorsRouter)
apiRouter.use('/notices', noticesRouter)
apiRouter.use('/', staffRouter) // /staff, /activities

