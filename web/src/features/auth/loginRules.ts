// без импортов через @/ — файл гоняется node --test

// как loginRegex на сервере
const ALLOWED = /^[a-zA-Z0-9а-яА-ЯёЁ._-]+$/

// чем заменить: пробелы на «_», почту на её начало, лишнее убрать
export function loginFix(login: string): string {
  let s = login.trim()
  if (s.includes('@')) s = s.split('@')[0]
  s = s.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '')
  return [...s].slice(0, 30).join('')
}

// что не так с логином, сразу при вводе; null — всё в порядке
export function loginProblem(login: string): string | null {
  if (login === '') return null
  if (/\s/.test(login)) return 'Пробел в логине нельзя: логин пишется одним словом.'
  if (login.includes('@')) return 'Это похоже на почту. Почту впишите в поле Email ниже, а логин придумайте без @.'
  if (!ALLOWED.test(login)) return 'Можно только буквы, цифры, точку, дефис и подчёркивание.'
  const n = [...login].length
  if (n < 3) return 'Логин не короче 3 символов.'
  if (n > 30) return 'Логин не длиннее 30 символов.'
  return null
}
