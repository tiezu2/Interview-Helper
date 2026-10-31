import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, metricsWsUrl, getToken } from '../api.js'
import { FaceAnalyzer, type FrameSignals } from '../analysis/faceAnalyzer.js'
import { PoseAnalyzer } from '../analysis/poseAnalyzer.js'
import { AudioAnalyzer } from '../analysis/audioAnalyzer.js'
import { SpeechRecognizer } from '../analysis/speech.js'
import { getPreferredCameraId, openCameraWithCheck } from '../analysis/media.js'
import { MetricsAggregator, MetricsSender } from '../analysis/aggregator.js'
import { NudgeEngine, type Nudge } from '../analysis/nudges.js'
import { MoodTracker, type MoodResult, classifyMood } from '../analysis/mood.js'
import { EXPRESSION_META, type Expression } from '../analysis/expressions.js'
import { framingFeedback, FramingTracker } from '../analysis/framing.js'
import { Interviewer } from '../analysis/tts.js'
import { MeshOverlay } from './meshOverlay.js'
import MeshLoader from './MeshLoader.js'
import Meters, { type LiveMeterValues } from './Meters.js'
import MoodBadge from './MoodBadge.js'
import LiveChart from './LiveChart.js'

interface Question {
  id: string
  order: number
  text: string
}

type Phase = 'permissions' | 'loading-models' | 'ready' | 'running' | 'ending'

export default function LiveSession() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const meshCanvasRef = useRef<HTMLCanvasElement>(null)

  const [phase, setPhase] = useState<Phase>('permissions')
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionIdx, setQuestionIdx] = useState(0)
  const [followUp, setFollowUp] = useState<string | null>(null)
  const [followUpBusy, setFollowUpBusy] = useState(false)
  const [ttsOn, setTtsOn] = useState(true)
  const [nudge, setNudge] = useState<Nudge | null>(null)
  const [speechSupported, setSpeechSupported] = useState(true)
  const [speechEngine, setSpeechEngine] = useState<'whisper' | 'none'>('whisper')
  const [speechStatus, setSpeechStatus] = useState('')
  const [meters, setMeters] = useState<LiveMeterValues>({
    eyeContact: 0,
    tension: 0,
    fidget: 0,
    wpm: 0,
    volume: 0,
    energy: 0,
    posture: null,
  })
  const [mood, setMood] = useState<MoodResult>(() =>
    classifyMood({ smile: 0, tension: 0, nervousness: 0, eyeContact: true }),
  )
  const [nervousnessHistory, setNervousnessHistory] = useState<number[]>([])
  const [expression, setExpression] = useState<Expression>('neutral')
  const [framingMsg, setFramingMsg] = useState<string | null>(null)
  const [meshOn, setMeshOn] = useState(false)
  const [poseOn, setPoseOn] = useState(false)
  const [cameraLabel, setCameraLabel] = useState('')
  const meshOnRef = useRef(false)
  const framingTracker = useRef(new FramingTracker())

  // Long-lived analysis objects survive re-renders in refs
  const rt = useRef<{
    stream?: MediaStream
    face?: FaceAnalyzer
    pose?: PoseAnalyzer
    audio?: AudioAnalyzer
    speech?: SpeechRecognizer
    aggregator?: MetricsAggregator
    sender?: MetricsSender
    nudges?: NudgeEngine
    moodTracker?: MoodTracker
    interviewer?: Interviewer
      mesh?: MeshOverlay
      rafId?: number
    flushId?: number
    fastId?: number
    eyeContactWindow: boolean[]
    posture: number | null
    questionOrder: number
    answerTexts: Record<number, string>
    latestFrame: FrameSignals | null
  }>({
    eyeContactWindow: [],
    posture: null,
    questionOrder: 1,
    answerTexts: {},
    latestFrame: null,
  })

  useEffect(() => {
    api<{ session: { questions: Question[]; status: string } }>(`/api/sessions/${id}`)
      .then((d) => {
        setQuestions(d.session.questions)
        if (d.session.status === 'reported') navigate(`/session/${id}/report`)
      })
      .catch((e) => setError(e.message))
  }, [id])

  // 姿态检测：默认关闭，需要时再加载模型（省 CPU 与 5.5MB 下载）
  const enablePose = async () => {
    if (rt.current.pose) return
    try {
      const pose = new PoseAnalyzer()
      await pose.init()
      rt.current.pose = pose
    } catch {
      // 姿态是增强项，失败不影响主流程
    }
  }

  const requestPermissions = async () => {
    setError('')
    try {
      // 与眼神/姿态训练一致：多组采集参数回退 + 等首帧，避免绿屏/黑屏卡死
      const video = videoRef.current
      if (!video) throw new Error('视频元素未就绪，请刷新页面重试')
      const { stream, usedLabel } = await openCameraWithCheck(video, {
        audio: true,
        deviceId: getPreferredCameraId() ?? undefined,
      })
      rt.current.stream = stream
      setCameraLabel(usedLabel)
      setPhase('loading-models')
      const face = new FaceAnalyzer()
      await face.init()
      rt.current.face = face
      // 姿态模型 5.5MB + 持续推理，默认不加载；学生可在开始前勾选开启
      if (poseOn) await enablePose()
      setPhase('ready')
    } catch (err: any) {
      // T2: denied permission → guidance, session cannot start
      if (!window.isSecureContext) {
        setError('当前页面不是 https 或 localhost，浏览器已禁用摄像头/麦克风。请换用 https 或在本机 localhost 打开。')
      } else if (err?.name === 'NotAllowedError') {
        setError('摄像头/麦克风权限被拒绝。请点击地址栏左侧的锁形图标允许访问，然后重试。')
      } else if (/设备|摄像头|占用|权限|ssl|https/i.test(String(err.message))) {
        // media.ts 抛出的已是面向用户的中文说明（含多组参数失败原因）
        setError(String(err.message))
      } else if (/wasm|webassembly|simd|createFromOptions/i.test(String(err.message))) {
        setError(
          '当前浏览器无法运行人脸/姿态模型（需要支持 WebAssembly SIMD）。建议使用 Chrome 87+、Edge 88+、Firefox 78+ 或 Safari 15+。',
        )
      } else {
        setError(`无法访问摄像头或麦克风：${err.message}`)
      }
    }
  }

  const speakQuestion = (idx: number, fromFollowUp?: string) => {
    const r = rt.current
    if (!r.interviewer) return
    const text = fromFollowUp ?? questions[idx]?.text
    if (text) r.interviewer.speak(text)
  }

  const startSession = async () => {
    const r = rt.current
    if (!r.stream || !r.face) return
    await api(`/api/sessions/${id}/start`, { method: 'POST' })

    r.aggregator = new MetricsAggregator()
    r.nudges = new NudgeEngine()
    r.moodTracker = new MoodTracker()
    r.interviewer = new Interviewer()
    r.interviewer.enabled = ttsOn
    r.sender = new MetricsSender(metricsWsUrl(id!))
    r.sender.connect()
    r.questionOrder = 1

    r.audio = new AudioAnalyzer()
    r.audio.start(r.stream)

    setSpeechSupported(SpeechRecognizer.supported())
    if (SpeechRecognizer.supported()) {
      r.speech = new SpeechRecognizer()
      r.speech.onStatus = (msg) => setSpeechStatus(msg)
      r.speech.onEngine = (engine) => setSpeechEngine(engine)
      r.speech.onDelta = (delta) => {
        r.aggregator?.addSpeech(delta)
        r.audio?.tracker.addWords(delta.words, performance.now())
        // F1/F5: keep the answer text per question for coaching + follow-ups
        r.answerTexts[r.questionOrder] = `${r.answerTexts[r.questionOrder] ?? ''} ${delta.text}`.trim()
      }
      r.speech.start()
    }

    // Visual loop via rAF; analyze() itself gates on new video frames
    if (meshCanvasRef.current) r.mesh = new MeshOverlay(meshCanvasRef.current)
    const loop = () => {
      const video = videoRef.current
      if (video && r.face?.ready) {
        const signals = r.face.analyze(video, performance.now())
        if (signals) {
          r.latestFrame = signals
          r.aggregator?.addFrame(signals)
          r.eyeContactWindow.push(signals.eyeContact)
          if (r.eyeContactWindow.length > 90) r.eyeContactWindow.shift()
        }
        if (r.mesh) {
          if (meshOnRef.current) {
            r.mesh.draw(r.face.lastLandmarks, video.videoWidth || 640, video.videoHeight || 480)
          } else {
            r.mesh.clear()
          }
        }
      }
      if (video && r.pose?.ready) {
        r.posture = r.pose.analyze(video, performance.now())
      }
      r.rafId = requestAnimationFrame(loop)
    }
    r.rafId = requestAnimationFrame(loop)

    // Fast UI loop (4x/sec): instant expression + responsive meters, so
    // feedback lands while the moment is still happening
    r.fastId = window.setInterval(() => {
      const frame = r.latestFrame
      if (!frame || !r.audio) return
      setExpression(frame.instantExpression)
      // Framing guidance: persists >1s before showing, clears instantly
      setFramingMsg(
        framingTracker.current.update(
          framingFeedback(r.face?.lastLandmarks ?? null),
          performance.now(),
        ),
      )
      const eyePct = r.eyeContactWindow.length
        ? (r.eyeContactWindow.filter(Boolean).length / r.eyeContactWindow.length) * 100
        : 0
      setMeters({
        eyeContact: eyePct,
        tension: frame.tension,
        fidget: frame.fidget,
        wpm: Math.round(r.audio.tracker.wpm(performance.now())),
        volume: r.audio.tracker.avgVolume(),
        energy: r.audio.tracker.energy(),
        posture: r.posture,
      })
    }, 250)

    // 1s cadence: update meters, run nudges, stream summary (R3 meters >=1x/sec)
    r.flushId = window.setInterval(() => {
      if (!r.aggregator || !r.audio) return
      const now = performance.now()
      const summary = r.aggregator.flush(r.audio.tracker, now)

      // F1: tag the window with the active question
      summary.questionOrder = r.questionOrder
      // F3: attach the rolling posture score
      if (r.posture !== null) summary.movement.posture = Math.round(r.posture * 100) / 100

      // Mood + nervousness from the rolling window (attached to the
      // streamed summary so the report timeline can chart them)
      r.moodTracker?.add({
        eyeContact: summary.gaze.eyeContact,
        blink: summary.gaze.blink,
        tension: summary.expression.tension,
        fidget: summary.movement.fidget,
        smile: summary.expression.smile,
      })
      const currentMood = r.moodTracker?.mood()
      const nervousness = r.moodTracker?.nervousness() ?? 0
      if (currentMood) {
        summary.mood = {
          state: currentMood.mood,
          emoji: currentMood.emoji,
          nervousness: Math.round(nervousness * 100) / 100,
        }
        setMood(currentMood)
      }
      setNervousnessHistory((h) => [...h.slice(-179), nervousness])

      r.sender?.send(summary)

      const newNudge = r.nudges?.addSample({
        ts: now,
        eyeContact: summary.gaze.eyeContact,
        fidget: summary.movement.fidget,
        wpm: summary.voice.wpm,
        speaking: summary.voice.speaking,
        volume: summary.voice.volume,
        posture: r.posture ?? undefined,
      })
      if (newNudge) {
        setNudge(newNudge)
        setTimeout(() => setNudge(null), 5000)
      }
    }, 1000)

    setPhase('running')
    speakQuestion(0)
  }

  const nextQuestion = () => {
    const r = rt.current
    setFollowUp(null)
    setQuestionIdx((i) => {
      const next = Math.min(i + 1, questions.length - 1)
      r.questionOrder = questions[next]?.order ?? next + 1
      speakQuestion(next)
      return next
    })
  }

  const askFollowUp = async () => {
    const r = rt.current
    const question = followUp ?? questions[questionIdx]?.text
    if (!question) return
    setFollowUpBusy(true)
    try {
      const d = await api<{ followUp: string }>(`/api/sessions/${id}/followup`, {
        method: 'POST',
        body: { question, answerText: r.answerTexts[r.questionOrder] ?? '' },
      })
      setFollowUp(d.followUp)
      speakQuestion(questionIdx, d.followUp)
    } catch {
      // follow-ups are best-effort
    } finally {
      setFollowUpBusy(false)
    }
  }

  const toggleTts = () => {
    setTtsOn((on) => {
      const next = !on
      if (rt.current.interviewer) rt.current.interviewer.enabled = next
      if (!next) rt.current.interviewer?.stop()
      return next
    })
  }

  const cleanup = () => {
    const r = rt.current
    if (r.rafId) cancelAnimationFrame(r.rafId)
    if (r.flushId) clearInterval(r.flushId)
    if (r.fastId) clearInterval(r.fastId)
    r.interviewer?.stop()
    r.speech?.stop()
    r.audio?.stop()
    r.sender?.close()
    r.face?.close()
    r.pose?.close()
    r.stream?.getTracks().forEach((t) => t.stop())
  }

  useEffect(() => cleanup, [])

  const endSession = async () => {
    setPhase('ending')

    // 本地化改造：DELETE 录像上传。B 路线承诺「不录像、不上传音视频」，
    // 服务器只收每秒指标摘要与最终报告。
    cleanup()

    try {
      await api(`/api/sessions/${id}/end`, { method: 'POST' })
    } catch (err: any) {
      setError(err.message)
      return
    }

    navigate(`/session/${id}/report`)
  }

  const question = questions[questionIdx]

  return (
    <div className="container">
      {error && (
        <div className="card">
          <div className="error">{error}</div>
          {phase === 'permissions' && <button onClick={requestPermissions}>重试</button>}
        </div>
      )}

      <div className="session-grid">
        <div className="session-video">
          <div className={`video-wrap ${phase === 'running' ? 'scanning' : ''}`}>
            <video ref={videoRef} className="preview" muted playsInline />
            <canvas ref={meshCanvasRef} className="mesh-canvas" />
            {phase === 'running' && (
              <>
                <span className="scan-corner tl" />
                <span className="scan-corner tr" />
                <span className="scan-corner bl" />
                <span className="scan-corner br" />
                <div className="expression-chip" key={expression}>
                  {EXPRESSION_META[expression].label}
                </div>
                <button
                  className="mesh-toggle"
                  onClick={() => {
                    setMeshOn((on) => {
                      meshOnRef.current = !on
                      return !on
                    })
                  }}
                >
                  {meshOn ? '网格：开' : '网格：关'}
                </button>
                {framingMsg && <div className="framing-chip">{framingMsg}</div>}
              </>
            )}
          </div>

          {phase === 'permissions' && !error && (
            <div className="card">
              <p>
                这次练习需要摄像头与麦克风。所有分析都在你的浏览器本地完成，音视频不会上传。
              </p>
              <button onClick={requestPermissions}>启用摄像头与麦克风</button>
            </div>
          )}

          {phase === 'loading-models' && <MeshLoader />}

          {phase === 'ready' && (
            <div className="card">
              <p>
                本次共 {questions.length} 道题，逐题进行。请像真实面试一样出声回答，答完点「下一题」。
              </p>
              {cameraLabel && (
                <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                  当前采集：{cameraLabel}
                </p>
              )}
              {!SpeechRecognizer.supported() && (
                <p className="muted">
                  当前浏览器不支持实时转写 —— 报告将不含文字稿，其余信号照常工作。
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={startSession}>开始模拟面试</button>
                {Interviewer.supported() && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={ttsOn}
                      onChange={toggleTts}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    朗读题目（面试官语音）
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={poseOn}
                    onChange={async (e) => {
                      setPoseOn(e.target.checked)
                      if (e.target.checked) await enablePose()
                    }}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  姿态检测（额外占用 CPU）
                </label>
              </div>
            </div>
          )}

          {phase === 'ending' && <div className="card muted">正在生成报告…</div>}
        </div>

        <div className="session-side">
          {(phase === 'running' || phase === 'ending') && (
            <>
              <MoodBadge mood={mood} />
              <LiveChart title="紧张度" values={nervousnessHistory} />
              <Meters values={meters} />
            </>
          )}
        </div>

        {phase === 'running' && question && (
          <div className="session-question">
            <div className="card">
              <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  第 {questionIdx + 1} / {questions.length} 题
                </span>
                {Interviewer.supported() && (
                  <button
                    className="secondary"
                    style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={toggleTts}
                  >
                    {ttsOn ? '朗读：开' : '朗读：关'}
                  </button>
                )}
              </div>
              <div className="question-box">{question.text}</div>
              {followUp && (
                <div className="question-box" style={{ borderLeftColor: 'var(--warn)' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    追问：
                  </span>{' '}
                  {followUp}
                </div>
              )}
              <div className="session-actions">
                <button onClick={askFollowUp} disabled={followUpBusy} className="secondary">
                  {followUpBusy ? '思考中…' : '追问一句'}
                </button>
                {questionIdx < questions.length - 1 ? (
                  <button onClick={nextQuestion}>下一题</button>
                ) : (
                  <button onClick={endSession}>完成面试</button>
                )}
                <button className="danger" onClick={endSession}>
                  提前结束
                </button>
              </div>
              {!speechSupported ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  当前环境不支持语音转写，文字稿将为空（不影响其他指标）。
                </p>
              ) : (
                <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
                  转写引擎：{speechEngine === 'whisper' ? '本地 Whisper（离线）' : '本地模型不可用'}
                  {speechStatus ? ` · ${speechStatus}` : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {nudge && <div className="nudge">{nudge.message}</div>}
    </div>
  )
}
