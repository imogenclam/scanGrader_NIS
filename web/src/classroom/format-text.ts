// экранировать до разметки
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// защита от CSRF через img
export function isAllowedImageSrc(url: string): boolean {
  const own = typeof location === 'undefined' ? 'https://local.invalid' : location.origin
  let u: URL
  try {
    u = new URL(url, own)
  } catch {
    return false
  }
  // путь сверяем после нормализации: ../ и %2e%2e уводят мимо загрузок
  if (u.origin === own && (url.startsWith('/') || url.startsWith('https://')) && !url.startsWith('//')) {
    return u.pathname.startsWith('/static/uploads/') || u.pathname.startsWith('/classroom/')
  }
  return url.startsWith('https://') && u.origin !== own
}

// статью читают все: файлы сдач не тянуть
export function isArticleImageSrc(url: string): boolean {
  if (!isAllowedImageSrc(url)) return false
  const own = typeof location === 'undefined' ? 'https://local.invalid' : location.origin
  const u = new URL(url, own)
  return u.origin !== own || u.pathname.startsWith('/static/uploads/')
}

// окружения, которые считает формулой сам MathJax
// копия для утилиты переносов: internal/texbreaks/texbreaks.go
const MATH_ENVS = new Set([
  'align', 'align*', 'alignat', 'alignat*', 'aligned', 'alignedat', 'array',
  'Bmatrix', 'bmatrix', 'cases', 'CD', 'eqnarray', 'eqnarray*', 'equation',
  'equation*', 'gather', 'gather*', 'gathered', 'matrix', 'multline',
  'multline*', 'pmatrix', 'smallmatrix', 'split', 'subarray', 'Vmatrix',
  'vmatrix',
])

interface Piece {
  text: string
  math: boolean
  display: boolean
}

// разбор на текст и формулы: $…$, $$…$$, \(…\), \[…\], \begin{align}…
function splitMath(src: string): Piece[] {
  const out: Piece[] = []
  let buf = ''
  let i = 0
  const pushText = () => {
    if (buf) out.push({ text: buf, math: false, display: false })
    buf = ''
  }
  const pushMath = (text: string, display: boolean) => {
    pushText()
    out.push({ text, math: true, display })
  }
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      const next = src[i + 1]
      if (next === '[' || next === '(') {
        const close = next === '[' ? '\\]' : '\\)'
        const end = src.indexOf(close, i + 2)
        if (end !== -1) {
          pushMath(src.slice(i, end + 2), next === '[')
          i = end + 2
          continue
        }
      }
      if (src.startsWith('\\begin{', i)) {
        const nameEnd = src.indexOf('}', i + 7)
        const name = nameEnd === -1 ? '' : src.slice(i + 7, nameEnd)
        if (MATH_ENVS.has(name)) {
          const close = '\\end{' + name + '}'
          const end = src.indexOf(close, nameEnd)
          if (end !== -1) {
            pushMath(src.slice(i, end + close.length), true)
            i = end + close.length
            continue
          }
        }
      }
      // \$ и прочие экранированные символы отдаём MathJax как есть
      buf += ch + (next ?? '')
      i += next === undefined ? 1 : 2
      continue
    }
    if (ch === '$') {
      if (src[i + 1] === '$') {
        const end = src.indexOf('$$', i + 2)
        if (end !== -1) {
          pushMath(src.slice(i, end + 2), true)
          i = end + 2
          continue
        }
        buf += '\\$\\$'
        i += 2
        continue
      }
      // «100$ за час» — это цена, а не формула
      const prev = src[i - 1]
      if (prev === undefined || !/[0-9]/.test(prev)) {
        // формулу можно перенести, но за пустую строку она не уходит
        const para = src.indexOf('\n\n', i + 1)
        const limit = para === -1 ? src.length : para
        const end = src.indexOf('$', i + 1)
        if (end !== -1 && end < limit && end > i + 1) {
          pushMath(src.slice(i, end + 1), false)
          i = end + 1
          continue
        }
      }
      buf += '\\$'
      i += 1
      continue
    }
    buf += ch
    i += 1
  }
  pushText()
  return out
}

const TEXT_MACROS: [RegExp, string][] = [
  [/\\textbf\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<strong>$1</strong>'],
  [/\\emph\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<em>$1</em>'],
  [/\\textit\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<em>$1</em>'],
  [/\\textsl\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<em>$1</em>'],
  [/\\underline\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<u>$1</u>'],
  [/\\uline\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<u>$1</u>'],
  [/\\texttt\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<code style="font-family:monospace">$1</code>'],
  [/\\textrm\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<span style="font-family:Georgia,serif">$1</span>'],
  [/\\textsf\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<span style="font-family:system-ui,sans-serif">$1</span>'],
  [/\\textsc\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<span style="font-variant:small-caps">$1</span>'],
  [/\\textmd\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<span style="font-weight:400;font-style:normal">$1</span>'],
  [/\\textup\{((?:[^{}]|\{[^{}]*\})*)\}/g, '<span style="font-style:normal">$1</span>'],
  [/\\textnormal\{((?:[^{}]|\{[^{}]*\})*)\}/g, '$1'],
  [/\\(?:bf|it|em)series\b/g, ''],
]

// текст уже экранирован: из сущностей в ссылке бывает только &amp;
const LINK_RE = /https?:\/\/(?:[^\s&\\{}$]|&amp;)+/gi

// текст уже экранирован; ![картинка](…) разобрана раньше, после «!» ссылку не берём
const MD_LINK_RE = /\[([^\]\n]+)\]\(([^()\s]+)\)/g

// Safari до 16.4 не знает lookbehind: такой литерал роняет весь модуль при загрузке.
// Совпадение сразу после символа prev пропускаем, как сделал бы lookbehind.
export function replaceNotAfter(s: string, re: RegExp, prev: string, fn: (...m: string[]) => string): string {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let out = ''
  let from = 0
  let m: RegExpExecArray | null
  while ((m = g.exec(s)) !== null) {
    if (m.index > 0 && s[m.index - 1] === prev) {
      g.lastIndex = m.index + 1
      continue
    }
    out += s.slice(from, m.index) + fn(...(m as unknown as string[]))
    from = m.index + m[0].length
    if (m[0] === '') g.lastIndex++
  }
  return out + s.slice(from)
}

// split по символу, перед которым нет обратной косой черты, тот же split, только без lookbehind
export function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = []
  let from = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === sep && (i === 0 || s[i - 1] !== '\\')) {
      out.push(s.slice(from, i))
      from = i + 1
    }
  }
  out.push(s.slice(from))
  return out
}
const HREF_RE = /\\href\{([^{}\s]+)\}\{((?:[^{}]|\{[^{}]*\})*)\}/g

function unescapeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// только http(s), почта и свои адреса: javascript: и //чужой.сайт не пускаем
export function isSafeHref(url: string): boolean {
  const u = url.trim()
  if (u === '' || /[\s\\<>"'`]/.test(u)) return false
  if (/^(https?:\/\/[^/]|mailto:[^/])/i.test(u)) return true
  return u.startsWith('#') || (u.startsWith('/') && !u.startsWith('//'))
}

export interface FormatOptions {
  // статьи: [текст](адрес), \href вне формул, картинки только из загрузок
  mdLinks?: boolean
  links?: boolean
  // комментарии: чужие картинки не вставляем
  noImages?: boolean
  // авторский текст: одиночный перевод строки — пробел, как в TeX
  tex?: boolean
}

// готовые куски html ждут под метками \uE000n\uE000 до конца разбора
interface Ctx {
  opts: FormatOptions
  blocks: string[]
  blockIds: Set<number>
  notes: string[]
}

function hold(ctx: Ctx, html: string, block: boolean): string {
  ctx.blocks.push(html)
  const id = ctx.blocks.length - 1
  if (block) ctx.blockIds.add(id)
  return `\uE000${id}\uE000`
}

// \newcommand из преамбулы: определяем в скрытой формуле
const DEFINE_RE =
  /\\(?:(?:re)?newcommand\*?\s*(?:\{\\[a-zA-Z]+\}|\\[a-zA-Z]+)\s*(?:\[\d\])?\s*(?:\[[^\]]*\])?|DeclareMathOperator\*?\s*\{\\[a-zA-Z]+\})\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}[ \t]*\n?/g

function renderTextPiece(input: string, ctx: Ctx): string {
  const held: string[] = []
  const keep = (html: string) => {
    held.push(html)
    return `\uE001${held.length - 1}`
  }
  // маркер картинки из частной области Unicode, в тексте его убираем
  let s = input.replace(/\uE001/g, '').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt: string, url: string) => {
    if (ctx.opts.noImages || !(ctx.opts.mdLinks ? isArticleImageSrc(url) : isAllowedImageSrc(url))) return m
    return keep(`<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0;display:block">`)
  })
  if (ctx.opts.mdLinks) {
    const link = (m: string, rawHref: string, label: string) => {
      const href = unescapeHtml(rawHref)
      if (!isSafeHref(href) || label.trim() === '') return m
      const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''
      return keep(`<a href="${escapeHtml(href)}"${ext}>${label}</a>`)
    }
    s = replaceNotAfter(s, MD_LINK_RE, '!', (m, label, href) => link(m, href, label))
    s = s.replace(HREF_RE, (m, href: string, label: string) => link(m, href, label))
  }
  s = s.replace(DEFINE_RE, (m) => hold(ctx, `<span style="display:none">$${m.trim()}$</span>`, false))
  // ссылку прячем от тире, ~ и звёздочек; точка в конце не её
  if (ctx.opts.links || ctx.opts.mdLinks) {
    s = s.replace(LINK_RE, (m) => {
      let url = m.replace(/[.,;:!?]+$/, '')
      let balance = 0
      for (const char of url) balance += char === '(' ? 1 : char === ')' ? -1 : 0
      while (balance < 0 && url.endsWith(')')) {
        url = url.slice(0, -1).replace(/[.,;:!?]+$/, '')
        balance++
      }
      if (!isSafeHref(unescapeHtml(url))) return m
      const label = ctx.opts.mdLinks ? url.replace(/^https?:\/\//i, '') : url
      const a = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="break-all text-primary underline">${label}</a>`
      return keep(a) + m.slice(url.length)
    })
  }
  for (const [re, to] of TEXT_MACROS) s = s.replace(re, to)
  // тире и пробелы из LaTeX, которые учитель пишет вне формул
  s = s
    .split('\n')
    .map((line) => (/^[\s|:-]+(?:\\\\)?$/.test(line) ? line : line.replace(/---/g, '—').replace(/--/g, '–')))
    .join('\n')
  s = s.replace(/\\qquad/g, '  ').replace(/\\quad/g, ' ')
  s = s.replace(/\\,/g, ' ').replace(/\\;/g, ' ')
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // \\ и \\[5pt] — перевод строки внутри абзаца
  s = s.replace(/\\\\\s*(\[[^\]\n]*\])?[ \t]*\n?/g, '<br>')
  s = s.replace(/\\(?:newline|linebreak)(?![a-zA-Z])[ \t]*\n?/g, '<br>')
  s = s.replace(/\\hspace\*?\{[^{}]*\}/g, ' ').replace(/\\(?:enspace|hfill)(?![a-zA-Z])/g, ' ')
  s = s.replace(/\\(?:ldots|dots|textellipsis)(?![a-zA-Z])(?:\{\})?/g, '…')
  s = s.replace(/\\S(?![a-zA-Z])/g, '§').replace(/\\qed(?![a-zA-Z])/g, '∎')
  s = s.replace(/``([\s\S]*?)&#39;&#39;/g, '«$1»')
  s = s.replace(/~/g, '&nbsp;')
  // экранированные в LaTeX символы; \$ оставляем MathJax
  s = s.replace(/\\([%#_{}])/g, '$1').replace(/\\&amp;/g, '&amp;').replace(/\\ /g, ' ')
  return s.replace(/\uE001(\d+)/g, (_m, n: string) => held[Number(n)])
}

// величина вертикального отступа: em переводим в три ступени
function skipClass(raw: string): string {
  const m = /^([\d.]+)\s*(em|ex|pt|px|cm|mm|in|\\baselineskip)?$/.exec(raw.trim())
  if (!m) return 'vm-skip-md'
  const unit = m[2] ?? 'em'
  const perEm: Record<string, number> = {
    em: 1, '\\baselineskip': 1.2, ex: 0.5, pt: 1 / 12, px: 1 / 16, cm: 2.36, mm: 0.236, in: 6,
  }
  const em = Number(m[1]) * (perEm[unit] ?? 1)
  if (em <= 0.45) return 'vm-skip-sm'
  if (em <= 1.2) return 'vm-skip-md'
  return 'vm-skip-lg'
}

// тело без вложенного \begin — так находится самый внутренний список
const LIST_ENV =
  /\\begin\{(itemize|enumerate|description)\}((?:(?!\\begin\{(?:itemize|enumerate|description)\})[\s\S])*?)\\end\{\1\}/g

function renderListItem(raw: string): string {
  const item = raw.trim()
  if (!item) return ''
  const label = /^\[([^\]]*)\]/.exec(item)
  if (!label) return `<li>${item}</li>`
  const body = item.slice(label[0].length).trimStart()
  const marker = label[1] ? `<strong>${label[1]}</strong>${body ? ' ' : ''}` : ''
  return `<li class="vm-item-custom">${marker}${body}</li>`
}

const SKIP_BY_NAME: Record<string, string> = {
  smallskip: 'vm-skip-sm', smallspace: 'vm-skip-sm',
  medskip: 'vm-skip-md', medspace: 'vm-skip-md',
  bigskip: 'vm-skip-lg', bigspace: 'vm-skip-lg',
}

// строка-список остаётся строкой и в TeX-режиме; та же проверка в internal/texbreaks
const LIST_LINE = /^(?:\d+[.)]|[a-zA-Zа-яёА-ЯЁ]\)|[-–—•])(?=\s|<br>|$)/

function joinLines(text: string, tex: boolean | undefined): string {
  if (!tex) return text.replace(/\n/g, '<br>')
  return text.replace(/[ \t]*\n[ \t]*/g, (m: string, at: number, all: string) =>
    LIST_LINE.test(all.slice(at + m.length)) ? '<br>' : ' ')
}

interface Node {
  html: string
  block: boolean
}

// абзацы и блоки: собираем html без сырых переводов строк
function assemble(src: string, ctx: Ctx): string {
  const nodes: Node[] = []
  let inlineCount = 0
  for (const para of src.split(/\n[ \t]*\n/)) {
    let buf = ''
    const flush = () => {
      const t = joinLines(buf, ctx.opts.tex).replace(/^(?:<br>)+|(?:<br>)+$/g, '').trim()
      buf = ''
      if (t === '') return
      nodes.push({ html: t, block: false })
      inlineCount++
    }
    for (const part of para.split(/(\uE000\d+\uE000)/)) {
      const m = /^\uE000(\d+)\uE000$/.exec(part)
      if (m && ctx.blockIds.has(Number(m[1]))) {
        flush()
        nodes.push({ html: part, block: true })
        continue
      }
      buf += part
    }
    flush()
  }
  // одиночный абзац не заворачиваем: не ломаем плотные подписи и слайды
  const wrap = inlineCount > 0 && nodes.length > 1
  return nodes.map((n) => (n.block || !wrap ? n.html : `<p>${n.html}</p>`)).join('')
}

// длинная строчная формула прокручивается, а не вылезает за край
const WIDE_INLINE_CHARS = 40

function wideInline(tex: string): string {
  return tex.length > WIDE_INLINE_CHARS ? `<span class="vm-math-wide">${tex}</span>` : tex
}

const ENV_TITLES: Record<string, string> = {
  theorem: 'Теорема', lemma: 'Лемма', definition: 'Определение', remark: 'Замечание',
  example: 'Пример', corollary: 'Следствие', proposition: 'Утверждение', proof: 'Доказательство',
}

const ENV_CLASSES: Record<string, string> = {
  center: 'vm-center', flushleft: 'vm-left', flushright: 'vm-right', quote: 'vm-quote', quotation: 'vm-quote',
}

// окружения текста: MathJax их не знает и рисует ошибку
const BLOCK_ENV =
  /\\begin\{(tabular|theorem|lemma|definition|remark|example|proof|corollary|proposition|center|flushleft|flushright|quote|quotation)\}((?:(?!\\begin\{\1\})[\s\S])*?)\\end\{\1\}/g

const FOOTNOTE = /\\footnote\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g

function startsWithBlock(html: string, ctx: Ctx): boolean {
  const m = /^\uE000(\d+)\uE000/.exec(html)
  return m !== null && ctx.blockIds.has(Number(m[1]))
}

function renderEnv(name: string, body: string, ctx: Ctx): string {
  const opt = /^\s*\[([^\]]*)\]/.exec(body)
  const inner = render((opt ? body.slice(opt[0].length) : body).trim(), ctx)
  const title = ENV_TITLES[name]
  if (!title) return `<div class="${ENV_CLASSES[name]}">${inner}</div>`
  const note = opt ? render(opt[1].trim(), ctx) : ''
  const label = name === 'proof' ? `<em>${note || title}.</em>` : `<strong>${title}${note ? ` (${note})` : ''}.</strong>`
  let html: string
  if (inner.startsWith('<p>')) html = `<p>${label} ${inner.slice(3)}`
  else if (inner === '' || startsWithBlock(inner, ctx)) html = `<p>${label}</p>${inner}`
  else html = `${label} ${inner}`
  if (name === 'proof' && !/∎(?:<\/p>)?$/.test(inner)) {
    const qed = '<span class="vm-qed">∎</span>'
    html = html.endsWith('</p>') ? `${html.slice(0, -4)}${qed}</p>` : html + qed
  }
  return `<div class="vm-thm">${html}</div>`
}

const ALIGN_STYLE: Record<string, string> = { c: ' style="text-align:center"', r: ' style="text-align:right"' }

// tabular: & — столбцы, \\ — строки, \hline — линия
function renderTabular(body: string, ctx: Ctx): string {
  const head = /^\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(body)
  const spec = (head ? head[1] : '')
    .replace(/\*\{(\d+)\}\{([^{}]*)\}/g, (_m, n: string, cols: string) => cols.repeat(Math.min(Number(n), 50)))
    .replace(/[@!<>]\{[^{}]*\}/g, '')
    .replace(/[pmbX](?:\{[^{}]*\})?/g, 'l')
  const aligns = [...spec].filter((ch) => ch === 'l' || ch === 'c' || ch === 'r')
  const rows: { cells: string; top: boolean; bottom: boolean }[] = []
  let ruleBefore = false
  for (const raw of body.slice(head ? head[0].length : 0).split(/\\\\(?:\s*\[[^\]]*\])?/)) {
    let rule = false
    const text = raw
      .replace(/\\(?:hline|toprule|midrule|bottomrule)(?![a-zA-Z])|\\cline\{[^{}]*\}/g, () => {
        rule = true
        return ''
      })
      .trim()
    if (text === '') {
      if (rule && rows.length > 0) rows[rows.length - 1].bottom = true
      else ruleBefore = ruleBefore || rule
      continue
    }
    let col = 0
    const cells = splitUnescaped(text, '&').map((cell) => {
      const multi = /^\s*\\multicolumn\{(\d+)\}\{([^{}]*)\}\{((?:[^{}]|\{[^{}]*\})*)\}\s*$/.exec(cell)
      const span = multi ? Math.max(1, Number(multi[1])) : 1
      const align = multi ? (/[lcr]/.exec(multi[2])?.[0] ?? 'l') : (aligns[col] ?? 'l')
      col += span
      const attrs = (span > 1 ? ` colspan="${span}"` : '') + (ALIGN_STYLE[align] ?? '')
      return `<td${attrs}>${render((multi ? multi[3] : cell).trim(), ctx)}</td>`
    })
    rows.push({ cells: cells.join(''), top: rule || ruleBefore, bottom: false })
    ruleBefore = false
  }
  const tr = rows.map((r) => {
    const cls = [r.top && 'vm-top', r.bottom && 'vm-bottom'].filter(Boolean).join(' ')
    return `<tr${cls ? ` class="${cls}"` : ''}>${r.cells}</tr>`
  })
  const ruled = spec.includes('|') ? ' class="vm-ruled"' : ''
  return `<div class="vm-table"><table${ruled}><tbody>${tr.join('')}</tbody></table></div>`
}

// сноски и текстовые окружения разбираем до формул: внутри них свой текст
function liftBlocks(src: string, ctx: Ctx): string {
  let s = src.replace(FOOTNOTE, (_m, body: string) => {
    ctx.notes.push(render(body.trim(), ctx))
    return hold(ctx, `<sup class="vm-fn">${ctx.notes.length}</sup>`, false)
  })
  for (let pass = 0; pass < 4; pass++) {
    const before = s
    s = s.replace(BLOCK_ENV, (_m, name: string, body: string) =>
      hold(ctx, name === 'tabular' ? renderTabular(body, ctx) : renderEnv(name, body, ctx), true))
    if (s === before) break
  }
  return s
}

function render(src: string, ctx: Ctx): string {
  // чат и обсуждение живут по-старому
  const pieces = splitMath(escapeHtml(ctx.opts.tex ? liftBlocks(src, ctx) : src))

  let s = pieces
    .map((p) => (p.math ? hold(ctx, p.display ? p.text : wideInline(p.text), p.display) : renderTextPiece(p.text, ctx)))
    .join('')

  // ещё раз: \textbf{текст с $формулой$} режется на куски
  for (const [re, to] of TEXT_MACROS) s = s.replace(re, to)

  // \begin{itemize}\item …\end{itemize} — это список, а не формула
  // вложенные списки собираем изнутри наружу
  for (let pass = 0; pass < 4; pass++) {
    const before = s
    s = s.replace(LIST_ENV, (_m, kind: string, body: string) => {
      const items = body
        .split(/\\item\b/)
        .slice(1)
        .map((raw) => renderListItem(raw.replace(/\n/g, ' ')))
        .filter((t) => t !== '')
      if (items.length === 0) return ''
      const tag = kind === 'enumerate' ? 'ol' : 'ul'
      return hold(ctx, `<${tag}>${items.join('')}</${tag}>`, true)
    })
    if (s === before) break
  }
  // незакрытое окружение не показываем сырым
  s = s.replace(/\\(?:begin|end)\{(?:itemize|enumerate|description)\}[ \t]*/g, '')

  // \item без окружения — всё равно список
  s = s.replace(/(?:^|\n)[ \t]*\\item\b[^\n]*(?:\n[ \t]*\\item\b[^\n]*)*/g, (m) => {
    const items = m
      .split(/\\item\b/)
      .slice(1)
      .map(renderListItem)
      .filter((t) => t !== '')
    if (items.length === 0) return m
    return '\n' + hold(ctx, `<ul>${items.join('')}</ul>`, true) + '\n'
  })

  // заголовки
  s = s.replace(/\\(section|subsection|subsubsection|paragraph)\*?\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_m, kind: string, title: string) => {
      const tag = kind === 'section' ? 'h2' : kind === 'subsection' ? 'h3' : 'h4'
      return hold(ctx, `<${tag}>${title.trim()}</${tag}>`, true)
    })

  // вертикальные отступы
  s = s.replace(/\\(smallskip|medskip|bigskip|smallspace|medspace|bigspace)\b[ \t]*/g,
    (_m, name: string) => hold(ctx, `<div class="vm-skip ${SKIP_BY_NAME[name]}"></div>`, true))
  s = s.replace(/\\vspace\*?\{([^{}]*)\}[ \t]*/g,
    (_m, arg: string) => hold(ctx, `<div class="vm-skip ${skipClass(arg)}"></div>`, true))

  s = s.replace(/\\par\b/g, '\n\n').replace(/\\(noindent|centering|newpage|clearpage|bigbreak)\b[ \t]*/g, '')

  return assemble(s, ctx)
}

export function formatText(input: unknown, opts: FormatOptions = {}): string {
  if (!input || typeof input !== 'string') return input ? String(input) : ''

  // абзацы держим, лишние пустые строки схлопываем
  const normalized = input.replace(/\uE000/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const ctx: Ctx = { opts, blocks: [], blockIds: new Set(), notes: [] }
  let html = render(normalized, ctx)
  if (ctx.notes.length > 0) html += `<ol class="vm-footnotes">${ctx.notes.map((n) => `<li>${n}</li>`).join('')}</ol>`
  // метки внутри меток: список в теореме, формула в ячейке
  for (let pass = 0; pass < 10 && html.includes('\uE000'); pass++) {
    html = html.replace(/\uE000(\d+)\uE000/g, (_m, n: string) => ctx.blocks[Number(n)])
  }
  return html
}

// есть ли в коротком тексте (сообщение чата) формулы
export function hasLatex(s: string): boolean {
  return /\$|\\\(|\\\[|\\frac|\\sqrt|\\sum|\\int|\\[a-zA-Z]{2,}/.test(s)
}
