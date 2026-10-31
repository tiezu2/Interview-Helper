import { config } from '../../config.js'
import { templateQuestions, templateCoaching } from './templates.js'
import type { SignalScores } from '../report/scores.js'

// Words that would turn coaching into a verdict — forbidden by the
// training-not-judging principle (R7 / T10).
export const BANNED_VERDICT_TERMS = [
  'hire',
  'reject',
  'unfit',
  'unsuitable',
  'lying',
  'liar',
  'deceptive',
  'dishonest',
  'truthful',
  'pass',
  'fail',
]

export function containsVerdictLanguage(text: string): string | null {
  const lower = text.toLowerCase()
  for (const term of BANNED_VERDICT_TERMS) {
    if (new RegExp(`\\b${term}\\b`).test(lower)) return term
  }
  return null
}

async function getChatModel() {
  if (config.llmProvider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    const { ChatAnthropic } = await import('@langchain/anthropic')
    return new ChatAnthropic({ model: 'claude-sonnet-5', temperature: 0.7 })
  }
  if (config.llmProvider === 'openai' && process.env.OPENAI_API_KEY) {
    const { ChatOpenAI } = await import('@langchain/openai')
    return new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0.7 })
  }
  return null
}

export async function generateQuestions(roleField: string, count = 5): Promise<string[]> {
  const model = await getChatModel()
  if (!model) return templateQuestions(roleField, count)

  try {
    const res = await model.invoke([
      [
        'system',
        `You are an interview coach generating practice questions. Return exactly ${count} interview questions for the given job role, one per line, no numbering, no extra text. Questions must be in English and answerable verbally in 1-3 minutes.`,
      ],
      ['human', `Job role: ${roleField}`],
    ])
    const lines = String(res.content)
      .split('\n')
      .map((l) => l.replace(/^\s*[\d.\-*]+\s*/, '').trim())
      .filter((l) => l.length > 10)
    if (lines.length >= count) return lines.slice(0, count)
    return templateQuestions(roleField, count)
  } catch {
    return templateQuestions(roleField, count)
  }
}

export async function generateFollowUp(question: string, answerText: string): Promise<string> {
  const model = await getChatModel()
  const fallback = 'Can you give me a specific example of that, with the outcome?'
  if (!model || !answerText.trim()) return fallback
  try {
    const res = await model.invoke([
      [
        'system',
        'You are a friendly interviewer. Given the question asked and the candidate\'s answer, ask ONE natural follow-up question that digs deeper into their answer. Return only the question text, in English, answerable in 1-2 minutes. Never judge the answer.',
      ],
      ['human', `Question: ${question}\nAnswer: ${answerText.slice(0, 2000)}`],
    ])
    const text = String(res.content).trim().split('\n')[0]
    if (text.length < 10 || containsVerdictLanguage(text)) return fallback
    return text
  } catch {
    return fallback
  }
}

export interface AnswerForCoaching {
  order: number
  question: string
  transcript: string
  heuristicNotes: string
}

// One call for all answers; returns coaching per order. Falls back to the
// provided heuristic notes when the LLM is unavailable or misbehaves.
export async function generateAnswerCoaching(
  answers: AnswerForCoaching[],
): Promise<Record<number, string>> {
  const fallback = Object.fromEntries(answers.map((a) => [a.order, a.heuristicNotes]))
  const model = await getChatModel()
  const withText = answers.filter((a) => a.transcript.trim())
  if (!model || !withText.length) return fallback

  try {
    const res = await model.invoke([
      [
        'system',
        `You are an interview answer coach. For each question/answer pair, write 2-3 sentences of specific coaching: did the answer address the question, was it structured (STAR: Situation, Task, Action, Result), was it concrete, did it ramble.
STRICT RULES: coaching only — never a verdict, never words like hire/reject/pass/fail/lying. Be encouraging and specific.
Return JSON only: {"1": "coaching...", "2": "coaching..."} keyed by question number.`,
      ],
      [
        'human',
        withText
          .map((a) => `Q${a.order}: ${a.question}\nAnswer: ${a.transcript.slice(0, 1500)}`)
          .join('\n\n'),
      ],
    ])
    const text = String(res.content)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallback
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>
    const out: Record<number, string> = { ...fallback }
    for (const [k, v] of Object.entries(parsed)) {
      const order = Number(k)
      if (Number.isInteger(order) && typeof v === 'string' && !containsVerdictLanguage(v)) {
        out[order] = v
      }
    }
    return out
  } catch {
    return fallback
  }
}

export async function generateCoaching(
  roleField: string,
  scores: SignalScores,
  transcript: string,
): Promise<string> {
  const model = await getChatModel()
  if (!model) return templateCoaching(scores)

  try {
    const res = await model.invoke([
      [
        'system',
        `You are a supportive interview delivery coach. Based on behavioral signal scores (0-100) and the transcript, write encouraging, specific coaching feedback in Markdown with sections: Strengths, Areas to Improve, Practice Tips.
STRICT RULES: never output a hiring verdict, never judge truthfulness, never use words like hire/reject/pass/fail/lying/deceptive. Focus only on delivery coaching. This is training, not judging.`,
      ],
      [
        'human',
        `Role: ${roleField}\nScores: ${JSON.stringify(scores)}\nTranscript excerpt:\n${transcript.slice(0, 4000)}`,
      ],
    ])
    const text = String(res.content)
    // Post-check: fall back to templates if the model slipped into verdict language
    if (containsVerdictLanguage(text)) return templateCoaching(scores)
    return text
  } catch {
    return templateCoaching(scores)
  }
}
