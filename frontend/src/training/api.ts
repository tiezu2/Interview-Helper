import { api } from '../api.js'

export type DrillKind = 'gaze' | 'pace' | 'filler' | 'posture' | 'intro'

export interface DrillSummary {
  kind: DrillKind
  label: string
  target: string
  unit: string
  runs: number
  latest: number | null
  best: number | null
  avg3: number | null
  trend: Array<{ at: string; score: number }>
}

export interface DrillPlanItem {
  kind: DrillKind
  label: string
  target: string
  reason: string
}

export interface DrillSummaryResponse {
  summaries: DrillSummary[]
  plan: DrillPlanItem[]
  stats: {
    totalRuns: number
    trainedKinds: number
    totalKinds: number
    recentAvg: number | null
  }
}

export function fetchDrillSummary() {
  return api<DrillSummaryResponse>('/api/drills/summary')
}

export function submitDrill(input: {
  kind: DrillKind
  score: number
  durationSec: number
  metrics?: Record<string, unknown>
}) {
  return api<{ run: { id: string; kind: string; score: number; createdAt: string } }>('/api/drills', {
    method: 'POST',
    body: input,
  })
}

// 各训练项路由（训练中心 → 具体训练页）
export const DRILL_PATH: Record<DrillKind, string> = {
  gaze: '/drills/gaze',
  pace: '/drills/pace',
  filler: '/drills/filler',
  posture: '/drills/posture',
  intro: '/drills/intro',
}
