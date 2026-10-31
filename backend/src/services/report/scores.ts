// Aggregates 1-second metric window summaries into per-signal 0-100 scores.
// Signal shape mirrors what the frontend aggregator sends over the WebSocket.

export interface MetricSignals {
  expression?: { tension: number; smile?: number } // 0-1, higher = more tension
  gaze?: { eyeContact: boolean; blink: boolean }
  movement?: { fidget: number; posture?: number } // fidget 0-1; posture 0-1, higher = more upright
  voice?: { wpm: number; pitchVar: number; volume: number; speaking: boolean }
  speech?: { fillers: number; words: number }
}

export interface SignalScores {
  expression: number
  eyeContact: number
  stillness: number
  voice: number
  // 没有可识别的语音时 speech 为 null（不给"刚好 50 分"的假数据）
  speech: number | null
  overall: number
  // 哪些维度本次没有数据，前端据此显示"数据不足"而不是编一个分数
  insufficient: string[]
  details: {
    eyeContactPct: number
    blinkRatePerMin: number
    avgWpm: number
    fillerCount: number
    fillerPer100Words: number
    avgTension: number
    avgFidget: number
    avgPosture: number | null
    energy: number
  }
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

export function aggregateScores(windows: MetricSignals[], durationSec: number): SignalScores {
  const n = Math.max(windows.length, 1)

  const tensions = windows.map((w) => w.expression?.tension ?? 0)
  const avgTension = tensions.reduce((a, b) => a + b, 0) / n

  const gazeWindows = windows.filter((w) => w.gaze)
  const eyeContactPct = gazeWindows.length
    ? (gazeWindows.filter((w) => w.gaze!.eyeContact).length / gazeWindows.length) * 100
    : 0
  const blinks = windows.filter((w) => w.gaze?.blink).length
  const blinkRatePerMin = (blinks / Math.max(durationSec, 1)) * 60

  const fidgets = windows.map((w) => w.movement?.fidget ?? 0)
  const avgFidget = fidgets.reduce((a, b) => a + b, 0) / n

  const speakingWindows = windows.filter((w) => w.voice?.speaking)
  const avgWpm = speakingWindows.length
    ? speakingWindows.reduce((a, w) => a + (w.voice!.wpm ?? 0), 0) / speakingWindows.length
    : 0
  const avgPitchVar = speakingWindows.length
    ? speakingWindows.reduce((a, w) => a + (w.voice!.pitchVar ?? 0), 0) / speakingWindows.length
    : 0

  // Energy: pitch expressiveness + volume dynamics while speaking (F4)
  const speakingVolumes = speakingWindows.map((w) => w.voice!.volume ?? 0)
  const volMean = speakingVolumes.length
    ? speakingVolumes.reduce((a, b) => a + b, 0) / speakingVolumes.length
    : 0
  const volStd = speakingVolumes.length
    ? Math.sqrt(speakingVolumes.reduce((a, b) => a + (b - volMean) ** 2, 0) / speakingVolumes.length)
    : 0
  const volDynamics = volMean > 0 ? Math.min(1, (volStd / volMean) * 2) : 0
  const energy = Math.round(clamp(avgPitchVar * 200 * 0.6 + volDynamics * 100 * 0.4))

  // Posture (F3): only present when the pose model ran
  const postureValues = windows
    .map((w) => w.movement?.posture)
    .filter((p): p is number => p !== undefined)
  const avgPosture = postureValues.length
    ? Math.round((postureValues.reduce((a, b) => a + b, 0) / postureValues.length) * 100) / 100
    : null

  const fillerCount = windows.reduce((a, w) => a + (w.speech?.fillers ?? 0), 0)
  const totalWords = windows.reduce((a, w) => a + (w.speech?.words ?? 0), 0)
  const fillerPer100Words = totalWords > 0 ? (fillerCount / totalWords) * 100 : 0

  // Score formulas — weights documented in docs/signals.md
  const expression = clamp(100 - avgTension * 100)
  const eyeContact = clamp(eyeContactPct)
  const stillness = clamp(100 - avgFidget * 100)

  // Voice: ideal pace 120-150 wpm, reward pitch variation
  const paceScore =
    avgWpm === 0 ? 50 : clamp(100 - Math.abs(avgWpm - 135) * (100 / 135))
  const pitchScore = clamp(avgPitchVar * 200) // pitchVar normalized 0-0.5+
  const voice = clamp(paceScore * 0.6 + pitchScore * 0.4)

  // Speech: penalize filler density (5 fillers per 100 words → 50)
  // 没有任何识别文本（麦克风没采到语音 / 模型不可用）时不给分，标记为数据不足。
  const hasSpeech = totalWords > 0
  const speech = hasSpeech ? clamp(100 - fillerPer100Words * 10) : null

  // 总体分：只按"有数据"的维度加权，权重重新归一，避免用假分拉高/拉低
  const weighted: Array<[number, number]> = [
    [expression, 0.2],
    [eyeContact, 0.25],
    [stillness, 0.15],
    [voice, 0.2],
  ]
  if (speech !== null) weighted.push([speech, 0.2])
  const weightSum = weighted.reduce((a, [, w]) => a + w, 0)
  const overall = clamp(weighted.reduce((a, [v, w]) => a + v * w, 0) / weightSum)

  return {
    expression: Math.round(expression),
    eyeContact: Math.round(eyeContact),
    stillness: Math.round(stillness),
    voice: Math.round(voice),
    speech: speech === null ? null : Math.round(speech),
    overall: Math.round(overall),
    insufficient: hasSpeech ? [] : ['speech'],
    details: {
      eyeContactPct: Math.round(eyeContactPct),
      blinkRatePerMin: Math.round(blinkRatePerMin * 10) / 10,
      avgWpm: Math.round(avgWpm),
      fillerCount,
      fillerPer100Words: Math.round(fillerPer100Words * 10) / 10,
      avgTension: Math.round(avgTension * 100) / 100,
      avgFidget: Math.round(avgFidget * 100) / 100,
      avgPosture,
      energy,
    },
  }
}
