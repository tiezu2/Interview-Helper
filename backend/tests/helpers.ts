import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { prisma } from '../src/db.js'

export async function freshApp(): Promise<FastifyInstance> {
  return buildApp()
}

export async function resetDb() {
  await prisma.report.deleteMany()
  await prisma.metricWindow.deleteMany()
  await prisma.question.deleteMany()
  await prisma.recording.deleteMany()
  await prisma.session.deleteMany()
  await prisma.invite.deleteMany()
  await prisma.user.deleteMany()
}

let emailCounter = 0

export async function registerUser(
  app: FastifyInstance,
  opts: { role?: 'admin' | 'assessor' | 'candidate'; email?: string } = {},
) {
  const email = opts.email ?? `user${++emailCounter}@test.dev`
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'password123', name: 'Test User' },
  })
  const body = res.json()
  // Registration only yields admin (first user) or candidate; other roles
  // are set directly for test setup.
  if (opts.role && body.user.role !== opts.role) {
    await prisma.user.update({ where: { id: body.user.id }, data: { role: opts.role } })
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'password123' },
    })
    return { ...login.json(), user: { ...body.user, role: opts.role } }
  }
  return body
}

export async function createSession(
  app: FastifyInstance,
  token: string,
  roleField = 'sales representative',
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { authorization: `Bearer ${token}` },
    payload: { roleField, consent: true },
  })
  return res.json().session
}
