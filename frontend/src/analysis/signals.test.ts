import { describe, it, expect } from 'vitest'
import { eyeContactFromLandmarks, eyeAspectRatio, BlinkDetector, type Point } from './gaze.js'
import { tensionComposite, dominantExpression } from './tension.js'
import { FidgetTracker, handNearFace } from './fidget.js'
import { countFillers, countWords } from './fillers.js'
import { NudgeEngine } from './nudges.js'
import { rms, detectPitch, VoiceTracker } from './voiceMetrics.js'

// Synthetic landmark fixture: 478 points; eyes/irises placed explicitly.
function makeFaceLandmarks(overrides: Record<number, Point> = {}): Point[] {
  const lm: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  // right eye corners + lids
  lm[33] = { x: 0.35, y: 0.45 }
  lm[133] = { x: 0.45, y: 0.45 }
  lm[159] = { x: 0.4, y: 0.435 }
  lm[145] = { x: 0.4, y: 0.465 }
  lm[468] = { x: 0.4, y: 0.45 } // right iris centered
  // left eye corners + lids
  lm[362] = { x: 0.55, y: 0.45 }
  lm[263] = { x: 0.65, y: 0.45 }
  lm[386] = { x: 0.6, y: 0.435 }
  lm[374] = { x: 0.6, y: 0.465 }
  lm[473] = { x: 0.6, y: 0.45 } // left iris centered
  lm[1] = { x: 0.5, y: 0.55 } // nose tip
  for (const [i, p] of Object.entries(overrides)) lm[Number(i)] = p
  return lm
}

describe('gaze (T5 fixture)', () => {
  it('centered irises count as eye contact', () => {
    expect(eyeContactFromLandmarks(makeFaceLandmarks())).toBe(true)
  })

  it('averted irises break eye contact', () => {
    const averted = makeFaceLandmarks({
      468: { x: 0.44, y: 0.45 }, // iris pushed to eye corner
      473: { x: 0.64, y: 0.45 },
    })
    expect(eyeContactFromLandmarks(averted)).toBe(false)
  })

  it('blink detector fires once per closure', () => {
    const d = new BlinkDetector(0.18)
    expect(d.update(0.3)).toBe(false) // open
    expect(d.update(0.1)).toBe(true) // closing edge
    expect(d.update(0.1)).toBe(false) // still closed
    expect(d.update(0.3)).toBe(false) // reopened
    expect(d.update(0.05)).toBe(true) // next blink
  })

  it('eye aspect ratio drops when lids close', () => {
    const open = eyeAspectRatio(makeFaceLandmarks())
    const closed = eyeAspectRatio(
      makeFaceLandmarks({
        159: { x: 0.4, y: 0.4495 },
        145: { x: 0.4, y: 0.4505 },
        386: { x: 0.6, y: 0.4495 },
        374: { x: 0.6, y: 0.4505 },
      }),
    )
    expect(closed).toBeLessThan(open / 2)
  })
})

describe('tension composite', () => {
  it('relaxed face scores near 0, tense face scores high', () => {
    expect(tensionComposite({ browDownLeft: 0, browDownRight: 0, jawClench: 0 })).toBe(0)
    const tense = tensionComposite({
      browDownLeft: 0.9,
      browDownRight: 0.9,
      jawClench: 0.8,
      mouthPressLeft: 0.7,
      mouthPressRight: 0.7,
      eyeSquintLeft: 0.6,
      eyeSquintRight: 0.6,
    })
    expect(tense).toBeGreaterThan(0.6)
    expect(tense).toBeLessThanOrEqual(1)
  })

  it('dominant expression classification', () => {
    expect(dominantExpression({ mouthSmileLeft: 0.6, mouthSmileRight: 0.6 })).toBe('positive')
    expect(dominantExpression({ browDownLeft: 0.5, browDownRight: 0.5 })).toBe('concerned')
    expect(dominantExpression({})).toBe('neutral')
  })
})

describe('fidget tracking', () => {
  it('still head scores low; jittery head scores high', () => {
    const still = new FidgetTracker(10)
    let stillScore = 0
    for (let i = 0; i < 10; i++) stillScore = still.update(makeFaceLandmarks())
    expect(stillScore).toBeLessThan(0.1)

    const jittery = new FidgetTracker(10)
    let jitterScore = 0
    for (let i = 0; i < 10; i++) {
      jitterScore = jittery.update(makeFaceLandmarks({ 1: { x: 0.5 + (i % 2) * 0.03, y: 0.55 } }))
    }
    expect(jitterScore).toBeGreaterThan(0.5)
  })

  it('hand near face detected within radius', () => {
    const face = makeFaceLandmarks()
    expect(handNearFace([{ x: 0.52, y: 0.57 }], face)).toBe(true)
    expect(handNearFace([{ x: 0.05, y: 0.95 }], face)).toBe(false)
    expect(handNearFace([], face)).toBe(false)
  })
})

describe('fillers (T8, 中文)', () => {
  it('counts 语气词 + 高频歧义词', () => {
    // 嗯(1) 呃(1) 啊(1)；「那个」出现 2 次 → 第 2 次起计 1；「然后」出现 2 次 → 计 1
    const text = '嗯，我觉得呃这个问题啊，那个那个，然后然后我就可以开始了。'
    expect(countFillers(text)).toBe(5)
  })

  it('单次出现的连词不算口头禅', () => {
    const text = '然后我先分析需求，就是做完了。'
    expect(countFillers(text)).toBe(0)
  })

  it('中文字数：汉字按字计，英文按词计，标点不计', () => {
    expect(countWords('今天天气不错')).toBe(6)
    expect(countWords('我用了 Docker 部署')).toBe(6) // 我用了部署=5 字 + Docker=1 词
    expect(countWords('')).toBe(0)
    expect(countWords('，。！？')).toBe(0)
  })
})

describe('nudge engine (T9)', () => {
  it('sustained gaze-away triggers a nudge within the 5s window', () => {
    const engine = new NudgeEngine()
    let nudge = null
    // 5 samples over 4 seconds, all gaze-away; keep the first fired nudge
    for (let t = 0; t <= 4000; t += 1000) {
      nudge = engine.addSample({ ts: t, eyeContact: false }) ?? nudge
    }
    expect(nudge).not.toBeNull()
    expect(nudge!.id).toBe('eye-contact')
  })

  it('rate-limits to one nudge per 20s', () => {
    const engine = new NudgeEngine()
    let count = 0
    for (let t = 0; t <= 30000; t += 1000) {
      if (engine.addSample({ ts: t, eyeContact: false })) count++
    }
    // 31s of continuous gaze-away → at most 2 nudges (t≈4s and t≈24s)
    expect(count).toBe(2)
  })

  it('good signals produce no nudge', () => {
    const engine = new NudgeEngine()
    let nudge = null
    for (let t = 0; t <= 10000; t += 1000) {
      nudge = engine.addSample({ ts: t, eyeContact: true, fidget: 0.1, wpm: 140, speaking: true, volume: 0.5 })
    }
    expect(nudge).toBeNull()
  })
})

describe('voice metrics (T7 math)', () => {
  it('rms of silence is 0, of a sine is ~0.707 amplitude', () => {
    expect(rms(new Float32Array(1024))).toBe(0)
    const sine = new Float32Array(1024)
    for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * i) / 64)
    expect(rms(sine)).toBeCloseTo(0.707, 1)
  })

  it('autocorrelation finds a 220Hz tone', () => {
    const sampleRate = 44100
    const freq = 220
    const samples = new Float32Array(2048)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate)
    }
    const pitch = detectPitch(samples, sampleRate)
    expect(pitch).not.toBeNull()
    expect(Math.abs(pitch! - freq)).toBeLessThan(10)
  })

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(2048), 44100)).toBeNull()
  })

  it('wpm reflects word arrival rate', () => {
    const tracker = new VoiceTracker()
    // 30 words over 12 seconds ≈ 150 wpm
    for (let i = 0; i < 30; i++) tracker.addWords(1, i * 400)
    const wpm = tracker.wpm(12000)
    expect(wpm).toBeGreaterThan(120)
    expect(wpm).toBeLessThan(180)
  })
})
