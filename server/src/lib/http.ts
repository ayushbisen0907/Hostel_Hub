import type { NextFunction, Request, RequestHandler, Response } from 'express'
import mongoose from 'mongoose'
import { z, type ZodTypeAny } from 'zod'
import { badRequest } from './errors.js'

/** Wraps an async route so rejected promises reach the error handler. */
export function ah<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next)
  }
}

/** Parse & validate with zod; throws ZodError (-> 400) on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data)
}

/* ---------------- common zod pieces ---------------- */

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v), { message: 'Invalid id' })

export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), {
    message: 'Invalid date',
  })
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
export const phone = z
  .string()
  .transform((s) => s.replace(/\D/g, '').slice(-10))
  .refine((s) => /^[6-9]\d{9}$/.test(s), { message: 'Enter a valid 10-digit mobile number' })
export const money = z.coerce.number().min(0).max(10_000_000)

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
})

export function paginate<T>(items: T[], total: number, page: number, limit: number) {
  return { items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
}

/** Validates :id route param */
export function idParam(req: Request, name = 'id'): string {
  const v = req.params[name]
  if (!v || !mongoose.isValidObjectId(v)) throw badRequest(`Invalid ${name}`)
  return v
}

/** Escape user text for use inside a RegExp (search). */
export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Local date helpers (server treats dates as YYYY-MM-DD strings, like the frontend). */
export function todayStr(d = new Date()): string {
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tz).toISOString().slice(0, 10)
}
export function monthOf(date: string) {
  return date.slice(0, 7)
}
