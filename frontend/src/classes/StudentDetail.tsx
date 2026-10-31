import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchStudentDetail, type StudentDetail, DIM_SHORT } from './api.js'

function scoreColor(v: number | null) {
  if (v === null) return 'var(--muted)'
  if (v >= 80) return 'var(--good)'
  if (v >= 60) return 'var(--warn)'
  return 'var(--bad)'
}

const DIM_LABEL: Record<string, string> = {
  expression: '表情从容',
  eyeContact: '眼神接触',
  stillness: '身体稳定',
  voice: '声音表现',
  speech: '语言表达',
}

// 表格列多，用短标签；上面的完整标签留给图表/详情文案

function Sparkline({ trend, width = 220, height = 44 }: { trend: Array<{ score: number | null }>; width?: number; height?: number }) {
  const pts = trend.filter((t): t is { score: number } => typeof t.score === 'number')
  if (pts.length < 2) return <div className="muted" style={{ fontSize: 12 }}>数据不足，再练一次就能看到趋势</div>
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * (width - 4) + 2)
  const ys = pts.map((p) => height - 3 - (Math.max(0, Math.min(100, p.score)) / 100) * (height - 8))
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="2.5" fill="var(--accent)" />
      ))}
    </svg>
  )
}

export default function StudentDetailPage() {
  const { id = '', sid = '' } = useParams()
  const [data, setData] = useState<StudentDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchStudentDetail(id, sid)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [id, sid])

  if (error) return <div className="container error">{error}</div>
  if (!data) return <div className="container muted">正在加载学生详情…</div>

  const { student, reports, stats, drills, suggestions } = data

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h2>
            {student.name}
            <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 10 }}>
              {student.studentNo ?? '未填学号'}
            </span>
          </h2>
          <div className="sub">
            加入班级于 {new Date(student.joinedAt).toLocaleDateString('zh-CN')} · 练习 {stats.sessions} 次，已出报告 {stats.reported} 份
          </div>
        </div>
        <div className="page-actions">
          <Link to={`/teacher/${id}`} className="muted">← 返回班级看板</Link>
        </div>
      </div>

      <div className="dash">
        <div>
          <div className="card">
            <h3 className="side-title">成绩概况</h3>
            <div className="stat-list">
              <div className="row">
                <span className="k">最近综合</span>
                <span className="v" style={{ color: scoreColor(stats.latestOverall) }}>
                  {stats.latestOverall ?? '—'}
                </span>
              </div>
              <div className="row">
                <span className="k">平均分</span>
                <span className="v" style={{ color: scoreColor(stats.avgOverall) }}>
                  {stats.avgOverall ?? '—'}
                </span>
              </div>
              <div className="row">
                <span className="k">最高分</span>
                <span className="v" style={{ color: scoreColor(stats.bestOverall) }}>
                  {stats.bestOverall ?? '—'}
                </span>
              </div>
              <div className="row">
                <span className="k">训练次数</span>
                <span className="v">{stats.drillRuns}</span>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>综合分趋势（左旧右新）</div>
              <Sparkline trend={stats.trend} />
            </div>
          </div>

          <div className="card">
            <h3 className="side-title">练习记录（{reports.length}）</h3>
            {reports.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>还没有完成的模拟面试。</p>
            ) : (
              <div className="table-wrap">
                <table className="compact">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th style={{ textAlign: 'left' }}>岗位</th>
                      <th>综合</th>
                      {Object.keys(DIM_SHORT).map((k) => (
                        <th key={k}>{DIM_SHORT[k]}</th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r.sessionId}>
                        <td className="muted" style={{ fontSize: 12 }}>{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                        <td style={{ textAlign: 'left' }}>{r.roleField}</td>
                        <td style={{ fontWeight: 700, color: scoreColor(r.overall) }}>{r.overall ?? '—'}</td>
                        {Object.keys(DIM_SHORT).map((k) => (
                          <td key={k} style={{ color: scoreColor((r as any)[k] ?? null) }}>
                            {(r as any)[k] ?? '—'}
                          </td>
                        ))}
                        <td>
                          <Link to={`/session/${r.sessionId}/report`}>查看报告</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="dash-main">
          <div className="card">
            <h3 className="side-title">训练明细</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>训练项</th>
                    <th>最近</th>
                    <th>最好</th>
                    <th>三次均</th>
                    <th>次数</th>
                    <th>趋势</th>
                  </tr>
                </thead>
                <tbody>
                  {drills.map((d) => (
                    <tr key={d.kind}>
                      <td style={{ textAlign: 'left' }}>{d.label}</td>
                      <td style={{ fontWeight: 700, color: scoreColor(d.latest) }}>{d.latest ?? '—'}</td>
                      <td>{d.best ?? '—'}</td>
                      <td>{d.avg3 ?? '—'}</td>
                      <td>{d.runs}</td>
                      <td><Sparkline trend={d.trend} width={110} height={26} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
              训练是学生在「训练中心」做的分项练习；报告来自完整模拟面试。
            </p>
          </div>
        </div>

        <div className="col-right">
          <div className="card">
            <h3 className="side-title">薄弱项建议</h3>
            {suggestions.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>还没有报告，无法给出建议。</p>
            ) : (
              suggestions.map((s) => (
                <div key={s.dimLabel} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{s.dimLabel}</strong>
                    <span style={{ color: scoreColor(s.dimScore), marginLeft: 6 }}>{s.dimScore}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    建议练：{s.drillLabel}
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
