import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api.js'

interface AnswerData {
  order: number
  question: string
  transcript: string
  words: number
  fillers: number
  durationSec: number
  avgNervousness: number
  dominantMood: { state: string; emoji: string } | null
  structure: {
    hasSituation: boolean
    hasAction: boolean
    hasResult: boolean
    structureScore: number
    lengthAssessment: string
  }
  coaching: string
}

interface ReportData {
  report: {
    scores: {
      expression: number
      eyeContact: number
      stillness: number
      voice: number
      speech: number
      overall: number
      answers?: AnswerData[]
      details: {
        eyeContactPct: number
        blinkRatePerMin: number
        avgWpm: number
        fillerCount: number
        fillerPer100Words: number
        avgPosture: number | null
        energy: number
      }
    }
    feedbackMd: string
    transcript: string
    createdAt: string
  }
  benchmarks: ({ sampleSize: number } & Record<string, number>) | null
  questions: { order: number; text: string }[]
  timeline: { ts: string; signals: any }[]
  roleField: string
  startedAt: string | null
  endedAt: string | null
}

// Minimal markdown rendering (headings, bold, lists) without a dependency
function renderMd(md: string) {
  const html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '<br/>')
  return { __html: html }
}

function scoreColor(v: number) {
  if (v >= 75) return 'var(--good)'
  if (v >= 50) return 'var(--warn)'
  return 'var(--bad)'
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<ReportData>(`/api/sessions/${id}/report`)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [id])

  if (error)
    return (
      <div className="container">
        <div className="card error">{error}</div>
      </div>
    )
  if (!data) return <div className="container muted">正在加载报告…</div>

  const { report, questions, timeline, benchmarks } = data
  const s = report.scores
  const answers = s.answers ?? []

  // Timeline sparkline per signal: sample up to 60 points
  const step = Math.max(1, Math.floor(timeline.length / 60))
  const sampled = timeline.filter((_, i) => i % step === 0)

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          本次练习报告 <span className="badge">{data.roleField}</span>
        </h2>
        <p className="muted">
          这份报告只看表达层面的信号，帮你练得更稳；它是训练反馈，不是对你的评价。
        </p>
        <div className="score-grid">
          <div className="score-tile" style={{ gridColumn: '1 / -1' }}>
            <div className="value" style={{ color: scoreColor(s.overall) }}>
              {s.overall}
            </div>
            <div className="name">综合表现</div>
            {benchmarks?.overall !== undefined && (
              <div className="benchmark">
                优于 {benchmarks.overall}% 的练习者
              </div>
            )}
          </div>
          {(
            [
              ['表情从容', s.expression, benchmarks?.expression],
              ['眼神接触', s.eyeContact, benchmarks?.eyeContact],
              ['身体稳定', s.stillness, benchmarks?.stillness],
              ['声音表现', s.voice, benchmarks?.voice],
              ['语言表达', s.speech, benchmarks?.speech],
            ] as const
          ).map(([name, v, pct]) => (
            <div className="score-tile" key={name}>
              <div className="value" style={{ color: scoreColor(v) }}>
                {v}
              </div>
              <div className="name">{name}</div>
              {pct !== undefined && <div className="benchmark">前 {100 - pct}%</div>}
            </div>
          ))}
        </div>
        {benchmarks && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            百分位对比的是平台上另外 {benchmarks.sampleSize} 次练习 —— 只作参照，不是排名。
          </p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>关键数据</h3>
        <table>
          <tbody>
            <tr>
              <td>眼神接触</td>
              <td>{s.details.eyeContactPct}% of the session</td>
            </tr>
            <tr>
              <td>语速</td>
              <td>{s.details.avgWpm} words/min (ideal 120–150)</td>
            </tr>
            <tr>
              <td>口头禅</td>
              <td>
                {s.details.fillerCount} total ({s.details.fillerPer100Words} per 100 words)
              </td>
            </tr>
            <tr>
              <td>声音表现力</td>
              <td>
                {s.details.energy}/100{' '}
                {s.details.energy < 25 ? '(monotone — vary pitch and volume)' : s.details.energy < 55 ? '(steady)' : '(expressive)'}
              </td>
            </tr>
            {s.details.avgPosture !== null && (
              <tr>
                <td>姿态</td>
                <td>
                  {Math.round(s.details.avgPosture * 100)}/100{' '}
                  {s.details.avgPosture >= 0.66 ? '(upright)' : s.details.avgPosture >= 0.4 ? '(okay)' : '(slouched)'}
                </td>
              </tr>
            )}
            <tr>
              <td>眨眼频率</td>
              <td>{s.details.blinkRatePerMin}/min</td>
            </tr>
          </tbody>
        </table>
      </div>

      {answers.length > 0 && answers.some((a) => a.dominantMood) && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>逐题情绪</h3>
          <div className="mood-strip">
            {answers.map((a) => (
              <div className="mood-strip-item" key={a.order} title={a.question}>
                <div className="mood-strip-emoji">{a.dominantMood?.emoji ?? '—'}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  Q{a.order}
                </div>
                <div className="mood-strip-nerv" style={{ color: a.avgNervousness > 0.5 ? 'var(--bad)' : 'var(--muted)' }}>
                  {Math.round(a.avgNervousness * 100)}%
                </div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Emoji = how you mostly came across during that answer; % = average nervousness.
          </p>
        </div>
      )}

      <div className="card feedback-md">
        <h3 style={{ marginTop: 0 }}>改进建议</h3>
        <div dangerouslySetInnerHTML={renderMd(report.feedbackMd)} />
      </div>

      {answers.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>逐题分析</h3>
          {answers.map((a) => (
            <details className="answer-card" key={a.order}>
              <summary>
                <span className="answer-emoji" />
                <span className="answer-q">
                  Q{a.order}. {a.question}
                </span>
                <span className="badge">{a.words} words</span>
              </summary>
              <div className="answer-body">
                <div className="answer-structure">
                  {(
                    [
                      ['Situation', a.structure.hasSituation],
                      ['Action', a.structure.hasAction],
                      ['Result', a.structure.hasResult],
                    ] as const
                  ).map(([label, present]) => (
                    <span key={label} className={`star-chip ${present ? 'on' : ''}`}>
                      {present ? '已覆盖' : '未覆盖'} {label}
                    </span>
                  ))}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {a.structure.lengthAssessment} · {a.fillers} fillers ·{' '}
                    {Math.round(a.avgNervousness * 100)}% nervousness
                  </span>
                </div>
                {a.coaching && <p style={{ lineHeight: 1.6 }}>{a.coaching}</p>}
                {a.transcript ? (
                  <p className="muted" style={{ lineHeight: 1.6, fontSize: 14 }}>
                    “{a.transcript}”
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: 13 }}>
                    这道题没有拿到文字稿。
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {sampled.length > 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>时间轴</h3>
          <TimelineChart samples={sampled} />
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>本次题目</h3>
        <ol>
          {questions.map((q) => (
            <li key={q.order} style={{ marginBottom: 8 }}>
              {q.text}
            </li>
          ))}
        </ol>
      </div>

      {report.transcript && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>文字稿</h3>
          <p style={{ lineHeight: 1.7 }}>{report.transcript}</p>
        </div>
      )}

      <p>
        <Link to="/history">← 返回历史</Link> · <Link to="/progress">查看进步</Link>
      </p>
    </div>
  )
}

function TimelineChart({ samples }: { samples: { signals: any }[] }) {
  const w = 800
  const h = 120
  const series = [
    { key: 'eye', color: 'var(--good)', label: '眼神接触', get: (s: any) => (s?.gaze?.eyeContact ? 1 : 0) },
    { key: 'nervous', color: '#b07cff', label: 'Nervousness', get: (s: any) => s?.mood?.nervousness ?? 0 },
    { key: 'tension', color: 'var(--bad)', label: '紧张度', get: (s: any) => s?.expression?.tension ?? 0 },
    { key: 'fidget', color: 'var(--warn)', label: 'Fidget', get: (s: any) => s?.movement?.fidget ?? 0 },
  ]
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none" style={{ minWidth: 400 }}>
        {series.map((ser) => {
          const points = samples
            .map((smp, i) => {
              const x = (i / (samples.length - 1)) * w
              const y = h - ser.get(smp.signals) * (h - 10) - 5
              return `${x},${y}`
            })
            .join(' ')
          return (
            <polyline
              key={ser.key}
              points={points}
              fill="none"
              stroke={ser.color}
              strokeWidth="2"
              opacity="0.85"
            />
          )
        })}
      </svg>
      <div className="muted" style={{ display: 'flex', gap: 16 }}>
        {series.map((ser) => (
          <span key={ser.key}>
            <span style={{ color: ser.color }}>●</span> {ser.label}
          </span>
        ))}
      </div>
    </div>
  )
}
