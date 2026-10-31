import { describe, it, expect } from 'vitest'
import { framingFeedback, FramingTracker } from './framing.js'
import type { Point } from './gaze.js'

// Fixture: face with nose at (nx, ny) and cheek edges width apart
function face(nx: number, ny: number, width = 0.3, yawShift = 0): Point[] {
  const lm: Point[] = Array.from({ length: 478 }, () => ({ x: nx, y: ny }))
  lm[1] = { x: nx, y: ny }
  lm[234] = { x: nx - width / 2 + yawShift, y: ny }
  lm[454] = { x: nx + width / 2 + yawShift, y: ny }
  return lm
}

describe('framing feedback', () => {
  it('centered face at a good distance is ok', () => {
    const r = framingFeedback(face(0.5, 0.5))
    expect(r.ok).toBe(true)
    expect(r.message).toBeNull()
  })

  it('no landmarks → step into frame', () => {
    expect(framingFeedback(null).message).toContain('No face detected')
    expect(framingFeedback([]).message).toContain('No face detected')
  })

  it('small face → come closer; huge face → move back', () => {
    expect(framingFeedback(face(0.5, 0.5, 0.1)).message).toContain('closer')
    expect(framingFeedback(face(0.5, 0.5, 0.7)).message).toContain('back')
  })

  it('horizontal guidance is mirrored for the preview', () => {
    // Face at image-x 0.8 appears LEFT in the mirrored preview → shift right...
    // display-x = 1 - 0.8 = 0.2 < 0.32 → "Shift right"
    expect(framingFeedback(face(0.8, 0.5)).message).toContain('right')
    expect(framingFeedback(face(0.2, 0.5)).message).toContain('left')
  })

  it('vertical guidance', () => {
    expect(framingFeedback(face(0.5, 0.15)).message).toContain('Lower')
    expect(framingFeedback(face(0.5, 0.85)).message).toContain('Sit up')
  })

  it('turned head → face the camera', () => {
    // Nose far off-center relative to cheek edges = yaw
    expect(framingFeedback(face(0.5, 0.5, 0.3, 0.1)).message).toContain('face the camera')
  })
})

describe('framing tracker debounce', () => {
  const bad = { ok: false, message: 'Shift right to center your face' }
  const good = { ok: true, message: null }

  it('shows a problem only after it persists ~1s', () => {
    const t = new FramingTracker()
    expect(t.update(bad, 0)).toBeNull() // first sighting arms the timer
    expect(t.update(bad, 500)).toBeNull()
    expect(t.update(bad, 1100)).toBe(bad.message)
  })

  it('clears immediately when framing is fixed', () => {
    const t = new FramingTracker()
    t.update(bad, 0)
    t.update(bad, 1200)
    expect(t.update(good, 1400)).toBeNull()
  })

  it('a changed message restarts the debounce', () => {
    const t = new FramingTracker()
    t.update(bad, 0)
    const other = { ok: false, message: 'Move back a little' }
    expect(t.update(other, 1100)).toBeNull() // new problem, timer restarts
    expect(t.update(other, 2200)).toBe(other.message)
  })
})
