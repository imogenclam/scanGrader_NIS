import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { examplePDF, withService } from '../../tests/fixture.mjs'

const binary = process.argv[2]
if (!binary) throw new Error('Передайте путь к исполняемому файлу Scan Grader.')
const screenshots = process.env.SG_SCREENSHOTS
if (screenshots) await mkdir(screenshots, { recursive: true })

async function screenshot(page, name) {
  if (screenshots) await page.screenshot({ path: path.join(screenshots, name + '.png'), animations: 'disabled' })
}

async function newestCode(dir, email) {
  const names = (await readdir(path.join(dir, 'mail'))).sort().reverse()
  for (const name of names) {
    const letter = await readFile(path.join(dir, 'mail', name), 'utf8')
    if (letter.includes(email)) {
      const code = /Код:\s*(\d{6})/u.exec(letter)?.[1]
      if (code) return code
    }
  }
  throw new Error('В тестовом ящике нет кода для указанного адреса.')
}

async function register(page, base, dataDir, name, role, byLink = false) {
  const password = randomBytes(16).toString('hex')
  const email = name + '@example.org'
  if (byLink) await page.getByRole('link', { name: 'Создать аккаунт', exact: true }).click()
  else await page.goto(base + '/register')
  if (role === 'teacher') {
    await page.getByRole('button', { name: /Преподаватель/ }).click()
    await page.locator('#teacher-note').fill('Учебная кафедра')
  }
  await page.locator('#last-name').fill('Тестов')
  await page.locator('#first-name').fill(role === 'teacher' ? 'Преподаватель' : 'Студент')
  await page.locator('#login').fill(name)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('#password2').fill(password)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.locator('#code').waitFor()
  assert.ok((await page.locator('body').innerText()).includes('data/mail'))
  await page.locator('#code').fill(await newestCode(dataDir, email))
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await page.locator('[data-app-shell]').waitFor()
  return { email, password }
}

async function login(page, base, login, password, tryWrong = false) {
  await page.goto(base + '/login')
  await page.locator('#login').fill(login)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  if (tryWrong) {
    await page.locator('#password').fill('incorrect-demo-password')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Неверный пароль' }).waitFor()
  }
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.locator('[data-app-shell]').waitFor()
}

async function pdfRendered(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some(canvas => {
    if (canvas.width < 128 || canvas.height < 128) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let dark = false
    let white = false
    for (let i = 0; i < data.length; i += 16) {
      if (data[i + 3] < 250) continue
      if (data[i] < 120) dark = true
      if (data[i] > 240) white = true
      if (dark && white) return true
    }
    return false
  }))
}

async function checkClassroom(browser, { base, dataDir, teacherPassword }) {
  const errors = []
  const foreign = []
  const requests = []
  const contexts = []
  async function openUser() {
    const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, locale: 'ru-RU', reducedMotion: 'reduce' })
    contexts.push(context)
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', err => errors.push(err.message))
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.pathname.startsWith('/api/')) requests.push([response.request().method(), url.pathname, response.status()])
    })
    page.on('request', req => {
      const url = new URL(req.url())
      if (/^https?:$/.test(url.protocol) && url.origin !== base) foreign.push(url.origin)
    })
    return page
  }
  try {
    const teacher = await openUser()
    await teacher.goto(base)
    await teacher.locator('#login').waitFor()
    await teacher.evaluate(() => document.fonts.ready)
    await screenshot(teacher, 'login')
    const instructor = await register(teacher, base, dataDir, 'teacher-demo', 'teacher')
    await teacher.goto(base + '/classroom/subjects')
    await teacher.getByRole('heading', { name: 'Мои предметы', exact: true }).waitFor()
    await teacher.getByText('Предметов пока нет', { exact: true }).waitFor()
    assert.equal(await teacher.locator('[data-app-shell] aside:visible').count(), 0)
    const createSubject = teacher.getByRole('link', { name: 'Создать предмет', exact: true })
    assert.equal(await createSubject.count(), 1)
    await screenshot(teacher, 'empty-subjects')
    await createSubject.click()
    await teacher.locator('#title').fill('Алгебра')
    await teacher.locator('#description').fill('Письменные работы по математике')
    await teacher.locator('form button[type=submit]').click()
    await teacher.waitForURL(/\/classroom\/subjects\/\d+$/)
    const subjectURL = teacher.url()
    const inviteButton = teacher.getByRole('button', { name: /Код:/ }).first()
    const code = (await inviteButton.innerText()).match(/[A-Z0-9]{6}/)?.[0]
    assert.ok(code)
    assert.equal(await teacher.getByRole('button', { name: /Код:/ }).count(), 1)
    await teacher.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    await inviteButton.click()
    assert.equal(await teacher.evaluate(() => navigator.clipboard.readText()), code)
    await teacher.getByRole('button', { name: 'Скопировать приглашение', exact: true }).click()
    assert.ok((await teacher.evaluate(() => navigator.clipboard.readText())).includes('/classroom/join?code=' + code))
    await teacher.getByText('Заданий пока нет', { exact: true }).waitFor()
    await screenshot(teacher, 'empty-subject')
    await teacher.getByRole('link', { name: 'Создать задание', exact: true }).click()
    await teacher.locator('#title').fill('Уравнения')
    await teacher.locator('#statement').fill('Решите уравнение $2x=4$.')
    await teacher.locator('[name=reference]').setInputFiles({ name: 'solutions.tex', mimeType: 'text/plain', buffer: Buffer.from('\\section*{Задача 1} $x=2$.') })
    await teacher.getByRole('button', { name: 'Опубликовать задание', exact: true }).click()
    await teacher.waitForURL(/\/classroom\/assignments\/\d+$/)
    const assignmentURL = teacher.url()
    await teacher.getByText('Пока никто не сдал работу', { exact: true }).waitFor()
    await teacher.goto(base + '/classroom/subjects')
    await teacher.getByText('Алгебра', { exact: true }).first().waitFor()
    const subjectRow = teacher.getByRole('list', { name: 'Предметы' }).getByRole('listitem').first()
    const rowBounds = await subjectRow.boundingBox()
    const mainBounds = await teacher.getByRole('main').boundingBox()
    assert.ok(rowBounds && mainBounds && rowBounds.width > mainBounds.width * 0.8 && rowBounds.height < 110)
    await screenshot(teacher, 'subjects')
    await teacher.getByRole('switch').click()
    assert.ok(await teacher.locator('html').evaluate(el => el.classList.contains('dark')))
    await screenshot(teacher, 'subjects-dark')
    await teacher.reload()
    assert.ok(await teacher.locator('html').evaluate(el => el.classList.contains('dark')))
    await teacher.getByRole('switch').click()
    await teacher.getByRole('button', { name: 'Выйти', exact: true }).click()
    await teacher.locator('#login').waitFor()
    await login(teacher, base, instructor.email, instructor.password, true)

    const student = await openUser()
    await student.goto(base + '/classroom/join?code=' + code)
    await student.locator('#login').waitFor()
    const account = await register(student, base, dataDir, 'student-demo', 'student', true)
    await student.waitForURL(/\/classroom\/join\?code=/)
    await student.getByRole('link', { name: 'Заполнить профиль' }).click()
    await student.locator('#groupNumber').fill('МАТ-01')
    await student.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await student.getByText('Личные данные сохранены').waitFor()
    await student.waitForURL(/\/classroom\/join\?code=/)
    assert.equal(await student.locator('#code').inputValue(), code)
    await student.locator('#code').fill(code.toLowerCase())
    await student.locator('form button[type=submit]').click()
    await student.waitForURL(subjectURL)
    assert.equal(await student.getByRole('button', { name: /Код:/ }).count(), 0)
    await student.getByRole('link', { name: 'Уравнения', exact: true }).click()
    await student.waitForURL(assignmentURL)
    await student.getByRole('heading', { name: 'Уравнения', exact: true }).waitFor()
    await student.locator('section[aria-label="Условие и баллы"] mjx-container').first().waitFor()
    await screenshot(student, 'upload')
    const originalPDF = examplePDF(4)
    await student.locator('[name=file]').setInputFiles({ name: 'solution.pdf', mimeType: 'application/pdf', buffer: originalPDF })
    const repeatTab = await student.context().newPage()
    repeatTab.setDefaultTimeout(15_000)
    await repeatTab.goto(assignmentURL)
    await repeatTab.getByLabel('PDF решения').setInputFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: examplePDF(5) })
    const uploadURL = '**/api/assignments/*/submissions'
    const created = student.waitForResponse(uploadURL)
    // Две открытые формы отправляют разные файлы. Вторая загрузка доходит до сервера после первой.
    await repeatTab.route(uploadURL, async route => { await created; await route.continue() }, { times: 1 })
    const repeated = repeatTab.waitForResponse(uploadURL)
    await repeatTab.getByRole('button', { name: 'Сдать работу', exact: true }).click()
    await student.getByRole('button', { name: 'Сдать работу', exact: true }).click()
    assert.equal((await created).status(), 201)
    assert.equal((await repeated).status(), 200)
    const read = student.getByRole('link', { name: 'Просмотреть работу', exact: true })
    await read.waitFor()
    const workURL = new URL(await read.getAttribute('href'), base)
    const notice = repeatTab.locator('[data-sonner-toast]').filter({ hasText: 'Работа уже сдана' })
    await notice.getByText(/Сохранён первоначальный PDF/).waitFor()
    const pdfResponse = repeatTab.waitForResponse('**/api/submissions/*/pdf')
    await notice.getByRole('link', { name: 'Открыть сданную работу', exact: true }).click()
    await repeatTab.waitForURL(workURL.href)
    assert.deepEqual(await (await pdfResponse).body(), originalPDF)
    await pdfRendered(repeatTab)
    await repeatTab.close()
    await read.click()
    await pdfRendered(student)
    assert.equal(await student.getByRole('button', { name: 'Утвердить оценку' }).count(), 0)
    console.log('Обе роли зарегистрированы. Проверены вход по email, профиль, вступление, публикация .tex и открытие первоначального PDF после повторной сдачи.')

    await teacher.goto(assignmentURL)
    await teacher.getByText('Проверено 0 из 1', { exact: true }).waitFor()
    await teacher.locator('section[aria-label="Условие и баллы"] mjx-container').first().waitFor()
    await screenshot(teacher, 'assignment')
    const gradeLink = teacher.locator('a[href$="/annotate"]').first()
    await gradeLink.click()
    await pdfRendered(teacher)
    const scoreInput = teacher.locator('input[inputmode=decimal], input[type=number]').last()
    await scoreInput.fill('0.7')
    await teacher.locator('textarea').last().fill('Арифметическая ошибка во второй строке.')
    await screenshot(teacher, 'review')
    await teacher.getByRole('button', { name: 'Утвердить оценку', exact: true }).click()
    await student.reload()
    await student.getByText('Арифметическая ошибка во второй строке.', { exact: true }).first().waitFor()
    assert.match(await student.locator('body').innerText(), /0[,.]7/)

    await teacher.goto(base + '/classroom/subjects')
    await teacher.getByRole('link', { name: 'Создать предмет', exact: true }).click()
    const longTitle = 'Математический анализ и методы доказательства для студентов первого курса'
    await teacher.locator('#title').fill(longTitle)
    await teacher.locator('form button[type=submit]').click()
    await teacher.getByRole('heading', { name: longTitle, exact: true }).waitFor()
    await teacher.goto(base + '/classroom/subjects')
    await teacher.getByRole('link', { name: longTitle, exact: true }).waitFor()
    for (const width of [320, 768, 1360]) {
      await teacher.setViewportSize({ width, height: 860 })
      assert.ok(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    }
    await screenshot(teacher, 'multiple-subjects')

    const outsider = await openUser()
    await login(outsider, base, 'teacher', teacherPassword)
    const privatePDF = base + '/api/submissions/' + workURL.pathname.split('/').at(-2) + '/pdf'
    assert.equal((await outsider.request.get(privatePDF)).status(), 403)

    await student.goto(base + '/profile')
    await student.getByRole('button', { name: 'Выйти', exact: true }).click()
    await student.getByRole('link', { name: 'Забыли пароль?', exact: true }).click()
    await student.locator('#email').fill(account.email)
    await student.getByRole('button', { name: 'Отправить код', exact: true }).click()
    await student.locator('#code').waitFor()
    await student.locator('#code').fill(await newestCode(dataDir, account.email))
    const newPassword = randomBytes(17).toString('hex')
    await student.locator('#password').fill(newPassword)
    await student.locator('#password2').fill(newPassword)
    await student.locator('form button[type=submit]').click()
    await student.getByText(/Пароль (изменён|обновлён|успешно изменён)/).first().waitFor()
    await login(student, base, 'student-demo', newPassword)
    await student.setViewportSize({ width: 390, height: 844 })
    await student.getByRole('button', { name: 'Меню', exact: true }).click()
    await student.getByRole('dialog').getByRole('link', { name: 'Мои предметы', exact: true }).click()
    await student.getByRole('dialog', { name: 'Навигация' }).waitFor({ state: 'hidden' })
    await student.getByText('Алгебра', { exact: true }).first().waitFor()
    await screenshot(student, 'mobile')
    assert.ok(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await student.setViewportSize({ width: 320, height: 700 })
    await student.getByRole('link', { name: 'Алгебра', exact: true }).click()
    await student.getByRole('link', { name: 'Уравнения', exact: true }).click()
    await student.getByRole('link', { name: 'Просмотреть работу', exact: true }).waitFor()
    assert.ok(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await student.setViewportSize({ width: 390, height: 844 })
    await student.goto(workURL.href)
    await pdfRendered(student)
    assert.deepEqual(errors, [])
    assert.deepEqual(foreign, [])
    console.log('Проверены PDF.js, итог 0,7, права другого преподавателя, смена пароля, мобильное меню и обе темы.')
  } catch (error) {
    for (const [index, context] of contexts.entries()) {
      const page = context.pages()[0]
      if (!page) continue
      await screenshot(page, 'failed-' + index)
      const alerts = await page.locator('[role="alert"],[role="alertdialog"],[data-sonner-toast]').allTextContents()
      const invalidFields = await page.locator('input:invalid,textarea:invalid').evaluateAll(fields => fields.map(f => f.id))
      console.error('Страница', new URL(page.url()).pathname, { alerts, invalidFields })
    }
    console.error('Ответы API', requests.slice(-12), 'Ошибки браузера', errors)
    throw error
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
}

const browser = await chromium.launch(process.env.CHROME_BIN
  ? { headless: true, executablePath: process.env.CHROME_BIN }
  : { headless: true, channel: 'chrome' })
try {
  await withService(path.resolve(binary), fixture => checkClassroom(browser, fixture))
} finally {
  await browser.close()
}
