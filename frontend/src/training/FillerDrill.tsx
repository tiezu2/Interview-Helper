import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { submitDrill } from './api.js'
import { countWords, findFillers } from '../analysis/fillers.js'
import { SpeechRecognizer } from '../analysis/speech.js'

// 口头禅清除训练。
// 两条路径，共用同一套评分：
//  A 实时说：本地 Whisper（自托管模型，离线）边说边转写，命中就高亮；
//     本地模型缺失时明确提示不可用（不再降级到浏览器内置识别）；
//  B 粘贴文本：把手机语音输入/输入法转写的文字粘进来，立刻分析。
// 这样即使浏览器不支持实时转写，这个训练也能完整演示。

const TARGET_DENSITY = 2 // 目标：填充词密度 < 2 个/100 字
const RECORD_SECONDS = 45

type Mode = 'speak' | 'paste'
type Phase = 'idle' | 'recording' | 'done'

const DEMO_TEXT =
  '那个，我先说一下我的项目经历，然后，然后我在学校做过一个二手交易平台，' +
  '嗯，我负责后端接口，呃，就是用了 Java 和 MySQL，然后呢性能优化这块，' +
  '其实我主要是加了缓存，那个效果提升了大概百分之四十。'

// 高亮口头禅
function Highlighted({ text }: { text: string }) {
  const hits = findFillers(text)
  if (!hits.length) return <span>{text}</span>
  const parts: React.ReactNode[] = []
  let cursor = 0
  hits.forEach((h, i) => {
    if (h.index > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, h.index)}</span>)
    parts.push(
      <mark
        key={`h${i}`}
        style={{
          background: '#fdeaea',
          color: 'var(--bad)',
          borderRadius: 4,
          padding: '0 2px',
          fontWeight: 600,
        }}
      >
        {text.slice(h.index, h.index + h.length)}
      </mark>,
    )
    cursor = h.index + h.length
  })
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>)
  return <span>{parts}</span>
}

export default function FillerDrill() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('paste')
  const [phase, setPhase] = useState<Phase>('idle')
  const [text, setText] = useState('')
  const [remaining, setRemaining] = useState(RECORD_SECONDS)
  const [supported, setSupported] = useState(true)
  const [engine, setEngine] = useState<'whisper' | 'none'>('whisper')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ score: number; fillers: number; words: number; density: number } | null>(null)

  const recRef = useRef<any>(null)
  const timerRef = useRef<number>(0)
  const stopAtRef = useRef(0)

  useEffect(() => {
    setSupported(SpeechRecognizer.supported())
    SpeechRecognizer.detectEngine().then((engine) => {
      setEngine(engine)
    })
  }, [])

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    recRef.current?.stop?.()
  }, [])

  const words = countWords(text)
  const fillers = findFillers(text).length
  const density = words > 0 ? Math.round((fillers / words) * 1000) / 10 : 0

  const scoreOf = (d: number) => Math.max(0, Math.min(100, Math.round(100 - d * 10)))

  const settle = async () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    recRef.current?.stop?.()
    recRef.current = null

    const w = countWords(text)
    if (w < 10) {
      setError('内容太短（不足 10 个字），再说长一点才能算密度。')
      setPhase('idle')
      return
    }
    const f = findFillers(text).length
    const d = Math.round((f / w) * 1000) / 10
    const score = scoreOf(d)
    setResult({ score, fillers: f, words: w, density: d })
    setPhase('done')

    setSaving(true)
    try {
      await submitDrill({
        kind: 'filler',
        score,
        durationSec: mode === 'speak' ? RECORD_SECONDS : Math.max(5, Math.round((w / 135) * 60)),
        metrics: { fillers: f, words: w, density: d, mode },
      })
    } catch (e: any) {
      setError('成绩保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const startSpeak = () => {
    if (!SpeechRecognizer.supported()) {
      setSupported(false)
      return
    }
    setError('')
    setText('')
    setResult(null)
    setPhase('recording')
    setRemaining(RECORD_SECONDS)
    setStatus('')

    const rec = new SpeechRecognizer()
    rec.onStatus = (m) => setStatus(m)
    rec.onDelta = (d) => {
      if (d.text) setText((prev) => (prev ? prev + ' ' : '') + d.text)
    }
    recRef.current = rec
    rec.start()

    stopAtRef.current = performance.now() + RECORD_SECONDS * 1000
    timerRef.current = window.setInterval(() => {
      const left = Math.max(0, (stopAtRef.current - performance.now()) / 1000)
      setRemaining(Math.ceil(left))
      if (left <= 0) {
        window.clearInterval(timerRef.current)
      }
    }, 200)
  }

  // 到点自动结算（text 更新后再算）
  useEffect(() => {
    if (phase === 'recording' && remaining <= 0) {
      settle()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase])

  const reset = () => {
    setPhase('idle')
    setText('')
    setResult(null)
    setError('')
    setRemaining(RECORD_SECONDS)
  }

  return (
    <div className="container mid">
      <div className="page-head">
        <div>
          <h2>口头禅清除</h2>
          <div className="sub">
            目标：填充词密度 &lt; {TARGET_DENSITY} 个/100 字。识别「嗯、呃、那个、然后、就是」这类填充词，命中就高亮。
          </div>
        </div>
        <div className="page-actions">
          <Link to="/drills" className="muted">← 回训练中心</Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={mode === 'paste' ? '' : 'secondary'}
            onClick={() => {
              setMode('paste')
              reset()
            }}
          >
            粘贴文字分析
          </button>
          <button
            className={mode === 'speak' ? '' : 'secondary'}
            onClick={() => {
              setMode('speak')
              reset()
            }}
          >
            实时说（浏览器转写）
          </button>
        </div>
      </div>

      {mode === 'paste' && (
        <div className="card">
          <label>把你刚才的回答贴进来（可以用手机语音输入、输入法语音转写）</label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setPhase('idle')
              setResult(null)
            }}
            placeholder="例：那个，我先说一下我的项目经历，然后……"
            rows={6}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--line-strong)',
              fontSize: 14,
              lineHeight: 1.8,
              fontFamily: 'inherit',
              resize: 'vertical',
              marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={settle} disabled={words === 0 || saving}>
              {saving ? '分析中…' : '分析口头禅'}
            </button>
            <button className="secondary" onClick={() => setText(DEMO_TEXT)}>
              填入示例文本
            </button>
            <button className="secondary" onClick={() => { setText(''); reset() }}>
              清空
            </button>
          </div>
        </div>
      )}

      {mode === 'speak' && (
        <div className="card">
          {!supported && (
            <div className="error" style={{ marginBottom: 10 }}>
              本地语音模型未加载成功（/models/whisper-tiny 缺失）。请改用「粘贴文字分析」，评分逻辑完全一样。
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {phase !== 'recording' ? (
              <button onClick={startSpeak} disabled={!supported}>
                开始说话（{RECORD_SECONDS} 秒）
              </button>
            ) : (
              <button className="danger" onClick={settle}>
                说完了，提前结束
              </button>
            )}
            <span className="muted" style={{ fontSize: 13 }}>
              {phase === 'recording'
                ? `剩余 ${remaining} 秒`
                : text
                  ? `已转写 ${words} 字`
                  : '点击后开始说话，本地实时转写'}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {engine === 'whisper' ? '本地 Whisper（离线）' : '本地模型不可用'}
              {status ? ` · ${status}` : ''}
            </span>
          </div>

          {text && (
            <div
              style={{
                marginTop: 12,
                padding: '12px 14px',
                background: '#f8fafc',
                border: '1px solid var(--line)',
                borderRadius: 8,
                fontSize: 15,
                lineHeight: 2,
              }}
            >
              <Highlighted text={text} />
            </div>
          )}
        </div>
      )}

      {/* 实时统计 */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, textAlign: 'center' }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>字数</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{words}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>口头禅</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: fillers > 0 ? 'var(--bad)' : 'var(--good)' }}>
              {fillers}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>密度（个/100字）</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: density > TARGET_DENSITY ? 'var(--bad)' : 'var(--good)' }}>
              {density}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>目标</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--muted)' }}>&lt; {TARGET_DENSITY}</div>
          </div>
        </div>

        {text && (
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              background: '#f8fafc',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontSize: 15,
              lineHeight: 2,
            }}
          >
            <Highlighted text={text} />
          </div>
        )}
      </div>

      {phase === 'done' && result && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                color: result.score >= 80 ? 'var(--good)' : result.score >= 60 ? 'var(--warn)' : 'var(--bad)',
              }}
            >
              {result.score}
            </div>
            <div className="muted">
              本次得分 / 100 {saving ? '· 正在保存…' : error ? '' : '· 已保存'}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {result.words} 字里出现 {result.fillers} 处口头禅，密度 {result.density}/100 字
            （评分 = 100 − 密度 × 10，密度 2 时 80 分）
          </div>
          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.9 }}>
            <strong>改写建议：</strong>把高亮处换成一个短停顿（心里数「1」），或者删掉直接接下一句。
            例如「那个，我先说」→「我先说」；「然后，然后我」→「接下来我」。
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={reset} style={{ flex: 1 }}>再练一次</button>
            <button className="secondary" style={{ flex: 1 }} onClick={() => navigate('/drills')}>
              回训练中心看成绩
            </button>
          </div>
        </div>
      )}

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
