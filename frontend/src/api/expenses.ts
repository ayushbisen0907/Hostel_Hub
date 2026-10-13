/**
 * Expenses (backend/src/modules/expenses/routes.ts). Needs the Basic plan
 * or higher and the `expenses` staff permission.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from './client'
import { useApiMutation } from './query'
import type { ID, Paginated, PaymentMode } from './types'

export const EXPENSE_CATEGORIES = ['electricity', 'water', 'groceries', 'salary', 'maintenance', 'internet', 'rent', 'other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface Expense {
  id: ID
  hostelId: ID
  category: ExpenseCategory
  amount: number
  date: string
  paidTo: string
  mode: PaymentMode
  note: string
  createdAt: string
  updatedAt?: string
}

export interface ExpenseRow extends Expense {
  hostelName: string
}

export interface ExpenseList extends Paginated<ExpenseRow> {
  totalAmount: number
}

export interface ExpenseListParams {
  hostelId?: ID | 'all'
  month?: string
  category?: ExpenseCategory | ''
  q?: string
  page?: number
  limit?: number
}

export interface ExpenseSummary {
  months: { month: string; total: number; count: number; byCategory: Record<ExpenseCategory, number> }[]
  byCategory: { category: ExpenseCategory; amount: number }[]
  total: number
  current: { month: string; total: number; previousTotal: number | null; change: number | null }
}

export interface ExpenseInput {
  hostelId: ID
  category: ExpenseCategory
  amount: number
  date: string
  paidTo: string
  mode: PaymentMode
  note: string
}

export const expensesApi = {
  list: (p: ExpenseListParams) => get<ExpenseList>('/expenses', { ...p }),
  summary: (p: { months?: number; month?: string; hostelId?: ID | 'all' }) => get<ExpenseSummary>('/expenses/summary', { ...p }),
  create: (body: ExpenseInput) => post<Expense>('/expenses', body),
  update: ({ id, ...body }: Partial<ExpenseInput> & { id: ID }) => patch<Expense>(`/expenses/${id}`, body),
  remove: (id: ID) => del<{ ok: true; id: ID }>(`/expenses/${id}`),
}

export function useExpenses(params: ExpenseListParams) {
  return useQuery({ queryKey: ['expenses', params], queryFn: () => expensesApi.list(params), placeholderData: keepPreviousData })
}

export function useExpenseSummary(params: { months?: number; month?: string; hostelId?: ID | 'all' }) {
  return useQuery({
    queryKey: ['expenses-summary', params],
    queryFn: () => expensesApi.summary(params),
    placeholderData: keepPreviousData,
  })
}

const INVALIDATE = [['expenses'], ['expenses-summary'], ['dashboard'], ['reports']]

export function useCreateExpense(onSuccess?: () => void) {
  return useApiMutation(expensesApi.create, {
    invalidate: INVALIDATE,
    success: (e) => `₹${e.amount.toLocaleString('en-IN')} expense added`,
    onSuccess: () => onSuccess?.(),
  })
}

export function useUpdateExpense(onSuccess?: () => void) {
  return useApiMutation(expensesApi.update, { invalidate: INVALIDATE, success: 'Expense updated', onSuccess: () => onSuccess?.() })
}

export function useDeleteExpense() {
  return useApiMutation(expensesApi.remove, { invalidate: INVALIDATE, success: 'Expense deleted' })
}
