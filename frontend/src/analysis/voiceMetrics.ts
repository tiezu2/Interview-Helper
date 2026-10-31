// Voice metrics from raw Web Audio time-domain samples: volume (RMS),
// pitch (autocorrelation), speaking/pause detection, and WPM from the
// live transcript word stream.

export function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

// Autocorrelation pitch detection; returns Hz or null when unvoiced.
export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  const volume = rms(samples)
  if (volume < 0.01) return null

  const minHz = 70
  const maxHz = 400
  const minLag = Math.floor(sampleRate / maxHz)
  const maxLag = Math.floor(sampleRate / minHz)

  let bestLag = -1
  let bestCorr = 0
  for (let lag = minLag; lag <= maxLag && lag < samples.length / 2; lag++) {
    let corr = 0
    for (let i = 0; i < samples.length - lag; i++) {
      corr += samples[i] * samples[i + lag]
    }
    corr /= samples.length - lag
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }
  if (bestLag === -1 || bestCorr < 0.001) return null
  return sampleRate / bestLag
}

// Tracks pitch variation (coefficient of variation) and pause patterns
// over a rolling window.
export class VoiceTracker {
  private pitches: number[] = []
  private volumes: number[] = []
  private wordTimestamps: number[] = []
  private silentMs = 0
  private lastUpdate: number | null = null

  update(samples: Float32Array, sampleRate: number, nowMs: number) {
    const volume = rms(samples)
    this.volumes.push(volume)
    if (this.volumes.length > 100) this.volumes.shift()

    const pitch = detectPitch(samples, sampleRate)
    if (pitch !== null) {
      this.pitches.push(pitch)
      if (this.pitches.length > 100) this.pitches.shift()
    }

    if (this.lastUpdate !== null) {
      const dt = nowMs - this.lastUpdate
      this.silentMs = volume < 0.01 ? this.silentMs + dt : 0
    }
    this.lastUpdate = nowMs
  }

  addWords(count: number, nowMs: number) {
    for (let i = 0; i < count; i++) this.wordTimestamps.push(nowMs)
    // keep last 60s of words
    const cutoff = nowMs - 60_000
    while (this.wordTimestamps.length && this.wordTimestamps[0] < cutoff) {
      this.wordTimestamps.shift()
    }
  }

  // Words per minute over the last 60s of speech
  wpm(nowMs: number): number {
    if (this.wordTimestamps.length < 2) return 0
    const spanMs = Math.max(nowMs - this.wordTimestamps[0], 5000)
    return (this.wordTimestamps.length / spanMs) * 60_000
  }

  // Coefficient of variation of pitch — higher = more expressive
  pitchVariation(): number {
    if (this.pitches.length < 5) return 0
    const mean = this.pitches.reduce((a, b) => a + b, 0) / this.pitches.length
    if (mean === 0) return 0
    const variance = this.pitches.reduce((a, b) => a + (b - mean) ** 2, 0) / this.pitches.length
    return Math.sqrt(variance) / mean
  }

  avgVolume(): number {
    if (!this.volumes.length) return 0
    return this.volumes.reduce((a, b) => a + b, 0) / this.volumes.length
  }

  // Volume dynamics while speaking: coefficient of variation of recent
  // above-threshold volumes. Flat delivery ≈ 0, lively delivery > 0.3.
  volumeDynamics(): number {
    const speaking = this.volumes.filter((v) => v >= 0.01)
    if (speaking.length < 5) return 0
    const mean = speaking.reduce((a, b) => a + b, 0) / speaking.length
    if (mean === 0) return 0
    const std = Math.sqrt(speaking.reduce((a, b) => a + (b - mean) ** 2, 0) / speaking.length)
    return std / mean
  }

  // Energy composite 0-1 (F4): pitch expressiveness + volume dynamics.
  // Mirrors the report-side formula in backend scores.ts.
  energy(): number {
    const pitchScore = Math.min(1, this.pitchVariation() * 2)
    const volScore = Math.min(1, this.volumeDynamics() * 2)
    return Math.max(0, Math.min(1, pitchScore * 0.6 + volScore * 0.4))
  }

  isSpeaking(): boolean {
    return this.volumes.length > 0 && this.volumes[this.volumes.length - 1] >= 0.01
  }

  currentPauseMs(): number {
    return this.silentMs
  }
}
