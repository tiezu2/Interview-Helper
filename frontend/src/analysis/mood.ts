import type { BlendshapeMap } from './tension.js'

// Mood classification + nervousness composite (docs/signals.md).
// Mood is derived from blendshapes and short-term signal history; it is a
// coaching aid describing how the person COMES ACROSS, never a judgment.

export type Mood = 'confident' | 'positive' | 'calm' | 'tense' | 'nervous' | 'flat'

export interface MoodResult {
  mood: Mood
  emoji: string
  label: string
}

export const MOOD_META: Record<Mood, { emoji: string; label: string }> = {
  confident: { emoji: '', label: '自信' },
  positive: { emoji: '', label: '积极' },
  calm: { emoji: '', label: '从容' },
  flat: { emoji: '', label: '平淡' },
  tense: { emoji: '', label: '紧绷' },
  nervous: { emoji: '', label: '紧张' },
}

export interface MoodInputs {
  smile: number // 0-1 avg of mouthSmile blendshapes
  tension: number // 0-1 composite
  nervousness: number // 0-1 composite (below)
  eyeContact: boolean
}

export function smileLevel(blendshapes: BlendshapeMap): number {
  return ((blendshapes.mouthSmileLeft ?? 0) + (blendshapes.mouthSmileRight ?? 0)) / 2
}

export function classifyMood(inp: MoodInputs): MoodResult {
  let mood: Mood
  if (inp.nervousness > 0.65) mood = 'nervous'
  else if (inp.tension > 0.55) mood = 'tense'
  else if (inp.smile > 0.35 && inp.eyeContact && inp.nervousness < 0.35) mood = 'confident'
  else if (inp.smile > 0.25) mood = 'positive'
  else if (inp.tension < 0.3 && inp.nervousness < 0.4) mood = 'calm'
  else mood = 'flat'
  return { mood, ...MOOD_META[mood] }
}

export interface NervousnessInputs {
  tension: number // 0-1
  fidget: number // 0-1
  gazeAway: number // 0-1 share of recent samples without eye contact
  blinkRatePerMin: number // typical resting 8-20
  pauseRatio?: number // 0-1 share of answer time silent (hesitation)
}

// Weighted composite, 0-1. Blink contributes above a 20/min baseline and
// saturates at 45/min. Weights documented in docs/signals.md.
export function nervousnessScore(inp: NervousnessInputs): number {
  const blinkFactor = Math.max(0, Math.min(1, (inp.blinkRatePerMin - 20) / 25))
  const pause = inp.pauseRatio ?? 0
  const score =
    inp.tension * 0.35 + inp.fidget * 0.25 + inp.gazeAway * 0.2 + blinkFactor * 0.12 + pause * 0.08
  return Math.max(0, Math.min(1, score))
}

// Rolling helper: keeps ~30s of per-second samples for stable mood/nervousness
export class MoodTracker {
  private samples: { eyeContact: boolean; blink: boolean; tension: number; fidget: number; smile: number }[] = []
  constructor(private windowSize = 30) {}

  add(sample: { eyeContact: boolean; blink: boolean; tension: number; fidget: number; smile: number }) {
    this.samples.push(sample)
    if (this.samples.length > this.windowSize) this.samples.shift()
  }

  nervousness(): number {
    if (!this.samples.length) return 0
    const n = this.samples.length
    const avg = (f: (s: (typeof this.samples)[0]) => number) =>
      this.samples.reduce((a, s) => a + f(s), 0) / n
    const blinksPerMin = (this.samples.filter((s) => s.blink).length / n) * 60
    return nervousnessScore({
      tension: avg((s) => s.tension),
      fidget: avg((s) => s.fidget),
      gazeAway: avg((s) => (s.eyeContact ? 0 : 1)),
      blinkRatePerMin: blinksPerMin,
    })
  }

  mood(): MoodResult {
    if (!this.samples.length) return classifyMood({ smile: 0, tension: 0, nervousness: 0, eyeContact: true })
    // Mood reacts faster than nervousness: last 5s for smile/tension/gaze
    const recent = this.samples.slice(-5)
    const avg = (f: (s: (typeof this.samples)[0]) => number) =>
      recent.reduce((a, s) => a + f(s), 0) / recent.length
    return classifyMood({
      smile: avg((s) => s.smile),
      tension: avg((s) => s.tension),
      nervousness: this.nervousness(),
      eyeContact: recent.filter((s) => s.eyeContact).length > recent.length / 2,
    })
  }
}
