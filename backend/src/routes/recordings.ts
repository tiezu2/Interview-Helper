import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { getStorage } from '../services/storage/index.js'
import { config } from '../config.js'

export default async function recordingRoutes(app: FastifyInstance) {
  // R11: post-session upload from MediaRecorder. Retry-safe: re-uploading
  // the same session overwrites the object and refreshes the row.
  app.post(
    '/api/sessions/:id/recording',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const session = await prisma.session.findUnique({ where: { id } })
      if (!session) return reply.code(404).send({ error: 'Session not found' })
      if (session.candidateId !== req.user.id) return reply.code(403).send({ error: 'Forbidden' })

      const file = await req.file()
      if (!file) return reply.code(400).send({ error: 'No file uploaded' })

      const data = await file.toBuffer()
      const objectKey = `sessions/${id}/recording.webm`
      const expiresAt = new Date(Date.now() + config.retentionDays * 24 * 60 * 60 * 1000)

      await getStorage().put(objectKey, data)
      const recording = await prisma.recording.upsert({
        where: { sessionId: id },
        create: { sessionId: id, objectKey, size: data.length, expiresAt, uploadedAt: new Date() },
        update: { size: data.length, expiresAt, uploadedAt: new Date() },
      })

      return reply.code(201).send({ recording: { id: recording.id, size: recording.size } })
    },
  )

  // R12: recordings are for internal AI-quality review ONLY — admin access only.
  app.get(
    '/api/recordings/:id',
    { preHandler: app.requireRole('admin') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const recording = await prisma.recording.findUnique({ where: { id } })
      if (!recording || !recording.uploadedAt) {
        return reply.code(404).send({ error: 'Recording not found' })
      }
      const data = await getStorage().get(recording.objectKey)
      reply.header('Content-Type', 'video/webm')
      return reply.send(data)
    },
  )

  app.get(
    '/api/recordings',
    { preHandler: app.requireRole('admin') },
    async () => {
      const recordings = await prisma.recording.findMany({
        orderBy: { uploadedAt: 'desc' },
        include: { session: { select: { roleField: true, startedAt: true } } },
      })
      return { recordings }
    },
  )
}
