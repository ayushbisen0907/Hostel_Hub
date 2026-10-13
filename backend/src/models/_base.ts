import { Schema } from 'mongoose'

/**
 * Shared schema options:
 *  - createdAt / updatedAt timestamps
 *  - JSON output uses `id` (string) instead of `_id`, drops `__v`,
 *    and removes any field listed in `hidden` (e.g. password hashes).
 */
export function baseOptions(hidden: string[] = []) {
  const transform = (_doc: unknown, ret: Record<string, unknown>) => {
    ret.id = String(ret._id)
    delete ret._id
    delete ret.__v
    for (const f of hidden) delete ret[f]
    return ret
  }
  return {
    timestamps: true as const,
    toJSON: { virtuals: false, transform },
    toObject: { virtuals: false, transform },
  }
}

/** Every tenant-owned document carries the organization id. */
export const orgField = { type: Schema.Types.ObjectId, ref: 'Organization', required: true as const, index: true }
export const ref = (model: string) => ({ type: Schema.Types.ObjectId, ref: model, required: true as const })
export const optionalRef = (model: string) => ({ type: Schema.Types.ObjectId, ref: model, default: null })

/** Turn a lean() document into API shape (id instead of _id). */
export function toApi<T extends { _id: unknown }>(doc: T, hidden: string[] = []) {
  const { _id, __v: _v, ...rest } = doc as T & { __v?: number }
  void _v
  const out: Record<string, unknown> = { id: String(_id), ...rest }
  for (const f of hidden) delete out[f]
  return out
}
