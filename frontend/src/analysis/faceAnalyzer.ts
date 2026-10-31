import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { eyeContactFromLandmarks, eyeAspectRatio, BlinkDetector, type Point } from './gaze.js'
import { tensionComposite, dominantExpression, type BlendshapeMap } from './tension.js'
import { classifyExpression, type Expression } from './expressions.js'
import { FidgetTracker } from './fidget.js'
import { smileLevel } from './mood.js'

export interface FrameSignals {
  faceDetected: boolean
  eyeContact: boolean
  blink: boolean
  tension: number
  smile: number
  expression: 'positive' | 'concerned' | 'neutral'
  instantExpression: Expression
  fidget: number
}

// Models are self-hosted under /models (fetched at build time by
// scripts/fetch-models.mjs) so nothing loads from a third-party CDN;
// the CDN paths remain as a fallback for stale deployments.
const LOCAL_WASM = '/models/wasm'
const LOCAL_FACE_MODEL = '/models/face_landmarker.task'
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const CDN_FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export async function resolveVisionFileset(wasmPath = LOCAL_WASM) {
  try {
    const probe = await fetch(`${wasmPath}/vision_wasm_internal.wasm`, { method: 'HEAD' })
    if (!probe.ok) throw new Error('local wasm missing')
    return await FilesetResolver.forVisionTasks(wasmPath)
  } catch {
    return FilesetResolver.forVisionTasks(CDN_WASM)
  }
}

// Wraps MediaPipe FaceLandmarker (R3). ~4MB model, cached by the browser
// after the first session.
export class FaceAnalyzer {
  private landmarker: FaceLandmarker | null = null
  private blinkDetector = new BlinkDetector()
  private fidgetTracker = new FidgetTracker()
  private lastVideoTime = -1
  // 降采样 + 限帧：人脸模型在 320×240、12fps 下足够准，CPU 占用能降到原来的 1/4 左右
  private downscale: HTMLCanvasElement | null = null
  private lastAnalyzeAt = 0
  private static readonly MIN_INTERVAL_MS = 1000 / 12
  private static readonly W = 320
  private static readonly H = 240

  // Latest raw landmarks, exposed for the mesh overlay renderer
  lastLandmarks: Point[] | null = null

  async init() {
    const fileset = await resolveVisionFileset()
    const options = {
      outputFaceBlendshapes: true,
      runningMode: 'VIDEO' as const,
      numFaces: 1,
    }
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: LOCAL_FACE_MODEL, delegate: 'GPU' },
        ...options,
      })
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CDN_FACE_MODEL, delegate: 'GPU' },
        ...options,
      })
    }
  }

  get ready() {
    return this.landmarker !== null
  }

  analyze(video: HTMLVideoElement, nowMs: number): FrameSignals | null {
    if (!this.landmarker) return null
    if (video.currentTime === this.lastVideoTime) return null
    // 限帧：不必每帧都跑模型
    if (nowMs - this.lastAnalyzeAt < FaceAnalyzer.MIN_INTERVAL_MS) return null
    this.lastAnalyzeAt = nowMs
    this.lastVideoTime = video.currentTime

    // 降采样到 320×240 再送模型（landmark 是归一化坐标，精度不受影响）
    let source: HTMLVideoElement | HTMLCanvasElement = video
    try {
      if (!this.downscale) {
        const c = document.createElement('canvas')
        c.width = FaceAnalyzer.W
        c.height = FaceAnalyzer.H
        this.downscale = c
      }
      const ctx = this.downscale.getContext('2d', { willReadFrequently: false })
      if (ctx) {
        ctx.drawImage(video, 0, 0, FaceAnalyzer.W, FaceAnalyzer.H)
        source = this.downscale
      }
    } catch {
      source = video
    }

    const result = this.landmarker.detectForVideo(source, nowMs)
    if (!result.faceLandmarks?.length) {
      this.lastLandmarks = null
      return {
        faceDetected: false,
        eyeContact: false,
        blink: false,
        tension: 0,
        smile: 0,
        expression: 'neutral',
        instantExpression: 'neutral',
        fidget: this.fidgetTracker.score(),
      }
    }

    const landmarks = result.faceLandmarks[0] as Point[]
    this.lastLandmarks = landmarks
    const blendshapes: BlendshapeMap = {}
    for (const cat of result.faceBlendshapes?.[0]?.categories ?? []) {
      blendshapes[cat.categoryName] = cat.score
    }

    return {
      faceDetected: true,
      eyeContact: eyeContactFromLandmarks(landmarks),
      blink: this.blinkDetector.update(eyeAspectRatio(landmarks)),
      tension: tensionComposite(blendshapes),
      smile: smileLevel(blendshapes),
      expression: dominantExpression(blendshapes),
      instantExpression: classifyExpression(blendshapes),
      fidget: this.fidgetTracker.update(landmarks),
    }
  }

  close() {
    this.landmarker?.close()
    this.landmarker = null
  }
}
