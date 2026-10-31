import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../db.js'

// 账号体系：以「学号 / 工号」作为登录账号，邮箱改为可选补充信息。
const registerSchema = z.object({
  account: z
    .string()
    .min(4, '学号/工号至少 4 位')
    .max(32, '学号/工号最多 32 位')
    .regex(/^[A-Za-z0-9_-]+$/, '学号/工号只能包含字母、数字、下划线和横线'),
  password: z.string().min(8, '密码至少 8 位'),
  name: z.string().min(1, '请填写姓名'),
  role: z.enum(['student', 'teacher']).optional(),
  email: z.string().email().optional().or(z.literal('')),
})

const loginSchema = z.object({
  account: z.string().min(1, '请填写学号/工号'),
  password: z.string(),
})

function toUserDto(u: { id: string; name: string; role: string; studentNo: string | null; email: string | null }) {
  return { id: u.id, name: u.name, role: u.role, studentNo: u.studentNo, email: u.email ?? '' }
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })
    const { account, password, name, role: wantedRole, email } = parsed.data

    const accountTaken = await prisma.user.findFirst({
      where: { OR: [{ studentNo: account }, { email: account }] },
    })
    if (accountTaken) return reply.code(409).send({ error: '该学号/工号已被注册' })

    const role: string = wantedRole ?? 'student'
    const emailValue = email && email.length > 0 ? email : null
    if (emailValue) {
      const emailTaken = await prisma.user.findUnique({ where: { email: emailValue } })
      if (emailTaken) return reply.code(409).send({ error: '该邮箱已被使用' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { studentNo: account, email: emailValue, passwordHash, name, role },
    })

    const token = app.jwt.sign({ id: user.id, role: user.role as any, email: user.studentNo ?? '' })
    return reply.code(201).send({ token, user: toUserDto(user) })
  })

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })
    const { account, password } = parsed.data

    const user = await prisma.user.findFirst({
      where: { OR: [{ studentNo: account }, { email: account }] },
    })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: '学号/工号或密码不正确' })
    }

    const token = app.jwt.sign({ id: user.id, role: user.role as any, email: user.studentNo ?? '' })
    return { token, user: toUserDto(user) }
  })

  // 体验模式：一键创建匿名学员账号，免注册（演示 / 快速开始训练用）。
  app.post('/api/auth/guest', async (req, reply) => {
    const rand = Math.random().toString(36).slice(2, 10)
    const email = `guest-${Date.now().toString(36)}-${rand}@local`
    const passwordHash = await bcrypt.hash(rand, 10)
    const user = await prisma.user.create({
      data: { email, passwordHash, name: '体验学员', role: 'student' },
    })
    const token = app.jwt.sign({ id: user.id, role: user.role as any, email })
    return reply.code(201).send({ token, user: toUserDto(user) })
  })

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, studentNo: true, email: true, name: true, role: true },
    })
    return { user: user ? toUserDto(user as any) : null }
  })
}
