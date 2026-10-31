import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth/AuthContext.js'

interface SessionRow {
  id: string
  roleField: string
  status: string
  createdAt: string
  candidate: { name: string }
  report: { id: string } | null
}

// 会话状态中文化
const STATUS_LABEL: Record<string, string> = {
  created: '未开始',
  active: '进行中',
  ended: '已结束',
  reported: '已完成',
}

const STATUS_CLASS: Record<string, string> = {
  created: '',
  active: 'active',
  ended: '',
  reported: 'active',
}

export default function SessionHistory() {
  const { isTeacher } = useAuth()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ sessions: SessionRow[] }>('/api/sessions')
      .then((d) => setSessions(d.sessions))
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>练习历史</h2>
        {error && <div className="error">{error}</div>}
        {sessions.length === 0 ? (
          <p className="muted">
            还没有练习记录。 <Link to="/">开始第一次模拟面试。</Link>
          </p>
        ) : (
          <div className="table-wrap">
            <table className="hist-table">
              <thead>
                <tr>
                  <th>时间</th>
                  {isTeacher && <th>学员</th>}
                  <th>岗位方向</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td data-label="时间">{new Date(s.createdAt).toLocaleString('zh-CN')}</td>
                    {isTeacher && <td data-label="学员">{s.candidate?.name ?? '—'}</td>}
                    <td data-label="岗位">{s.roleField}</td>
                    <td data-label="状态">
                      <span className={`badge ${STATUS_CLASS[s.status] ?? ''}`}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </td>
                    <td data-label="" className="hist-action">
                      {s.report ? (
                        <Link to={`/session/${s.id}/report`}>查看报告</Link>
                      ) : s.status === 'created' || s.status === 'active' ? (
                        <Link to={`/session/${s.id}`}>继续</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
