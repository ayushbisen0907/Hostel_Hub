/**
 * In-app notifications for the logged-in user (staff: /notifications,
 * hosteler: /portal/notifications). Polled every 30s while the app is open.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from './client'
import { useSession } from './session'
import type { ID } from './types'

export type NotificationType =
  | 'payment_submitted'
  | 'payment_verified'
  | 'payment_rejected'
  | 'bill_generated'
  | 'move_out_requested'
  | 'move_out_approved'
  | 'move_out_rejected'
  | 'consent_required'
  | 'general'

export interface AppNotification {
  id: ID
  type: NotificationType
  title: string
  body: string
  link: string
  readAt: string | null
  createdAt: string
}

interface NotificationList {
  items: AppNotification[]
  unreadCount: number
}

function base(kind: 'staff' | 'hosteler' | undefined) {
  return kind === 'hosteler' ? '/portal/notifications' : '/notifications'
}

export const notificationsKey = ['notifications'] as const

export function useNotifications() {
  const session = useSession((s) => s.session)
  const kind = session?.kind
  const blocked = session?.kind === 'hosteler' && (session.mustChangePassword || !!session.consentRequired)
  return useQuery({
    queryKey: [...notificationsKey, kind],
    queryFn: () => get<NotificationList>(base(kind), { limit: 30 }),
    enabled: !!session && !blocked,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
}

export function useNotificationActions() {
  const qc = useQueryClient()
  const kind = useSession((s) => s.session?.kind)
  const refresh = () => qc.invalidateQueries({ queryKey: notificationsKey })
  return {
    markRead: async (id: ID) => {
      await post(`${base(kind)}/${id}/read`)
      await refresh()
    },
    markAllRead: async () => {
      await post(`${base(kind)}/read-all`)
      await refresh()
    },
  }
}
