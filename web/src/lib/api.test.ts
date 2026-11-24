import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { api, ApiError, GET_TIMEOUT_MS, UPLOAD_TIMED_OUT } from './api.ts'

// Оставляем запрос в полёте, пока клиент не отменит настоящий AbortSignal.
function pendingFetch(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal: AbortSignal
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    signal = init.signal!
    return new Promise<Response>((_, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  return () => signal
}

test('после загрузки 20 МиБ на скорости 25 КБ/с клиент дожидается проверки PDF и ответа', async (t) => {
  const signal = pendingFetch(t)
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(20 << 20)]), 'work.pdf')
  const reply = api.post('/api/assignments/17/submissions', form)
  const expired = assert.rejects(reply, { message: UPLOAD_TIMED_OUT })
  t.mock.timers.tick(17 * 60_000)
  assert.equal(signal().aborted, false)
  t.mock.timers.tick(60_000)
  assert.equal(signal().aborted, true)
  await expired
})

test('загрузка эталона TeX сохраняет обычный таймаут формы', async (t) => {
  const signal = pendingFetch(t)
  const form = new FormData()
  form.set('reference', new Blob(['x']), 'solution.tex')
  const reply = api.post('/api/subjects/17/assignments', form)
  t.mock.timers.tick(61_000)
  assert.equal(signal().aborted, true)
  await assert.rejects(reply, { message: UPLOAD_TIMED_OUT })
})

test('GET со внешним сигналом прерывается по штатному таймауту', async (t) => {
  const signal = pendingFetch(t)
  const controller = new AbortController()
  const reply = api.get('/api/me', { signal: controller.signal })
  t.mock.timers.tick(GET_TIMEOUT_MS)
  assert.equal(signal().aborted, true)
  assert.equal(controller.signal.aborted, false)
  await assert.rejects(reply, ApiError)
})

test('вызывающий может отменить GET до истечения таймаута', async (t) => {
  const signal = pendingFetch(t)
  const controller = new AbortController()
  const reply = api.get('/api/me', { signal: controller.signal })
  controller.abort()
  assert.equal(signal().aborted, true)
  await assert.rejects(reply, (reason) => reason === controller.signal.reason)
})
