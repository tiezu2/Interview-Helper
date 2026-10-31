import type { FastifyInstance } from 'fastify'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../db.js'

// 班级与看板：老师建班 → 学生凭加入码进班 → 老师按班级看学生分数。
// 隐私边界：老师只能看到「分数与指标摘要」，看不到音视频与原始文字稿。

const createSchema = z.object({
  name: z.string().min(1).max(40),
})

const joinSchema = z.object({
  joinCode: z.string().min(4).max(12),
})

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉易混淆的 I/O/0/1

function makeCode(len = 6) {
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_CHARS[randomInt(CODE_CHARS.length)]
  return out
}

// 从 Report.scores（JSON blob）里取五项分数与综合分
function parseScores(raw: string | null): {
  overall: number | null
  expression: number | null
  eyeContact: number | null
  stillness: number | null
  voice: number | null
  speech: number | null
} {
  if (!raw) return { overall: null, expression: null, eyeContact: null, stillness: null, voice: null, speech: null }
  try {
    const s = JSON.parse(raw)
    const n = (v: unknown) => (typeof v === 'number' ? v : null)
    return {
      overall: n(s.overall),
      expression: n(s.expression),
      eyeContact: n(s.eyeContact),
      stillness: n(s.stillness),
      voice: n(s.voice),
      speech: n(s.speech),
    }
  } catch {
    return { overall: null, expression: null, eyeContact: null, stillness: null, voice: null, speech: null }
  }
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

export default async function classRoutes(app: FastifyInstance) {
  // ---------- 老师：建班 ----------
  app.post('/api/classes', { preHandler: app.authenticate }, async (req, reply) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return reply.code(403).send({ error: '只有老师账号可以创建班级' })
    }
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: '请输入班级名称' })

    // 极小概率重复，重试几次
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode()
      const exists = await prisma.classroom.findUnique({ where: { joinCode: code } })
      if (exists) continue
      const classroom = await prisma.classroom.create({
        data: { name: parsed.data.name, joinCode: code, teacherId: req.user.id },
      })
      return reply.code(201).send({ classroom })
    }
    return reply.code(500).send({ error: '生成加入码失败，请重试' })
  })

  // ---------- 老师：班级列表（含人数与班级均分） ----------
  app.get('/api/classes', { preHandler: app.authenticate }, async (req, reply) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return reply.code(403).send({ error: '只有老师账号可以查看班级' })
    }
    const rooms = await prisma.classroom.findMany({
      where: { teacherId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { memberships: { include: { student: true } } },
    })

    const result = []
    for (const room of rooms) {
      const studentIds = room.memberships.map((m) => m.studentId)
      const reports = studentIds.length
        ? await prisma.report.findMany({
            where: { session: { candidateId: { in: studentIds } } },
            select: { scores: true },
          })
        : []
      const overalls = reports
        .map((r) => parseScores(r.scores).overall)
        .filter((v): v is number => v !== null)

      result.push({
        id: room.id,
        name: room.name,
        joinCode: room.joinCode,
        createdAt: room.createdAt,
        memberCount: room.memberships.length,
        reportCount: overalls.length,
        classAvg: avg(overalls),
      })
    }
    return { classes: result }
  })

  // ---------- 老师：班级看板（每个学生的分数） ----------
  app.get('/api/classes/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const room = await prisma.classroom.findUnique({
      where: { id },
      include: { memberships: { include: { student: true } } },
    })
    if (!room) return reply.code(404).send({ error: '班级不存在' })
    if (room.teacherId !== req.user.id && req.user.role !== 'admin') {
      return reply.code(403).send({ error: '无权查看该班级' })
    }

    // 批量拉取：报告与训练各一次查询，避免 N+1（30 人从 60+ 次查询降到 2 次）
    const ids = room.memberships.map((m) => m.studentId)
    const [allReports, allDrills] = await Promise.all([
      ids.length
        ? prisma.report.findMany({
            where: { session: { candidateId: { in: ids } } },
            orderBy: { createdAt: 'desc' },
            select: { scores: true, createdAt: true, sessionId: true, session: { select: { candidateId: true } } },
          })
        : Promise.resolve([] as any[]),
      ids.length
        ? prisma.drillRun.findMany({
            where: { userId: { in: ids } },
            orderBy: { createdAt: 'desc' },
            select: { userId: true, kind: true, score: true, createdAt: true },
          })
        : Promise.resolve([] as any[]),
    ])

    const reportsByStudent = new Map<string, any[]>()
    for (const r of allReports as any[]) {
      const sid = r.session?.candidateId
      if (!sid) continue
      if (!reportsByStudent.has(sid)) reportsByStudent.set(sid, [])
      reportsByStudent.get(sid)!.push(r)
    }
    const drillsByStudent = new Map<string, any[]>()
    for (const d of allDrills as any[]) {
      if (!drillsByStudent.has(d.userId)) drillsByStudent.set(d.userId, [])
      drillsByStudent.get(d.userId)!.push(d)
    }

    const students = []
    for (const m of room.memberships) {
      const sid = m.studentId

      const reports = (reportsByStudent.get(sid) ?? []).slice(0, 10)
      const parsed = reports.map((r: any) => ({ at: r.createdAt, sessionId: r.sessionId, ...parseScores(r.scores) }))
      const overalls = parsed.map((p) => p.overall).filter((v): v is number => v !== null)

      const drills = (drillsByStudent.get(sid) ?? []).slice(0, 50)

      const latest = parsed[0] ?? null
      students.push({
        id: sid,
        name: m.student.name,
        studentNo: m.student.studentNo,
        email: m.student.email,
        joinedAt: m.joinedAt,
        sessionCount: reports.length,
        latest: latest
          ? {
              overall: latest.overall,
              expression: latest.expression,
              eyeContact: latest.eyeContact,
              stillness: latest.stillness,
              voice: latest.voice,
              speech: latest.speech,
              at: latest.at,
            }
          : null,
        bestOverall: overalls.length ? Math.max(...overalls) : null,
        avgOverall: avg(overalls),
        trend: parsed
          .slice(0, 8)
          .map((p) => ({ at: p.at, score: p.overall }))
          .reverse(),
        drillCount: drills.length,
        drillAvg: avg(drills.map((d) => d.score)),
        lastActivity: latest?.at ?? drills[0]?.createdAt ?? null,
      })
    }

    // 班级汇总裁剪
    const overalls = students.map((s) => s.avgOverall).filter((v): v is number => v !== null)
    const weakest = ['expression', 'eyeContact', 'stillness', 'voice', 'speech'] as const
    const dimAvg: Record<string, number | null> = {}
    for (const k of weakest) {
      const vals = students
        .map((s) => (s.latest ? (s.latest as any)[k] : null))
        .filter((v): v is number => typeof v === 'number')
      dimAvg[k] = avg(vals)
    }

    return {
      classroom: { id: room.id, name: room.name, joinCode: room.joinCode, createdAt: room.createdAt },
      students: students.sort((a, b) => (b.avgOverall ?? -1) - (a.avgOverall ?? -1)),
      stats: {
        memberCount: students.length,
        practiced: students.filter((s) => s.sessionCount > 0).length,
        classAvg: avg(overalls),
        dimAvg,
      },
    }
  })

  // ---------- 学生：加入班级 ----------
  app.post('/api/classes/join', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = joinSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: '请输入 6 位加入码' })

    const room = await prisma.classroom.findUnique({ where: { joinCode: parsed.data.joinCode.trim().toUpperCase() } })
    if (!room) return reply.code(404).send({ error: '加入码不存在，请向老师确认' })

    const existing = await prisma.classMembership.findUnique({
      where: { classroomId_studentId: { classroomId: room.id, studentId: req.user.id } },
    })
    if (existing) return reply.send({ classroom: { id: room.id, name: room.name }, already: true })

    await prisma.classMembership.create({ data: { classroomId: room.id, studentId: req.user.id } })
    return reply.code(201).send({ classroom: { id: room.id, name: room.name } })
  })

  // ---------- 学生：我的班级 ----------
  app.get('/api/my-classes', { preHandler: app.authenticate }, async (req) => {
    const memberships = await prisma.classMembership.findMany({
      where: { studentId: req.user.id },
      include: { classroom: { include: { teacher: { select: { name: true } } } } },
      orderBy: { joinedAt: 'desc' },
    })
    return {
      classes: memberships.map((m) => ({
        id: m.classroom.id,
        name: m.classroom.name,
        teacherName: m.classroom.teacher.name,
        joinedAt: m.joinedAt,
      })),
    }
  })

  // ---------- 学生：同班同学的分数排行 ----------
  // 隐私边界：只给「姓名 / 学号打码 / 分数 / 练习次数」，
  // 不含任何音视频、文字稿、邮箱。
  app.get('/api/my-classes/:id/classmates', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const membership = await prisma.classMembership.findUnique({
      where: { classroomId_studentId: { classroomId: id, studentId: req.user.id } },
    })
    if (!membership) return reply.code(403).send({ error: '你还没有加入这个班级' })

    const room = await prisma.classroom.findUnique({
      where: { id },
      include: {
        teacher: { select: { name: true } },
        memberships: { include: { student: { select: { id: true, name: true, studentNo: true } } } },
      },
    })
    if (!room) return reply.code(404).send({ error: '班级不存在' })

    const ids = room.memberships.map((m) => m.studentId)

    // 一次取全班的报告（只取分数与时间），再在内存里按学生聚合
    const reports = await prisma.report.findMany({
      where: { session: { candidateId: { in: ids } } },
      select: { scores: true, createdAt: true, session: { select: { candidateId: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const sessionsByStudent = await prisma.session.groupBy({
      by: ['candidateId'],
      where: { candidateId: { in: ids } },
      _count: { _all: true },
    })
    const sessionCount = new Map(sessionsByStudent.map((s) => [s.candidateId, s._count._all]))

    const byStudent = new Map<string, { overall: number | null; expression: number | null; eyeContact: number | null; stillness: number | null; voice: number | null; speech: number | null; at: Date }[]>()
    for (const r of reports) {
      const sid = r.session.candidateId
      if (!byStudent.has(sid)) byStudent.set(sid, [])
      byStudent.get(sid)!.push({ ...parseScores(r.scores), at: r.createdAt })
    }

    const maskNo = (no: string | null) => {
      if (!no) return '未填学号'
      if (no.length <= 4) return no[0] + '***'
      return no.slice(0, 3) + '****' + no.slice(-2)
    }

    const rows = room.memberships.map((m) => {
      const list = byStudent.get(m.studentId) ?? []
      const overalls = list.map((x) => x.overall).filter((v): v is number => v !== null)
      return {
        id: m.studentId,
        name: m.student.name,
        studentNoMasked: maskNo(m.student.studentNo),
        isMe: m.studentId === req.user.id,
        sessionCount: sessionCount.get(m.studentId) ?? 0,
        latestOverall: list[0]?.overall ?? null,
        bestOverall: overalls.length ? Math.max(...overalls) : null,
        avgOverall: avg(overalls),
        lastAt: list[0]?.at ?? null,
      }
    })

    // 按均分排序给出名次（没练过的排在最后）
    const ranked = rows
      .slice()
      .sort((a, b) => (b.avgOverall ?? -1) - (a.avgOverall ?? -1))
      .map((r, i) => ({ ...r, rank: r.sessionCount > 0 ? i + 1 : null }))

    const mine = ranked.find((r) => r.isMe) ?? null
    const classOveralls = ranked.map((r) => r.avgOverall).filter((v): v is number => v !== null)

    return {
      classroom: { id: room.id, name: room.name, teacherName: room.teacher.name },
      me: mine,
      rankTotal: ranked.filter((r) => r.rank !== null).length,
      classAvg: avg(classOveralls),
      classmates: ranked,
    }
  })
}
