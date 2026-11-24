import { isPublicPath } from './public-paths.ts'
import { saveReturnTo } from './returnTo.ts'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

const AUTH_PAGES = ['/login', '/register', '/forgot']
export const GET_TIMEOUT_MS = 20_000

export const SESSION_EXPIRED = 'Сессия истекла, войдите заново'

// ответ увёл на страницу логина — это тоже «не авторизован»
export function isLoginRedirect(res: { redirected?: boolean; url?: string }): boolean {
  if (!res.redirected || !res.url) return false
  try {
    return new URL(res.url, window.location.origin).pathname === '/login'
  } catch {
    return false
  }
}

// для XHR: responseURL после редиректа
export function isLoginResponseURL(responseURL: string | null | undefined): boolean {
  if (!responseURL) return false
  try {
    return new URL(responseURL, window.location.origin).pathname === '/login'
  } catch {
    return false
  }
}

let onSessionLost = () => {}

// main.tsx сбрасывает профиль в кэше запросов
export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn
}

export function goToLogin(reason?: string) {
  if (AUTH_PAGES.includes(window.location.pathname)) return
  saveReturnTo(window.location.pathname + window.location.search)
  window.location.href = reason === 'approved' ? '/login?reason=approved' : '/login'
}

// сервер объясняет, почему вход сброшен (одобрили заявку)
async function authReason(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { reason?: unknown }
    return typeof body.reason === 'string' ? body.reason : undefined
  } catch {
    return undefined
  }
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const opts: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {},
    ...init,
  }
  if (body !== undefined) {
    if (body instanceof FormData) {
      opts.body = body
    } else {
      opts.headers = { ...opts.headers, 'Content-Type': 'application/json' }
      opts.body = JSON.stringify(body)
    }
  }
  const upload = body instanceof FormData
  const submission = method === 'POST' && /^\/api\/assignments\/\d+\/submissions(?:[?#]|$)/.test(url)
  const timeout = upload ? uploadTimeoutMs(body, submission) : method === 'GET' ? GET_TIMEOUT_MS : 60_000
  const ctrl = new AbortController()
  const callerSignal = opts.signal
  const cancel = () => ctrl.abort(callerSignal?.reason)
  if (callerSignal?.aborted) cancel()
  else callerSignal?.addEventListener('abort', cancel, { once: true })
  opts.signal = ctrl.signal
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, opts)
    return await readResponse<T>(res, url)
  } catch (e) {
    if (callerSignal?.aborted && callerSignal.reason === ctrl.signal.reason) throw e
    if (e instanceof ApiError) throw e
    if (ctrl.signal.aborted && upload) throw new ApiError(0, UPLOAD_TIMED_OUT)
    throw new ApiError(0, 'Нет связи с сервером, попробуйте ещё раз')
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', cancel)
  }
}

async function readResponse<T>(res: Response, url: string): Promise<T> {
  if (res.status === 401 && url === '/api/me') throw new ApiError(401, SESSION_EXPIRED)
  const onAuthPage = AUTH_PAGES.includes(window.location.pathname)
  if ((res.status === 401 && !onAuthPage) || isLoginRedirect(res)) {
    const reason = res.status === 401 ? await authReason(res) : undefined
    // на открытой странице не уводим, а переходим в гостевой режим; одобренного ведём войти
    const path = window.location.pathname
    if (reason === 'approved' || !isPublicPath(path)) goToLogin(reason)
    // сам профиль и так вернёт null, не трогаем его кэш посреди запроса
    else if (url !== '/api/me') onSessionLost()
    throw new ApiError(401, SESSION_EXPIRED)
  }

  const contentType = res.headers.get('Content-Type') ?? ''
  const isJSON = contentType.includes('application/json')
  const data = isJSON ? await res.json().catch((e: unknown) => {
    if (e instanceof SyntaxError) return null
    throw e
  }) : await res.text()

  if (!res.ok) throw new ApiError(res.status, serverMessage(data) || statusText(res.status) || `Ошибка ${res.status}`, data)
  return data as T
}

export const UPLOAD_TIMED_OUT = 'Загрузка не закончилась: связь слишком медленная или оборвалась. Попробуйте ещё раз'

// Даём минуту на начало передачи и рассчитываем её по скорости 25 КБ/с.
export function uploadTimeoutMs(fd: FormData, submission = false): number {
  let bytes = 0
  fd.forEach((v) => {
    bytes += typeof v === 'string' ? v.length : v.size
  })
  // Серверу даны ещё 2 минуты на проверку PDF и запись сдачи, клиенту — 30 с на ответ.
  const responseTime = submission ? 150_000 : 0
  return 60_000 + Math.ceil(bytes / 25) + responseTime
}

const STATUS_TEXT: Record<number, string> = {
  413: 'Файл слишком большой',
  429: 'Слишком много запросов, подождите немного и попробуйте снова',
  502: 'Сервер перезапускается, повторите через минуту',
  503: 'Сервер перегружен, повторите через минуту',
  504: 'Сервер долго не отвечал, повторите через минуту',
}

// понятный текст по коду, когда сервер своего не прислал
export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? ''
}

// сервер отвечает то JSON {message}, то текстом из http.Error, а nginx — HTML-страницей,
// chi при перегрузке — английским текстом; такое не показываем
export function serverMessage(data: unknown): string {
  if (typeof data === 'string') {
    const text = data.trim()
    return text.startsWith('<') || text.length > 300 || !/[а-яё]/i.test(text) ? '' : text
  }
  if (data && typeof data === 'object') {
    const { message, error } = data as { message?: unknown; error?: unknown }
    return String(message || error || '')
  }
  return ''
}

// текст ошибки для человека: от сервера, если он ответил, иначе запасной
// голое «Ошибка 400» не показываем
export function errorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback
  if (e.message && !/^Ошибка \d+$/.test(e.message)) return e.message
  return fallback
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>('GET', url, undefined, init),
  post: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>('POST', url, body, init),
  put: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>('PUT', url, body, init),
  del: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>('DELETE', url, body, init),
}
