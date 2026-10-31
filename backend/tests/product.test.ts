/**
 * 产品测试（当前产品模型：老师/学生两张表）
 *
 * 覆盖答辩最可能被问到的 8 个点：
 *  1. 老师注册/登录   2. 学生注册/登录   3. 账号唯一性
 *  4. 学生不能建班    5. 加入码进班       6. 老师只能看自己班
 *  7. 无语音时不给假分 8. 学生不能读别人的报告
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { freshApp, resetDb } from './helpers.js'
import { prisma } from '../src/db.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await freshApp()
  await app.ready()
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await app.close()
})

// ---------- 小工具 ----------
async function register(account: string, role: 'teacher' | 'student', name = '测试用户') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { account, password: 'password123', name, role },
  })
  return { status: res.statusCode, body: res.json() }
}

async function login(account: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { account, password: 'password123' },
  })
  return { status: res.statusCode, body: res.json() }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

async function teacherWithToken(account = 'T1001') {
  await register(account, 'teacher', '测试老师')
  const { body } = await login(account)
  return { token: body.token as string, user: body.user }
}

async function studentWithToken(account = 'S1001') {
  await register(account, 'student', '测试学生')
  const { body } = await login(account)
  return { token: body.token as string, user: body.user }
}

describe('账号体系（Teacher / Student 两张表）', () => {
  it('1. 老师注册后能以工号登录，角色是 teacher', async () => {
    const reg = await register('T2001', 'teacher', '王老师')
    expect(reg.status).toBe(201)
    expect(reg.body.user.role).toBe('teacher')

    const res = await login('T2001')
    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('王老师')
    expect(res.body.token).toBeTruthy()

    // 确实落在 Teacher 表，而不是 Student 表
    expect(await prisma.teacher.count({ where: { employeeNo: 'T2001' } })).toBe(1)
    expect(await prisma.student.count({ where: { studentNo: 'T2001' } })).toBe(0)
  })

  it('2. 学生注册后能以学号登录，角色是 student', async () => {
    const reg = await register('S2001', 'student', '张明')
    expect(reg.status).toBe(201)
    expect(reg.body.user.role).toBe('student')

    const res = await login('S2001')
    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('张明')
    expect(await prisma.student.count({ where: { studentNo: 'S2001' } })).toBe(1)
    expect(await prisma.teacher.count({ where: { employeeNo: 'S2001' } })).toBe(0)
  })

  it('3. 同一学号/工号不能重复注册（两张表都要查重）', async () => {
    await register('X3001', 'student')
    const again = await register('X3001', 'teacher')
    expect(again.status).toBe(409)
    expect(again.body.error).toMatch(/已.*注册/)
  })

  it('4. 错误密码登录返回 401', async () => {
    await register('S3001', 'student')
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: 'S3001', password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('权限隔离', () => {
  it('5. 学生不能创建班级（403）', async () => {
    const s = await studentWithToken('S4001')
    const res = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: auth(s.token),
      payload: { name: '越权班级' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('6. 学生凭加入码进班，老师看板能看到他', async () => {
    const t = await teacherWithToken('T4001')
    const s = await studentWithToken('S4002')

    const created = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: auth(t.token),
      payload: { name: '测试班' },
    })
    expect([200, 201]).toContain(created.statusCode)
    const cls = created.json().classroom ?? created.json()
    expect(cls.joinCode).toHaveLength(6)

    const joined = await app.inject({
      method: 'POST',
      url: '/api/classes/join',
      headers: auth(s.token),
      payload: { joinCode: cls.joinCode },
    })
    expect([200, 201]).toContain(joined.statusCode)

    const board = await app.inject({
      method: 'GET',
      url: `/api/classes/${cls.id}`,
      headers: auth(t.token),
    })
    expect(board.statusCode).toBe(200)
    expect(board.json().students.map((x: any) => x.name)).toContain('测试学生')
  })

  it('7. 别的老师的班级看不到（403）', async () => {
    const t1 = await teacherWithToken('T4002')
    const t2 = await teacherWithToken('T4003')
    const created = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: auth(t1.token),
      payload: { name: '一班' },
    })
    const cls = created.json().classroom ?? created.json()

    const res = await app.inject({
      method: 'GET',
      url: `/api/classes/${cls.id}`,
      headers: auth(t2.token),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('报告分数', () => {
  it('8. 没有语音数据时 speech 为 null（不给 50 分假分），综合分按其余维度归一', async () => {
    const s = await studentWithToken('S5001')

    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: auth(s.token),
      payload: { roleField: '测试岗位', consent: true },
    })
    expect(created.statusCode).toBe(201)
    const sessionId = created.json().session.id

    await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/start`, headers: auth(s.token) })
    await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/end`, headers: auth(s.token) })

    const rep = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/report`,
      headers: auth(s.token),
    })
    expect(rep.statusCode).toBe(200)
    const scores = rep.json().report.scores
    expect(scores.speech).toBeNull()
    expect(scores.insufficient).toContain('speech')
    // 其余四维仍要给出分数
    for (const k of ['expression', 'eyeContact', 'stillness', 'voice']) {
      expect(typeof scores[k]).toBe('number')
    }
    expect(typeof scores.overall).toBe('number')
  })
})

describe('数据归属', () => {
  it('9. 学生只能看到自己的会话列表，读不到别人的报告', async () => {
    const a = await studentWithToken('S6001')
    const b = await studentWithToken('S6002')

    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: auth(a.token),
      payload: { roleField: '测试岗位', consent: true },
    })
    const sessionId = created.json().session.id
    await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/start`, headers: auth(a.token) })
    await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/end`, headers: auth(a.token) })

    // 自己的能读
    const own = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/report`,
      headers: auth(a.token),
    })
    expect(own.statusCode).toBe(200)

    // 别人的读不到
    const other = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/report`,
      headers: auth(b.token),
    })
    expect([403, 404]).toContain(other.statusCode)
  })
})
