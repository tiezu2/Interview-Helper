import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'

const updateRoleSchema = z.object({
  role: z.enum(['admin', 'assessor', 'candidate']),
})

export default async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', { preHandler: app.requireRole('admin') }, async () => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return { users }
  })

  app.patch(
    '/api/admin/users/:id/role',
    { preHandler: app.requireRole('admin') },
    async (req, reply) => {
      const parsed = updateRoleSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid role' })
      const { id } = req.params as { id: string }
      const user = await prisma.user.update({
        where: { id },
        data: { role: parsed.data.role },
        select: { id: true, email: true, name: true, role: true },
      })
      return { user }
    },
  )
}
