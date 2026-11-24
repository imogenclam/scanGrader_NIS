const KEY = 'sg-return-to'
const TTL_MS = 30 * 60 * 1000

export function saveReturnTo(path: string) {
  if (!/^\/(?:profile|classroom)(?:[/?]|$)/.test(path) || path.includes('\\')) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }))
  } catch {}
}

export function takeReturnTo(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown }
    if (typeof path !== 'string' || typeof at !== 'number') return null
    if (Date.now() - at > TTL_MS) return null
    if (!/^\/(?:profile|classroom)(?:[/?]|$)/.test(path) || path.includes('\\')) return null
    return path
  } catch {
    return null
  }
}
