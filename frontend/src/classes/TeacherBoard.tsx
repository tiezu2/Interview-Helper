import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { listClasses, type ClassRow } from './api.js'
import { BoardContent } from './ClassRoom.js'

// 「班级看板」独立标签页：顶部是班级标签条，点哪个班就看哪个班。
export default function TeacherBoard() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<ClassRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listClasses()
      .then((d) => setRows(d.classes))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const selectedId = params.get('class') ?? rows[0]?.id ?? ''
  const current = rows.find((r) => r.id === selectedId)

  if (error) return <div className="container error">{error}</div>
  if (loading) return <div className="container muted">正在加载班级…</div>

  if (rows.length === 0) {
    return (
      <div className="container">
        <div className="page-head">
          <div>
            <h2>班级看板</h2>
            <div className="sub">这里按班级查看学生分数。你还没有班级。</div>
          </div>
        </div>
        <div className="card muted">
          先去「班级管理」建一个班，把加入码发给学生，他们进班后这里就有数据了。
          <div style={{ marginTop: 12 }}>
            <button onClick={() => navigate('/teacher')}>去班级管理</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="container" style={{ paddingBottom: 0 }}>
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div>
            <h2>班级看板</h2>
            <div className="sub">按班级查看每位学员的分数、练习量与需要关注的人。</div>
          </div>
          <div className="page-actions">
            <Link to="/teacher" className="muted">班级管理 →</Link>
          </div>
        </div>

        {/* 班级标签条 */}
        <div className="class-tabs">
          {rows.map((r) => {
            const active = r.id === selectedId
            return (
              <button
                key={r.id}
                className={active ? 'class-tab active' : 'class-tab'}
                onClick={() => setParams({ class: r.id })}
              >
                {r.name}
                <span className="class-tab-count">{r.memberCount}</span>
              </button>
            )
          })}
        </div>

        {current && (
          <div className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            加入码 <strong style={{ letterSpacing: 2 }}>{current.joinCode}</strong> · 学员 {current.memberCount} 人 · 班级均分{' '}
            {current.classAvg ?? '—'}
          </div>
        )}
      </div>

      {/* 复用同一套看板 */}
      {selectedId && <BoardContent key={selectedId} classId={selectedId} />}
    </div>
  )
}
