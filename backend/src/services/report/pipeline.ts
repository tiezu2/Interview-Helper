import { prisma } from '../../db.js'
import { aggregateScores } from './scores.js'
import {
  segmentByQuestion,
  analyzeAnswerHeuristics,
  heuristicAnswerCoaching,
  type WindowWithMeta,
} from './answers.js'
import { generateCoaching, generateAnswerCoaching, containsVerdictLanguage } from '../llm/index.js'
import { templateCoaching } from '../llm/templates.js'

// Runs on session end (R7): aggregate metric windows -> scores + per-answer
// analysis -> LLM coaching -> persist report. Transcript comes from the live
// Web Speech transcript sent with metric windows; a whisper pass over the
// uploaded recording can replace it later without changing this pipeline.
export async function generateReport(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { metricWindows: { orderBy: { ts: 'asc' } }, questions: { orderBy: { order: 'asc' } } },
  })
  if (!session) throw new Error('Session not found')

  const existing = await prisma.report.findUnique({ where: { sessionId } })
  if (existing) return existing

  const windows: WindowWithMeta[] = []
  const transcriptParts: string[] = []
  for (const mw of session.metricWindows) {
    try {
      const parsed = JSON.parse(mw.signals)
      windows.push(parsed)
      if (typeof parsed.transcriptDelta === 'string' && parsed.transcriptDelta.trim()) {
        transcriptParts.push(parsed.transcriptDelta.trim())
      }
    } catch {
      // skip malformed windows rather than failing the report
    }
  }

  const durationSec =
    session.startedAt && session.endedAt
      ? (session.endedAt.getTime() - session.startedAt.getTime()) / 1000
      : windows.length

  const scores = aggregateScores(windows, durationSec)
  const transcript = transcriptParts.join(' ')

  // F1/F2: per-question segments with heuristic + LLM answer coaching
  const segments = segmentByQuestion(windows)
  const questionByOrder = new Map(session.questions.map((q) => [q.order, q.text]))
  const heuristicsByOrder = new Map(
    segments.map((seg) => [seg.order, analyzeAnswerHeuristics(seg)]),
  )
  const coaching = await generateAnswerCoaching(
    segments.map((seg) => ({
      order: seg.order,
      question: questionByOrder.get(seg.order) ?? '',
      transcript: seg.transcript,
      heuristicNotes: heuristicAnswerCoaching(seg, heuristicsByOrder.get(seg.order)!),
    })),
  )

  const answers = segments.map((seg) => {
    const h = heuristicsByOrder.get(seg.order)!
    return {
      order: seg.order,
      question: questionByOrder.get(seg.order) ?? '',
      transcript: seg.transcript,
      words: seg.words,
      fillers: seg.fillers,
      durationSec: seg.durationSec,
      avgNervousness: seg.avgNervousness,
      dominantMood: seg.dominantMood,
      structure: {
        hasSituation: h.hasSituation,
        hasAction: h.hasAction,
        hasResult: h.hasResult,
        structureScore: h.structureScore,
        lengthAssessment: h.lengthAssessment,
      },
      coaching: coaching[seg.order] ?? '',
    }
  })

  let feedbackMd = await generateCoaching(session.roleField, scores, transcript)
  if (containsVerdictLanguage(feedbackMd)) {
    feedbackMd = templateCoaching(scores)
  }

  const report = await prisma.report.create({
    data: {
      sessionId,
      scores: JSON.stringify({ ...scores, answers }),
      feedbackMd,
      transcript,
    },
  })

  await prisma.session.update({ where: { id: sessionId }, data: { status: 'reported' } })
  return report
}
