import { PoseLandmarker } from '@mediapipe/tasks-vision'
import { PostureTracker } from './posture.js'
import { resolveVisionFileset } from './faceAnalyzer.js'
import type { Point } from './gaze.js'

const LOCAL_POSE_MODEL = '/models/pose_landmarker_lite.task'
const CDN_POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

// PoseLandmarker wrapper (F3). Runs at ~2fps — posture changes slowly and
// the pose model is heavier than the face model. Self-hosted model with
// CDN fallback, same policy as FaceAnalyzer.
export class PoseAnalyzer {
  private landmarker: PoseLandmarker | null = null
  private tracker = new PostureTracker()
  private lastRun = 0

  async init() {
    const fileset = await resolveVisionFileset()
    const options = { runningMode: 'VIDEO' as const, numPoses: 1 }
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: LOCAL_POSE_MODEL, delegate: 'GPU' },
        ...options,
      })
    } catch {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CDN_POSE_MODEL, delegate: 'GPU' },
        ...options,
      })
    }
  }

  get ready() {
    return this.landmarker !== null
  }

  // Returns the rolling posture score (0-1, 1 = upright), or null before
  // the first successful detection.
  analyze(video: HTMLVideoElement, nowMs: number): number | null {
    if (!this.landmarker) return this.tracker.current()
    if (nowMs - this.lastRun < 500) return this.tracker.current()
    this.lastRun = nowMs

    const result = this.landmarker.detectForVideo(video, nowMs)
    const pose = result.landmarks?.[0] as Point[] | undefined
    if (pose) return this.tracker.update(pose)
    return this.tracker.current()
  }

  close() {
    this.landmarker?.close()
    this.landmarker = null
  }
}
