/**
 * Hosteler documents — backend/src/modules/documents/routes.ts
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { del, downloadFile, get, openFile, patch, upload } from './client'
import { useStaffSession } from './session'
import type { DocumentType, HDocument, ID, ListResponse, Paginated } from './types'

/** GET /documents item */
export interface DocumentRow extends HDocument {
  uploadedAt: string
  hostelerName: string | null
  hostelerLoginId: string | null
}

/** GET /documents/missing item */
export interface MissingDocsRow {
  hosteler: { id: ID; name: string; loginId: string; phone: string; hostelId: ID }
  lacks: ('aadhaar' | 'police_verification')[]
}

export interface DocumentListParams {
  hostelerId?: ID
  hostelId?: ID | 'all'
  type?: DocumentType
  verified?: 'true' | 'false'
  /** expired or expiring within N days */
  expiring?: number
  page?: number
  limit?: number
}

export const documentsApi = {
  list: (params: DocumentListParams) => get<Paginated<DocumentRow>>('/documents', { ...params }),
  missing: async (hostelId?: ID | 'all') => (await get<ListResponse<MissingDocsRow>>('/documents/missing', { hostelId })).items,
  upload: ({ file, hostelerId, type, expiryDate }: { file: File; hostelerId: ID; type: DocumentType; expiryDate?: string | null }) =>
    upload<DocumentRow>('/documents', file, { hostelerId, type, expiryDate: expiryDate || undefined }),
  update: ({ id, ...body }: { id: ID; verified?: boolean; expiryDate?: string | null; type?: DocumentType }) =>
    patch<DocumentRow>(`/documents/${id}`, body),
  remove: (id: ID) => del(`/documents/${id}`),
}

export const documentFilePath = (id: ID) => `/documents/${id}/file`
export const viewDocument = (id: ID) => openFile(documentFilePath(id))
export const downloadDocument = (d: { id: ID; fileName: string }) => downloadFile(`/documents/${d.id}/download`, d.fileName)

/** Document changes affect the profile counts / photo too. */
export const DOCUMENT_INVALIDATE = [['documents'], ['hosteler'], ['hostelers']]

export function useDocuments(params: DocumentListParams, enabled = true) {
  const staff = useStaffSession()
  return useQuery({
    queryKey: ['documents', params],
    queryFn: () => documentsApi.list(params),
    enabled: !!staff && enabled,
    placeholderData: keepPreviousData,
  })
}

export function useMissingDocuments(hostelId: ID | 'all', enabled = true) {
  const staff = useStaffSession()
  return useQuery({ queryKey: ['documents', 'missing', hostelId], queryFn: () => documentsApi.missing(hostelId), enabled: !!staff && enabled })
}
