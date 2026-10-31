import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { freshApp, resetDb, registerUser } from './helpers.js'
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

describe('auth & roles (R8)', () => {
  it('first registered user becomes admin, later users candidates', async () => {
    const first = await registerUser(app)
    const second = await registerUser(app)
    expect(first.user.role).toBe('admin')
    expect(second.user.role).toBe('candidate')
  })

  it('rejects duplicate email', async () => {
    await registerUser(app, { email: 'dupe@test.dev' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'dupe@test.dev', password: 'password123', name: 'X' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('login returns a JWT with role claim', async () => {
    await registerUser(app, { email: 'login@test.dev' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@test.dev', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const decoded = app.jwt.decode<{ role: string }>(res.json().token)
    expect(decoded?.role).toBe('admin')
  })

  it('wrong password rejected', async () => {
    await registerUser(app, { email: 'wrong@test.dev' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'wrong@test.dev', password: 'not-the-password' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('unauthenticated request to protected route rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('invites (R8)', () => {
  it('assessor can create an invite; candidate cannot', async () => {
    await registerUser(app) // admin
    const assessor = await registerUser(app, { role: 'assessor' })
    const candidate = await registerUser(app)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${assessor.token}` },
      payload: {},
    })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().invite.code).toBeTruthy()

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${candidate.token}` },
      payload: {},
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('registering with an invite code links and consumes it', async () => {
    await registerUser(app)
    const assessor = await registerUser(app, { role: 'assessor' })
    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${assessor.token}` },
      payload: {},
    })
    const code = inviteRes.json().invite.code

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'invited@test.dev', password: 'password123', name: 'Invited', inviteCode: code },
    })
    expect(reg.statusCode).toBe(201)
    expect(reg.json().user.role).toBe('candidate')

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'again@test.dev', password: 'password123', name: 'Again', inviteCode: code },
    })
    expect(reuse.statusCode).toBe(400)
  })

  it('expired invite code rejected', async () => {
    await registerUser(app)
    const assessor = await registerUser(app, { role: 'assessor' })
    const invite = await prisma.invite.create({
      data: {
        assessorId: assessor.user.id,
        code: 'expiredcode1',
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    const res = await app.inject({
      method: 'GET',
      url: `/api/invites/${invite.code}/validate`,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('admin routes (R8)', () => {
  it('admin can list users and change roles; non-admin gets 403', async () => {
    const admin = await registerUser(app)
    const other = await registerUser(app)

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${admin.token}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().users).toHaveLength(2)

    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${other.user.id}/role`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { role: 'assessor' },
    })
    expect(promote.statusCode).toBe(200)
    expect(promote.json().user.role).toBe('assessor')

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${other.token}` },
    })
    expect(forbidden.statusCode).toBe(403)
  })
})
