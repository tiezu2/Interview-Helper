import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PoseAnalyzer } from '../analysis/poseAnalyzer.js'
import { submitDrill } from './api.js'
import { getPreferredCameraId, listCameras, openCameraWithCheck, setPreferredCameraId } from '../analysis/media.js'

// 姿态矫正训练：摄像头 + PoseLandmarker，实时判定「端正 / 含胸」，
// 45 秒内统计端正保持率。判定逻辑复用 analysis/posture.ts（肩宽归一化）。

const DURATION = 45 // 秒
const TARGET_RATIO = 80 // 目标：端正保持率 ≥ 80%

type Phase = 'idle' | 'loading' | 'running' | 'done' | 'error'

export default function PostureDrill() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyzerRef = useRef<PoseAnalyzer | null>(null)
  const rafRef = useRef<number>(0)
  const startRef = useRef(0)

  const statsRef = useRef({ total: 0, upright: 0, sum: 0, last: 0 })
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [posture, setPosture] = useState<number | null>(null)
  const [uprightRatio, setUprightRatio] = useState(0)
  const [result, setResult] = useState<{ score: number; ratio: number; avg: number; seconds: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [cameraLabel, setCameraLabel] = useState('')
  const [cameras, setCameras] = useState<Array<{ deviceId: string; label: string }>>([])

  useEffect(() => {
    listCameras().then((list) => setCameras(list))
  }, [])

  const stopAll = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    analyzerRef.current?.close()
    analyzerRef.current = null
  }

  useEffect(() => stopAll, [])

  const finish = async () => {
    const st = statsRef.current
    const ratio = st.total > 0 ? (st.upright / st.total) * 100 : 0
    const avg = st.total > 0 ? st.sum / st.total : 0
    const score = Math.max(0, Math.min(100, Math.round(ratio)))

    stopAll()
    setPhase('done')
    setResult({
      score,
      ratio: Math.round(ratio),
      avg: Math.round(avg * 100) / 100,
      seconds: Math.round((performance.now() - startRef.current) / 1000),
    })

    setSaving(true)
    try {
      await submitDrill({
        kind: 'posture',
        score,
        durationSec: DURATION,
        metrics: {
          uprightRatio: Math.round(ratio),
          avgPosture: Math.round(avg * 100) / 100,
          samples: st.total,
          target: TARGET_RATIO,
        },
      })
    } catch (e: any) {
      setError('成绩保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const loop = () => {
    const video = videoRef.current
    const analyzer = analyzerRef.current
    if (!video || !analyzer) return

    const now = performance.now()
    if ((now - startRef.current) / 1000 >= DURATION) {
      finish()
      return
    }

    const p = analyzer.analyze(video, now)
    const st = statsRef.current
    if (p !== null) {
      st.total += 1
      st.sum += p
      st.last = p
      if (p >= 0.66) st.upright += 1
    }

    if (st.total % 4 === 0) {
      setElapsed(Math.round(((now - startRef.current) / 1000) * 10) / 10)
      setPosture(p)
      setUprightRatio(st.total > 0 ? Math.round((st.upright / st.total) * 100) : 0)
    }

    rafRef.current = requestAnimationFrame(loop)
  }

  const start = async () => {
    setPhase('loading')
    setError('')
    setResult(null)
    statsRef.current = { total: 0, upright: 0, sum: 0, last: 0 }
    setElapsed(0)
    setUprightRatio(0)
    setPosture(null)

    try {
      const video = videoRef.current
      if (!video) throw new Error('视频元素未就绪')
      const { stream, usedLabel } = await openCameraWithCheck(video, {
        deviceId: getPreferredCameraId() ?? undefined,
      })
      setCameraLabel(usedLabel)
      streamRef.current = stream

      const analyzer = new PoseAnalyzer()
      await analyzer.init() // pose_landmarker_lite.task，约 5.5MB，首次加载较慢
      analyzerRef.current = analyzer

      startRef.current = performance.now()
      setPhase('running')
      rafRef.current = requestAnimationFrame(loop)
    } catch (e: any) {
      stopAll()
      setPhase('error')
      setError(
        e?.name === 'NotAllowedError'
          ? '没有拿到摄像头权限。请点地址栏左侧的相机图标，允许本站使用摄像头后重试。'
          : '启动失败：' + (e?.message ?? String(e)),
      )
    }
  }

  const remaining = Math.max(0, DURATION - elapsed)
  const good = posture !== null && posture >= 0.66

  return (
    <div className="container mid">
      <div className="page-head">
        <div>
          <h2>姿态矫正 · 45 秒</h2>
          <div className="sub">
            目标：端正保持率 ≥ {TARGET_RATIO}%。
          </div>
        </div>
        <div className="page-actions">
          <Link to="/drills" className="muted">← 回训练中心</Link>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            width: '100%',
            display: 'block',
            transform: 'scaleX(-1)',
            background: '#0f172a',
            aspectRatio: '4 / 3',
            objectFit: 'cover',
          }}
        />
        {phase === 'running' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              border: `4px solid ${good ? 'var(--good)' : 'var(--warn)'}`,
              pointerEvents: 'none',
              transition: 'border-color .25s',
            }}
          />
        )}
        {phase === 'running' && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              padding: '6px 10px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              background: good ? 'rgba(22,163,74,.16)' : 'rgba(217,119,6,.16)',
              color: good ? 'var(--good)' : 'var(--warn)',
            }}
          >
            {posture === null ? '正在识别身体姿态…' : good ? '姿态端正' : '有点含胸，坐直一点'}
          </div>
        )}
        {phase === 'running' && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              padding: '6px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,.9)',
              border: '1px solid var(--line)',
              fontSize: 13,
            }}
          >
            剩余 {remaining.toFixed(1)} 秒
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ height: 8, borderRadius: 999, background: '#e8eef6', overflow: 'hidden', marginBottom: 12 }}>
          <div
            style={{
              width: `${Math.min(100, (elapsed / DURATION) * 100)}%`,
              height: '100%',
              background: 'var(--accent)',
              transition: 'width .1s linear',
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, textAlign: 'center' }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>端正保持率</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: uprightRatio >= TARGET_RATIO ? 'var(--good)' : 'var(--warn)',
              }}
            >
              {uprightRatio}%
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>当前姿态分</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {posture === null ? '—' : Math.round(posture * 100)}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>已用时间</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{elapsed.toFixed(1)}s</div>
          </div>
        </div>

        {cameras.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13 }}>摄像头</label>
            <select
              defaultValue={getPreferredCameraId() ?? ''}
              onChange={(e) => setPreferredCameraId(e.target.value || null)}
              style={{ marginBottom: 0 }}
            >
              <option value="">自动选择</option>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {cameraLabel && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            当前采集：{cameraLabel}
          </p>
        )}
        {phase === 'idle' && (
          <button style={{ width: '100%', marginTop: 16 }} onClick={start}>
            开始训练（需要摄像头权限）
          </button>
        )}
        {phase === 'loading' && (
          <div className="muted" style={{ marginTop: 16 }}>
            正在加载姿态模型与摄像头…首次约 3—6 秒（模型 5.5MB）
          </div>
        )}
        {phase === 'error' && (
          <>
            <div className="error" style={{ marginTop: 16 }}>{error}</div>
            <button style={{ width: '100%', marginTop: 12 }} onClick={start}>重试</button>
          </>
        )}

        {phase === 'done' && result && (
          <div style={{ marginTop: 16 }}>
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
              <div className="muted">本次得分 / 100 {saving ? '· 正在保存…' : error ? '' : '· 已保存'}</div>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              端正保持率 {result.ratio}% · 平均姿态分 {Math.round(result.avg * 100)} · 时长 {result.seconds} 秒
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={start} style={{ flex: 1 }}>再来一次</button>
              <button className="secondary" style={{ flex: 1 }} onClick={() => navigate('/drills')}>
                回训练中心看成绩
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
