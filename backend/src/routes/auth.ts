import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../db.js'

// 账号体系：老师用「工号」、学生用「学号」登录，分别存放在 Teacher / Student 两张表。
const accountField = z
  .string()
  .min(4, '学号/工号至少 4 位')
  .max(32, '学号/工号最多 32 位')
  .regex(/^[A-Za-z0-9_-]+$/, '学号/工号只能包含字母、数字、下划线和横线')

const registerSchema = z.object({
  account: accountField,
  password: z.string().min(8, '密码至少 8 位'),
  name: z.string().min(1, '请填写姓名'),
  role: z.enum(['student', 'teacher']).optional(),
  email: z.string().email().optional().or(z.literal('')),
})

const loginSchema = z.object({
  account: z.string().min(1, '请填写学号/工号'),
  password: z.string(),
  role: z.enum(['student', 'teacher']).optional(), // 前端登录页可指定身份，避免同名冲突
})

type Role = 'student' | 'teacher'

interface AccountDto {
  id: string
  name: string
  role: Role
  studentNo: string | null
  email: string
}

function dto(u: { id: string; name: string; account: string | null; email: string | null }, role: Role): AccountDto {
  return { id: u.id, name: u.name, role, studentNo: u.account, email: u.email ?? '' }
}

export default async function authRoutes(app: FastifyInstance) {
  // ---------- 注册 ----------
  app.post('/api/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })
    const { account, password, name, role: wantedRole, email } = parsed.data
    const role: Role = wantedRole === 'teacher' ? 'teacher' : 'student'
    const emailValue = email && email.length > 0 ? email : null

    // 两张表都要查重：同一个学号/工号不能重复注册
    const [studentTaken, teacherTaken] = await Promise.all([
      prisma.student.findFirst({ where: { OR: [{ studentNo: account }, { email: account }] } }),
      prisma.teacher.findFirst({ where: { OR: [{ employeeNo: account }, { email: account }] } }),
    ])
    if (studentTaken || teacherTaken) return reply.code(409).send({ error: '该学号/工号已被注册' })

    if (emailValue) {
      const [se, te] = await Promise.all([
        prisma.student.findUnique({ where: { email: emailValue } }),
        prisma.teacher.findUnique({ where: { email: emailValue } }),
      ])
      if (se || te) return reply.code(409).send({ error: '该邮箱已被使用' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    if (role === 'teacher') {
      const t = await prisma.teacher.create({
        data: { employeeNo: account, email: emailValue, passwordHash, name },
      })
      const token = app.jwt.sign({ id: t.id, role: 'teacher', email: account })
      return reply.code(201).send({ token, user: dto({ ...t, account: t.employeeNo }, 'teacher') })
    }

    const s = await prisma.student.create({
      data: { studentNo: account, email: emailValue, passwordHash, name },
    })
    const token = app.jwt.sign({ id: s.id, role: 'student', email: account })
    return reply.code(201).send({ token, user: dto({ ...s, account: s.studentNo }, 'student') })
  })

  // ---------- 登录 ----------
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })
    const { account, password, role } = parsed.data

    const bad = () => reply.code(401).send({ error: '学号/工号或密码不正确' })

    // 未指定身份时：先查学生，再查老师；指定了身份就只查对应表
    if (role !== 'teacher') {
      const s = await prisma.student.findFirst({
        where: { OR: [{ studentNo: account }, { email: account }] },
      })
      if (s && (await bcrypt.compare(password, s.passwordHash))) {
        const token = app.jwt.sign({ id: s.id, role: 'student', email: account })
        return { token, user: dto({ ...s, account: s.studentNo }, 'student') }
      }
      if (role === 'student') return bad()
    }

    const t = await prisma.teacher.findFirst({
      where: { OR: [{ employeeNo: account }, { email: account }] },
    })
    if (t && (await bcrypt.compare(password, t.passwordHash))) {
      const token = app.jwt.sign({ id: t.id, role: 'teacher', email: account })
      return { token, user: dto({ ...t, account: t.employeeNo }, 'teacher') }
    }
    return bad()
  })

  // ---------- 体验账号（学生） ----------
  app.post('/api/auth/guest', async (_req, reply) => {
    const rand = Math.random().toString(36).slice(2, 10)
    const email = `guest-${Date.now().toString(36)}-${rand}@local`
    const passwordHash = await bcrypt.hash(rand, 10)
    const s = await prisma.student.create({
      data: { email, passwordHash, name: '体验学员' },
    })
    const token = app.jwt.sign({ id: s.id, role: 'student', email })
    return reply.code(201).send({ token, user: dto({ ...s, account: s.studentNo }, 'student') })
  })

  // ---------- 当前用户 ----------
  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req) => {
    if (req.user.role === 'teacher') {
      const t = await prisma.teacher.findUnique({
        where: { id: req.user.id },
        select: { id: true, employeeNo: true, email: true, name: true },
      })
      return { user: t ? dto({ ...t, account: t.employeeNo }, 'teacher') : null }
    }
    const s = await prisma.student.findUnique({
      where: { id: req.user.id },
      select: { id: true, studentNo: true, email: true, name: true },
    })
    return { user: s ? dto({ ...s, account: s.studentNo }, 'student') : null }
  })
}
