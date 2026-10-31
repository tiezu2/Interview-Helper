import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

const ROLES = ['软件开发（后端/前端）', '软件测试', '实施运维', '数据分析', '产品/运营', '其他']

export default function SessionSetup() {
  const navigate = useNavigate()
  const [roleField, setRoleField] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const d = await api<{ session: { id: string } }>('/api/sessions', {
        method: 'POST',
        body: { roleField, consent: consent as true },
      })
      navigate(`/session/${d.session.id}`)
    } catch (err: any) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="container narrow">
      <div className="card">
        <h2>模拟面试</h2>
        <p className="muted">
          一场由 AI 主持的模拟面试。摄像头与麦克风的数据在你的浏览器内实时分析，
          只把「每秒指标摘要」传给服务器用于生成报告。
        </p>
        <form onSubmit={start}>
          <label>你要练习的岗位方向？</label>
          <input
            value={roleField}
            onChange={(e) => setRoleField(e.target.value)}
            placeholder="例：软件开发（后端/前端）、软件测试、实施运维"
            list="role-options"
            required
            minLength={2}
          />
          <datalist id="role-options">
            {ROLES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>

          <div className="consent-box">
            <strong>开始前请了解</strong>
            <ul>
              <li>
                摄像头与麦克风的数据<strong>全程在本机浏览器内分析</strong>（表情、眼神接触、动作、
                声音、语言），不会上传音视频。
              </li>
              <li>
                本次练习<strong>不录像、不存档音视频</strong>；服务器只保存每秒的指标摘要与最终报告。
              </li>
              <li>
                这是<strong>训练，不是评判</strong>：报告只针对表达给出可改进的建议，不做任何录用判断、
                也不评价你的诚实与否。
              </li>
            </ul>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.5 }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ width: 'auto', margin: 0 }}
              />
              我已了解上述说明，同意在本机进行实时分析。
            </label>
          </div>

          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={!consent || busy}>
            {busy ? '正在准备题目…' : '开始模拟面试'}
          </button>
        </form>
      </div>
    </div>
  )
}
