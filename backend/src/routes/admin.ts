import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'

// 账号已拆成 Teacher / Student 两张表，这里只提供只读总览（角色不再可改）。
export default async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', { preHandler: app.requireRole('admin') }, async () => {
    const [teachers, students] = await Promise.all([
      prisma.teacher.findMany({
        select: { id: true, employeeNo: true, email: true, name: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.student.findMany({
        select: { id: true, studentNo: true, email: true, name: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    return {
      teachers: teachers.map((t) => ({ ...t, role: 'teacher', studentNo: t.employeeNo })),
      students: students.map((s) => ({ ...s, role: 'student' })),
    }
  })
}
