import { prisma } from '../../db.js'
import { getStorage } from '../storage/index.js'

// R12: recordings auto-delete after the retention window. `now` is
// injectable for tests (T17 clock injection).
export async function runRetentionSweep(now: Date = new Date()): Promise<number> {
  const expired = await prisma.recording.findMany({
    where: { expiresAt: { lt: now }, uploadedAt: { not: null } },
  })

  let deleted = 0
  for (const rec of expired) {
    try {
      await getStorage().delete(rec.objectKey)
      await prisma.recording.delete({ where: { id: rec.id } })
      deleted++
    } catch {
      // leave the row for the next sweep if storage deletion fails
    }
  }
  return deleted
}

export function startRetentionJob(intervalMs = 60 * 60 * 1000) {
  const timer = setInterval(() => {
    runRetentionSweep().catch(() => {})
  }, intervalMs)
  timer.unref()
  return timer
}
