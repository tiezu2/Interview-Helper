// Per-question answer segmentation and heuristic quality analysis (F1/F2).
// Pure functions — the LLM adds richer coaching on top when available.
// 中文化改造：STAR 线索词换成中文表达，点评文案改为中文。

import type { MetricSignals } from './scores.js'

export interface WindowWithMeta extends MetricSignals {
  questionOrder?: number
  transcriptDelta?: string
  mood?: { state: string; emoji: string; nervousness: number }
}

export interface AnswerSegment {
  order: number
  transcript: string
  words: number
  fillers: number
  durationSec: number
  avgNervousness: number
  dominantMood: { state: string; emoji: string } | null
}

export function segmentByQuestion(windows: WindowWithMeta[]): AnswerSegment[] {
  const byOrder = new Map<number, WindowWithMeta[]>()
  for (const w of windows) {
    const order = w.questionOrder ?? 0
    if (!byOrder.has(order)) byOrder.set(order, [])
    byOrder.get(order)!.push(w)
  }

  const segments: AnswerSegment[] = []
  for (const [order, ws] of [...byOrder.entries()].sort((a, b) => a[0] - b[0])) {
    if (order === 0) continue // windows before the first question
    const transcript = ws
      .map((w) => w.transcriptDelta?.trim())
      .filter(Boolean)
      .join(' ')
    const nervousValues = ws.map((w) => w.mood?.nervousness).filter((n): n is number => n !== undefined)

    const moodCounts = new Map<string, { count: number; emoji: string }>()
    for (const w of ws) {
      if (!w.mood) continue
      const cur = moodCounts.get(w.mood.state) ?? { count: 0, emoji: w.mood.emoji }
      cur.count++
      moodCounts.set(w.mood.state, cur)
    }
    const dominant = [...moodCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0]

    segments.push({
      order,
      transcript,
      words: ws.reduce((a, w) => a + (w.speech?.words ?? 0), 0),
      fillers: ws.reduce((a, w) => a + (w.speech?.fillers ?? 0), 0),
      durationSec: ws.length,
      avgNervousness: nervousValues.length
        ? Math.round((nervousValues.reduce((a, b) => a + b, 0) / nervousValues.length) * 100) / 100
        : 0,
      dominantMood: dominant ? { state: dominant[0], emoji: dominant[1].emoji } : null,
    })
  }
  return segments
}

// 启发式结构分析（无需 LLM）。中文 STAR 线索词。
const SITUATION_CUES =
  /(当时|那时候|去年|上个学期|实习时|有一次|在一个|项目里|情况是|背景是|我们组|我负责的)/
const ACTION_CUES =
  /(我(就|先|决定|尝试|负责|牵头|组织|梳理|改|做)|于是|后来我|我的做法|具体来说|我分成|我提出|我推动)/
const RESULT_CUES =
  /(最后|结果是|最终|上线后|效果|提升了|降低了|提高了|解决了|通过了|拿到了|我们完成|成功率|省下)/

export interface AnswerHeuristics {
  hasSituation: boolean
  hasAction: boolean
  hasResult: boolean
  structureScore: number // 0-100
  lengthAssessment: '偏短' | '时长合适' | '偏长'
  fillerDensity: number // per 100 words
}

export function analyzeAnswerHeuristics(seg: AnswerSegment): AnswerHeuristics {
  const t = seg.transcript
  const hasSituation = SITUATION_CUES.test(t)
  const hasAction = ACTION_CUES.test(t)
  const hasResult = RESULT_CUES.test(t)
  const structureScore = Math.round(
    ((hasSituation ? 1 : 0) + (hasAction ? 1 : 0) + (hasResult ? 1 : 0)) * (100 / 3),
  )
  const lengthAssessment =
    seg.words < 40 ? '偏短' : seg.words > 350 ? '偏长' : '时长合适'
  const fillerDensity = seg.words > 0 ? Math.round((seg.fillers / seg.words) * 1000) / 10 : 0
  return { hasSituation, hasAction, hasResult, structureScore, lengthAssessment, fillerDensity }
}

export function heuristicAnswerCoaching(seg: AnswerSegment, h: AnswerHeuristics): string {
  const parts: string[] = []
  if (!seg.transcript) {
    return '这道题没有拿到文字稿，所以无法给内容层面的建议——上面的表达信号仍然有效。'
  }
  if (h.lengthAssessment === '偏短') {
    parts.push('这道题答得偏短，建议用 1—2 分钟讲一个具体例子。')
  } else if (h.lengthAssessment === '偏长') {
    parts.push('这道题答得偏长，练习把结论先说出来，然后停住。')
  } else {
    parts.push('回答长度合适。')
  }
  const missing: string[] = []
  if (!h.hasSituation) missing.push('当时的情景/处境')
  if (!h.hasAction) missing.push('你具体做了什么')
  if (!h.hasResult) missing.push('最后的结果或影响')
  if (missing.length) {
    parts.push(`可以补上${missing.join('、')}（STAR 结构：情境、任务、行动、结果）。`)
  } else {
    parts.push('结构完整——情境、行动、结果都讲到了，这就是面试官想听的。')
  }
  if (h.fillerDensity > 5) {
    parts.push(`这段口头禅偏多（每 100 字 ${h.fillerDensity} 个），改用短暂停顿会更稳。`)
  }
  return parts.join(' ')
}

// Percentile rank of v among values (share strictly below), 0-100
export function percentileRank(values: number[], v: number): number {
  if (!values.length) return 50
  const below = values.filter((x) => x < v).length
  return Math.round((below / values.length) * 100)
}
