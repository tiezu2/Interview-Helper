import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../db.js'

// 老师端：单个学生的详情（报告 + 训练明细）、移除学生、批量导入学生。
// 隐私边界：老师可看分数、逐题文字与训练指标；不含任何音视频。

const DEFAULT_PASSWORD = '12345678'

const importSchema = z.object({
  text: z.string().min(1, '请粘贴学号与姓名'),
  defaultPassword: z.string().min(8).max(32).optional(),
})

const DIM_LABEL: Record<string, string> = {
  expression: '表情从容',
  eyeContact: '眼神接触',
  stillness: '身体稳定',
  voice: '声音表现',
  speech: '语言表达',
}

const DRILL_LABEL: Record<string, string> = {
  gaze: '眼神锁定',
  pace: '语速控制',
  filler: '口头禅清除',
  posture: '姿态矫正',
  intro: '自我介绍',
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

function parseScores(raw: string | null) {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// 老师是否拥有这个班
async function ownsClass(teacherId: string, classId: string) {
  const room = await prisma.classroom.findUnique({ where: { id: classId } })
  return room && room.teacherId === teacherId ? room : null
}

export default async function classStudentRoutes(app: FastifyInstance) {
  // ---------- 学生详情：报告列表 + 训练明细 ----------
  app.get('/api/classes/:id/students/:sid', { preHandler: app.authenticate }, async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string }
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return reply.code(403).send({ error: '只有老师可以查看学生详情' })
    }
    const room = await ownsClass(req.user.id, id)
    if (!room) return reply.code(403).send({ error: '无权查看该班级' })

    const membership = await prisma.classMembership.findUnique({
      where: { classroomId_studentId: { classroomId: id, studentId: sid } },
    })
    if (!membership) return reply.code(404).send({ error: '该学生不在这个班里' })

    const student = await prisma.user.findUnique({
      where: { id: sid },
      select: { id: true, name: true, studentNo: true },
    })
    if (!student) return reply.code(404).send({ error: '学生不存在' })

    // 报告（最近 20 次）
    const sessions = await prisma.session.findMany({
      where: { candidateId: sid },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        roleField: true,
        status: true,
        createdAt: true,
        report: { select: { scores: true, createdAt: true } },
      },
    })

    const reports = sessions
      .filter((s) => s.report)
      .map((s) => {
        const sc = parseScores(s.report!.scores) as Record<string, any>
        return {
          sessionId: s.id,
          roleField: s.roleField,
          createdAt: s.report!.createdAt,
          overall: typeof sc.overall === 'number' ? sc.overall : null,
          expression: sc.expression ?? null,
          eyeContact: sc.eyeContact ?? null,
          stillness: sc.stillness ?? null,
          voice: sc.voice ?? null,
          speech: sc.speech ?? null,
          answers: Array.isArray(sc.answers) ? sc.answers.length : 0,
        }
      })

    const overalls = reports.map((r) => r.overall).filter((v): v is number => typeof v === 'number')

    // 训练明细（按 kind 聚合）
    const drills = await prisma.drillRun.findMany({
      where: { userId: sid },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { kind: true, score: true, durationSec: true, createdAt: true },
    })
    const kinds = Object.keys(DRILL_LABEL)
    const drillDetail = kinds.map((kind) => {
      const own = drills.filter((d) => d.kind === kind)
      const recent3 = own.slice(0, 3)
      return {
        kind,
        label: DRILL_LABEL[kind],
        runs: own.length,
        latest: own[0]?.score ?? null,
        best: own.length ? Math.max(...own.map((d) => d.score)) : null,
        avg3: avg(recent3.map((d) => d.score)),
        trend: own
          .slice(0, 10)
          .map((d) => ({ at: d.createdAt, score: d.score }))
          .reverse(),
      }
    })

    // 薄弱项建议：把「最近综合分里的最弱维度」和「最弱的训练项」对应起来
    const latestReport = reports[0] ?? null
    const weakDims = latestReport
      ? (['expression', 'eyeContact', 'stillness', 'voice', 'speech'] as const)
          .map((k) => ({
            key: k,
            label: DIM_LABEL[k],
            score: typeof (latestReport as any)[k] === 'number' ? (latestReport as any)[k] : null,
          }))
          .filter((x) => x.score !== null)
          .sort((a, b) => (a.score as number) - (b.score as number))
          .slice(0, 2)
      : []

    const dimToDrill: Record<string, string> = {
      expression: 'filler',
      eyeContact: 'gaze',
      stillness: 'posture',
      voice: 'pace',
      speech: 'filler',
    }
    const suggestions = weakDims.map((d) => ({
      dimLabel: d.label,
      dimScore: d.score,
      drillKind: dimToDrill[d.key] ?? 'intro',
      drillLabel: DRILL_LABEL[dimToDrill[d.key] ?? 'intro'],
    }))

    return {
      student: { ...student, joinedAt: membership.joinedAt },
      reports,
      stats: {
        sessions: sessions.length,
        reported: reports.length,
        latestOverall: overalls[0] ?? null,
        avgOverall: avg(overalls),
        bestOverall: overalls.length ? Math.max(...overalls) : null,
        trend: reports
          .slice(0, 8)
          .map((r) => ({ at: r.createdAt, score: r.overall }))
          .reverse(),
        drillRuns: drills.length,
      },
      drills: drillDetail,
      suggestions,
    }
  })

  // ---------- 移除学生（只解除班级关联，不删账号） ----------
  app.delete('/api/classes/:id/students/:sid', { preHandler: app.authenticate }, async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string }
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return reply.code(403).send({ error: '只有老师可以移除学生' })
    }
    const room = await ownsClass(req.user.id, id)
    if (!room) return reply.code(403).send({ error: '无权操作该班级' })

    const existing = await prisma.classMembership.findUnique({
      where: { classroomId_studentId: { classroomId: id, studentId: sid } },
    })
    if (!existing) return reply.code(404).send({ error: '该学生不在这个班里' })

    await prisma.classMembership.delete({ where: { id: existing.id } })
    return { ok: true }
  })

  // ---------- 批量导入学生 ----------
  // 文本格式（每行一个）：学号,姓名 或 学号 姓名 或 只写学号
  app.post('/api/classes/:id/import', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return reply.code(403).send({ error: '只有老师可以批量导入' })
    }
    const room = await ownsClass(req.user.id, id)
    if (!room) return reply.code(403).send({ error: '无权操作该班级' })

    const parsed = importSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })

    const password = parsed.data.defaultPassword || DEFAULT_PASSWORD
    const passwordHash = await bcrypt.hash(password, 10)

    const lines = parsed.data.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)

    const created: Array<{ studentNo: string; name: string; password: string }> = []
    const added: Array<{ studentNo: string; name: string }> = []
    const skipped: Array<{ line: string; reason: string }> = []

    for (const line of lines) {
      const parts = line.split(/[,，\t;；\s]+/).filter(Boolean)
      const studentNo = parts[0]
      const name = parts[1] ?? `学生${studentNo.slice(-4)}`

      if (!studentNo || !/^[A-Za-z0-9_-]{4,32}$/.test(studentNo)) {
        skipped.push({ line, reason: '学号格式不对（4—32 位字母数字）' })
        continue
      }

      // 已有账号？
      let user = await prisma.user.findFirst({ where: { studentNo } })
      let isNew = false
      if (!user) {
        user = await prisma.user.create({
          data: { studentNo, name, passwordHash, role: 'student' },
        })
        isNew = true
      }

      const exists = await prisma.classMembership.findUnique({
        where: { classroomId_studentId: { classroomId: id, studentId: user.id } },
      })
      if (exists) {
        skipped.push({ line, reason: '已在该班级' })
        continue
      }

      await prisma.classMembership.create({ data: { classroomId: id, studentId: user.id } })
      if (isNew) created.push({ studentNo, name, password })
      else added.push({ studentNo, name: user.name })
    }

    return {
      ok: true,
      defaultPassword: password,
      summary: { created: created.length, added: added.length, skipped: skipped.length },
      created,
      added,
      skipped,
    }
  })
}
