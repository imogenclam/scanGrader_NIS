import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { examplePDF } from '../../tests/fixture.mjs'

const assignment = { id: 7, subject_id: 2, subject_title: 'Алгебра', title: 'Уравнения', statement: 'Решите задачу', tasks: [{ number: 1, max: 2 }] }
const assignmentPath = '/api/assignments/7'
const workPath = '/api/submissions/11'
let server, browser, base

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, hmr: false },
    logLevel: 'error',
  })
  await server.listen()
  base = 'http://127.0.0.1:' + server.httpServer.address().port
  browser = await chromium.launch(process.env.CHROME_BIN
    ? { executablePath: process.env.CHROME_BIN }
    : { channel: 'chrome' })
})
after(async () => {
  await browser?.close()
  await server?.close()
})

function work(state, student = 'Первый студент', id = 11) {
  const submission = { id, state, student, group: 'МАТ-01', submitted_at: '2026-11-10T12:00:00Z' }
  if (state === 'approved') submission.final = [{ number: 1, score: 2, comment: 'Верно' }]
  return submission
}

async function openScreen(t, role, path, submissions) {
  const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } })
  t.after(() => page.close())
  await page.clock.install()
  await page.addInitScript(monitored => {
    const fetch = window.fetch.bind(window)
    window.pollReads = 0
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input
      if (new URL(url, location.href).pathname === monitored) window.pollReads++
      return fetch(input, init)
    }
  }, path)
  const state = {
    user: { id: 1, role, login: 'test-user', full_name: 'Тестовый пользователь', group: 'МАТ-01' },
    submissions, hold: undefined,
  }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()).pathname
    if (url === '/api/me') return route.fulfill({ json: state.user })
    if (url === workPath + '/pdf') return route.fulfill({ contentType: 'application/pdf', body: examplePDF() })
    let payload
    if (url === assignmentPath) payload = { assignment, submissions: state.submissions }
    else if (url === workPath) payload = { assignment, submission: state.submissions.find(row => row.id === 11) }
    else return route.fulfill({ status: 404 })
    if (url === path && state.hold) {
      const release = state.hold
      state.hold = undefined
      await release.promise
    }
    return route.fulfill({ json: payload })
  })
  await page.goto(base + (path === workPath ? '/classroom/submissions/11/view' : '/classroom/assignments/7'))
  await page.getByRole('heading', { name: assignment.title, exact: true }).waitFor()
  const visible = show => page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: value ? 'visible' : 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, value: !value })
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  }, show)
  const reads = () => page.evaluate(() => window.pollReads)
  return { page, state, visible, reads }
}

test('вкладка с ожидающей работой обновляется при возвращении и останавливается после утверждения', async t => {
  const { page, state, visible, reads } = await openScreen(t, 'student', workPath, [work('waiting')])
  await page.getByText('Ожидает оценки', { exact: true }).waitFor()
  assert.equal(await reads(), 1)
  await visible(false)
  await page.clock.runFor(8_000)
  assert.equal(await reads(), 1, 'скрытая вкладка отправила запрос')
  state.submissions = [work('approved')]
  await visible(true)
  await page.getByText('Итоговая оценка', { exact: true }).waitFor({ timeout: 2_000 })
  await visible(false)
  await visible(true)
  await page.clock.runFor(8_000)
  assert.equal(await reads(), 2, 'утверждённая работа продолжает опрашивать сервер')
})

test('при открытии утверждённой работы достаточно одного чтения', async t => {
  const { page, visible, reads } = await openScreen(t, 'student', workPath, [work('approved')])
  await page.getByText('Итоговая оценка', { exact: true }).waitFor()
  await page.clock.runFor(8_000)
  await visible(false)
  await visible(true)
  assert.equal(await reads(), 1)
})

test('задание студента замечает сдачу из другой вкладки и её утверждение', async t => {
  const { page, state, visible, reads } = await openScreen(t, 'student', assignmentPath, [])
  await visible(false)
  state.submissions = [work('waiting')]
  await visible(true)
  await page.getByRole('heading', { name: 'Работа ожидает проверки' }).waitFor({ timeout: 2_000 })
  state.submissions = [work('approved')]
  await page.clock.runFor(4_000)
  await page.getByRole('heading', { name: 'Работа проверена' }).waitFor()
  const settled = await reads()
  await page.clock.runFor(8_000)
  await visible(false)
  await visible(true)
  assert.equal(await reads(), settled, 'готовая оценка студента продолжает обновляться')
})

test('список преподавателя продолжает обновляться после проверки всех работ и совмещает повторные запросы', async t => {
  const { page, state, visible, reads } = await openScreen(t, 'teacher', assignmentPath, [work('approved')])
  await page.getByText('Проверено 1 из 1', { exact: true }).waitFor()
  state.submissions = [work('approved'), work('manual', 'Второй студент', 12)]
  const release = Promise.withResolvers()
  state.hold = release
  try {
    await Promise.all([page.waitForRequest('**' + assignmentPath, { timeout: 2_000 }), page.clock.runFor(4_000)])
    await visible(false)
    await visible(true)
    await page.clock.runFor(8_000)
    assert.equal(await reads(), 2, 'ожидающий ответ вызвал параллельные запросы')
  } finally {
    release.resolve()
  }
  await page.getByText('Проверено 1 из 2', { exact: true }).waitFor()
  await page.clock.runFor(4_000)
  assert.equal(await reads(), 3, 'после получения ответа должен работать один таймер')
})

test('смена пользователя на том же задании исключает ответ предыдущей сессии', async t => {
  const { page, state, visible } = await openScreen(t, 'teacher', assignmentPath, [work('approved')])
  const release = Promise.withResolvers()
  state.hold = release
  try {
    await Promise.all([page.waitForRequest('**' + assignmentPath, { timeout: 2_000 }), page.clock.runFor(4_000)])
    await visible(false)
    state.user = { ...state.user, id: 2, full_name: 'Другой преподаватель' }
    state.submissions = [work('manual', 'Новый студент', 12)]
    // Профиль устарел, старый запрос задания всё ещё в пути.
    await page.clock.setSystemTime(Date.now() + 360_000)
    await visible(true)
    await page.getByText('Новый студент', { exact: true }).waitFor({ timeout: 2_000 })
  } finally {
    release.resolve()
  }
  await page.clock.runFor(100)
  assert.equal(await page.getByText('Первый студент', { exact: true }).count(), 0)
})
