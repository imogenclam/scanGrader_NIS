// без импортов через @/ — файл гоняется node --test
// тот же алфавит, что codes.Alphabet в internal/platform/codes: без O, 0, I, 1, L
// код только подсказывает после промаха, ввод старых кодов не режет
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

// символы, которых в кодах лекций не бывает
export function impossibleCodeChars(code: string): string[] {
  const out: string[] = []
  for (const ch of code.toUpperCase()) {
    if (!JOIN_CODE_ALPHABET.includes(ch) && !out.includes(ch)) out.push(ch)
  }
  return out
}
