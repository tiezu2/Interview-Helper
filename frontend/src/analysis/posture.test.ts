import { describe, it, expect } from 'vitest'
import { postureScore, PostureTracker } from './posture.js'
import { VoiceTracker } from './voiceMetrics.js'
import type { Point } from './gaze.js'

// Pose fixture: 33 landmarks, only nose (0) and shoulders (11/12) matter
function makePose(noseY: number, leftShoulderY = 0.6, rightShoulderY = 0.6): Point[] {
  const pose: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }))
  pose[0] = { x: 0.5, y: noseY }
  pose[11] = { x: 0.35, y: leftShoulderY }
  pose[12] = { x: 0.65, y: rightShoulderY }
  return pose
}

describe('posture score (F3)', () => {
  it('upright pose (head well above shoulders) scores high', () => {
    // shoulder width 0.3, head height 0.25 → ratio 0.83
    const score = postureScore(makePose(0.35))
    expect(score).not.toBeNull()
    expect(score!).toBeGreaterThan(0.9)
  })

  it('slouched pose (head dropped toward shoulders) scores low', () => {
    // head height 0.09 → ratio 0.3
    const score = postureScore(makePose(0.51))
    expect(score!).toBeLessThan(0.2)
  })

  it('sideways lean reduces the score', () => {
    const level = postureScore(makePose(0.35, 0.6, 0.6))!
    const tilted = postureScore(makePose(0.35, 0.52, 0.68))!
    expect(tilted).toBeLessThan(level)
  })

  it('returns null when shoulders are not reliably detected', () => {
    const collapsed: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }))
    expect(postureScore(collapsed)).toBeNull()
    expect(postureScore([])).toBeNull()
  })

  it('tracker averages over its window and survives bad frames', () => {
    const t = new PostureTracker(5)
    expect(t.current()).toBeNull()
    for (let i = 0; i < 5; i++) t.update(makePose(0.35))
    const good = t.current()!
    t.update([]) // undetected frame keeps last average
    expect(t.current()).toBe(good)
  })
})

describe('voice energy (F4)', () => {
  it('monotone flat voice scores near 0', () => {
    const tracker = new VoiceTracker()
    const steady = new Float32Array(2048)
    for (let i = 0; i < steady.length; i++) steady[i] = 0.3 * Math.sin((2 * Math.PI * 150 * i) / 44100)
    for (let t = 0; t < 20; t++) tracker.update(steady, 44100, t * 100)
    expect(tracker.energy()).toBeLessThan(0.25)
  })

  it('varied pitch and volume scores higher than monotone', () => {
    const flat = new VoiceTracker()
    const varied = new VoiceTracker()
    for (let t = 0; t < 30; t++) {
      const flatBuf = new Float32Array(2048)
      const variedBuf = new Float32Array(2048)
      const freq = 120 + (t % 10) * 25 // sweeping pitch
      const amp = 0.15 + (t % 5) * 0.1 // swelling volume
      for (let i = 0; i < 2048; i++) {
        flatBuf[i] = 0.3 * Math.sin((2 * Math.PI * 150 * i) / 44100)
        variedBuf[i] = amp * Math.sin((2 * Math.PI * freq * i) / 44100)
      }
      flat.update(flatBuf, 44100, t * 100)
      varied.update(variedBuf, 44100, t * 100)
    }
    expect(varied.energy()).toBeGreaterThan(flat.energy())
    expect(varied.energy()).toBeLessThanOrEqual(1)
  })
})
