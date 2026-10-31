import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createClass, listClasses, type ClassRow } from './api.js'

function scoreColor(v: number | null) {
  if (v === null) return 'var(--muted)'
  if (v >= 80) return 'var(--good)'
  if (v >= 60) return 'var(--warn)'
  return 'var(--bad)'
}

export default function TeacherHome() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ClassRow[]>([])
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = () => {
    listClasses()
      .then((d) => setRows(d.classes))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const d = await createClass(name.trim())
      setName('')
      navigate(`/teacher/${d.classroom.id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const totalStudents = rows.reduce((a, c) => a + c.memberCount, 0)
  const totalReports = rows.reduce((a, c) => a + c.reportCount, 0)
  const avgPool = rows.map((c) => c.classAvg).filter((v): v is number => v !== null)
  const overallAvg = avgPool.length ? Math.round(avgPool.reduce((a, b) => a + b, 0) / avgPool.length) : null

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h2>班级后台</h2>
          <div className="sub">建班级 → 发加入码 → 学生进班练习 → 在这里看全班分数与状态。</div>
        </div>
      </div>

      <div className="dash">
        {/* 左栏：建班 */}
        <div>
          <div className="card">
            <h3 className="side-title">新建班级</h3>
            <form onSubmit={submit}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：计算机专升本 2024 级 1 班"
                maxLength={40}
                style={{ marginBottom: 10 }}
              />
              <button type="submit" disabled={busy || !name.trim()} style={{ width: '100%' }}>
                {busy ? '创建中…' : '创建班级'}
              </button>
            </form>
            {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
            <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0, lineHeight: 1.7 }}>
              创建后会自动生成 6 位加入码，把码发给学生即可。
            </p>
          </div>

          <div className="card">
            <h3 className="side-title">总体情况</h3>
            <div className="stat-list">
              <div className="row">
                <span className="k">班级数</span>
                <span className="v">{rows.length}</span>
              </div>
              <div className="row">
                <span className="k">学员总数</span>
                <span className="v">{totalStudents}</span>
              </div>
              <div className="row">
                <span className="k">已生成报告</span>
                <span className="v">{totalReports}</span>
              </div>
              <div className="row">
                <span className="k">各班平均</span>
                <span className="v" style={{ color: scoreColor(overallAvg) }}>
                  {overallAvg ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 中栏：班级列表 */}
        <div className="dash-main">
          {loading && <div className="card muted">正在加载班级…</div>}

          {!loading && rows.length === 0 && (
            <div className="card muted">还没有班级。先在左侧创建一个，然后把加入码发给学生。</div>
          )}

          <div className="tile-grid">
            {rows.map((c) => (
              <Link key={c.id} to={`/teacher/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="tile" style={{ height: '100%' }}>
                  <div className="tile-head">
                    <strong style={{ fontSize: 14, lineHeight: 1.4 }}>{c.name}</strong>
                    <span className="tile-score" style={{ color: scoreColor(c.classAvg) }}>
                      {c.classAvg ?? '—'}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    学员 {c.memberCount} · 报告 {c.reportCount}
                  </div>
                  <div
                    style={{
                      marginTop: 'auto',
                      fontSize: 13,
                      letterSpacing: 2,
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      color: 'var(--accent)',
                      background: 'var(--accent-soft)',
                      borderRadius: 6,
                      padding: '6px 8px',
                      textAlign: 'center',
                    }}
                  >
                    {c.joinCode}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* 右栏：使用提示 */}
        <div className="col-right">
          <div className="card">
            <h3 className="side-title">怎么让学生进班</h3>
            <ol className="plan-list" style={{ fontSize: 13 }}>
              <li>点开一个班级，复制它的加入码</li>
              <li>把加入码发到班级群</li>
              <li>学生注册（选「我是学生」）后，在「我的班级」输入加入码</li>
              <li>学生完成一次模拟面试后，这个班就能看到他的分数</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
