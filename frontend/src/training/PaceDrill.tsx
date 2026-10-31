import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { submitDrill } from './api.js'
import { countWords } from '../analysis/fillers.js'

// 语速控制训练：读一段已知字数的自我介绍，分段计时，算「字/分钟」。
// 不依赖语音识别（国内 Chrome 的 Web Speech 基本不可用），
// 用「麦克风音量判定开口 + 分段手动确认」拿到可靠的计时，
// 这样语速与稳定性的计算在任何网络环境下都成立。

const TARGET_WPM = 135 // 目标语速（区间 120–150）
const LOW = 120
const HIGH = 150

const SEGMENTS = [
  '各位老师好，我叫张明，计算机应用技术专业，在校期间主要做后端开发和数据库相关的小项目。',
  '我熟悉 Java 和 MySQL，做过一个校园二手交易平台，负责接口设计、权限校验和性能优化。',
  '我希望找一份后端开发的工作，能继续把工程能力练扎实，也愿意从测试和运维开始做起。',
]

type Phase = 'idle' | 'reading' | 'between' | 'done'

interface SegResult {
  chars: number
  sec: number
  wpm: number
}

const stripCount = (s: string) => countWords(s)
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

export default function PaceDrill() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [segIndex, setSegIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [results, setResults] = useState<SegResult[]>([])
  const [micOn, setMicOn] = useState(true)
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [finalScore, setFinalScore] = useState<number | null>(null)

  const startRef = useRef(0)
  const tickRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const spokeRef = useRef(false)

  const segText = SEGMENTS[segIndex] ?? ''
  const segChars = stripCount(segText)
  const targetSec = (segChars / TARGET_WPM) * 60

  // 麦克风：音量条 + 首次出声自动开始计时
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
          if (rms > 0.012 && !spokeRef.current) {
            spokeRef.current = true
            setHeard(true)
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
  }, [micOn])

  // 计时
  useEffect(() => {
    if (phase !== 'reading') return
    const id = window.setInterval(() => {
      setElapsed((performance.now() - startRef.current) / 1000)
    }, 100)
    tickRef.current = id
    return () => window.clearInterval(id)
  }, [phase])

  // 首次出声自动开始（替代点按钮）
  useEffect(() => {
    if (heard && phase === 'idle' && micOn) startSegment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard, phase, micOn])

  const startSegment = () => {
    setError('')
    setElapsed(0)
    startRef.current = performance.now()
    setPhase('reading')
  }

  const finishSegment = () => {
    const sec = Math.max(0.5, (performance.now() - startRef.current) / 1000)
    const wpm = Math.round((segChars / sec) * 60)
    const next = [...results, { chars: segChars, sec: Math.round(sec * 10) / 10, wpm }]
    setResults(next)
    setElapsed(0)
    spokeRef.current = false
    setHeard(false)

    if (next.length >= SEGMENTS.length) {
      finalize(next)
    } else {
      setSegIndex(segIndex + 1)
      setPhase('between')
    }
  }

  const finalize = async (all: SegResult[]) => {
    setPhase('done')
    const wpms = all.map((r) => r.wpm)
    const avg = wpms.reduce((a, b) => a + b, 0) / wpms.length
    const variance = wpms.reduce((a, b) => a + (b - avg) ** 2, 0) / wpms.length
    const std = Math.sqrt(variance)
    const cv = avg > 0 ? std / avg : 0
    const inRangeRatio = wpms.filter((w) => w >= LOW && w <= HIGH).length / wpms.length
    const stability = clamp(100 - cv * 200)
    const center = clamp(100 - (Math.abs(avg - TARGET_WPM) / TARGET_WPM) * 100)
    const score = Math.round(clamp(inRangeRatio * 100 * 0.5 + stability * 0.35 + center * 0.15))

    setFinalScore(score)
    setSaving(true)
    try {
      await submitDrill({
        kind: 'pace',
        score,
        durationSec: Math.max(1, Math.round(all.reduce((a, b) => a + b.sec, 0))),
        metrics: {
          avgWpm: Math.round(avg),
          perSegmentWpm: wpms,
          inRangeRatio: Math.round(inRangeRatio * 100) / 100,
          cv: Math.round(cv * 100) / 100,
          targetWpm: TARGET_WPM,
          chars: all.map((r) => r.chars),
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
    setSegIndex(0)
    setPhase('idle')
    setElapsed(0)
    setFinalScore(null)
    setError('')
    spokeRef.current = false
    setHeard(false)
  }

  const drift = elapsed - targetSec // 正数=比目标慢
  const driftText = Math.abs(drift) < 1 ? '正好' : drift > 0 ? `慢 ${drift.toFixed(1)} 秒` : `快 ${(-drift).toFixed(1)} 秒`

  return (
    <div className="container mid">
      <div className="page-head">
        <div>
          <h2>语速控制</h2>
          <div className="sub">
            目标 {TARGET_WPM} 字/分（合格区间 {LOW}—{HIGH}）。分 3 段朗读，系统按每段字数与真实用时算语速。
          </div>
        </div>
        <div className="page-actions">
          <Link to="/drills" className="muted">← 回训练中心</Link>
        </div>
      </div>

      <div className="card">
        <div className="drill-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            第 {Math.min(segIndex + 1, SEGMENTS.length)} / {SEGMENTS.length} 段 · 本段 {segChars} 字 · 目标 {targetSec.toFixed(1)} 秒
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={micOn}
              onChange={(e) => setMicOn(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            麦克风（开口自动计时）
          </label>
        </div>

        {segIndex < SEGMENTS.length && (
          <div
            style={{
              fontSize: 20,
              lineHeight: 1.9,
              padding: '16px 18px',
              background: '#f7faff',
              border: '1px solid #e2ecf9',
              borderRadius: 10,
              letterSpacing: '0.5px',
            }}
          >
            {segText}
          </div>
        )}

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
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
                color: phase !== 'reading' ? 'var(--muted)' : Math.abs(drift) < 2 ? 'var(--good)' : Math.abs(drift) < 5 ? 'var(--warn)' : 'var(--bad)',
              }}
            >
              {phase === 'reading' ? driftText : '—'}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              麦克风音量 {heard ? '· 已收到声音' : micOn ? '· 等待你开口' : '· 已关闭'}
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
          {phase === 'idle' && (
            <button onClick={startSegment}>开始这一段（或直接开口朗读）</button>
          )}
          {phase === 'reading' && <button onClick={finishSegment}>读完了，下一段</button>}
          {phase === 'between' && (
            <>
              <button onClick={startSegment}>开始第 {segIndex + 1} 段</button>
              <button className="secondary" onClick={reset}>重新开始</button>
            </>
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
                <th>字数</th>
                <th>用时</th>
                <th>语速</th>
                <th>评价</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>第 {i + 1} 段</td>
                  <td>{r.chars}</td>
                  <td>{r.sec.toFixed(1)}s</td>
                  <td style={{ fontWeight: 700 }}>{r.wpm} 字/分</td>
                  <td
                    style={{
                      color: r.wpm > HIGH ? 'var(--bad)' : r.wpm < LOW ? 'var(--warn)' : 'var(--good)',
                    }}
                  >
                    {r.wpm > HIGH ? '偏快' : r.wpm < LOW ? '偏慢' : '在区间内'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {phase === 'done' && finalScore !== null && (
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
            评分 = 50% 落在 120—150 区间的段数比例 + 35% 段间稳定性 + 15% 平均语速接近 135
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
