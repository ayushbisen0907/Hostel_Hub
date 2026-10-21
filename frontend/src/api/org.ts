/**
 * Organization settings, plan, staff logins and backup
 * (backend/src/modules/org/routes.ts). Everything here except GET /org is owner-only.
 */
import { useQuery } from '@tanstack/react-query'
import { api, del, get, patch, post } from './client'
import { useApiMutation } from './query'
import { refreshStaffMe, staffChangePassword } from './auth'
import { useStaffSession } from './session'
import type { ID, ListResponse, OrgDetails, Settings, StaffRole, User } from './types'

export type TeamRole = Exclude<StaffRole, 'owner'>

export interface OrgProfileInput {
  name: string
  ownerName: string
  email: string
  phone: string
}

export interface NewUserInput {
  name: string
  email: string
  phone: string
  role: TeamRole
}

export interface UserWithPassword {
  user: User
  /** generated temporary password — only returned once */
  tempPassword: string | null
}

export const orgApi = {
  updateProfile: (body: Partial<OrgProfileInput>) => patch<OrgDetails>('/org', body),
  updateSettings: (body: Partial<Settings>) => patch<Settings>('/org/settings', body),

  users: async () => (await get<ListResponse<User>>('/org/users')).items,
  createUser: (body: NewUserInput) => post<UserWithPassword>('/org/users', body),
  updateUser: ({ id, ...body }: { id: ID; name?: string; phone?: string; role?: TeamRole; active?: boolean }) =>
    patch<User>(`/org/users/${id}`, body),
  resetPassword: (id: ID) => post<UserWithPassword>(`/org/users/${id}/reset-password`),
  deleteUser: (id: ID) => del<{ ok: true }>(`/org/users/${id}`),

  /** Downloads the JSON backup as a file. */
  exportBackup: async () => {
    const res = await api.get<Blob>('/org/export', { responseType: 'blob' })
    const disposition = String(res.headers['content-disposition'] ?? '')
    const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? `hostelhub-backup-${new Date().toISOString().slice(0, 10)}.json`
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
}

/** Keep the session's copy of the organization (plan, name) in sync. */
const syncSession = () => {
  refreshStaffMe().catch(() => undefined)
}

export function useUpdateOrgProfile() {
  return useApiMutation(orgApi.updateProfile, { invalidate: [['org']], success: 'Profile updated', onSuccess: syncSession })
}

/** Change the logged-in staff member's own password (signs out their other sessions). */
export function useChangeOwnPassword(onSuccess?: () => void) {
  return useApiMutation(({ current, next }: { current: string; next: string }) => staffChangePassword(current, next), {
    success: 'Password changed',
    onSuccess: () => onSuccess?.(),
    toastErrors: false,
  })
}

export function useUpdateOrgSettings() {
  return useApiMutation(orgApi.updateSettings, { invalidate: [['org']], success: 'Preferences saved', onSuccess: syncSession })
}

/* ---------------- team ---------------- */

export function useTeam() {
  const owner = useStaffSession()?.user.role === 'owner'
  return useQuery({ queryKey: ['org-users'], queryFn: orgApi.users, enabled: owner })
}

export function useCreateUser(onSuccess?: (r: UserWithPassword) => void) {
  return useApiMutation(orgApi.createUser, {
    invalidate: [['org-users']],
    success: (r) => `Login created for ${r.user.name}`,
    onSuccess: (r) => onSuccess?.(r),
    toastErrors: false, // the invite form shows errors inline (e.g. email already used)
  })
}

export function useUpdateUser(onSuccess?: () => void) {
  return useApiMutation(orgApi.updateUser, { invalidate: [['org-users']], success: 'Login updated', onSuccess: () => onSuccess?.() })
}

export function useResetUserPassword(onSuccess?: (r: UserWithPassword) => void) {
  return useApiMutation(orgApi.resetPassword, { invalidate: [['org-users']], onSuccess: (r) => onSuccess?.(r) })
}

export function useDeleteUser() {
  return useApiMutation(orgApi.deleteUser, { invalidate: [['org-users']], success: 'Login removed' })
}
