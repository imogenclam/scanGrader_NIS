import { api } from '@/lib/api'
import type { AccountCreated, LoginCheck, LoginRequest, LoginResponse, RegisterRequest, RegisterStarted } from '@/lib/api.gen'

export const checkLogin = (login: string) => api.post<LoginCheck>('/api/auth/check', { login })
export const signIn = (creds: LoginRequest) => api.post<LoginResponse>('/api/login', creds)

// анкета регистрации: остальные поля RegisterRequest сервер заполнит сам
export type RegisterBody = Pick<RegisterRequest, 'login' | 'password' | 'email'> & {
  requested_role: 'student' | 'teacher'
  teacher_note?: string
  full_name?: string
}
export const register = (body: RegisterBody) => api.post<RegisterStarted>('/api/register', body)
export const verifyEmail = (email: string, code: string) => api.post<AccountCreated>('/api/verify-email', { email, code })

export const logout = () => api.post<void>('/api/logout')

// восстановление пароля по коду из письма
export const requestPasswordCode = (email: string) => api.post<{ local_delivery?: boolean }>('/api/password/forgot', { email })
export const resetPassword = (data: { email: string; code: string; new_password: string }) =>
  api.post<unknown>('/api/password/reset', data)
