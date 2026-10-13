/**
 * Who is logged in on this device. Persisted to localStorage so a refresh
 * keeps the user signed in. The token is sent with every API request
 * (see client.ts); the server is the source of truth for everything else.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Hostel, Hosteler, Organization, StaffRole, User } from './types'

export interface StaffSession {
  kind: 'staff'
  token: string
  user: User
  organization: Organization
}

export interface HostelerSession {
  kind: 'hosteler'
  token: string
  hosteler: Hosteler
  hostel: Pick<Hostel, 'id' | 'name' | 'code' | 'city' | 'phone'> | null
  mustChangePassword: boolean
}

export type Session = StaffSession | HostelerSession

interface SessionState {
  session: Session | null
  setSession: (s: Session | null) => void
  /** merge fields into the current session (e.g. after a profile/token refresh) */
  patchSession: (patch: Partial<StaffSession> | Partial<HostelerSession>) => void
  clear: () => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      patchSession: (patch) => set((s) => (s.session ? { session: { ...s.session, ...patch } as Session } : s)),
      clear: () => set({ session: null }),
    }),
    { name: 'hostelhub-session', version: 1 },
  ),
)

export const getSession = () => useSession.getState().session

/* ---------------- convenience hooks ---------------- */

export function useStaffSession(): StaffSession | null {
  const s = useSession((x) => x.session)
  return s?.kind === 'staff' ? s : null
}

export function useHostelerSession(): HostelerSession | null {
  const s = useSession((x) => x.session)
  return s?.kind === 'hosteler' ? s : null
}

/* ---------------- staff permissions (mirror backend/src/middleware/auth.ts) ---------------- */

export type StaffModule =
  | 'org'
  | 'hostels'
  | 'rooms'
  | 'hostelers'
  | 'checkin'
  | 'documents'
  | 'fees'
  | 'expenses'
  | 'mess'
  | 'attendance'
  | 'complaints'
  | 'visitors'
  | 'notices'
  | 'staff'
  | 'reports'

const ACCESS: Record<StaffRole, StaffModule[] | 'all'> = {
  owner: 'all',
  manager: ['hostels', 'rooms', 'hostelers', 'checkin', 'documents', 'fees', 'expenses', 'mess', 'attendance', 'complaints', 'visitors', 'notices', 'staff', 'reports'],
  warden: ['rooms', 'hostelers', 'checkin', 'documents', 'mess', 'attendance', 'complaints', 'visitors', 'notices'],
  accountant: ['hostelers', 'fees', 'expenses', 'reports'],
}

export function roleCan(role: StaffRole | undefined, module: StaffModule): boolean {
  if (!role) return false
  const a = ACCESS[role]
  return a === 'all' || a.includes(module)
}

/** `const can = useCan(); can('fees')` */
export function useCan() {
  const role = useStaffSession()?.user.role
  return (module: StaffModule) => roleCan(role, module)
}
