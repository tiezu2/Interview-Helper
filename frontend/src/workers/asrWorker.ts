// 语音识别 Worker：把 whisper 推理移出主线程。
// 主线程只负责采集与显示，因此界面不再卡顿（推理在后台线程跑）。
import { pipeline, env } from '../vendor/transformers.min.js'

/* eslint-disable no-restricted-globals */
const ctx: any = self

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
env.backends.onnx.wasm.wasmPaths = '/models/ort-wasm/'
env.backends.onnx.wasm.numThreads = 1

let pipePromise: Promise<any> | null = null

ctx.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data

  if (msg?.type === 'warmup') {
    try {
      if (!pipePromise) {
        ctx.postMessage({ type: 'status', text: '正在加载本地语音模型（首次约 10—20 秒）…' })
        pipePromise = pipeline('automatic-speech-recognition', 'whisper-tiny', { quantized: true })
      }
      await pipePromise
      ctx.postMessage({ type: 'ready' })
    } catch (e: any) {
      pipePromise = null
      ctx.postMessage({ type: 'error', message: String(e?.message ?? e) })
    }
    return
  }

  if (msg?.type === 'transcribe') {
    const { id, audio } = msg
    try {
      if (!pipePromise) {
        ctx.postMessage({ type: 'status', text: '正在加载本地语音模型（首次约 10—20 秒）…' })
        pipePromise = pipeline('automatic-speech-recognition', 'whisper-tiny', { quantized: true })
      }
      const pipe = await pipePromise
      const out = await pipe(audio, { language: 'chinese', task: 'transcribe' })
      const text = String(out?.text ?? '').trim()
      ctx.postMessage({ type: 'result', id, text })
    } catch (e: any) {
      ctx.postMessage({ type: 'error', id, message: String(e?.message ?? e) })
    }
  }
}
