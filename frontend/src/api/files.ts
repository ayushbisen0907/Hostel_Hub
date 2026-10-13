/**
 * Protected files (documents, photos) need the auth header, so they can't be
 * used as a plain <img src>. These helpers fetch them into object URLs.
 */
import { useEffect, useState } from 'react'
import { fetchFileUrl } from './client'

/** API paths returned by the server start with "/api"; the axios instance already has that base. */
export function apiPath(url: string): string {
  return url.replace(/^\/api(?=\/)/, '')
}

/**
 * Object URL for a protected file (null while loading / on error / when `path` is null).
 * Changing `version` refetches (e.g. pass `updatedAt` after a photo upload).
 * The object URL is revoked on unmount / change.
 */
export function useProtectedFileUrl(path: string | null | undefined, version?: string | number) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    setUrl(null)
    setError(false)
    if (!path) return
    let alive = true
    let created: string | null = null
    fetchFileUrl(apiPath(path))
      .then((u) => {
        created = u
        if (alive) setUrl(u)
        else URL.revokeObjectURL(u)
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [path, version])
  return { url, error, loading: !!path && !url && !error }
}

export const MAX_UPLOAD_MB = 5
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

/** Client-side check before uploading. Returns an error message or null. */
export function checkUploadFile(file: File, opts: { photo?: boolean } = {}): string | null {
  const types = opts.photo ? PHOTO_TYPES : UPLOAD_TYPES
  const max = opts.photo ? MAX_PHOTO_BYTES : MAX_UPLOAD_BYTES
  if (!types.includes(file.type))
    return opts.photo ? `"${file.name}" isn't a JPG, PNG, WEBP or HEIC image` : `"${file.name}" must be an image (JPG, PNG, WEBP, HEIC) or a PDF`
  if (file.size > max) return `"${file.name}" is too large. ${opts.photo ? 'Photos' : 'Files'} must be ${max / 1024 / 1024} MB or smaller.`
  return null
}
