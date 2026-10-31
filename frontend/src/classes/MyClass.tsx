import { useEffect, useState } from 'react'
import { fetchClassmates, joinClass, myClasses, type ClassmatesResponse } from './api.js'

function scoreColor(v: number | null) {
  if (v === null) return 'var(--muted)'
  if (v >= 80) return 'var(--good)'
  if (v >= 60) return 'var(--warn)'
  return 'var(--bad)'
}

interface MyClassRow {
  id: string
  name: string
  teacherName: string
  joinedAt: string
}

// 单个班级：我的名次 + 同班同学分数排行（不含任何音视频）
function ClassPanel({ cls }: { cls: MyClassRow }) {
  const [data, setData] = useState<ClassmatesResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchClassmates(cls.id)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [cls.id])

  const me = data?.me ?? null

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 17 }}>{cls.name}</h2>
          <div className="sub">
            老师：{cls.teacherName} · 我加入于 {new Date(cls.joinedAt).toLocaleDateString('zh-CN')}
          </div>
        </div>
        {me && me.rank !== null && (
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 12 }}>我的名次</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>
              {me.rank}
              <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> / {data?.rankTotal}</span>
            </div>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="muted">正在加载同班成绩…</div>}

      {data && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: 12,
              textAlign: 'center',
              padding: '12px 0 16px',
            }}
          >
            <div>
              <div className="muted" style={{ fontSize: 12 }}>我的最近分</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: scoreColor(me?.latestOverall ?? null) }}>
                {me?.latestOverall ?? '—'}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>我的均分</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: scoreColor(me?.avgOverall ?? null) }}>
                {me?.avgOverall ?? '—'}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>我的练习</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{me?.sessionCount ?? 0} 次</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>班级均分</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: scoreColor(data.classAvg) }}>
                {data.classAvg ?? '—'}
              </div>
            </div>
          </div>

          {data.classmates.length === 0 ? (
            <div className="muted">班里还没有其他同学。</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>名次</th>
                    <th style={{ textAlign: 'left' }}>同学</th>
                    <th>最近综合</th>
                    <th>均分</th>
                    <th>最好</th>
                    <th>练习次数</th>
                  </tr>
                </thead>
                <tbody>
                  {data.classmates.map((c) => (
                    <tr key={c.id} style={c.isMe ? { background: 'var(--accent-soft)' } : undefined}>
                      <td style={{ fontWeight: 700 }}>{c.rank ?? '—'}</td>
                      <td style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: c.isMe ? 700 : 500 }}>
                          {c.name}
                          {c.isMe && <span className="badge" style={{ marginLeft: 6 }}>我</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>{c.studentNoMasked}</div>
                      </td>
                      <td style={{ fontWeight: 700, color: scoreColor(c.latestOverall) }}>
                        {c.latestOverall ?? '—'}
                      </td>
                      <td>{c.avgOverall ?? '—'}</td>
                      <td>{c.bestOverall ?? '—'}</td>
                      <td>{c.sessionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function MyClass() {
  const [rows, setRows] = useState<MyClassRow[]>([])
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    myClasses()
      .then((d) => setRows(d.classes))
      .catch((e) => setError(e.message))
  }

  useEffect(load, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOk('')
    try {
      const d = await joinClass(code.trim().toUpperCase())
      setOk(d.already ? `你已经在「${d.classroom.name}」里了` : `已加入「${d.classroom.name}」`)
      setCode('')
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h2>我的班级</h2>
          <div className="sub">
            输入老师给的 6 位加入码进班；进班后能看到自己在班里的排名和同学的分数（仅分数，不含音视频）。
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <form className="join-form" onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="输入 6 位加入码，如 AB3K9M"
            maxLength={6}
            style={{
              flex: 1,
              minWidth: 220,
              margin: 0,
              letterSpacing: 3,
              fontFamily: 'ui-monospace, Menlo, monospace',
            }}
          />
          <button type="submit" disabled={busy || code.trim().length < 4}>
            {busy ? '加入中…' : '加入班级'}
          </button>
        </form>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        {ok && <div style={{ marginTop: 8, color: 'var(--good)', fontSize: 13 }}>{ok}</div>}
      </div>

      {rows.length === 0 ? (
        <div className="card muted">还没有加入任何班级。向老师要一个加入码，在上面输入即可。</div>
      ) : (
        rows.map((c) => <ClassPanel key={c.id} cls={c} />)
      )}
    </div>
  )
}
