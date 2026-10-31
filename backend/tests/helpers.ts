import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { prisma } from '../src/db.js'

export async function freshApp(): Promise<FastifyInstance> {
  return buildApp()
}

// 清空所有业务表（外键顺序：子表先删）
export async function resetDb() {
  await prisma.report.deleteMany()
  await prisma.metricWindow.deleteMany()
  await prisma.question.deleteMany()
  await prisma.session.deleteMany()
  await prisma.classMembership.deleteMany()
  await prisma.classroom.deleteMany()
  await prisma.drillRun.deleteMany()
  await prisma.student.deleteMany()
  await prisma.teacher.deleteMany()
}
