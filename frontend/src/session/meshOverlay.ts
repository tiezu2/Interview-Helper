import { DrawingUtils, FaceLandmarker } from '@mediapipe/tasks-vision'
import type { Point } from '../analysis/gaze.js'

// Sci-fi face mesh overlay: faint tesselation + glowing contour lines
// drawn over the mirrored camera preview.

export class MeshOverlay {
  private ctx: CanvasRenderingContext2D
  private drawer: DrawingUtils

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.drawer = new DrawingUtils(this.ctx)
  }

  draw(landmarks: Point[] | null, videoWidth: number, videoHeight: number) {
    if (this.canvas.width !== videoWidth) this.canvas.width = videoWidth
    if (this.canvas.height !== videoHeight) this.canvas.height = videoHeight
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!landmarks) return

    const lm = landmarks as { x: number; y: number; z?: number }[]

    this.ctx.save()
    this.ctx.shadowColor = 'rgba(79, 140, 255, 0.8)'
    this.ctx.shadowBlur = 4

    // Wireframe skin
    this.drawer.drawConnectors(lm as any, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
      color: 'rgba(79, 140, 255, 0.12)',
      lineWidth: 0.5,
    })
    // Structural contours, brighter
    for (const contour of [
      FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
      FaceLandmarker.FACE_LANDMARKS_LIPS,
    ]) {
      this.drawer.drawConnectors(lm as any, contour, {
        color: 'rgba(110, 231, 255, 0.55)',
        lineWidth: 1.2,
      })
    }
    // Iris tracking dots
    for (const contour of [
      FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
      FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
    ]) {
      this.drawer.drawConnectors(lm as any, contour, {
        color: 'rgba(62, 207, 142, 0.9)',
        lineWidth: 1.5,
      })
    }
    this.ctx.restore()
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
}
