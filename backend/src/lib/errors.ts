import type { ErrorRequestHandler, RequestHandler } from 'express'
import mongoose from 'mongoose'
import { ZodError } from 'zod'

/** An error that is safe to show to the API client. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, 'BAD_REQUEST', details)
export const unauthorized = (msg = 'Please log in') => new AppError(401, msg, 'UNAUTHORIZED')
export const forbidden = (msg = 'You do not have access to this') => new AppError(403, msg, 'FORBIDDEN')
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`, 'NOT_FOUND')
export const conflict = (msg: string) => new AppError(409, msg, 'CONFLICT')

export const notFoundRoute: RequestHandler = (req, _res, next) => {
  next(new AppError(404, `Route ${req.method} ${req.originalUrl} not found`, 'ROUTE_NOT_FOUND'))
}

/**
 * Single error format for every response:
 * { error: { code, message, details? } }
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues[0] ? `${err.issues[0].path.join('.') || 'input'}: ${err.issues[0].message}` : 'Invalid input',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    })
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: Object.values(err.errors)[0]?.message ?? 'Invalid input',
        details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
      },
    })
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: `Invalid ${err.path}` } })
  }
  if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
    const fields = Object.keys((err as { keyValue?: object }).keyValue ?? {}).filter((k) => k !== 'orgId')
    return res.status(409).json({ error: { code: 'DUPLICATE', message: `${fields.join(', ') || 'Value'} already exists` } })
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } })
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File is too large' } })
  }
  console.error(err)
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } })
}
