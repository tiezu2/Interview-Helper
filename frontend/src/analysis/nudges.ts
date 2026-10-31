// Live nudge engine (R6): supportive cues from rolling 5s signal windows,
// rate-limited to one nudge per 20s. Wording is always encouraging.

export interface NudgeSignalSample {
  ts: number
  eyeContact?: boolean
  fidget?: number
  wpm?: number
  speaking?: boolean
  volume?: number
  posture?: number
}

export interface Nudge {
  id: string
  message: string
}

const NUDGE_RULES: Array<{
  id: string
  message: string
  trigger: (window: NudgeSignalSample[]) => boolean
}> = [
  {
    id: 'eye-contact',
    message: '视线离开镜头，请回到摄像头方向。',
    trigger: (w) => {
      const gazeSamples = w.filter((s) => s.eyeContact !== undefined)
      return gazeSamples.length >= 4 && gazeSamples.every((s) => !s.eyeContact)
    },
  },
  {
    id: 'fidgeting',
    message: '检测到持续小动作，建议稳定身体姿态。',
    trigger: (w) => {
      const f = w.filter((s) => s.fidget !== undefined)
      return f.length >= 4 && f.every((s) => (s.fidget ?? 0) > 0.6)
    },
  },
  {
    id: 'pace-fast',
    message: '语速偏快，建议放慢至 120—150 字/分钟。',
    trigger: (w) => {
      const speaking = w.filter((s) => s.speaking && (s.wpm ?? 0) > 0)
      return speaking.length >= 4 && speaking.every((s) => (s.wpm ?? 0) > 180)
    },
  },
  {
    id: 'posture',
    message: '坐姿偏低，建议坐直并打开肩膀。',
    trigger: (w) => {
      const p = w.filter((s) => s.posture !== undefined)
      return p.length >= 4 && p.every((s) => (s.posture ?? 1) < 0.4)
    },
  },
  {
    id: 'volume-low',
    message: '音量偏小，建议适当提高音量。',
    trigger: (w) => {
      const speaking = w.filter((s) => s.speaking)
      return speaking.length >= 4 && speaking.every((s) => (s.volume ?? 1) < 0.02)
    },
  },
]

export class NudgeEngine {
  private samples: NudgeSignalSample[] = []
  private lastNudgeAt = -Infinity
  constructor(
    private windowMs = 5000,
    private cooldownMs = 20000,
  ) {}

  addSample(sample: NudgeSignalSample): Nudge | null {
    this.samples.push(sample)
    const cutoff = sample.ts - this.windowMs
    this.samples = this.samples.filter((s) => s.ts >= cutoff)

    if (sample.ts - this.lastNudgeAt < this.cooldownMs) return null

    for (const rule of NUDGE_RULES) {
      if (rule.trigger(this.samples)) {
        this.lastNudgeAt = sample.ts
        return { id: rule.id, message: rule.message }
      }
    }
    return null
  }
}
