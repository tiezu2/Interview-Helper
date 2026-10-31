import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'

// 分项训练（Drill）模块。
// 设计原则：前端负责耳听目视的实时判定（全部在浏览器内完成），
// 后端只保存「一次训练的结论」，用于进步曲线与训练计划 —— 不接收音视频。

export const DRILL_KINDS = ['gaze', 'pace', 'filler', 'posture', 'intro'] as const
export type DrillKind = (typeof DRILL_KINDS)[number]

const META: Record<DrillKind, { label: string; target: string; unit: string }> = {
  gaze: { label: '眼神锁定', target: '连续注视镜头 ≥ 25 秒，中断 ≤ 2 次', unit: '秒' },
  pace: { label: '语速控制', target: '稳定在 120–150 字/分钟', unit: '字/分' },
  filler: { label: '口头禅清除', target: '填充词密度 < 2 个/100 字', unit: '个/100字' },
  posture: { label: '姿态矫正', target: '端正保持率 ≥ 80%', unit: '%' },
  intro: { label: '自我介绍', target: '40 秒内讲清「我是谁/能做什么/为什么合适」', unit: '秒' },
}

const submitSchema = z.object({
  kind: z.enum(DRILL_KINDS),
  score: z.number().min(0).max(100),
  durationSec: z.number().int().min(1).max(3600),
  metrics: z.record(z.any()).optional(),
})

type Row = {
  kind: string
  score: number
  durationSec: number
  metrics: string
  createdAt: Date
}

function parseMetrics(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

// 计划规则：取最近 3 次平均分最低的 3 项，给一句人话理由。
function buildPlan(summaries: Array<{ kind: DrillKind; avg3: number | null; runs: number }>) {
  const weak = summaries
    .filter((s) => s.runs > 0)
    .sort((a, b) => (a.avg3 ?? 0) - (b.avg3 ?? 0))
    .slice(0, 3)

  const untried = summaries.filter((s) => s.runs === 0).slice(0, 3)

  const items = [
    ...weak.map((s) => ({
      kind: s.kind,
      label: META[s.kind].label,
      target: META[s.kind].target,
      reason: `最近 3 次平均 ${s.avg3 ?? 0} 分，是当前较弱的一项`,
    })),
    ...untried.map((s) => ({
      kind: s.kind,
      label: META[s.kind].label,
      target: META[s.kind].target,
      reason: '还没有练过，建议先做一次基线测试',
    })),
  ]
  return items.slice(0, 3)
}

export default async function drillRoutes(app: FastifyInstance) {
  // 提交一次训练结果
  app.post('/api/drills', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = submitSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })
    const { kind, score, durationSec, metrics } = parsed.data

    const run = await prisma.drillRun.create({
      data: {
        userId: req.user.id,
        kind,
        score: Math.round(score),
        durationSec,
        metrics: JSON.stringify(metrics ?? {}),
      },
    })

    return reply.code(201).send({
      run: { id: run.id, kind: run.kind, score: run.score, createdAt: run.createdAt },
    })
  })

  // 训练记录列表（可按 kind 过滤）
  app.get('/api/drills', { preHandler: app.authenticate }, async (req) => {
    const q = req.query as { kind?: string; limit?: string }
    const limit = Math.min(Number(q.limit ?? 20) || 20, 100)
    const where: any = { userId: req.user.id }
    if (q.kind) where.kind = q.kind

    const rows: Row[] = await prisma.drillRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return {
      runs: rows.map((r) => ({
        id: (r as any).id,
        kind: r.kind,
        score: r.score,
        durationSec: r.durationSec,
        metrics: parseMetrics(r.metrics),
        createdAt: r.createdAt,
      })),
    }
  })

  // 汇总：分项成绩、趋势、训练计划
  app.get('/api/drills/summary', { preHandler: app.authenticate }, async (req) => {
    const rows: Row[] = await prisma.drillRun.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    const summaries = DRILL_KINDS.map((kind) => {
      const own = rows.filter((r) => r.kind === kind)
      const recent3 = own.slice(0, 3)
      const avg3 = recent3.length
        ? Math.round(recent3.reduce((a, b) => a + b.score, 0) / recent3.length)
        : null
      return {
        kind,
        label: META[kind].label,
        target: META[kind].target,
        unit: META[kind].unit,
        runs: own.length,
        latest: own[0]?.score ?? null,
        best: own.length ? Math.max(...own.map((r) => r.score)) : null,
        avg3,
        // 时间正序，便于前端直接画折线
        trend: own
          .slice(0, 10)
          .map((r) => ({ at: r.createdAt, score: r.score }))
          .reverse(),
      }
    })

    const trained = summaries.filter((s) => s.runs > 0).length
    const recentAvg =
      rows.length > 0
        ? Math.round(rows.slice(0, 10).reduce((a, b) => a + b.score, 0) / Math.min(rows.length, 10))
        : null

    return {
      summaries,
      plan: buildPlan(summaries.map((s) => ({ kind: s.kind, avg3: s.avg3, runs: s.runs }))),
      stats: {
        totalRuns: rows.length,
        trainedKinds: trained,
        totalKinds: DRILL_KINDS.length,
        recentAvg,
      },
    }
  })
}
