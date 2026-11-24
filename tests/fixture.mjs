import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Одностраничный PDF с решением, без персональных данных и внешних файлов.
export function examplePDF(answer = 4) {
  const stream = `BT /F1 18 Tf 30 90 Td (2 + 2 = ${answer}) Tj ET\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = ['0000000000 65535 f ']
  for (const [index, obj] of objects.entries()) {
    offsets.push(`${String(pdf.length).padStart(10, '0')} 00000 n `)
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`
  }
  const start = pdf.length
  pdf += `xref\n0 ${offsets.length}\n${offsets.join('\n')}\n`
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}

async function loopbackPort() {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const { port } = probe.address()
  const closed = once(probe, 'close')
  probe.close()
  await closed
  return port
}

export async function withService(executable, run) {
  const binary = resolve(executable)
  const dataDir = await mkdtemp(join(tmpdir(), 'scangrader-contract-'))
  const addr = '127.0.0.1:' + await loopbackPort()
  const options = {
    cwd: dataDir,
    env: { ...process.env, SG_DATA_DIR: dataDir, SG_SMTP_HOST: '', SG_SMTP_FROM: '', SG_SMTP_USER: '', SG_SMTP_PASSWORD: '', SG_OCR_KEY: '', SG_OCR_FOLDER: '', SG_MODEL_URL: '', SG_MODEL_NAME: '', SG_MODEL_KEY: '', SG_SECURE_COOKIE: '0' },
  }
  let child
  let finished
  try {
    const init = execFileSync(binary, ['-init-teacher'], { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const teacherPassword = init.match(/Пароль:\s*(\S+)/u)?.[1]
    assert.ok(teacherPassword, 'Инициализация учебного преподавателя')
    child = spawn(binary, ['-addr', addr], { ...options, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let startupLog = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', part => { startupLog = (startupLog + part).slice(-1500) })
    finished = once(child, 'exit')
    const base = 'http://' + addr
    let ready = false
    let lastStatus = ''
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
      try {
        const result = await fetch(base + '/healthz', { signal: AbortSignal.timeout(1000) })
        ready = result.ok
        lastStatus = String(result.status)
      } catch (error) {
        lastStatus = error.cause?.code || error.message
      }
      if (ready) break
      await delay(100)
    }
    assert.ok(ready, `Проверка готовности: ${lastStatus}. ${startupLog}`)
    await run({ base, dataDir, teacherPassword })
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill()
    if (finished) await finished
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
