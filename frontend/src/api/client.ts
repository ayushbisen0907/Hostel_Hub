/**
 * Axios instance for the HostelHub API.
 *
 *  - baseURL from VITE_API_URL (default "/api", proxied by Vite in dev)
 *  - adds `Authorization: Bearer <token>` from the current session
 *  - turns every failure into an ApiError { status, code, message, details }
 *  - 401 -> session cleared (user is sent back to login by the route guards)
 *  - 403 PASSWORD_CHANGE_REQUIRED -> hosteler is sent to the set-password page
 *  - 403 CONSENT_REQUIRED -> hosteler is sent to the hostel-rules page (/portal/rules)
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import { getSession, useSession } from './session'

function resolveApiUrl(raw: string | undefined): string {
  const v = raw?.trim().replace(/\/+$/, '')
  if (!v) return '/api'
  // a bare host means https://<host>/api; a bare Render service name (Render's `fromService … property: host`)
  // has no dot — its public address is <name>.onrender.com
  if (!/^https?:\/\//.test(v) && !v.startsWith('/')) return `https://${v.includes('.') ? v : `${v}.onrender.com`}/api`
  return v
}

export const API_BASE_URL: string = resolveApiUrl(import.meta.env.VITE_API_URL)

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
})

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

api.interceptors.request.use((config) => {
  const s = getSession()
  if (s?.token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${s.token}`
  return config
})

/** Requests that should not log the user out on 401 (wrong password etc.) */
const AUTH_PATHS = ['/auth/login', '/auth/signup', '/portal/auth/login', '/auth/change-password', '/portal/auth/set-password']

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<{ error?: { code?: string; message?: string; details?: unknown } }>) => {
    if (!err.response) {
      const offline = err.code === 'ECONNABORTED' ? 'The server took too long to respond' : 'Cannot reach the server. Check your internet connection.'
      return Promise.reject(new ApiError(0, 'NETWORK_ERROR', offline))
    }
    const { status } = err.response
    let body = err.response.data
    // blob responses (file downloads) carry JSON errors as a Blob
    if (body instanceof Blob) {
      try {
        body = JSON.parse(await body.text())
      } catch {
        body = {}
      }
    }
    const code = body?.error?.code ?? `HTTP_${status}`
    const message = body?.error?.message ?? (status >= 500 ? 'Something went wrong on the server' : 'Request failed')
    const url = err.config?.url ?? ''

    if (status === 401 && !AUTH_PATHS.some((p) => url.endsWith(p))) {
      useSession.getState().clear()
    }
    if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
      const s = getSession()
      if (s?.kind === 'hosteler' && !s.mustChangePassword) useSession.getState().patchSession({ mustChangePassword: true })
    }
    if (status === 403 && code === 'CONSENT_REQUIRED') {
      const s = getSession()
      if (s?.kind === 'hosteler' && !s.consentRequired) useSession.getState().patchSession({ consentRequired: true })
    }
    return Promise.reject(new ApiError(status, code, message, body?.error?.details))
  },
)

/** Human-readable message for any error (use in toasts). */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error && e.message) return e.message
  return fallback
}

/* ------------------------------------------------------------------ */
/* Typed helpers                                                       */
/* ------------------------------------------------------------------ */

export async function get<T>(url: string, params?: Record<string, unknown>, config?: AxiosRequestConfig): Promise<T> {
  const res = await api.get<T>(url, { ...config, params: cleanParams(params) })
  return res.data
}
export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await api.post<T>(url, body, config)).data
}
export async function put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await api.put<T>(url, body, config)).data
}
export async function patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await api.patch<T>(url, body, config)).data
}
export async function del<T = void>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await api.delete<T>(url, config)).data
}

/** Multipart upload; `fields` are added as form fields next to the file. */
export async function upload<T>(url: string, file: File, fields: Record<string, string | number | boolean | null | undefined> = {}, method: 'post' | 'put' = 'post'): Promise<T> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') form.append(k, String(v))
  form.append('file', file)
  return (await api.request<T>({ url, method, data: form })).data
}

/** Drop undefined / '' / 'all' query params so URLs stay clean. */
function cleanParams(params?: Record<string, unknown>) {
  if (!params) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (k === 'hostelId' && v === 'all') continue
    out[k] = v
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Protected files (documents, photos)                                 */
/* ------------------------------------------------------------------ */

/** Fetch a protected file with the auth header and return an object URL (revoke it when done). */
export async function fetchFileUrl(url: string): Promise<string> {
  const res = await api.get<Blob>(url, { responseType: 'blob' })
  return URL.createObjectURL(res.data)
}

/** Open a protected file in a new tab. */
export async function openFile(url: string) {
  // open the tab synchronously (popup blockers), then point it at the blob
  const win = window.open('', '_blank')
  try {
    const objectUrl = await fetchFileUrl(url)
    if (win) win.location.href = objectUrl
    else window.location.href = objectUrl
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch (e) {
    win?.close()
    throw e
  }
}

/** Download a protected file with its original name. */
export async function downloadFile(url: string, fileName: string) {
  const objectUrl = await fetchFileUrl(url)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
}
