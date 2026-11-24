import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { examplePDF, withService } from '../fixture.mjs'

function actor(base) {
  let cookie = ''
  return async (method, path, status, payload) => {
    const headers = cookie ? { Cookie: cookie } : {}
    let body = payload
    if (payload !== undefined && !(payload instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(payload)
    }
    const res = await fetch(base + path, { method, body, headers, signal: AbortSignal.timeout(15000) })
    const session = res.headers.getSetCookie().find(value => value.startsWith('sg_session='))
    if (session) cookie = session.split(';')[0]
    if (status === undefined) return res
    assert.equal(res.status, status, `${method} ${path}: HTTP ${res.status}, ожидался ${status}`)
    if (res.headers.get('content-type')?.includes('application/json')) return res.json()
    return Buffer.from(await res.arrayBuffer())
  }
}

function submissionForm(pdf) {
  const form = new FormData()
  form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'solution.pdf')
  return form
}

async function classroom(base, mailDir, teacherPassword) {
  const teacher = actor(base)
  const student = actor(base)
  const name = 'sg' + randomBytes(5).toString('hex')
  const email = name + '@example.org'
  const password = randomBytes(20).toString('hex')
  await teacher('POST', '/api/login', 200, { login: 'teacher', password: teacherPassword })
  await student('GET', '/api/me', 401)
  const registration = await student('POST', '/api/register', 200, {
    login: name, email, password, full_name: 'Учебный студент', group_number: 'ТЕСТ-01', requested_role: 'student',
  })
  assert.equal(registration.local_delivery, true)
  const letters = await readdir(mailDir)
  assert.equal(letters.length, 1)
  const letter = await readFile(join(mailDir, letters[0]), 'utf8')
  assert.ok(letter.includes(email))
  const code = letter.match(/Код:\s*(\d{6})/u)?.[1]
  assert.ok(code, 'В тестовом письме ожидается код подтверждения')
  await student('POST', '/api/verify-email', 200, { email, code })
  assert.equal((await student('GET', '/api/me', 200)).role, 'student')
  console.log('Регистрация, подтверждение почты и изоляция сессий проверены.')

  const subject = await teacher('POST', '/api/subjects', 201, {
    title: 'Арифметика', description: 'Учебный предмет для проверки API',
  })
  await student('POST', '/api/subjects/join', 200, { code: subject.invite_code })
  const form = new FormData()
  form.set('title', 'Сложение')
  form.set('statement', 'Найдите сумму 2 и 2.')
  form.set('tasks', JSON.stringify([{ number: 1, max: 1 }]))
  form.set('reference', new Blob(['$2+2=4$'], { type: 'text/plain' }), 'solutions.tex')
  const assignment = await teacher('POST', `/api/subjects/${subject.id}/assignments`, 201, form)
  const task = `/api/assignments/${assignment.id}`
  await student('GET', task + '/reference', 403)
  assert.equal((await student('GET', task, 200)).assignment.title, 'Сложение')

  const send = task + '/submissions'
  const attempts = await Promise.all([examplePDF(4), examplePDF(5)].map(async pdf => {
    const response = await student('POST', send, undefined, submissionForm(pdf))
    return { pdf, status: response.status, receipt: await response.json() }
  }))
  const first = attempts.find(attempt => attempt.status === 201)
  const concurrent = attempts.find(attempt => attempt.status === 200)
  assert.ok(first && concurrent, `Параллельные сдачи должны вернуть 201 и 200, получено ${attempts.map(a => a.status)}`)
  const id = first.receipt.id
  assert.ok(Number.isInteger(id) && id > 0)
  assert.deepEqual(first.receipt, { id, already_submitted: false })
  assert.deepEqual(concurrent.receipt, { id, already_submitted: true })
  assert.deepEqual(await student('POST', send, 200, submissionForm(concurrent.pdf)), { id, already_submitted: true })
  assert.deepEqual((await student('GET', task, 200)).submissions.map(s => s.id), [id])
  const work = `/api/submissions/${id}`
  assert.deepEqual(await student('GET', work + '/pdf', 200), first.pdf)
  assert.deepEqual(await teacher('GET', work + '/pdf', 200), first.pdf)
  assert.equal((await student('GET', work, 200)).submission.state, 'waiting')

  let status
  for (let attempt = 0; attempt < 100; attempt++) {
    status = (await teacher('GET', work, 200)).submission.state
    if (status === 'manual') break
    await delay(100)
  }
  assert.equal(status, 'manual', 'Без внешних ключей работу получает преподаватель')
  await teacher('POST', work + '/retry', 409)
  const grade = { number: 1, score: 1, comment: 'Верное вычисление.' }
  await teacher('POST', work + '/approve', 400, { grades: [{ ...grade, score: 2 }] })
  await teacher('POST', work + '/approve', 200, { grades: [grade] })
  await teacher('POST', work + '/approve', 409, { grades: [grade] })
  const result = (await student('GET', work, 200)).submission
  assert.equal(result.state, 'approved')
  assert.deepEqual(result.final, [grade])
  assert.ok(!('draft' in result))
  console.log('Публикация, права, повтор сдачи, ручная проверка и получение итога проверены.')
}

if (!process.argv[2]) throw new Error('Передайте путь к собранному исполняемому файлу Scan Grader.')
await withService(process.argv[2], async ({ base, dataDir, teacherPassword }) => {
  await classroom(base, join(dataDir, 'mail'), teacherPassword)
})
