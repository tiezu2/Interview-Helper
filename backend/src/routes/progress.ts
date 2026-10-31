import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'

// F7: score history for the progress dashboard (own sessions only)
export default async function progressRoutes(app: FastifyInstance) {
  app.get('/api/progress', { preHandler: app.authenticate }, async (req) => {
    const sessions = await prisma.session.findMany({
      where: { candidateId: req.user.id, status: 'reported' },
      orderBy: { createdAt: 'asc' },
      include: { report: { select: { scores: true, createdAt: true } } },
    })

    const history = sessions
      .filter((s) => s.report)
      .map((s) => {
        let scores: any = null
        try {
          scores = JSON.parse(s.report!.scores)
        } catch {
          /* skip */
        }
        return {
          sessionId: s.id,
          roleField: s.roleField,
          date: s.report!.createdAt,
          overall: scores?.overall ?? null,
          expression: scores?.expression ?? null,
          eyeContact: scores?.eyeContact ?? null,
          stillness: scores?.stillness ?? null,
          voice: scores?.voice ?? null,
          speech: scores?.speech ?? null,
        }
      })
      .filter((h) => h.overall !== null)

    // Streak: consecutive calendar days (ending today or yesterday) with a session
    const days = [...new Set(history.map((h) => new Date(h.date).toISOString().slice(0, 10)))]
      .sort()
      .reverse()
    let streak = 0
    if (days.length) {
      const today = new Date()
      const dayMs = 24 * 60 * 60 * 1000
      const expected: string[] = []
      for (let i = 0; i < days.length + 1; i++) {
        expected.push(new Date(today.getTime() - i * dayMs).toISOString().slice(0, 10))
      }
      // allow the streak to start yesterday
      let idx = days[0] === expected[0] ? 0 : days[0] === expected[1] ? 1 : -1
      if (idx >= 0) {
        for (const d of days) {
          if (d === expected[idx]) {
            streak++
            idx++
          } else break
        }
      }
    }

    const best = history.length ? Math.max(...history.map((h) => h.overall as number)) : null

    return { history, streak, best, totalSessions: history.length }
  })
}
