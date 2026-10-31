// Gaze + blink signal math over MediaPipe FaceLandmarker landmarks.
// Landmark indices follow the canonical MediaPipe face mesh.

export interface Point {
  x: number
  y: number
  z?: number
}

// Iris centers: 468 (right), 473 (left). Eye corners for normalization.
const RIGHT_IRIS = 468
const LEFT_IRIS = 473
const RIGHT_EYE_OUTER = 33
const RIGHT_EYE_INNER = 133
const LEFT_EYE_INNER = 362
const LEFT_EYE_OUTER = 263

// Eye aspect ratio points (upper/lower lids)
const RIGHT_EYE_TOP = 159
const RIGHT_EYE_BOTTOM = 145
const LEFT_EYE_TOP = 386
const LEFT_EYE_BOTTOM = 374

// Iris center deviation from the eye-corner midpoint, normalized by eye
// width. Within tolerance cone => looking at camera.
export function eyeContactFromLandmarks(lm: Point[], tolerance = 0.18): boolean {
  if (lm.length <= LEFT_IRIS) return false
  const eyes = [
    { iris: lm[RIGHT_IRIS], a: lm[RIGHT_EYE_OUTER], b: lm[RIGHT_EYE_INNER] },
    { iris: lm[LEFT_IRIS], a: lm[LEFT_EYE_INNER], b: lm[LEFT_EYE_OUTER] },
  ]
  for (const { iris, a, b } of eyes) {
    const width = Math.hypot(b.x - a.x, b.y - a.y)
    if (width === 0) return false
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    const deviation = Math.hypot(iris.x - midX, iris.y - midY) / width
    if (deviation > tolerance) return false
  }
  return true
}

// Eye aspect ratio: lid distance / eye width. Dips below threshold = blink.
export function eyeAspectRatio(lm: Point[]): number {
  if (lm.length <= LEFT_EYE_BOTTOM) return 1
  const right =
    Math.hypot(lm[RIGHT_EYE_TOP].x - lm[RIGHT_EYE_BOTTOM].x, lm[RIGHT_EYE_TOP].y - lm[RIGHT_EYE_BOTTOM].y) /
    Math.hypot(lm[RIGHT_EYE_OUTER].x - lm[RIGHT_EYE_INNER].x, lm[RIGHT_EYE_OUTER].y - lm[RIGHT_EYE_INNER].y)
  const left =
    Math.hypot(lm[LEFT_EYE_TOP].x - lm[LEFT_EYE_BOTTOM].x, lm[LEFT_EYE_TOP].y - lm[LEFT_EYE_BOTTOM].y) /
    Math.hypot(lm[LEFT_EYE_OUTER].x - lm[LEFT_EYE_INNER].x, lm[LEFT_EYE_OUTER].y - lm[LEFT_EYE_INNER].y)
  return (right + left) / 2
}

export class BlinkDetector {
  private wasClosed = false
  constructor(private threshold = 0.18) {}

  // Returns true once per blink (on the closing edge)
  update(ear: number): boolean {
    const closed = ear < this.threshold
    const blinked = closed && !this.wasClosed
    this.wasClosed = closed
    return blinked
  }
}
