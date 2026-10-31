import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { generateQuestions, generateFollowUp } from '../services/llm/index.js'
import { generateReport } from '../services/report/pipeline.js'

const followUpSchema = z.object({
  question: z.string().min(2).max(1000),
  answerText: z.string().max(8000).default(''),
})

const createSessionSchema = z.object({
  roleField: z.string().min(2).max(200),
  consent: z.literal(true), // R10: no session without consent
  inviteCode: z.string().optional(),
})

export default async function sessionRoutes(app: FastifyInstance) {
  app.post('/api/sessions', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Consent and a job role are required to start a session' })
    }
    const { roleField, inviteCode } = parsed.data

    // Link to the inviting assessor when the candidate arrived via invite
    let assessorId: string | null = null
    if (inviteCode) {
      const invite = await prisma.invite.findUnique({ where: { code: inviteCode } })
      if (invite && invite.expiresAt >= new Date()) assessorId = invite.assessorId
    }

    const questions = await generateQuestions(roleField, 5)

    const session = await prisma.session.create({
      data: {
        candidateId: req.user.id,
        assessorId,
        roleField,
        consentAt: new Date(),
        status: 'created',
        questions: {
          create: questions.map((text, i) => ({ order: i + 1, text })),
        },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    })

    return reply.code(201).send({ session })
  })

  app.post('/api/sessions/:id/start', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = await prisma.session.findUnique({ where: { id } })
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    if (session.candidateId !== req.user.id) return reply.code(403).send({ error: 'Forbidden' })
    if (!session.consentAt) return reply.code(400).send({ error: 'Consent required' })

    const updated = await prisma.session.update({
      where: { id },
      data: { status: 'active', startedAt: new Date() },
    })
    return { session: updated }
  })

  app.post('/api/sessions/:id/end', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = await prisma.session.findUnique({ where: { id } })
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    if (session.candidateId !== req.user.id) return reply.code(403).send({ error: 'Forbidden' })

    await prisma.session.update({
      where: { id },
      data: { status: 'ended', endedAt: new Date() },
    })

    // R7: report ready <30s — generate synchronously; upload failures
    // elsewhere never block this path.
    const report = await generateReport(id)
    return { reportId: report.id }
  })

  // F5: follow-up question generated from the candidate's actual answer.
  // Not persisted as a Question row — its answer streams into the parent
  // question's metric windows.
  app.post('/api/sessions/:id/followup', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = followUpSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid follow-up request' })

    const session = await prisma.session.findUnique({ where: { id } })
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    if (session.candidateId !== req.user.id) return reply.code(403).send({ error: 'Forbidden' })

    const followUp = await generateFollowUp(parsed.data.question, parsed.data.answerText)
    return { followUp }
  })

  app.get('/api/sessions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = await prisma.session.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } } },
    })
    if (!session) return reply.code(404).send({ error: 'Session not found' })

    const isOwner = session.candidateId === req.user.id
    const isAssessor = req.user.role === 'assessor' && session.assessorId === req.user.id
    const isAdmin = req.user.role === 'admin'
    if (!isOwner && !isAssessor && !isAdmin) return reply.code(403).send({ error: 'Forbidden' })

    return { session }
  })

  // R9: session history scoped by role
  app.get('/api/sessions', { preHandler: app.authenticate }, async (req) => {
    const where =
      req.user.role === 'admin'
        ? {}
        : req.user.role === 'assessor'
          ? { assessorId: req.user.id }
          : { candidateId: req.user.id }

    const sessions = await prisma.session.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        candidate: { select: { name: true, email: true } },
        report: { select: { id: true } },
      },
    })
    return { sessions }
  })
}
