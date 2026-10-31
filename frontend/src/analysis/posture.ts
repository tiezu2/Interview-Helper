import type { Point } from './gaze.js'

// Posture score from MediaPipe PoseLandmarker landmarks (F3).
// 1 = upright and level, 0 = slouched/collapsed. Formula in docs/signals.md.

const NOSE = 0
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12

export function postureScore(pose: Point[]): number | null {
  if (pose.length <= RIGHT_SHOULDER) return null
  const nose = pose[NOSE]
  const ls = pose[LEFT_SHOULDER]
  const rs = pose[RIGHT_SHOULDER]

  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  if (shoulderWidth < 0.05) return null // pose not reliably detected

  const midY = (ls.y + rs.y) / 2

  // Head height: vertical distance from nose to shoulder line, relative to
  // shoulder width. Upright ≈ 0.55-0.9; head dropping toward shoulders
  // (slouch/lean-in) pushes it down.
  const headHeight = (midY - nose.y) / shoulderWidth
  const uprightness = clamp01((headHeight - 0.25) / 0.4)

  // Shoulder tilt: vertical asymmetry relative to width (leaning sideways)
  const tilt = Math.abs(ls.y - rs.y) / shoulderWidth
  const tiltPenalty = clamp01((tilt - 0.08) / 0.25)

  return clamp01(uprightness * (1 - tiltPenalty * 0.5))
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// Rolling average so the meter doesn't jitter
export class PostureTracker {
  private values: number[] = []
  constructor(private windowSize = 10) {}

  update(pose: Point[]): number | null {
    const score = postureScore(pose)
    if (score !== null) {
      this.values.push(score)
      if (this.values.length > this.windowSize) this.values.shift()
    }
    return this.current()
  }

  current(): number | null {
    if (!this.values.length) return null
    return this.values.reduce((a, b) => a + b, 0) / this.values.length
  }
}
