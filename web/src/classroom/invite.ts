// без импортов через @/ — файл гоняется node --test

// ссылка проходит через регистрацию и вход прямо в предмет
export function inviteLink(origin: string, code: string): string {
  return `${origin}/classroom/join?code=${encodeURIComponent(code)}`
}

export function inviteText(title: string, code: string, origin: string): string {
  return (
    `Вступайте в предмет «${title}» в Scan Grader: ${inviteLink(origin, code)}\n` +
    `Если ссылка не открывается, код предмета: ${code}`
  )
}
