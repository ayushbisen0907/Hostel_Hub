/**
 * Hostel rules + the hosteler's signed consent.
 *
 *  - Portal: GET /portal/auth/rules, POST /portal/auth/consent (backend/src/modules/auth/routes.ts).
 *    Every other portal endpoint answers 403 CONSENT_REQUIRED until the current version is signed.
 *  - Staff: GET /hostelers/:id/consents (with the signature image).
 */
import { useQuery } from '@tanstack/react-query'
import { get, post } from './client'
import { useApiMutation } from './query'
import { useHostelerSession, useSession, useStaffSession } from './session'
import type { ID } from './types'

export interface PortalRules {
  hostelName: string
  rulesText: string
  /** 0 = the hostel has no rules */
  rulesVersion: number
  signed: boolean
  signedAt: string | null
}

export interface RulesConsent {
  id: ID
  hostelId: ID
  hostelerId: ID
  rulesVersion: number
  /** the exact text that was accepted */
  rulesText: string
  signedName: string
  /** PNG data URL */
  signature: string
  acceptedAt: string
  ip: string
  userAgent: string
  createdAt: string
}

export interface ConsentBody {
  signedName: string
  /** PNG data URL ≤ 200 KB */
  signature: string
  accept: true
}

export const portalRulesKey = ['portal', 'rules'] as const

export function usePortalRules() {
  const s = useHostelerSession()
  return useQuery({
    queryKey: portalRulesKey,
    queryFn: () => get<PortalRules>('/portal/auth/rules'),
    enabled: !!s && !s.mustChangePassword,
  })
}

/** Errors are not toasted: the rules page shows them inline. */
export function useSignRules() {
  return useApiMutation(
    (body: ConsentBody) => post<{ consent: Omit<RulesConsent, 'signature' | 'rulesText'>; consentRequired: false; rulesVersion: number }>('/portal/auth/consent', body),
    {
      invalidate: [['portal']],
      toastErrors: false,
      onSuccess: () => useSession.getState().patchSession({ consentRequired: false }),
    },
  )
}

export function useHostelerConsents(hostelerId: ID | null | undefined, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['hosteler', hostelerId, 'consents'],
    queryFn: () => get<{ items: RulesConsent[] }>(`/hostelers/${hostelerId}/consents`),
    enabled: !!staff && !!hostelerId && enabled,
  })
}
