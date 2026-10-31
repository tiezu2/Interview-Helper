import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'

// F9: in-memory spectator registry — assessors watching a live session.
// Summaries only (no video/audio ever leaves the candidate's browser).
type SocketLike = { readyState: number; OPEN?: number; send: (data: string) => void }
const spectators = new Map<string, Set<SocketLike>>()

function broadcast(sessionId: string, frame: string) {
  const set = spectators.get(sessionId)
  if (!set) return
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(frame)
  }
}

// R5/R7 ingest: the browser aggregates all live analysis into 1-second
// summaries and streams them here. Auth via ?token= because the browser
// WebSocket API cannot set headers.
export default async function metricsRoutes(app: FastifyInstance) {
  app.get('/api/sessions/:id/metrics', { websocket: true }, async (socket, req) => {
    const { id } = req.params as { id: string }
    const token = (req.query as { token?: string }).token

    let user
    try {
      user = app.jwt.verify<{ id: string; role: string }>(token ?? '')
    } catch {
      socket.close(4401, 'Unauthorized')
      return
    }

    const session = await prisma.session.findUnique({ where: { id } })
    if (!session || session.candidateId !== user.id) {
      socket.close(4403, 'Forbidden')
      return
    }

    socket.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type !== 'metrics' || typeof msg.signals !== 'object') return
        await prisma.metricWindow.create({
          data: {
            sessionId: id,
            ts: new Date(msg.ts ?? Date.now()),
            signals: JSON.stringify(msg.signals),
          },
        })
        broadcast(id, JSON.stringify({ type: 'metrics', ts: msg.ts, signals: msg.signals }))
        socket.send(JSON.stringify({ type: 'ack', ts: msg.ts }))
      } catch {
        // Malformed frames are dropped; the client buffers and retries (reliability NFR)
      }
    })

    socket.on('close', () => {
      broadcast(id, JSON.stringify({ type: 'session-offline' }))
    })
  })

  // F9: read-only spectate stream for the linked assessor or an admin
  app.get('/api/sessions/:id/spectate', { websocket: true }, async (socket, req) => {
    const { id } = req.params as { id: string }
    const token = (req.query as { token?: string }).token

    let user
    try {
      user = app.jwt.verify<{ id: string; role: string }>(token ?? '')
    } catch {
      socket.close(4401, 'Unauthorized')
      return
    }

    const session = await prisma.session.findUnique({ where: { id } })
    const allowed =
      session &&
      (user.role === 'admin' || (user.role === 'assessor' && session.assessorId === user.id))
    if (!allowed) {
      socket.close(4403, 'Forbidden')
      return
    }

    if (!spectators.has(id)) spectators.set(id, new Set())
    spectators.get(id)!.add(socket)

    socket.send(JSON.stringify({ type: 'spectate-joined', status: session.status }))

    socket.on('close', () => {
      spectators.get(id)?.delete(socket)
      if (spectators.get(id)?.size === 0) spectators.delete(id)
    })
  })
}
