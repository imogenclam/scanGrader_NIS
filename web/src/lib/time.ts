// Платформа живёт по Москве: у всех на экране одно и то же время.
const MSK_TZ = 'Europe/Moscow'

const NAIVE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

// строка без зоны приходит из базы в UTC
export function parseServerDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  const iso = NAIVE.test(s) ? `${s.replace(' ', 'T')}Z` : s
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

type Parts = { y: string; m: string; d: string; hh: string; mm: string }

function mskParts(d: Date): Parts {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: MSK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  const [date, time] = s.split(/[T\s]+/)
  const [y, m, dd] = date.split('-')
  const [hh, mm] = time.split(':')
  return { y, m, d: dd, hh, mm }
}

export function mskDate(raw: string | null | undefined): string {
  const d = parseServerDate(raw)
  if (!d) return ''
  const p = mskParts(d)
  return `${p.d}.${p.m}.${p.y}`
}

export function mskTime(raw: string | null | undefined): string {
  const d = parseServerDate(raw)
  if (!d) return ''
  const p = mskParts(d)
  return `${p.hh}:${p.mm}`
}

export function mskDateTime(raw: string | null | undefined, sep = ', '): string {
  const d = parseServerDate(raw)
  if (!d) return ''
  const p = mskParts(d)
  return `${p.d}.${p.m}.${p.y}${sep}${p.hh}:${p.mm}`
}

export function mskShortDateTime(raw: string | null | undefined): string {
  const d = parseServerDate(raw)
  if (!d) return ''
  const p = mskParts(d)
  return `${p.d}.${p.m}, ${p.hh}:${p.mm}`
}

// значение для <input type="datetime-local">
export function mskInput(raw: string | null | undefined): string {
  const d = parseServerDate(raw)
  if (!d) return ''
  const p = mskParts(d)
  return `${p.y}-${p.m}-${p.d}T${p.hh}:${p.mm}`
}

export function mskNowInput(): string {
  return mskInput(new Date().toISOString())
}

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

export function mskLongDate(raw: string | null | undefined): string {
  const d = parseServerDate(raw)
  if (!d) return ''
  const p = mskParts(d)
  return `${Number(p.d)} ${MONTHS_GEN[Number(p.m) - 1]} ${p.y}`
}

// «2026-10-15T10:00» (МСК) → «15 октября в 10:00»
export function scheduleLabel(wall: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(wall)
  if (!m) return wall
  return `${Number(m[3])} ${MONTHS_GEN[Number(m[2]) - 1]} в ${m[4]}`
}

export function mskYear(raw: string | null | undefined): string {
  const d = parseServerDate(raw)
  return d ? mskParts(d).y : ''
}

export function timeAgo(raw: string | null | undefined): string {
  const d = parseServerDate(raw)
  if (!d) return ''
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин назад`
  return `${Math.floor(mins / 60)} ч назад`
}

// шаблон проверочной до первого проведения помечен датой выдачи в 2099 году
export function isLectureOnlyIssue(raw: string | null | undefined): boolean {
  const d = parseServerDate(raw)
  return !!d && d.getUTCFullYear() >= 2098
}

export type DeadlineTone = 'overdue' | 'soon' | 'normal'

// один цвет срока на всех экранах: красный только у прошедшего
export function deadlineTone(raw: string | null | undefined, now = Date.now()): DeadlineTone {
  const d = parseServerDate(raw)
  if (!d) return 'normal'
  const left = d.getTime() - now
  if (left < 0) return 'overdue'
  return left < 48 * 3600 * 1000 ? 'soon' : 'normal'
}
