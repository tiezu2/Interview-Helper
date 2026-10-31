import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DRILL_PATH, fetchDrillSummary, type DrillSummaryResponse } from './api.js'

function scoreColor(score: number | null) {
  if (score === null) return 'var(--muted)'
  if (score >= 80) return 'var(--good)'
  if (score >= 60) return 'var(--warn)'
  return 'var(--bad)'
}

// 迷你趋势线（纯 SVG，无依赖）：越靠右越新
function Sparkline({ trend }: { trend: Array<{ score: number }> }) {
  if (trend.length < 2) {
    return (
      <div className="muted" style={{ fontSize: 12, height: 28 }}>
        再练一次就能看到趋势
      </div>
    )
  }
  const w = 120
  const h = 28
  const pts = trend.map((t, i) => {
    const x = (i / (trend.length - 1)) * (w - 4) + 2
    const y = h - 2 - (Math.max(0, Math.min(100, t.score)) / 100) * (h - 6)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function TrainingHome() {
  const navigate = useNavigate()
  const [data, setData] = useState<DrillSummaryResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchDrillSummary()
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="container error">加载训练数据失败：{error}</div>
  if (!data) return <div className="container muted">正在加载训练数据…</div>

  const { summaries, plan, stats } = data
  const recent = summaries.filter((s) => s.runs > 0)

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h2>训练中心</h2>
          <div className="sub">分项刻意练习：每次只练一件事，练完就有分数，分数会累积成进步曲线。</div>
        </div>
        <div className="page-actions">
          <Link to="/">
            <button className="secondary">去模拟面试 →</button>
          </Link>
        </div>
      </div>

      <div className="dash">
        {/* 左栏：今日计划 + 统计 */}
        <div>
          <div className="card">
            <h3 className="side-title">今日训练计划</h3>
            {plan.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                还没有训练记录，先从任意一项开始。
              </p>
            ) : (
              <ol className="plan-list">
                {plan.map((p) => (
                  <li key={p.kind}>
                    <Link to={DRILL_PATH[p.kind]} style={{ fontWeight: 600 }}>
                      {p.label}
                    </Link>
                    <div className="why">{p.reason}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="card">
            <h3 className="side-title">训练概况</h3>
            <div className="stat-list">
              <div className="row">
                <span className="k">累计训练</span>
                <span className="v">{stats.totalRuns} 次</span>
              </div>
              <div className="row">
                <span className="k">已练项目</span>
                <span className="v">
                  {stats.trainedKinds}/{stats.totalKinds}
                </span>
              </div>
              <div className="row">
                <span className="k">近期均分</span>
                <span className="v" style={{ color: scoreColor(stats.recentAvg) }}>
                  {stats.recentAvg ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 中栏：训练项目 */}
        <div className="dash-main">
          <div className="card">
            <h3 className="side-title">全部训练项</h3>
            <div className="tile-grid">
              {summaries.map((s) => {
                const available = true // 5 个训练项全部开放
                return (
                  <div key={s.kind} className="tile">
                    <div className="tile-head">
                      <strong style={{ fontSize: 14 }}>{s.label}</strong>
                      <span className="tile-score" style={{ color: scoreColor(s.latest) }}>
                        {s.latest ?? '—'}
                      </span>
                    </div>
                    <div className="tile-target">{s.target}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      最好 {s.best ?? '—'} · 三次均 {s.avg3 ?? '—'} · {s.runs} 次
                    </div>
                    <Sparkline trend={s.trend} />
                    {available ? (
                      <button style={{ width: '100%' }} onClick={() => navigate(DRILL_PATH[s.kind])}>
                        {s.runs > 0 ? '再练一次' : '开始训练'}
                      </button>
                    ) : (
                      <button className="secondary" disabled style={{ width: '100%' }}>
                        开发中
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 右栏：最近成绩 + 说明 */}
        <div className="col-right">
          <div className="card">
            <h3 className="side-title">常用入口</h3>
            <div className="app-grid">
              {[
                ['面试', '/', '模拟面试'],
                ['眼', '/drills/gaze', '眼神锁定'],
                ['速', '/drills/pace', '语速控制'],
                ['词', '/drills/filler', '口头禅'],
                ['姿', '/drills/posture', '姿态矫正'],
                ['介', '/drills/intro', '自我介绍'],
                ['班', '/classes', '我的班级'],
                ['进', '/progress', '我的进步'],
              ].map(([icon, to, label]) => (
                <Link key={to + label} to={to} className="app-item">
                  <span className="app-icon">{icon}</span>
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="side-title">各项最近成绩</h3>
            {recent.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>还没有训练成绩。</p>
            ) : (
              recent.map((s) => (
                <div className="mini-row" key={s.kind}>
                  <div className="top">
                    <span>{s.label}</span>
                    <strong style={{ color: scoreColor(s.latest) }}>{s.latest}</strong>
                  </div>
                  <div className="mini-bar">
                    <span style={{ width: `${s.latest ?? 0}%`, background: scoreColor(s.latest) }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
