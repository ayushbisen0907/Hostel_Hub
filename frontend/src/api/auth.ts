/** Authentication API (staff + hosteler portal). See backend/src/modules/auth/routes.ts */
import { get, post } from './client'
import { useSession, type HostelerSession, type StaffSession } from './session'
import { queryClient } from './query'
import type { Hostel, Hosteler, Organization, User } from './types'

interface StaffAuthResponse {
  token: string
  user: User
  organization: Organization
}

interface PortalAuthResponse {
  token: string
  mustChangePassword: boolean
  /** the hostel's rules must be signed (/portal/rules) before anything else */
  consentRequired?: boolean
  rulesVersion?: number
  hosteler: Hosteler
  hostel: HostelerSession['hostel']
}

function startStaffSession(r: StaffAuthResponse) {
  queryClient.clear()
  const s: StaffSession = { kind: 'staff', token: r.token, user: r.user, organization: r.organization }
  useSession.getState().setSession(s)
  return s
}

export async function staffSignup(body: { orgName: string; ownerName: string; email: string; phone: string; password: string }) {
  return startStaffSession(await post<StaffAuthResponse>('/auth/signup', body))
}

export async function staffLogin(email: string, password: string) {
  return startStaffSession(await post<StaffAuthResponse>('/auth/login', { email, password }))
}

/** Refresh user + organization (e.g. after plan/profile changes). */
export async function refreshStaffMe() {
  const r = await get<{ user: User; organization: Organization }>('/auth/me')
  useSession.getState().patchSession({ user: r.user, organization: r.organization })
  return r
}

export async function staffChangePassword(currentPassword: string, newPassword: string) {
  const r = await post<{ token: string }>('/auth/change-password', { currentPassword, newPassword })
  useSession.getState().patchSession({ token: r.token })
}

/* ---------------- hosteler portal ---------------- */

export async function hostelerLogin(loginId: string, password: string) {
  const r = await post<PortalAuthResponse>('/portal/auth/login', { loginId, password })
  queryClient.clear()
  const s: HostelerSession = {
    kind: 'hosteler',
    token: r.token,
    hosteler: r.hosteler,
    hostel: r.hostel,
    mustChangePassword: r.mustChangePassword,
    consentRequired: !!r.consentRequired,
  }
  useSession.getState().setSession(s)
  return s
}

/** First login (temporary password) or a normal password change. Returns a fresh token. */
export async function hostelerSetPassword(currentPassword: string, newPassword: string) {
  const r = await post<{ token: string; mustChangePassword: boolean; consentRequired?: boolean }>('/portal/auth/set-password', { currentPassword, newPassword })
  const consentRequired = !!r.consentRequired
  useSession.getState().patchSession({ token: r.token, mustChangePassword: false, consentRequired })
  return { consentRequired }
}

export async function refreshHostelerMe() {
  const r = await get<{
    mustChangePassword: boolean
    consentRequired?: boolean
    rulesVersion?: number
    hosteler: Hosteler
    hostel: Pick<Hostel, 'id' | 'name' | 'code' | 'city' | 'phone'> | null
  }>('/portal/auth/me')
  useSession.getState().patchSession({
    hosteler: r.hosteler,
    hostel: r.hostel,
    mustChangePassword: r.mustChangePassword,
    consentRequired: !!r.consentRequired,
  })
  return r
}

export function logout() {
  useSession.getState().clear()
  queryClient.clear()
}
