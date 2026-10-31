import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

interface HistoryPoint {
  sessionId: string
  roleField: string
  date: string
  overall: number
  expression: number
  eyeContact: number
  stillness: number
  voice: number
  speech: number
}

interface ProgressData {
  history: HistoryPoint[]
  streak: number
  best: number | null
  totalSessions: number
}

const SERIES = [
  { key: 'overall', label: '综合', color: '#4f8cff', width: 3 },
  { key: 'eyeContact', label: '眼神', color: '#3ecf8e', width: 1.5 },
  { key: 'voice', label: '声音', color: '#f5b942', width: 1.5 },
  { key: 'speech', label: '表达', color: '#b07cff', width: 1.5 },
] as const

export default function ProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<ProgressData>('/api/progress')
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error)
    return (
      <div className="container">
        <div className="card error">{error}</div>
      </div>
    )
  if (!data) return <div className="container muted">正在加载进步数据…</div>

  const { history, streak, best, totalSessions } = data

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>我的进步</h2>
        {totalSessions === 0 ? (
          <p className="muted">
            还没有完成的练习。 先做一次<Link to="/">模拟面试</Link>，成绩就会在这里画出曲线。
          </p>
        ) : (
          <>
            <div className="score-grid" style={{ marginBottom: 16 }}>
              <div className="score-tile">
                <div className="value">{totalSessions}</div>
                <div className="name">练习次数</div>
              </div>
              <div className="score-tile">
                <div className="value" style={{ color: streak > 0 ? 'var(--good)' : undefined }}>
                  {streak > 0 ? `${streak} 天` : '0 天'}
                </div>
                <div className="name">连续天数</div>
              </div>
              <div className="score-tile">
                <div className="value" style={{ color: 'var(--accent)' }}>
                  {best ?? '—'}
                </div>
                <div className="name">最好成绩</div>
              </div>
              <div className="score-tile">
                <div className="value">{history[history.length - 1]?.overall ?? '—'}</div>
                <div className="name">最近综合分</div>
              </div>
            </div>

            {history.length >= 2 ? (
              <ProgressChart history={history} />
            ) : (
              <p className="muted">再完成一次练习就能看到趋势线。</p>
            )}
          </>
        )}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>全部练习</h3>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>岗位方向</th>
                <th>综合分</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => (
                <tr key={h.sessionId}>
                  <td>{new Date(h.date).toLocaleDateString()}</td>
                  <td>{h.roleField}</td>
                  <td style={{ fontWeight: 700 }}>{h.overall}</td>
                  <td>
                    <Link to={`/session/${h.sessionId}/report`}>报告</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ProgressChart({ history }: { history: HistoryPoint[] }) {
  const w = 800
  const h = 220
  const pad = 24
  const x = (i: number) => pad + (i / (history.length - 1)) * (w - pad * 2)
  const y = (v: number) => h - pad - (v / 100) * (h - pad * 2)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ minWidth: 400 }}>
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={pad}
              x2={w - pad}
              y1={y(g)}
              y2={y(g)}
              stroke="rgba(147,161,189,0.15)"
              strokeDasharray="4 6"
            />
            <text x={4} y={y(g) + 4} fontSize="10" fill="var(--muted)">
              {g}
            </text>
          </g>
        ))}
        {SERIES.map((ser) => (
          <polyline
            key={ser.key}
            points={history.map((p, i) => `${x(i)},${y(p[ser.key] as number)}`).join(' ')}
            fill="none"
            stroke={ser.color}
            strokeWidth={ser.width}
            strokeLinejoin="round"
            opacity={ser.key === 'overall' ? 1 : 0.6}
          />
        ))}
        {history.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.overall)} r="4" fill="#4f8cff" />
        ))}
      </svg>
      <div className="muted" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {SERIES.map((ser) => (
          <span key={ser.key}>
            <span style={{ color: ser.color }}>●</span> {ser.label}
          </span>
        ))}
      </div>
    </div>
  )
}
