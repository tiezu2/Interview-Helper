// Model-loading screen: a low-poly wireframe head that draws itself in,
// scanning frame corners, rotating calibration ring — amber HUD style.

// Symmetric low-poly head: vertices defined for the left half + center,
// mirrored around x=100 (viewBox 200x240).
const HALF: [number, number][] = [
  [100, 8], // 0 crown
  [64, 22], // 1 upper skull
  [40, 62], // 2 temple
  [32, 108], // 3 cheekbone
  [40, 156], // 4 jaw upper
  [58, 192], // 5 jaw lower
  [80, 214], // 6 chin side
  [100, 222], // 7 chin center
  [66, 84], // 8 brow outer
  [100, 78], // 9 brow center
  [64, 104], // 10 eye outer
  [84, 104], // 11 eye inner
  [100, 98], // 12 nose bridge
  [100, 140], // 13 nose tip
  [84, 148], // 14 nostril
  [76, 178], // 15 mouth corner
  [100, 170], // 16 lip top
  [100, 188], // 17 lip bottom
]

function mirror([x, y]: [number, number]): [number, number] {
  return [200 - x, y]
}

// Vertex table: 0-17 left/center, 18-35 mirrored (center points duplicate harmlessly)
const V: [number, number][] = [...HALF, ...HALF.map(mirror)]
const M = (i: number) => (i < HALF.length ? i + HALF.length : i)

// Edges on the left half + center seam; mirrored automatically
const LEFT_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], // outline
  [1, 9], [2, 8], [8, 9], [3, 10], [8, 10], [8, 11], [9, 12], [11, 12], // brow/eye
  [10, 11], [3, 14], [12, 13], [13, 14], [14, 15], [4, 15], [13, 16], // nose/cheek
  [15, 16], [15, 17], [16, 17], [17, 7], [5, 15], [6, 17], [11, 13], [2, 9], [10, 14],
]

const EDGES: [number, number][] = [
  ...LEFT_EDGES,
  ...LEFT_EDGES.map(([a, b]): [number, number] => [M(a), M(b)]),
]

export default function MeshLoader({ label = 'Calibrating facial mesh' }: { label?: string }) {
  return (
    <div className="mesh-loader">
      <div className="mesh-loader-stage">
        <span className="scan-corner tl" />
        <span className="scan-corner tr" />
        <span className="scan-corner bl" />
        <span className="scan-corner br" />
        <svg className="mesh-loader-ring" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="28 12" strokeLinecap="round" />
        </svg>
        <svg viewBox="0 0 200 240" className="mesh-loader-head">
          {EDGES.map(([a, b], i) => (
            <line
              key={i}
              x1={V[a][0]}
              y1={V[a][1]}
              x2={V[b][0]}
              y2={V[b][1]}
              className="mesh-loader-line"
              style={{ animationDelay: `${(i % LEFT_EDGES.length) * 55}ms` }}
            />
          ))}
          {V.map(([x, y], i) => (
            <circle
              key={`v${i}`}
              cx={x}
              cy={y}
              r="1.6"
              className="mesh-loader-vertex"
              style={{ animationDelay: `${(i % HALF.length) * 90}ms` }}
            />
          ))}
        </svg>
        <div className="mesh-loader-scanline" />
      </div>
      <div className="mesh-loader-label">
        {label.toUpperCase()}
        <span className="mesh-loader-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </div>
      <div className="mesh-loader-sub">首次访问会下载模型，之后从浏览器缓存加载</div>
    </div>
  )
}
