import type { Point } from './gaze.js'

// Live framing guidance: is the face centered, at a good distance, and
// oriented toward the camera? Messages are phrased for the MIRRORED
// preview the user is looking at.

export interface FramingResult {
  ok: boolean
  message: string | null
}

const NOSE = 1
const RIGHT_EDGE = 234 // user's right cheek edge (image left)
const LEFT_EDGE = 454 // user's left cheek edge (image right)

export function framingFeedback(lm: Point[] | null): FramingResult {
  if (!lm || lm.length <= LEFT_EDGE) {
    return { ok: false, message: 'No face detected — step into the frame' }
  }

  const nose = lm[NOSE]
  const right = lm[RIGHT_EDGE]
  const left = lm[LEFT_EDGE]

  const faceWidth = Math.hypot(left.x - right.x, left.y - right.y)
  if (faceWidth < 0.15) return { ok: false, message: 'Come a little closer to the camera' }
  if (faceWidth > 0.55) return { ok: false, message: 'Move back a little' }

  // Horizontal: preview is mirrored, so display-x = 1 - image-x
  const displayX = 1 - nose.x
  if (displayX < 0.32) return { ok: false, message: 'Shift right to center your face' }
  if (displayX > 0.68) return { ok: false, message: 'Shift left to center your face' }

  // Vertical
  if (nose.y < 0.26) return { ok: false, message: 'Lower yourself or raise the camera a bit' }
  if (nose.y > 0.76) return { ok: false, message: 'Sit up or lower the camera a bit' }

  // Yaw: head turned sideways — nose-to-cheek distances become asymmetric
  const toRight = Math.hypot(nose.x - right.x, nose.y - right.y)
  const toLeft = Math.hypot(nose.x - left.x, nose.y - left.y)
  if (toLeft > 0 && (toRight / toLeft < 0.5 || toRight / toLeft > 2)) {
    return { ok: false, message: 'Turn to face the camera directly' }
  }

  return { ok: true, message: null }
}

// Debounces framing messages so a brief wobble doesn't flash warnings:
// a problem must persist ~1s to show, and good framing clears immediately.
export class FramingTracker {
  private badSince: number | null = null
  private lastMessage: string | null = null

  update(result: FramingResult, nowMs: number): string | null {
    if (result.ok) {
      this.badSince = null
      this.lastMessage = null
      return null
    }
    if (this.badSince === null || this.lastMessage !== result.message) {
      this.badSince = nowMs
      this.lastMessage = result.message
      return null
    }
    return nowMs - this.badSince >= 1000 ? result.message : null
  }
}
