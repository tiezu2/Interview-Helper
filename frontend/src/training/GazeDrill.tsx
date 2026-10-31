import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FaceAnalyzer } from '../analysis/faceAnalyzer.js'
import { submitDrill } from './api.js'
import { getPreferredCameraId, listCameras, openCameraWithCheck, setPreferredCameraId } from '../analysis/media.js'

const DURATION = 30 // 秒

type Phase = 'idle' | 'loading' | 'running' | 'done' | 'error'

interface GazeStats {
  total: number
  contact: number
  breaks: number
  longestStreak: number
  streakStartMs: number
  lastContact: boolean
}

export default function GazeDrill() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyzerRef = useRef<FaceAnalyzer | null>(null)
  const rafRef = useRef<number>(0)
  const startMsRef = useRef<number>(0)
  const statsRef = useRef<GazeStats>({
    total: 0,
    contact: 0,
    breaks: 0,
    longestStreak: 0,
    streakStartMs: 0,
    lastContact: false,
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [lookAtCamera, setLookAtCamera] = useState(false)
  const [contactSec, setContactSec] = useState(0)
  const [breaks, setBreaks] = useState(0)
  const [streakSec, setStreakSec] = useState(0)
  const [result, setResult] = useState<{ score: number; contactPct: number; longest: number; breaks: number } | null>(null)
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
    const contactPct = st.total > 0 ? (st.contact / st.total) * 100 : 0
    const streakScore = Math.min(100, (st.longestStreak / 25) * 100)
    const raw = 0.7 * contactPct + 0.3 * streakScore - st.breaks * 2
    const score = Math.max(0, Math.min(100, Math.round(raw)))

    stopAll()
    setPhase('done')
    setResult({
      score,
      contactPct: Math.round(contactPct),
      longest: Math.round(st.longestStreak * 10) / 10,
      breaks: st.breaks,
    })

    setSaving(true)
    try {
      await submitDrill({
        kind: 'gaze',
        score,
        durationSec: DURATION,
        metrics: {
          contactPct: Math.round(contactPct),
          longestStreakSec: Math.round(st.longestStreak * 10) / 10,
          breaks: st.breaks,
          frames: st.total,
        },
      })
      setSaving(false)
    } catch (e: any) {
      setSaving(false)
      setError('成绩保存失败：' + e.message)
    }
  }

  const loop = () => {
    const video = videoRef.current
    const analyzer = analyzerRef.current
    if (!video || !analyzer) return

    const now = performance.now()
    const t = (now - startMsRef.current) / 1000
    if (t >= DURATION) {
      finish()
      return
    }

    const sig = analyzer.analyze(video, now)
    const st = statsRef.current
    if (sig) {
      st.total += 1
      if (sig.eyeContact) {
        st.contact += 1
        if (!st.lastContact) st.streakStartMs = now
        st.lastContact = true
      } else if (st.lastContact) {
        // 刚丢失注视：这一整段连续注视结束
        const streak = (now - st.streakStartMs) / 1000
        if (streak > st.longestStreak) st.longestStreak = streak
        if (streak >= 0.4) st.breaks += 1
        st.lastContact = false
      }
    }

    if (st.total % 6 === 0) {
      setElapsed(Math.round(t * 10) / 10)
      setLookAtCamera(sig?.eyeContact ?? false)
      setContactSec(Math.round((st.total > 0 ? st.contact / st.total : 0) * 100))
      setBreaks(st.breaks)
      setStreakSec(Math.round(st.lastContact ? (now - st.streakStartMs) / 1000 : 0))
    }

    rafRef.current = requestAnimationFrame(loop)
  }

  const start = async () => {
    setPhase('loading')
    setError('')
    setResult(null)
    statsRef.current = {
      total: 0,
      contact: 0,
      breaks: 0,
      longestStreak: 0,
      streakStartMs: 0,
      lastContact: false,
    }
    setElapsed(0)
    setBreaks(0)
    setContactSec(0)
    setStreakSec(0)

    try {
      const video = videoRef.current
      if (!video) throw new Error('视频元素未就绪')
      const { stream, usedLabel } = await openCameraWithCheck(video, {
        deviceId: getPreferredCameraId() ?? undefined,
      })
      setCameraLabel(usedLabel)
      streamRef.current = stream

      const analyzer = new FaceAnalyzer()
      await analyzer.init() // 首次会下载/读取 face_landmarker.task（约 3.6MB）
      analyzerRef.current = analyzer

      startMsRef.current = performance.now()
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
  const progress = Math.min(100, (elapsed / DURATION) * 100)

  return (
    <div className="container mid">
      <div className="page-head">
        <div>
          <h2>眼神锁定 · 30 秒</h2>
          <div className="sub">目标：连续注视镜头 ≥ 25 秒，中断 ≤ 2 次。看的是镜头，不是屏幕上自己的脸。</div>
        </div>
        <div className="page-actions">
          <Link to="/drills" className="muted">← 回训练中心</Link>
        </div>
      </div>

      <div className="card" style={{ position: 'relative', padding: 0, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            width: '100%',
            display: 'block',
            transform: 'scaleX(-1)',
            background: '#0b0f18',
            aspectRatio: '4 / 3',
            objectFit: 'cover',
          }}
        />
        {phase === 'running' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              border: `4px solid ${lookAtCamera ? 'var(--good)' : 'var(--bad)'}`,
              pointerEvents: 'none',
              transition: 'border-color .2s',
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
              background: lookAtCamera ? 'rgba(62,207,142,.18)' : 'rgba(242,109,109,.18)',
              color: lookAtCamera ? 'var(--good)' : 'var(--bad)',
            }}
          >
            {lookAtCamera ? '注视中 · 连续 ' + streakSec + ' 秒' : '视线离开了镜头'}
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
        <div style={{ height: 8, borderRadius: 999, background: 'var(--surface)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width .1s linear' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, textAlign: 'center' }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>注视占比</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{contactSec}%</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>中断次数</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: breaks > 2 ? 'var(--bad)' : 'var(--text)' }}>{breaks}</div>
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
        {phase === 'loading' && <div className="muted" style={{ marginTop: 16 }}>正在加载人脸模型与摄像头…首次约 3—5 秒</div>}
        {phase === 'error' && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
        {phase === 'error' && (
          <button style={{ width: '100%', marginTop: 12 }} onClick={start}>重试</button>
        )}

        {phase === 'done' && result && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: result.score >= 80 ? 'var(--good)' : result.score >= 60 ? 'var(--warn)' : 'var(--bad)' }}>
                {result.score}
              </div>
              <div className="muted">本次得分 / 100</div>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              注视占比 {result.contactPct}% · 最长连续 {result.longest} 秒 · 中断 {result.breaks} 次
              {saving && ' · 正在保存…'}
              {!saving && !error && ' · 已保存'}
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
