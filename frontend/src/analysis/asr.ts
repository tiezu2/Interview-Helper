// 语音识别：采集在主线程，**推理放到 Web Worker**。
//
// 为什么这么改：whisper 推理即使跑 WASM 也吃满 CPU，放主线程会直接卡住界面
// （按钮点不动、滚动掉帧）。移到 Worker 后界面保持流畅，代价是文字延迟 2—4 秒。
//
// 关于「放到云端」：Node 侧要用 @xenova/transformers 必须带 onnxruntime-node + sharp，
// 当前环境 sharp 的原生二进制拉不下来（构建脚本被禁用且下载失败），服务端跑不起来，
// 所以先落地 Worker 方案；将来有云端 ASR（讯飞/阿里云/Whisper API）或带 GPU 的服务器时，
// 只需要替换本文件里的 transcribe 实现，上层组件无需改动。

export interface SpeechDelta {
  text: string
  words: number
  fillers: number
}

export type AsrEngine = 'whisper' | 'none'

const SAMPLE_RATE = 16000
const CHUNK_SECONDS = 4
const OVERLAP_SECONDS = 0.6
const MODEL_PROBE = '/models/whisper-tiny/config.json'

let workerInstance: Worker | null = null
let warmupPromise: Promise<void> | null = null
let probeCache: Promise<boolean> | null = null

export async function localModelAvailable(): Promise<boolean> {
  if (!probeCache) {
    probeCache = fetch(MODEL_PROBE, { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false)
  }
  return probeCache
}

function createWorker(onStatus?: (m: string) => void): Worker {
  let w: Worker
  try {
    w = new Worker(new URL('../workers/asrWorker.ts', import.meta.url), { type: 'module' })
  } catch (e) {
    // 老版 Firefox（<114）不支持 module worker
    throw new Error('当前浏览器不支持 module worker，请升级浏览器（Firefox ≥ 114 / Safari ≥ 15 / Chrome ≥ 80）')
  }
  w.onmessage = (ev: MessageEvent) => {
    const msg = ev.data
    if (msg?.type === 'status') onStatus?.(msg.text)
  }
  return w
}

function getWorker(onStatus?: (m: string) => void): Worker {
  if (!workerInstance) workerInstance = createWorker(onStatus)
  return workerInstance
}

// 预加载模型（进入页面时先调用，避免开始说话时干等）
export function warmupWhisper(onStatus?: (m: string) => void): Promise<void> {
  if (warmupPromise) return warmupPromise
  warmupPromise = new Promise<void>((resolve, reject) => {
    const w = getWorker(onStatus)
    const handler = (ev: MessageEvent) => {
      const msg = ev.data
      if (msg?.type === 'ready') {
        w.removeEventListener('message', handler)
        resolve()
      } else if (msg?.type === 'error') {
        w.removeEventListener('message', handler)
        warmupPromise = null
        reject(new Error(msg.message))
      } else if (msg?.type === 'status') {
        onStatus?.(msg.text)
      }
    }
    w.addEventListener('message', handler)
    w.postMessage({ type: 'warmup' })
  })
  return warmupPromise
}

export class LocalWhisperASR {
  onDelta: ((delta: SpeechDelta) => void) | null = null
  onStatus: ((msg: string) => void) | null = null

  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private buffer: Float32Array = new Float32Array(0)
  private busy = false
  private stopped = true
  private seq = 0
  private pending = new Map<number, (text: string) => void>()
  private prefix = ''
  private inputRate = SAMPLE_RATE

  static supported() {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  async start() {
    this.stopped = false
    this.buffer = new Float32Array(0)
    this.prefix = ''

    const w = getWorker((m) => this.onStatus?.(m))
    w.onmessage = (ev: MessageEvent) => {
      const msg = ev.data
      if (msg?.type === 'status') this.onStatus?.(msg.text)
      else if (msg?.type === 'ready') this.onStatus?.('本地语音模型已就绪（后台线程）')
      else if (msg?.type === 'result') {
        const cb = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        cb?.(msg.text)
      } else if (msg?.type === 'error') {
        const cb = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        console.error('[ASR] 识别失败', msg.message)
        this.onStatus?.('识别出错：' + msg.message)
        cb?.('')
      }
    }

    try {
      await warmupWhisper((m) => this.onStatus?.(m))
    } catch (e: any) {
      this.onStatus?.('本地语音识别启动失败：' + (e as Error).message)
    }
    if (this.stopped) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    this.stream = stream

    // Safari 老版本只有 webkitAudioContext；且部分浏览器会忽略 sampleRate 选项，
    // 实际采样率可能是 44.1k/48k，需要在发送前重采样到 16k（whisper 要求）。
    const Ctor: any =
      (window as any).AudioContext ?? (window as any).webkitAudioContext
    const ctx: AudioContext = Ctor ? new Ctor({ sampleRate: SAMPLE_RATE }) : (null as any)
    if (!ctx) throw new Error('当前浏览器不支持 AudioContext，无法录音')
    this.ctx = ctx
    this.inputRate = ctx.sampleRate || SAMPLE_RATE
    await ctx.resume()

    const source = ctx.createMediaStreamSource(stream)
    this.source = source
    const node = ctx.createScriptProcessor(4096, 1, 1)
    this.node = node

    node.onaudioprocess = (ev) => {
      if (this.stopped) return
      const input = ev.inputBuffer.getChannelData(0)
      const merged = new Float32Array(this.buffer.length + input.length)
      merged.set(this.buffer, 0)
      merged.set(input, this.buffer.length)
      this.buffer = merged
      this.maybeTranscribe(w)
    }

    source.connect(node)
    node.connect(ctx.destination)
    this.onStatus?.('正在录音，后台识别中…')
  }

  private maybeTranscribe(w: Worker) {
    if (this.busy || this.stopped) return
    const need = CHUNK_SECONDS * this.inputRate
    if (this.buffer.length < need) return

    this.busy = true
    const take = Math.min(
      this.buffer.length,
      Math.floor((CHUNK_SECONDS + OVERLAP_SECONDS) * this.inputRate),
    )
    const raw = this.buffer.slice(this.buffer.length - take)
    // 统一成 16k 单声道给 whisper
    const slice = this.inputRate === SAMPLE_RATE ? raw : resampleLinear(raw, this.inputRate, SAMPLE_RATE)
    const id = ++this.seq

    this.pending.set(id, (text) => {
      const fresh = this.dedupe(text)
      if (fresh) this.onDelta?.({ text: fresh, words: 0, fillers: 0 })
      const keep = Math.floor(OVERLAP_SECONDS * SAMPLE_RATE)
      this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - keep))
      this.busy = false
    })

    w.postMessage({ type: 'transcribe', id, audio: slice }, [slice.buffer])
  }

  private dedupe(text: string): string {
    const prev = this.prefix
    if (!text) return ''
    if (!prev) {
      this.prefix = text
      return text
    }
    const max = Math.min(prev.length, text.length, 12)
    let overlap = 0
    for (let n = max; n > 0; n--) {
      if (prev.endsWith(text.slice(0, n))) {
        overlap = n
        break
      }
    }
    const fresh = text.slice(overlap).trim()
    if (fresh) this.prefix = (prev + fresh).slice(-80)
    return fresh
  }

  stop() {
    this.stopped = true
    try {
      this.node?.disconnect()
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.node = null
    this.source = null
    this.stream = null
    this.ctx = null
    this.pending.clear()
    this.busy = false
  }

  static disposeWorker() {
    workerInstance?.terminate()
    workerInstance = null
    warmupPromise = null
  }
}

// 线性重采样：把任意采样率转成 16k（whisper 要求）
export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}
