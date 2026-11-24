// есть ли что набирать MathJax: лишний вызов дешевле пропущенной формулы
export function hasRawMath(text: string): boolean {
  return text.includes('$') || text.includes('\\(') || text.includes('\\[') || text.includes('\\begin{')
}
