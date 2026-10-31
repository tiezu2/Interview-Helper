/**
 * 拆表迁移 · 步骤 3：把 .split-dump.json 灌回 Teacher / Student 两张表。
 * id 全部沿用原值，因此 Session/DrillRun/Classroom 的外键无需改写。
 * 用法：node scripts/migrate-restore.mjs
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'

const prisma = new PrismaClient()
const dumpPath = 'prisma/.split-dump.json'
if (!existsSync(dumpPath)) {
  console.error('找不到 ' + dumpPath + '，请先运行 node scripts/migrate-dump.mjs')
  process.exit(1)
}
const d = JSON.parse(readFileSync(dumpPath, 'utf8'))

const TEACHER_ROLES = new Set(['teacher', 'admin', 'assessor'])
const teachers = d.users.filter((u) => TEACHER_ROLES.has(u.role))
const students = d.users.filter((u) => !TEACHER_ROLES.has(u.role))

const toDate = (v) => (v ? new Date(v) : undefined)

// 1) 老师
if (teachers.length) {
  await prisma.teacher.createMany({
    data: teachers.map((u) => ({
      id: u.id,
      employeeNo: u.studentNo ?? null,
      email: u.email ?? null,
      passwordHash: u.passwordHash,
      name: u.name,
      createdAt: toDate(u.createdAt),
    })),
  })
}

// 2) 学生
if (students.length) {
  await prisma.student.createMany({
    data: students.map((u) => ({
      id: u.id,
      studentNo: u.studentNo ?? null,
      email: u.email ?? null,
      passwordHash: u.passwordHash,
      name: u.name,
      createdAt: toDate(u.createdAt),
    })),
  })
}

const teacherIds = new Set(teachers.map((t) => t.id))
const studentIds = new Set(students.map((s) => s.id))

// 3) 班级（老师必须存在）
const rooms = d.classrooms.filter((c) => teacherIds.has(c.teacherId))
if (rooms.length) {
  await prisma.classroom.createMany({
    data: rooms.map((c) => ({
      id: c.id,
      name: c.name,
      joinCode: c.joinCode,
      teacherId: c.teacherId,
      createdAt: toDate(c.createdAt),
    })),
  })
}

// 4) 班级成员（学生必须存在）
const roomIds = new Set(rooms.map((c) => c.id))
const memberships = d.memberships.filter((m) => roomIds.has(m.classroomId) && studentIds.has(m.studentId))
if (memberships.length) {
  await prisma.classMembership.createMany({
    data: memberships.map((m) => ({
      id: m.id,
      classroomId: m.classroomId,
      studentId: m.studentId,
      joinedAt: toDate(m.joinedAt),
    })),
  })
}

// 5) 会话（学生必须存在；assessor 一律置空，历史角色已废弃）
const sessions = d.sessions.filter((s) => studentIds.has(s.candidateId))
const sessionIds = new Set(sessions.map((s) => s.id))
if (sessions.length) {
  await prisma.session.createMany({
    data: sessions.map((s) => ({
      id: s.id,
      candidateId: s.candidateId,
      assessorId: null,
      roleField: s.roleField,
      status: s.status,
      consentAt: toDate(s.consentAt) ?? null,
      startedAt: toDate(s.startedAt) ?? null,
      endedAt: toDate(s.endedAt) ?? null,
      createdAt: toDate(s.createdAt),
    })),
  })
}

// 6) 题目 / 指标窗口 / 报告
const questions = d.questions.filter((q) => sessionIds.has(q.sessionId))
if (questions.length) {
  await prisma.question.createMany({
    data: questions.map((q) => ({
      id: q.id,
      sessionId: q.sessionId,
      order: q.order,
      text: q.text,
      askedAt: toDate(q.askedAt) ?? null,
    })),
  })
}

const windows = d.metricWindows.filter((w) => sessionIds.has(w.sessionId))
if (windows.length) {
  for (let i = 0; i < windows.length; i += 400) {
    await prisma.metricWindow.createMany({
      data: windows.slice(i, i + 400).map((w) => ({
        id: w.id,
        sessionId: w.sessionId,
        ts: toDate(w.ts),
        signals: w.signals,
      })),
    })
  }
}

const reports = d.reports.filter((r) => sessionIds.has(r.sessionId))
if (reports.length) {
  await prisma.report.createMany({
    data: reports.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      scores: r.scores,
      feedbackMd: r.feedbackMd,
      transcript: r.transcript,
      createdAt: toDate(r.createdAt),
    })),
  })
}

// 7) 训练记录
const drills = d.drillRuns.filter((x) => studentIds.has(x.userId))
if (drills.length) {
  await prisma.drillRun.createMany({
    data: drills.map((x) => ({
      id: x.id,
      userId: x.userId,
      kind: x.kind,
      score: x.score,
      durationSec: x.durationSec,
      metrics: x.metrics,
      createdAt: toDate(x.createdAt),
    })),
  })
}

const counts = {
  Teacher: await prisma.teacher.count(),
  Student: await prisma.student.count(),
  Classroom: await prisma.classroom.count(),
  ClassMembership: await prisma.classMembership.count(),
  Session: await prisma.session.count(),
  Question: await prisma.question.count(),
  MetricWindow: await prisma.metricWindow.count(),
  Report: await prisma.report.count(),
  DrillRun: await prisma.drillRun.count(),
}
console.log('迁移完成：')
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v}`)
await prisma.$disconnect()
