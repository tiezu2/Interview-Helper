import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { freshApp, resetDb, registerUser, createSession } from './helpers.js'
import { prisma } from '../src/db.js'
import { setStorageForTests, type StorageService } from '../src/services/storage/index.js'
import { runRetentionSweep } from '../src/services/retention/job.js'

let app: FastifyInstance

// In-memory storage driver so tests exercise upload/retention without disk
class MemoryStorage implements StorageService {
  store = new Map<string, Buffer>()
  failNextPut = false
  async put(key: string, data: Buffer) {
    if (this.failNextPut) {
      this.failNextPut = false
      throw new Error('simulated storage outage')
    }
    this.store.set(key, data)
  }
  async get(key: string) {
    const v = this.store.get(key)
    if (!v) throw new Error('not found')
    return v
  }
  async delete(key: string) {
    this.store.delete(key)
  }
  async exists(key: string) {
    return this.store.has(key)
  }
}

let storage: MemoryStorage

beforeAll(async () => {
  app = await freshApp()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await resetDb()
  storage = new MemoryStorage()
  setStorageForTests(storage)
})

function uploadPayload() {
  const boundary = '----testboundary'
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.webm"\r\nContent-Type: video/webm\r\n\r\n`,
    ),
    Buffer.from('fake-webm-bytes'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

describe('recording upload (R11, T15)', () => {
  it('candidate uploads recording after session; row persisted with expiry', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const session = await createSession(app, cand.token)

    const { body, headers } = uploadPayload()
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/recording`,
      headers: { ...headers, authorization: `Bearer ${cand.token}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)

    const rec = await prisma.recording.findUnique({ where: { sessionId: session.id } })
    expect(rec?.uploadedAt).toBeTruthy()
    expect(rec!.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(await storage.exists(rec!.objectKey)).toBe(true)
  })

  it('T15: upload failure never blocks the report; retry succeeds', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const session = await createSession(app, cand.token)

    // Report generates fine with no recording at all
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/end`,
      headers: { authorization: `Bearer ${cand.token}` },
    })
    expect(await prisma.report.count()).toBe(1)

    // First upload attempt fails at the storage layer
    storage.failNextPut = true
    const { body, headers } = uploadPayload()
    const fail = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/recording`,
      headers: { ...headers, authorization: `Bearer ${cand.token}` },
      payload: body,
    })
    expect(fail.statusCode).toBe(500)
    expect(await prisma.report.count()).toBe(1) // report untouched

    // Retry succeeds
    const retry = uploadPayload()
    const ok = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/recording`,
      headers: { ...retry.headers, authorization: `Bearer ${cand.token}` },
      payload: retry.body,
    })
    expect(ok.statusCode).toBe(201)
  })
})

describe('recording governance (R12, T16, T17)', () => {
  async function uploadedRecording() {
    const admin = await registerUser(app)
    const assessor = await registerUser(app, { role: 'assessor' })
    const cand = await registerUser(app)
    const session = await createSession(app, cand.token)
    const { body, headers } = uploadPayload()
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/recording`,
      headers: { ...headers, authorization: `Bearer ${cand.token}` },
      payload: body,
    })
    const rec = await prisma.recording.findUnique({ where: { sessionId: session.id } })
    return { admin, assessor, cand, rec: rec! }
  }

  it('T16: assessor and candidate get 403 on recording download; admin gets 200', async () => {
    const { admin, assessor, cand, rec } = await uploadedRecording()

    for (const blocked of [assessor, cand]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/recordings/${rec.id}`,
        headers: { authorization: `Bearer ${blocked.token}` },
      })
      expect(res.statusCode).toBe(403)
    }

    const ok = await app.inject({
      method: 'GET',
      url: `/api/recordings/${rec.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toContain('video/webm')
  })

  it('T17: retention sweep deletes expired recording object and row (clock injection)', async () => {
    const { rec } = await uploadedRecording()

    // Not yet expired: sweep at "now" deletes nothing
    expect(await runRetentionSweep(new Date())).toBe(0)

    // Sweep with a clock 31 days ahead deletes object + row
    const future = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
    expect(await runRetentionSweep(future)).toBe(1)
    expect(await prisma.recording.findUnique({ where: { id: rec.id } })).toBeNull()
    expect(await storage.exists(rec.objectKey)).toBe(false)
  })
})
