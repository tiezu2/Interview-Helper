import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { freshApp, resetDb, registerUser, createSession } from './helpers.js'
import { prisma } from '../src/db.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await freshApp()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await resetDb()
})

describe('session creation (R2, R10, T3, T14)', () => {
  it('T14: session without consent is rejected and none persisted', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${cand.token}` },
      payload: { roleField: 'teacher' }, // consent missing
    })
    expect(res.statusCode).toBe(400)
    expect(await prisma.session.count()).toBe(0)
  })

  it('T14: consent timestamp persisted on creation', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const session = await createSession(app, cand.token)
    expect(session.consentAt).toBeTruthy()
  })

  it('T3/T4: sales-rep session gets >=5 role-relevant questions (template fallback, LLM_PROVIDER=none)', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const session = await createSession(app, cand.token, 'sales representative')
    expect(session.questions.length).toBeGreaterThanOrEqual(5)
    for (const q of session.questions) {
      expect(q.text.toLowerCase()).toContain('sales representative')
    }
    const orders = session.questions.map((q: any) => q.order)
    expect(orders).toEqual([1, 2, 3, 4, 5])
  })

  it('start requires ownership; end generates a report (R7)', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const other = await registerUser(app)
    const session = await createSession(app, cand.token)

    const foreignStart = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/start`,
      headers: { authorization: `Bearer ${other.token}` },
    })
    expect(foreignStart.statusCode).toBe(403)

    const start = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/start`,
      headers: { authorization: `Bearer ${cand.token}` },
    })
    expect(start.statusCode).toBe(200)
    expect(start.json().session.status).toBe('active')

    const end = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/end`,
      headers: { authorization: `Bearer ${cand.token}` },
    })
    expect(end.statusCode).toBe(200)
    expect(end.json().reportId).toBeTruthy()
  })
})

describe('access control (R8, T11, T12, T13)', () => {
  it('T11: candidate requesting another candidate report gets 403', async () => {
    await registerUser(app)
    const candA = await registerUser(app)
    const candB = await registerUser(app)
    const session = await createSession(app, candA.token)
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/end`,
      headers: { authorization: `Bearer ${candA.token}` },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/report`,
      headers: { authorization: `Bearer ${candB.token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('T12: assessor sees only invited candidates sessions', async () => {
    await registerUser(app)
    const assessor = await registerUser(app, { role: 'assessor' })
    const cand = await registerUser(app)

    // Session linked to assessor via invite code
    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${assessor.token}` },
      payload: {},
    })
    const code = inviteRes.json().invite.code

    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${cand.token}` },
      payload: { roleField: 'teacher', consent: true, inviteCode: code },
    })
    // Unlinked session from the same candidate
    await createSession(app, cand.token)

    const list = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${assessor.token}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().sessions).toHaveLength(1)
    expect(list.json().sessions[0].assessorId).toBe(assessor.user.id)
  })

  it('T13: candidate history shows only their own sessions', async () => {
    await registerUser(app)
    const candA = await registerUser(app)
    const candB = await registerUser(app)
    await createSession(app, candA.token)
    await createSession(app, candA.token)
    await createSession(app, candB.token)

    const listA = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${candA.token}` },
    })
    expect(listA.json().sessions).toHaveLength(2)

    const listB = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${candB.token}` },
    })
    expect(listB.json().sessions).toHaveLength(1)
  })
})
