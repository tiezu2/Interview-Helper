import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.js'

type Variant = 'student' | 'teacher'

const COPY = {
  student: {
    badge: '学生端',
    title: '学生登录',
    sub: '用学号登录：练习模拟面试、做分项训练、查看自己的进步与班级排名。',
    accountLabel: '学号',
    accountPlaceholder: '例：2024123456',
    submit: '登录',
    other: '我是老师',
    otherTo: '/teacher/login',
    registerHint: '还没有账号？',
    registerTo: '/register',
    registerText: '注册学生账号',
  },
  teacher: {
    badge: '教师端',
    title: '老师登录',
    sub: '用工号登录：创建班级、把加入码发给学生、查看全班分数与需要关注的学生。',
    accountLabel: '工号',
    accountPlaceholder: '例：T2024001',
    submit: '登录',
    other: '我是学生',
    otherTo: '/login',
    registerHint: '还没有账号？',
    registerTo: '/teacher/register',
    registerText: '注册教师账号',
  },
} as const

export function LoginPage({ variant }: { variant: Variant }) {
  const { login, guest } = useAuth()
  const navigate = useNavigate()
  const copy = COPY[variant]
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(account.trim(), password)
      navigate('/')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const startGuest = async () => {
    setBusy(true)
    setError('')
    try {
      await guest()
      navigate('/drills')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container narrow">
      <div className="card">
        <div className="auth-badge" style={{ background: variant === 'teacher' ? '#eef4ff' : '#ecfdf3', color: variant === 'teacher' ? 'var(--accent)' : 'var(--good)' }}>
          {copy.badge}
        </div>
        <h2 style={{ marginTop: 10 }}>{copy.title}</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.7 }}>
          {copy.sub}
        </p>

        <form onSubmit={submit}>
          <label>{copy.accountLabel}</label>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={copy.accountPlaceholder}
            autoComplete="username"
            required
          />
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '登录中…' : copy.submit}
          </button>
        </form>

        {variant === 'student' && (
          <>
            <div style={{ margin: '14px 0', textAlign: 'center' }} className="muted">
              — 或 —
            </div>
            <button onClick={startGuest} disabled={busy} className="secondary" style={{ width: '100%' }}>
              {busy ? '正在进入…' : '一键体验（免注册，直接开始训练）'}
            </button>
          </>
        )}

        <div style={{ marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {copy.registerHint.replace('？', '')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="secondary" onClick={() => navigate(copy.registerTo)}>
              {copy.registerText}
            </button>
            <button className="secondary" onClick={() => navigate(copy.otherTo)}>
              {copy.other} →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function RegisterPage({ variant }: { variant: Variant }) {
  const { register } = useAuth()
  const navigate = useNavigate()
  const copy = COPY[variant]
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await register(account.trim(), password, name, variant, email.trim())
      navigate(variant === 'teacher' ? '/teacher' : '/')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container narrow">
      <div className="card">
        <div className="auth-badge" style={{ background: variant === 'teacher' ? '#eef4ff' : '#ecfdf3', color: variant === 'teacher' ? 'var(--accent)' : 'var(--good)' }}>
          {copy.badge}
        </div>
        <h2 style={{ marginTop: 10 }}>{variant === 'teacher' ? '注册教师账号' : '注册学生账号'}</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.7 }}>
          {variant === 'teacher'
            ? '注册后可以创建班级、生成加入码，并查看全班学生的分数。'
            : '注册后用学号登录，练习记录与训练成绩会一直保存，方便看进步曲线。'}
        </p>

        <form onSubmit={submit}>
          <label>{copy.accountLabel}</label>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={copy.accountPlaceholder}
            minLength={4}
            maxLength={32}
            pattern="[A-Za-z0-9_\-]+"
            title="只能包含字母、数字、下划线和横线"
            autoComplete="username"
            required
          />
          <label>姓名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
          <label>密码（至少 8 位）</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
          <label>邮箱（可选，用于找回密码）</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可以不填" />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '正在创建…' : variant === 'teacher' ? '注册并进入班级后台' : '注册'}
          </button>
        </form>

        <div style={{ marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            已有账号
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              className="secondary"
              onClick={() => navigate(variant === 'teacher' ? '/teacher/login' : '/login')}
            >
              去登录
            </button>
            <button className="secondary" onClick={() => navigate(copy.otherTo)}>
              {copy.other} →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
