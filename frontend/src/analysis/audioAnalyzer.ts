import { VoiceTracker } from './voiceMetrics.js'

// Web Audio wrapper (R4): samples the mic ~10x/sec and feeds VoiceTracker.
export class AudioAnalyzer {
  readonly tracker = new VoiceTracker()
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buffer: Float32Array<ArrayBuffer> | null = null
  private timer: number | null = null

  start(stream: MediaStream) {
    this.ctx = new AudioContext()
    const source = this.ctx.createMediaStreamSource(stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    source.connect(this.analyser)
    this.buffer = new Float32Array(this.analyser.fftSize)

    this.timer = window.setInterval(() => {
      if (!this.analyser || !this.buffer || !this.ctx) return
      this.analyser.getFloatTimeDomainData(this.buffer)
      this.tracker.update(this.buffer, this.ctx.sampleRate, performance.now())
    }, 100)
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer)
    this.ctx?.close()
    this.ctx = null
    this.analyser = null
  }
}
