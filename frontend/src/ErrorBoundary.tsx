import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// 出错的页面不应该让整个应用白屏：给一个可读的兜底页 + 一键恢复。
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[UI] 页面渲染出错', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="container narrow" style={{ paddingTop: 48 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>这个页面出错了</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
            不影响你的练习记录与账号数据。可以先回到首页继续，或者刷新页面再试一次。
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => {
                window.location.href = '/'
              }}
            >
              回到首页
            </button>
            <button className="secondary" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
          <details style={{ marginTop: 16 }}>
            <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
              查看错误详情（反馈问题时可复制）
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                background: '#fafafa',
                border: '1px solid var(--line)',
                borderRadius: 6,
                fontSize: 12,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
