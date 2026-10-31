import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { submitDrill } from './api.js'

// 自我介绍训练：把 40 秒的自我介绍拆成三段固定结构，
// 每段只说一件事，说完了点按钮进入下一段。
// 评分 = 40% 结构完整 + 40% 时长掌控 + 20% 说话占比（麦克风）
// —— 不依赖语音识别，任何网络环境都能打分。

const SEGMENTS = [
  { title: '我是谁', hint: '姓名 / 学校 / 专业 / 年级', target: 15 },
  { title: '能做什么', hint: '技能 + 一个具体项目或实习经历', target: 15 },
  { title: '为什么合适', hint: '为什么这个岗位 / 你能带来什么', target: 10 },
]

type Phase = 'idle' | 'ready' | 'speaking' | 'between' | 'done'

export default function IntroDrill() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [idx, setIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [results, setResults] = useState<Array<{ sec: number; target: number }>>([])
  const [micOn, setMicOn] = useState(true)
  const [level, setLevel] = useState(0)
  const [speakRatio, setSpeakRatio] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [finalScore, setFinalScore] = useState<number | null>(null)
  const [detail, setDetail] = useState<{ structure: number; timing: number; speaking: number } | null>(null)

  const startRef = useRef(0)
  const tickRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const speakStats = useRef({ total: 0, speaking: 0 })

  const seg = SEGMENTS[idx] ?? SEGMENTS[SEGMENTS.length - 1]
  const targetSec = seg.target

  // 麦克风：音量条 + 说话占比统计
  useEffect(() => {
    if (!micOn) return
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        src.connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        const loop = () => {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          const rms = Math.sqrt(sum / buf.length)
          setLevel(Math.min(1, rms * 12))
          if (phase === 'speaking') {
            speakStats.current.total += 1
            if (rms > 0.012) speakStats.current.speaking += 1
            const { total, speaking } = speakStats.current
            if (total > 0) setSpeakRatio(Math.round((speaking / total) * 100))
          }
          rafRef.current = requestAnimationFrame(loop)
        }
        loop()
      } catch {
        setMicOn(false)
      }
    })()
    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, phase === 'speaking'])

  // 计时
  useEffect(() => {
    if (phase !== 'speaking') return
    const id = window.setInterval(() => {
      setElapsed((performance.now() - startRef.current) / 1000)
    }, 100)
    tickRef.current = id
    return () => window.clearInterval(id)
  }, [phase])

  const startSegment = () => {
    setError('')
    setElapsed(0)
    startRef.current = performance.now()
    setPhase('speaking')
  }

  const nextSegment = () => {
    const sec = Math.max(0.5, (performance.now() - startRef.current) / 1000)
    const next = [...results, { sec: Math.round(sec * 10) / 10, target: targetSec }]
    setResults(next)
    setElapsed(0)
    speakStats.current = { total: 0, speaking: 0 }

    if (next.length >= SEGMENTS.length) {
      finalize(next)
    } else {
      setIdx(idx + 1)
      setPhase('between')
    }
  }

  const finalize = async (all: Array<{ sec: number; target: number }>) => {
    // 结构完整：每段是否真的说了（≥3 秒）
    const spoken = all.filter((r) => r.sec >= 3).length
    const structure = Math.round((spoken / SEGMENTS.length) * 100)

    // 时长掌控：每段偏离目标的比例，越接近 100 分
    const accs = all.map((r) => {
      const diff = Math.abs(r.sec - r.target) / r.target
      return Math.max(0, 100 - diff * 100)
    })
    const timing = Math.round(accs.reduce((a, b) => a + b, 0) / accs.length)

    const speaking = micOn ? speakRatio : 0
    const base = micOn ? 0.4 * structure + 0.4 * timing + 0.2 * speaking : 0.5 * structure + 0.5 * timing
    const score = Math.round(Math.max(0, Math.min(100, base)))

    setDetail({ structure, timing, speaking })
    setFinalScore(score)
    setPhase('done')

    setSaving(true)
    try {
      await submitDrill({
        kind: 'intro',
        score,
        durationSec: Math.max(1, Math.round(all.reduce((a, b) => a + b.sec, 0))),
        metrics: {
          segments: all.map((r) => ({ sec: r.sec, target: r.target })),
          structure,
          timing,
          speaking,
          micOn,
        },
      })
    } catch (e: any) {
      setError('成绩保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setResults([])
    setIdx(0)
    setPhase('idle')
    setElapsed(0)
    setFinalScore(null)
    setDetail(null)
    setSpeakRatio(0)
    setError('')
    speakStats.current = { total: 0, speaking: 0 }
  }

  const drift = elapsed - targetSec
  const driftText = Math.abs(drift) < 1.5 ? '刚好' : drift > 0 ? `超 ${drift.toFixed(1)} 秒` : `还差 ${(-drift).toFixed(1)} 秒`

  return (
    <div className="container mid">
      <div className="page-head">
        <div>
          <h2>自我介绍 · 40 秒</h2>
          <div className="sub">
            三段结构：我是谁（15 秒）→ 能做什么（15 秒）→ 为什么合适（10 秒）。每段说完点按钮进入下一段。
          </div>
        </div>
        <div className="page-actions">
          <Link to="/drills" className="muted">← 回训练中心</Link>
        </div>
      </div>

      <div className="card">
        <div className="drill-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            第 {Math.min(idx + 1, SEGMENTS.length)} / {SEGMENTS.length} 段 · 目标 {targetSec} 秒
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={micOn}
              onChange={(e) => setMicOn(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            麦克风（统计说话占比）
          </label>
        </div>

        <div
          style={{
            padding: '18px',
            background: '#f2f7ff',
            border: '1px solid #dbe7fb',
            borderRadius: 10,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800 }}>{seg.title}</div>
          <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            说这几点：{seg.hint}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 92 }}>
            <div className="muted" style={{ fontSize: 12 }}>本段已用</div>
            <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {elapsed.toFixed(1)}s
            </div>
          </div>
          <div style={{ minWidth: 92 }}>
            <div className="muted" style={{ fontSize: 12 }}>与目标差</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color:
                  phase !== 'speaking'
                    ? 'var(--muted)'
                    : Math.abs(drift) < 2
                      ? 'var(--good)'
                      : Math.abs(drift) < 5
                        ? 'var(--warn)'
                        : 'var(--bad)',
              }}
            >
              {phase === 'speaking' ? driftText : '—'}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              说话占比 {micOn ? `${speakRatio}%` : '（麦克风未开）'}
            </div>
            <div style={{ height: 8, background: '#e8eef6', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.round(level * 100)}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 80ms linear',
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {phase === 'idle' && <button onClick={() => { setPhase('ready'); startSegment() }}>开始第 1 段</button>}
          {phase === 'between' && <button onClick={startSegment}>开始第 {idx + 1} 段</button>}
          {phase === 'speaking' && <button onClick={nextSegment}>这段说完了</button>}
          {(phase === 'between' || phase === 'speaking') && (
            <button className="secondary" onClick={reset}>重新开始</button>
          )}
        </div>

        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {results.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>已完成段</h3>
          <table>
            <thead>
              <tr>
                <th>段</th>
                <th>内容</th>
                <th>目标</th>
                <th>实际</th>
                <th>评价</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const segMeta = SEGMENTS[i]
                const okLen = r.sec >= 3
                const diff = r.sec - r.target
                return (
                  <tr key={i}>
                    <td>第 {i + 1} 段</td>
                    <td style={{ textAlign: 'left' }}>{segMeta.title}</td>
                    <td>{r.target} 秒</td>
                    <td>{r.sec.toFixed(1)} 秒</td>
                    <td style={{ color: !okLen ? 'var(--bad)' : Math.abs(diff) < 3 ? 'var(--good)' : 'var(--warn)' }}>
                      {!okLen ? '说太短' : Math.abs(diff) < 3 ? '节奏合适' : diff > 0 ? '偏长' : '偏短'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {phase === 'done' && finalScore !== null && detail && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                color: finalScore >= 80 ? 'var(--good)' : finalScore >= 60 ? 'var(--warn)' : 'var(--bad)',
              }}
            >
              {finalScore}
            </div>
            <div className="muted">本次得分 / 100 {saving ? '· 正在保存…' : error ? '' : '· 已保存'}</div>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            结构完整 {detail.structure} · 时长掌控 {detail.timing}
            {micOn && <> · 说话占比 {detail.speaking}</>}（结构 40% + 时长 40%
            {micOn && ' + 说话 20%'}）
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={reset} style={{ flex: 1 }}>再练一次</button>
            <button className="secondary" style={{ flex: 1 }} onClick={() => navigate('/drills')}>
              回训练中心看成绩
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
