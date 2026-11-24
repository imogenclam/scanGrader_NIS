export function isPublicPath(path: string): boolean {
  return ['/', '/login', '/register', '/forgot'].includes(path)
}
