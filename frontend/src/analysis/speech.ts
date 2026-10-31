import { countFillers, countWords } from './fillers.js'
import { LocalWhisperASR, localModelAvailable, type AsrEngine } from './asr.js'

export interface SpeechDelta {
  text: string
  words: number
  fillers: number
}

export type SpeechStatus = (msg: string) => void
export type { AsrEngine }

// 只使用「本地 Whisper」一条链路。
// 浏览器内置的 SpeechRecognition（走 Google 服务）在国内不稳定，且会和
// 我们的音频分析抢麦克风、结果还会乱序，这里彻底移除；
// 本地模型缺失时明确提示“不可用”，不做静默降级。

let whisperProbe: Promise<boolean> | null = null

class WhisperEngine {
  private asr = new LocalWhisperASR()
  onDelta: ((delta: SpeechDelta) => void) | null = null
  onStatus: SpeechStatus | null = null

  start() {
    this.asr.onDelta = (d) => {
      this.onDelta?.({ text: d.text, words: countWords(d.text), fillers: countFillers(d.text) })
    }
    this.asr.onStatus = (m) => this.onStatus?.(m)
    this.asr.start().catch((e) => this.onStatus?.('本地语音识别启动失败：' + (e as Error).message))
  }

  stop() {
    this.asr.stop()
  }
}

export class SpeechRecognizer {
  onDelta: ((delta: SpeechDelta) => void) | null = null
  onStatus: SpeechStatus | null = null
  onEngine: ((engine: AsrEngine) => void) | null = null

  private engine: WhisperEngine | null = null

  // 只需要麦克风权限；模型是否存在由 detectEngine 判断
  static supported(): boolean {
    return LocalWhisperASR.supported()
  }

  static async detectEngine(): Promise<AsrEngine> {
    if (!whisperProbe) whisperProbe = localModelAvailable()
    return (await whisperProbe) ? 'whisper' : 'none'
  }

  async start() {
    const engineName = await SpeechRecognizer.detectEngine()
    this.onEngine?.(engineName)

    if (engineName !== 'whisper') {
      this.onStatus?.('本地语音识别模型不可用（/models/whisper-tiny 缺失），文字稿将为空')
      return
    }

    this.onStatus?.('本地语音识别（离线）')
    const e = new WhisperEngine()
    e.onStatus = (m) => this.onStatus?.(m)
    e.onDelta = (d) => this.onDelta?.(d)
    this.engine = e
    e.start()
  }

  stop() {
    this.engine?.stop()
    this.engine = null
  }
}
