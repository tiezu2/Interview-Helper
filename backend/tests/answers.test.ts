import { describe, it, expect } from 'vitest'
import {
  segmentByQuestion,
  analyzeAnswerHeuristics,
  heuristicAnswerCoaching,
  percentileRank,
  type WindowWithMeta,
} from '../src/services/report/answers.js'
import { containsVerdictLanguage } from '../src/services/llm/index.js'

function window(order: number, text: string, words: number, fillers = 0, nervousness = 0.3): WindowWithMeta {
  return {
    questionOrder: order,
    transcriptDelta: text,
    speech: { fillers, words },
    mood: { state: 'calm', emoji: '🙂', nervousness },
  }
}

describe('answer segmentation (F1)', () => {
  it('groups windows and transcript by question order', () => {
    const segments = segmentByQuestion([
      window(1, 'first answer part one', 4),
      window(1, 'part two', 2),
      window(2, 'second answer', 2, 1, 0.6),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[0].order).toBe(1)
    expect(segments[0].transcript).toBe('first answer part one part two')
    expect(segments[0].words).toBe(6)
    expect(segments[1].fillers).toBe(1)
    expect(segments[1].avgNervousness).toBe(0.6)
  })

  it('computes dominant mood per segment and skips pre-question windows', () => {
    const w1 = window(1, 'a', 1)
    const w2 = { ...window(1, 'b', 1), mood: { state: 'nervous', emoji: '😰', nervousness: 0.8 } }
    const w3 = { ...window(1, 'c', 1), mood: { state: 'nervous', emoji: '😰', nervousness: 0.7 } }
    const pre = { ...window(0, 'setup noise', 2) }
    const segments = segmentByQuestion([pre, w1, w2, w3])
    expect(segments).toHaveLength(1)
    expect(segments[0].dominantMood?.state).toBe('nervous')
  })

  it('handles windows with no question tag or transcript', () => {
    expect(segmentByQuestion([{ speech: { fillers: 0, words: 0 } }])).toHaveLength(0)
  })
})

describe('answer heuristics (F2)', () => {
  const starAnswer =
    'When I was at my previous company there was a time we lost a key client. ' +
    'So I decided to rebuild the relationship and I organized weekly check-ins with their team. ' +
    'As a result we won the contract back and it improved our retention overall. ' +
    Array.from({ length: 20 }, () => 'and we kept improving the process every quarter').join(' ')

  it('detects STAR components in a structured answer', () => {
    const seg = { order: 1, transcript: starAnswer, words: 120, fillers: 2, durationSec: 60, avgNervousness: 0.2, dominantMood: null }
    const h = analyzeAnswerHeuristics(seg)
    expect(h.hasSituation).toBe(true)
    expect(h.hasAction).toBe(true)
    expect(h.hasResult).toBe(true)
    expect(h.structureScore).toBe(100)
    expect(h.lengthAssessment).toBe('good length')
  })

  it('flags a short unstructured answer', () => {
    const seg = { order: 1, transcript: 'I am a hard worker and very motivated', words: 8, fillers: 0, durationSec: 5, avgNervousness: 0.2, dominantMood: null }
    const h = analyzeAnswerHeuristics(seg)
    expect(h.structureScore).toBe(0)
    expect(h.lengthAssessment).toBe('too short')
    const coaching = heuristicAnswerCoaching(seg, h)
    expect(coaching).toContain('STAR')
    expect(coaching).toContain('short')
  })

  it('heuristic coaching never contains verdict language', () => {
    const cases = [
      { order: 1, transcript: '', words: 0, fillers: 0, durationSec: 10, avgNervousness: 0, dominantMood: null },
      { order: 2, transcript: 'um like well', words: 3, fillers: 3, durationSec: 5, avgNervousness: 0.9, dominantMood: null },
      { order: 3, transcript: starAnswer, words: 400, fillers: 30, durationSec: 200, avgNervousness: 0.5, dominantMood: null },
    ]
    for (const seg of cases) {
      const md = heuristicAnswerCoaching(seg, analyzeAnswerHeuristics(seg))
      expect(containsVerdictLanguage(md)).toBeNull()
    }
  })
})

describe('percentile rank (F8 benchmarks)', () => {
  it('ranks correctly against a distribution', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentileRank(values, 55)).toBe(50)
    expect(percentileRank(values, 100)).toBe(90)
    expect(percentileRank(values, 5)).toBe(0)
  })

  it('defaults to 50 with no data', () => {
    expect(percentileRank([], 42)).toBe(50)
  })
})
