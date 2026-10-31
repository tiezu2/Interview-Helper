import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../db.js'

const createInviteSchema = z.object({
  email: z.string().email().optional(),
  expiresInDays: z.number().int().min(1).max(90).default(14),
})

export default async function inviteRoutes(app: FastifyInstance) {
  app.post(
    '/api/invites',
    { preHandler: app.requireRole('assessor', 'admin') },
    async (req, reply) => {
      const parsed = createInviteSchema.safeParse(req.body ?? {})
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })
      const { email, expiresInDays } = parsed.data

      const invite = await prisma.invite.create({
        data: {
          assessorId: req.user.id,
          code: randomBytes(6).toString('hex'),
          email,
          expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        },
      })
      return reply.code(201).send({ invite })
    },
  )

  app.get(
    '/api/invites',
    { preHandler: app.requireRole('assessor', 'admin') },
    async (req) => {
      const invites = await prisma.invite.findMany({
        where: req.user.role === 'admin' ? {} : { assessorId: req.user.id },
        orderBy: { createdAt: 'desc' },
      })
      return { invites }
    },
  )

  // Public check so the register page can validate a code before signup
  app.get('/api/invites/:code/validate', async (req, reply) => {
    const { code } = req.params as { code: string }
    const invite = await prisma.invite.findUnique({ where: { code } })
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return reply.code(404).send({ valid: false })
    }
    return { valid: true, email: invite.email }
  })
}
