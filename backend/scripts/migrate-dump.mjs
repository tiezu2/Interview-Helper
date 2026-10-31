/**
 * 拆表迁移 · 步骤 1：把现有 dev.db 全部数据导出成 JSON（用旧的 User 单表结构读取）。
 * 用法：node scripts/migrate-dump.mjs
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const prisma = new PrismaClient()

const dump = {
  users: await prisma.user.findMany(),
  classrooms: await prisma.classroom.findMany(),
  memberships: await prisma.classMembership.findMany(),
  sessions: await prisma.session.findMany(),
  questions: await prisma.question.findMany(),
  metricWindows: await prisma.metricWindow.findMany(),
  reports: await prisma.report.findMany(),
  drillRuns: await prisma.drillRun.findMany(),
  invites: await prisma.invite.findMany(),
  recordings: await prisma.recording.findMany(),
}

const out = 'prisma/.split-dump.json'
writeFileSync(out, JSON.stringify(dump), 'utf8')

const teachers = dump.users.filter((u) => u.role === 'teacher' || u.role === 'admin' || u.role === 'assessor')
const students = dump.users.filter((u) => !(u.role === 'teacher' || u.role === 'admin' || u.role === 'assessor'))

console.log(`已导出到 ${out}`)
console.log(`  User 总数 ${dump.users.length}：老师 ${teachers.length} / 学生 ${students.length}`)
console.log(`  Classroom ${dump.classrooms.length} / Membership ${dump.memberships.length}`)
console.log(`  Session ${dump.sessions.length} / Question ${dump.questions.length} / MetricWindow ${dump.metricWindows.length}`)
console.log(`  Report ${dump.reports.length} / DrillRun ${dump.drillRuns.length} / Invite ${dump.invites.length} / Recording ${dump.recordings.length}`)
await prisma.$disconnect()
