// Формы аккаунта обмениваются JSON с обработчиками /api.
export interface LoginRequest { login: string; password: string }
export interface LoginCheck { exists: boolean; next: 'password' }
export interface LoginResponse { success: boolean; restored?: boolean }
export interface RegisterRequest { login: string; password: string; email: string }
export interface RegisterStarted { success: boolean; need_verify: boolean; message?: string; local_delivery?: boolean }
export interface AccountCreated { success: boolean; user_id: number; user_type: 'student' | 'teacher'; message?: string }
