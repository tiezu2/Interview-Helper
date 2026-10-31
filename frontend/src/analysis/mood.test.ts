import { describe, it, expect } from 'vitest'
import { classifyMood, nervousnessScore, smileLevel, MoodTracker } from './mood.js'

describe('nervousness composite', () => {
  it('relaxed inputs score near 0', () => {
    expect(
      nervousnessScore({ tension: 0.05, fidget: 0.05, gazeAway: 0.1, blinkRatePerMin: 14 }),
    ).toBeLessThan(0.1)
  })

  it('stressed inputs score high', () => {
    expect(
      nervousnessScore({ tension: 0.8, fidget: 0.8, gazeAway: 0.9, blinkRatePerMin: 40, pauseRatio: 0.5 }),
    ).toBeGreaterThan(0.7)
  })

  it('blink rate only contributes above the 20/min baseline', () => {
    const base = { tension: 0.3, fidget: 0.3, gazeAway: 0.3 }
    const calmBlink = nervousnessScore({ ...base, blinkRatePerMin: 12 })
    const atBaseline = nervousnessScore({ ...base, blinkRatePerMin: 20 })
    const rapidBlink = nervousnessScore({ ...base, blinkRatePerMin: 45 })
    expect(calmBlink).toBe(atBaseline)
    expect(rapidBlink).toBeGreaterThan(atBaseline)
  })

  it('is clamped to 0-1', () => {
    expect(
      nervousnessScore({ tension: 1, fidget: 1, gazeAway: 1, blinkRatePerMin: 100, pauseRatio: 1 }),
    ).toBeLessThanOrEqual(1)
  })
})

describe('mood classification', () => {
  it('high nervousness wins over everything', () => {
    expect(classifyMood({ smile: 0.9, tension: 0.1, nervousness: 0.8, eyeContact: true }).mood).toBe('nervous')
  })

  it('smiling with eye contact and low nervousness = confident', () => {
    expect(classifyMood({ smile: 0.5, tension: 0.2, nervousness: 0.2, eyeContact: true }).mood).toBe('confident')
  })

  it('smiling without eye contact = positive', () => {
    expect(classifyMood({ smile: 0.5, tension: 0.2, nervousness: 0.2, eyeContact: false }).mood).toBe('positive')
  })

  it('high tension = tense', () => {
    expect(classifyMood({ smile: 0.1, tension: 0.7, nervousness: 0.4, eyeContact: true }).mood).toBe('tense')
  })

  it('relaxed neutral face = calm; middling signals = flat', () => {
    expect(classifyMood({ smile: 0.1, tension: 0.1, nervousness: 0.2, eyeContact: true }).mood).toBe('calm')
    expect(classifyMood({ smile: 0.1, tension: 0.45, nervousness: 0.5, eyeContact: false }).mood).toBe('flat')
  })

  it('every mood carries a label（界面已不使用 emoji）', () => {
    const res = classifyMood({ smile: 0, tension: 0, nervousness: 0, eyeContact: true })
    expect(res.label.length).toBeGreaterThan(0)
    expect(res.emoji).toBe('')
    expect(res.label.length).toBeGreaterThan(0)
  })
})

describe('smile level', () => {
  it('averages both smile blendshapes', () => {
    expect(smileLevel({ mouthSmileLeft: 0.6, mouthSmileRight: 0.4 })).toBeCloseTo(0.5)
    expect(smileLevel({})).toBe(0)
  })
})

describe('MoodTracker rolling window', () => {
  const calm = { eyeContact: true, blink: false, tension: 0.1, fidget: 0.1, smile: 0.1 }
  const stressed = { eyeContact: false, blink: true, tension: 0.8, fidget: 0.8, smile: 0 }

  it('tracks calm → nervous as samples change', () => {
    const t = new MoodTracker(30)
    for (let i = 0; i < 20; i++) t.add(calm)
    expect(t.nervousness()).toBeLessThan(0.2)
    expect(['calm', 'confident']).toContain(t.mood().mood)

    for (let i = 0; i < 30; i++) t.add(stressed)
    expect(t.nervousness()).toBeGreaterThan(0.6)
    expect(t.mood().mood).toBe('nervous')
  })

  it('empty tracker returns a neutral default', () => {
    const t = new MoodTracker()
    expect(t.nervousness()).toBe(0)
    expect(t.mood().mood).toBeDefined()
  })
})
