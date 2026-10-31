import type { MoodResult } from '../analysis/mood.js'

const MOOD_COLORS: Record<string, string> = {
  confident: 'var(--good)',
  positive: 'var(--good)',
  calm: 'var(--accent)',
  flat: 'var(--muted)',
  tense: 'var(--warn)',
  nervous: 'var(--bad)',
}

export default function MoodBadge({ mood }: { mood: MoodResult }) {
  const color = MOOD_COLORS[mood.mood] ?? 'var(--accent)'
  return (
    <div className="mood-badge" style={{ ['--mood-color' as any]: color }}>
      <span className="mood-dot" style={{ background: color }} aria-hidden="true" />
      <div>
        <div className="mood-label" style={{ color }}>
          {mood.label}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          当前状态判断
        </div>
      </div>
    </div>
  )
}
