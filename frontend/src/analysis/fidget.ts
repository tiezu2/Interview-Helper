import type { Point } from './gaze.js'

// Movement/fidget score: variance of head landmark displacement across
// recent frames, plus hand-near-face events. Output normalized 0-1.

const NOSE_TIP = 1

export class FidgetTracker {
  private positions: Point[] = []
  private handNearFaceFrames = 0
  private totalFrames = 0
  constructor(private windowSize = 30) {}

  update(faceLandmarks: Point[], handNearFace = false): number {
    if (faceLandmarks.length > NOSE_TIP) {
      this.positions.push({ ...faceLandmarks[NOSE_TIP] })
      if (this.positions.length > this.windowSize) this.positions.shift()
    }
    this.totalFrames++
    if (handNearFace) this.handNearFaceFrames++

    return this.score()
  }

  score(): number {
    if (this.positions.length < 2) return 0
    // Mean per-frame displacement, scaled: 0.005 normalized units/frame ≈ noticeable fidgeting
    let sum = 0
    for (let i = 1; i < this.positions.length; i++) {
      sum += Math.hypot(
        this.positions[i].x - this.positions[i - 1].x,
        this.positions[i].y - this.positions[i - 1].y,
      )
    }
    const meanDisplacement = sum / (this.positions.length - 1)
    const movementScore = Math.min(1, meanDisplacement / 0.01)

    const handScore = this.totalFrames > 0 ? Math.min(1, (this.handNearFaceFrames / this.totalFrames) * 3) : 0
    return Math.min(1, movementScore * 0.7 + handScore * 0.3)
  }

  resetWindow() {
    this.handNearFaceFrames = 0
    this.totalFrames = 0
  }
}

// Hand-near-face: any hand landmark within radius of the face bounding box center
export function handNearFace(handLandmarks: Point[], faceLandmarks: Point[], radius = 0.25): boolean {
  if (!handLandmarks.length || faceLandmarks.length <= NOSE_TIP) return false
  const nose = faceLandmarks[NOSE_TIP]
  return handLandmarks.some((p) => Math.hypot(p.x - nose.x, p.y - nose.y) < radius)
}
