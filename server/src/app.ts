import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import { errorHandler, notFoundRoute } from './lib/errors.js'
import { apiRouter } from './modules/index.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(
    cors({
      origin: (origin, cb) => {
        // allow tools like curl/Postman (no origin) and the configured frontends
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true)
        cb(new Error(`Origin ${origin} not allowed by CORS`))
      },
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'))

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))
  app.use('/api', apiRouter)

  app.use(notFoundRoute)
  app.use(errorHandler)
  return app
}
