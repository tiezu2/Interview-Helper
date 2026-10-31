import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  DIM_LABEL,
  DIM_SHORT,
  getClassDetail,
  importStudents,
  removeStudent,
  type ClassDetail,
  type StudentRow,
} from './api.js'

function scoreColor(v: number | null) {
  if (v === null) return 'var(--muted)'
  if (v >= 80) return 'var(--good)'
  if (v >= 60) return 'var(--warn)'
  return 'var(--bad)'
}

function daysSince(iso: string | null) {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 86400000
}

function when(iso: string | null) {
  const d = daysSince(iso)
  if (d === null) return '—'
  if (d * 86400 < 60) return '刚刚'
  if (d * 24 < 1) return `${Math.floor(d * 24)} 小时前`
  return `${Math.floor(d)} 天前`
}

type Level = 'ok' | 'warn' | 'bad'

function warnOf(s: StudentRow): { level: Level; text: string; group: string } {
  if (s.sessionCount === 0) {
    const d = daysSince(s.joinedAt) ?? 0
    if (d >= 7) return { level: 'bad', text: `加入 ${Math.floor(d)} 天未练习`, group: '一直没练' }
    if (d >= 3) return { level: 'warn', text: `加入 ${Math.floor(d)} 天未练习`, group: '一直没练' }
    return { level: 'ok', text: '刚加入', group: '正常' }
  }
  const last = daysSince(s.lastActivity)
  if (last !== null && last >= 14) {
    return { level: 'warn', text: `${Math.floor(last)} 天没练了`, group: '久未练习' }
  }
  if (s.avgOverall !== null && s.avgOverall < 60) {
    return { level: 'warn', text: '均分偏低', group: '分数偏低' }
  }
  return { level: 'ok', text: '正常', group: '正常' }
}

const DIMS = Object.keys(DIM_LABEL) as Array<keyof typeof DIM_LABEL>

function buildCsv(className: string, students: StudentRow[]) {
  const header = [
    '姓名',
    '学号',
    '最近综合',
    ...DIMS.map((k) => DIM_LABEL[k]),
    '均分',
    '最好',
    '练习次数',
    '训练次数',
    '加入时间',
    '最近活动',
    '状态',
  ]
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = students.map((s) => {
    const w = warnOf(s)
    return [
      s.name,
      s.studentNo ?? '',
      s.latest?.overall ?? '',
      ...DIMS.map((k) => (s.latest as any)?.[k] ?? ''),
      s.avgOverall ?? '',
      s.bestOverall ?? '',
      s.sessionCount,
      s.drillCount,
      new Date(s.joinedAt).toLocaleDateString('zh-CN'),
      s.lastActivity ? new Date(s.lastActivity).toLocaleString('zh-CN') : '未练习',
      w.text,
    ]
  })
  const lines = [header, ...rows].map((r) => r.map(esc).join(','))
  return { csv: '\ufeff' + lines.join('\r\n') + '\r\n', filename: `${className}-成绩单.csv` }
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function BoardContent({ classId, embedded = false }: { classId: string; embedded?: boolean }) {
  const id = classId
  const [data, setData] = useState<ClassDetail | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    getClassDetail(id)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [id, reloadKey])

  const alerts = useMemo(() => {
    if (!data) return { bad: [] as StudentRow[], warn: [] as StudentRow[] }
    const bad: StudentRow[] = []
    const warn: StudentRow[] = []
    for (const s of data.students) {
      const w = warnOf(s)
      if (w.level === 'bad') bad.push(s)
      else if (w.level === 'warn') warn.push(s)
    }
    return { bad, warn }
  }, [data])

  if (error) return <div className={embedded ? 'error' : 'container error'}>{error}</div>
  if (!data) return <div className={embedded ? 'muted' : 'container muted'}>正在加载班级看板…</div>

  const { classroom, students, stats } = data
  const needAttention = alerts.bad.length + alerts.warn.length

  return (
    <div className={embedded ? 'board-embedded' : 'container'}>
      <div
        className={embedded ? 'page-actions' : 'page-head'}
        style={embedded ? { justifyContent: 'flex-end', marginBottom: 12 } : undefined}
      >
        {!embedded && (
          <div>
            <h2>{classroom.name} · 班级看板</h2>
            <div className="sub">查看每位学员的表达分数、练习量与近期状态，可直接导出成绩单。</div>
          </div>
        )}
        <div className="page-actions">
          <button
            className="secondary"
            onClick={() => {
              const { csv, filename } = buildCsv(classroom.name, students)
              download(filename, csv)
            }}
            disabled={students.length === 0}
          >
            导出成绩单 CSV
          </button>
          {!embedded && <Link to="/teacher" className="muted">← 班级列表</Link>}
        </div>
      </div>

      <div className="dash">
        {/* 左栏：班级信息与操作 */}
        <div>
          <div className="card">
            <h3 className="side-title">班级加入码</h3>
            <div className="join-code">{classroom.joinCode}</div>
            <button
              className="secondary"
              style={{ width: '100%' }}
              onClick={async () => {
                try {
                  if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(classroom.joinCode)
                  } else {
                    // 老浏览器 / 非 https 环境没有 Clipboard API
                    const ta = document.createElement('textarea')
                    ta.value = classroom.joinCode
                    ta.style.position = 'fixed'
                    ta.style.opacity = '0'
                    document.body.appendChild(ta)
                    ta.select()
                    document.execCommand('copy')
                    document.body.removeChild(ta)
                  }
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                } catch {
                  setCopied(false)
                }
              }}
            >
              {copied ? '已复制' : '复制加入码'}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              学生注册后在「我的班级」输入该码即可进班。
            </p>
          </div>

          <div className="card">
            <h3 className="side-title">班级概况</h3>
            <div className="stat-list">
              <div className="row">
                <span className="k">学员人数</span>
                <span className="v">{stats.memberCount}</span>
              </div>
              <div className="row">
                <span className="k">已练习</span>
                <span className="v">{stats.practiced}</span>
              </div>
              <div className="row">
                <span className="k">班级均分</span>
                <span className="v" style={{ color: scoreColor(stats.classAvg) }}>
                  {stats.classAvg ?? '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="side-title">批量导入学生</h3>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'每行一个：学号,姓名\n20240001,张三\n20240002,李四'}
              rows={5}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--line-strong)',
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: 'ui-monospace, Menlo, monospace',
                resize: 'vertical',
                marginBottom: 8,
              }}
            />
            <button
              style={{ width: '100%' }}
              disabled={importing || !importText.trim()}
              onClick={async () => {
                setImporting(true)
                setImportMsg('')
                try {
                  const r = await importStudents(id, importText)
                  setImportMsg(
                    `新建 ${r.summary.created} 人、拉入已有账号 ${r.summary.added} 人、跳过 ${r.summary.skipped} 人` +
                      (r.summary.created > 0 ? `；初始密码统一为 ${r.defaultPassword}` : ''),
                  )
                  setImportText('')
                  setReloadKey((k) => k + 1)
                } catch (e: any) {
                  setImportMsg('导入失败：' + e.message)
                } finally {
                  setImporting(false)
                }
              }}
            >
              {importing ? '导入中…' : '导入到本班'}
            </button>
            {importMsg && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>
                {importMsg}
              </p>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>
              学号不存在会自动建号（默认密码 12345678），已存在的账号直接拉进班。
            </p>
          </div>
        </div>

        {/* 中栏：预警 + 成绩表 */}
        <div className="dash-main">
          {needAttention > 0 && (
            <div className="card" style={{ borderLeft: '3px solid var(--warn)', background: '#fffdf7' }}>
              <div className="attention-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>需要关注 {needAttention} 人</h3>
                <span className="muted" style={{ fontSize: 12 }}>未开始 / 久未练习 / 分数偏低</span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexFlow: 'wrap', gap: 8 }}>
                {[...alerts.bad, ...alerts.warn].map((s) => {
                  const w = warnOf(s)
                  return (
                    <span key={s.id} className={`status-chip status-${w.level === 'bad' ? 'bad' : 'warn'}`}>
                      {s.name} · {w.text}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {students.length === 0 ? (
            <div className="card muted">
              这个班还没有学生。把加入码 <strong>{classroom.joinCode}</strong> 发给学生，他们注册后在「我的班级」输入即可。
            </div>
          ) : (
            <div className="card" style={{ padding: '8px 12px' }}>
              <div className="table-wrap">
                <table className="compact">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>学员</th>
                      <th>状态</th>
                      <th>最近综合</th>
                      <th>均分</th>
                      <th>最好</th>
                      <th>练习</th>
                      <th>训练</th>
                      <th>最近活动</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const w = warnOf(s)
                      const cls = w.level === 'bad' ? 'row-bad' : w.level === 'warn' ? 'row-warn' : ''
                      return (
                        <tr key={s.id} className={cls}>
                          <td style={{ textAlign: 'left' }}>
                            <Link to={`/teacher/${id}/students/${s.id}`} style={{ fontWeight: 600 }}>
                              {s.name}
                            </Link>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {s.studentNo ?? '未填学号'}
                            </div>
                          </td>
                          <td>
                            <span className={`status-chip status-${w.level}`}>{w.text}</span>
                          </td>
                          <td>
                            <span
                              style={{
                                fontSize: 17,
                                fontWeight: 700,
                                color: scoreColor(s.latest?.overall ?? null),
                              }}
                            >
                              {s.latest?.overall ?? '—'}
                            </span>
                          </td>

                          <td>{s.avgOverall ?? '—'}</td>
                          <td>{s.bestOverall ?? '—'}</td>
                          <td>{s.sessionCount}</td>
                          <td>{s.drillCount}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{when(s.lastActivity)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <Link to={`/teacher/${id}/students/${s.id}`} style={{ marginRight: 10 }}>
                              详情
                            </Link>
                            <button
                              className="link-danger"
                              disabled={busyId === s.id}
                              onClick={async () => {
                                if (!confirm(`把「${s.name}」移出这个班级？账号与练习记录会保留。`)) return
                                setBusyId(s.id)
                                try {
                                  await removeStudent(id, s.id)
                                  setReloadKey((k) => k + 1)
                                } catch (e: any) {
                                  alert('移除失败：' + e.message)
                                } finally {
                                  setBusyId('')
                                }
                              }}
                            >
                              {busyId === s.id ? '移除中…' : '移除'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 右栏：五维均分 */}
        <div className="col-right">
          <div className="card">
            <h3 className="side-title">班级五维均分</h3>
            {DIMS.map((k) => {
              const v = stats.dimAvg[k] ?? null
              return (
                <div className="mini-row" key={k}>
                  <div className="top">
                    <span>{DIM_LABEL[k]}</span>
                    <strong style={{ color: scoreColor(v) }}>{v ?? '—'}</strong>
                  </div>
                  <div className="mini-bar">
                    <span style={{ width: `${v ?? 0}%`, background: scoreColor(v) }} />
                  </div>
                </div>
              )
            })}
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
              取各学员最近一次的分数做平均，用来定位全班共同的薄弱项。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// 路由包装：/teacher/:id
export default function ClassRoom() {
  const { id = '' } = useParams()
  return <BoardContent classId={id} />
}
