export interface LiveMeterValues {
  eyeContact: number // rolling % 0-100
  tension: number // 0-1
  fidget: number // 0-1
  wpm: number
  volume: number // 0-1-ish rms
  energy: number // 0-1 composite (F4)
  posture: number | null // 0-1, null until pose model detects (F3)
}

function color(value: number, invert = false) {
  const v = invert ? 1 - value : value
  if (v >= 0.66) return 'var(--good)'
  if (v >= 0.33) return 'var(--warn)'
  return 'var(--bad)'
}

function Meter({
  name,
  display,
  fraction,
  invert = false,
}: {
  name: string
  display: string
  fraction: number
  invert?: boolean
}) {
  const clamped = Math.max(0, Math.min(1, fraction))
  return (
    <div className="meter">
      <div className="label">
        <span>{name}</span>
        <span>{display}</span>
      </div>
      <div className="bar">
        <div
          className="fill"
          style={{ width: `${clamped * 100}%`, background: color(clamped, invert) }}
        />
      </div>
    </div>
  )
}

export default function Meters({ values }: { values: LiveMeterValues }) {
  // WPM meter: 135 is ideal center; map 60-210 onto 0-1 closeness
  const paceCloseness =
    values.wpm === 0 ? 0.5 : Math.max(0, 1 - Math.abs(values.wpm - 135) / 75)
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>实时信号</h3>
      <Meter
        name="眼神接触"
        display={`${Math.round(values.eyeContact)}%`}
        fraction={values.eyeContact / 100}
      />
      <Meter
        name="紧张度"
        display={values.tension < 0.33 ? '放松' : values.tension < 0.66 ? '有点紧张' : '很紧张'}
        fraction={1 - values.tension}
      />
      <Meter
        name="稳定度"
        display={values.fidget < 0.33 ? '很稳' : values.fidget < 0.66 ? '有些动作' : '小动作偏多'}
        fraction={1 - values.fidget}
      />
      <Meter
        name="语速"
        display={values.wpm > 0 ? `${Math.round(values.wpm)} 字/分` : '倾听中…'}
        fraction={paceCloseness}
      />
      <Meter
        name="音量"
        display={values.volume < 0.01 ? '偏小' : values.volume < 0.05 ? '合适' : '响亮'}
        fraction={Math.min(1, values.volume * 12)}
      />
      <Meter
        name="声音表现力"
        display={values.energy < 0.25 ? '单调' : values.energy < 0.55 ? '平稳' : '有起伏'}
        fraction={values.energy}
      />
      {values.posture !== null && (
        <Meter
          name="姿态"
          display={values.posture >= 0.66 ? '端正' : values.posture >= 0.4 ? '一般' : '含胸'}
          fraction={values.posture}
        />
      )}
    </div>
  )
}
