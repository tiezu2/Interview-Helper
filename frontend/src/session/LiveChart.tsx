// Scrolling line chart for a live 0-1 signal — 扁平折线，无发光/无渐变/无动画。
// 纯 SVG，无图表依赖，风格对齐 antd 后台。

const W = 300
const H = 90
const WINDOW = 90 // seconds shown

export default function LiveChart({
  title,
  values,
  color = '#ff4d4f',
}: {
  title: string
  values: number[]
  color?: string
}) {
  const shown = values.slice(-WINDOW)
  const current = shown.length ? shown[shown.length - 1] : 0
  const pct = Math.round(current * 100)

  const points = shown.map((v, i) => {
    const x = shown.length > 1 ? (i / (WINDOW - 1)) * W : 0
    const y = H - v * (H - 8) - 4
    return [x, y] as const
  })
  const line = points.map(([x, y]) => `${x},${y}`).join(' ')
  const lastX = points.length ? points[points.length - 1][0] : 0
  const area = points.length ? `${line} ${lastX},${H} 0,${H}` : ''

  const level = pct >= 66 ? '偏高' : pct >= 33 ? '略高' : '平稳'

  return (
    <div className="live-chart">
      <div className="live-chart-head">
        <span>{title}</span>
        <span className="live-chart-value" style={{ color }}>
          {pct}
          <span className="live-chart-unit">% · {level}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            x2={W}
            y1={H - g * (H - 8) - 4}
            y2={H - g * (H - 8) - 4}
            stroke="#f0f0f0"
            strokeWidth="1"
          />
        ))}
        {area && <polygon points={area} fill={color} fillOpacity="0.06" />}
        {points.length > 1 && (
          <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        )}
        {points.length > 0 && (
          <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="2.5" fill={color} />
        )}
      </svg>
      <div className="live-chart-foot muted">最近 {WINDOW} 秒</div>
    </div>
  )
}
