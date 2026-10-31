// 在 Node 里跑 whisper-tiny，验证「服务端语音识别」是否可行（速度 + 中文效果）
import path from 'node:path'
import fs from 'node:fs'

const MODEL_ROOT = path.resolve('../frontend/public/models')
const WAV = process.argv[2] || 'E:/Desktop/人工智能/测试素材/朗读-含口头禅-正常语速.wav'

function readWav(file) {
  const buf = fs.readFileSync(file)
  // 解析 RIFF 头
  let off = 12
  let fmt = null
  let data = null
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      }
    } else if (id === 'data') {
      data = buf.subarray(off + 8, off + 8 + size)
    }
    off += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('WAV 解析失败')
  const n = data.length / 2
  const pcm = new Float32Array(n)
  for (let i = 0; i < n; i++) pcm[i] = data.readInt16LE(i * 2) / 32768
  // 简单线性重采样到 16k
  const target = 16000
  if (fmt.sampleRate === target) return { pcm, sampleRate: fmt.sampleRate }
  const ratio = fmt.sampleRate / target
  const out = new Float32Array(Math.floor(n / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, n - 1)
    const frac = pos - i0
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac
  }
  return { pcm: out, sampleRate: target, originalRate: fmt.sampleRate }
}

const { pipeline, env } = await import('@xenova/transformers')
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = MODEL_ROOT
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1

console.log('模型目录:', MODEL_ROOT)
console.log('音频:', WAV)

const t0 = Date.now()
const pipe = await pipeline('automatic-speech-recognition', 'whisper-tiny', { quantized: true })
const t1 = Date.now()
console.log(`加载模型耗时: ${((t1 - t0) / 1000).toFixed(1)}s`)

const { pcm, sampleRate, originalRate } = readWav(WAV)
console.log(`音频: ${(pcm.length / sampleRate).toFixed(1)}s, 采样率 ${originalRate ?? sampleRate} → ${sampleRate}`)

const t2 = Date.now()
const out = await pipe(pcm, { language: 'chinese', task: 'transcribe' })
const t3 = Date.now()
console.log(`识别耗时: ${((t3 - t2) / 1000).toFixed(2)}s  (实时率 ${((t3 - t2) / 1000 / (pcm.length / sampleRate)).toFixed(2)}x)`)
console.log('识别结果:')
console.log('  ' + (out?.text ?? '(空)').trim())
