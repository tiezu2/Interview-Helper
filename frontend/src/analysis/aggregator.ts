import type { FrameSignals } from './faceAnalyzer.js'
import type { VoiceTracker } from './voiceMetrics.js'

export interface WindowSummary {
  expression: { tension: number; smile: number }
  gaze: { eyeContact: boolean; blink: boolean }
  movement: { fidget: number; posture?: number }
  voice: { wpm: number; pitchVar: number; volume: number; speaking: boolean; energy: number }
  speech: { fillers: number; words: number }
  // filled in by the live session after MoodTracker/PoseAnalyzer run
  mood?: { state: string; emoji: string; nervousness: number }
  questionOrder?: number
  transcriptDelta: string
}

// Collects per-frame visual signals + voice/speech state into the
// 1-second summaries streamed to the server (metric_windows rows).
export class MetricsAggregator {
  private frames: FrameSignals[] = []
  private fillers = 0
  private words = 0
  private transcriptParts: string[] = []

  addFrame(signals: FrameSignals) {
    this.frames.push(signals)
  }

  addSpeech(delta: { text: string; words: number; fillers: number }) {
    this.fillers += delta.fillers
    this.words += delta.words
    this.transcriptParts.push(delta.text)
  }

  // Called once per second: summarize and reset
  flush(voice: VoiceTracker, nowMs: number): WindowSummary {
    const n = Math.max(this.frames.length, 1)
    const avgTension = this.frames.reduce((a, f) => a + f.tension, 0) / n
    const avgSmile = this.frames.reduce((a, f) => a + f.smile, 0) / n
    const avgFidget = this.frames.reduce((a, f) => a + f.fidget, 0) / n
    const eyeContactMajority =
      this.frames.filter((f) => f.eyeContact).length > this.frames.length / 2
    const blinked = this.frames.some((f) => f.blink)

    const summary: WindowSummary = {
      expression: { tension: round2(avgTension), smile: round2(avgSmile) },
      gaze: { eyeContact: eyeContactMajority, blink: blinked },
      movement: { fidget: round2(avgFidget) },
      voice: {
        wpm: Math.round(voice.wpm(nowMs)),
        pitchVar: round2(voice.pitchVariation()),
        volume: round2(voice.avgVolume()),
        speaking: voice.isSpeaking(),
        energy: round2(voice.energy()),
      },
      speech: { fillers: this.fillers, words: this.words },
      transcriptDelta: this.transcriptParts.join(' '),
    }

    this.frames = []
    this.fillers = 0
    this.words = 0
    this.transcriptParts = []
    return summary
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

// Buffered WebSocket sender: metrics survive brief network drops
// (reliability NFR) by queueing until the socket reopens.
export class MetricsSender {
  private ws: WebSocket | null = null
  private queue: string[] = []
  private closed = false

  constructor(private url: string) {}

  connect() {
    if (this.closed) return
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => {
      while (this.queue.length && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(this.queue.shift()!)
      }
    }
    this.ws.onclose = () => {
      this.ws = null
      if (!this.closed) setTimeout(() => this.connect(), 1000)
    }
  }

  send(summary: WindowSummary) {
    const frame = JSON.stringify({ type: 'metrics', ts: Date.now(), signals: summary })
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame)
    } else {
      this.queue.push(frame)
      if (this.queue.length > 600) this.queue.shift() // cap at ~10 min
    }
  }

  close() {
    this.closed = true
    this.ws?.close()
  }
}
