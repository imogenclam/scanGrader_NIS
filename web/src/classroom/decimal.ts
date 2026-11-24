export function parsePoints(value: string): number {
  const normalized = value.trim().replace(',', '.')
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return NaN
  return Number(normalized)
}
