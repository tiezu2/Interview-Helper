import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.js'
import SessionSetup from './session/SessionSetup.js'

// 路由级分包：只有真正进入某个页面时才加载它的代码（首屏更小更快）
const LoginPage = lazy(() => import('./auth/AuthPage.js').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('./auth/AuthPage.js').then((m) => ({ default: m.RegisterPage })))
const LiveSession = lazy(() => import('./session/LiveSession.js'))
const TrainingHome = lazy(() => import('./training/TrainingHome.js'))
const GazeDrill = lazy(() => import('./training/GazeDrill.js'))
const PaceDrill = lazy(() => import('./training/PaceDrill.js'))
const FillerDrill = lazy(() => import('./training/FillerDrill.js'))
const PostureDrill = lazy(() => import('./training/PostureDrill.js'))
const IntroDrill = lazy(() => import('./training/IntroDrill.js'))
const ReportPage = lazy(() => import('./report/ReportPage.js'))
const SessionHistory = lazy(() => import('./report/SessionHistory.js'))
const ProgressPage = lazy(() => import('./report/ProgressPage.js'))
const TeacherHome = lazy(() => import('./classes/TeacherHome.js'))
const ClassRoom = lazy(() => import('./classes/ClassRoom.js'))
const StudentDetailPage = lazy(() => import('./classes/StudentDetail.js'))
const TeacherBoard = lazy(() => import('./classes/TeacherBoard.js'))
const MyClass = lazy(() => import('./classes/MyClass.js'))

function PageFallback() {
  return (
    <div className="container muted" style={{ padding: '40px 20px' }}>
      加载中…
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = {
  teacher: '老师',
  student: '学生',
  admin: '管理员',
  assessor: '老师',
  candidate: '学生',
}


const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']


// 非安全上下文（http + 非 localhost）时浏览器会禁用摄像头/麦克风，必须提前告知
function CompatBanner() {
  if (typeof window === 'undefined') return null
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(window.location.hostname)
  if (window.isSecureContext || isLocal) return null
  return (
    <div className="compat-banner">
      当前页面通过 <strong>http</strong> 访问（非 https），浏览器会禁用摄像头与麦克风，面试与训练功能无法使用。
      请改用 <strong>https</strong> 访问，或在本机用 <strong>localhost</strong> 打开。
    </div>
  )
}

function Hero() {
  const { user, isTeacher } = useAuth()
  const now = new Date()
  const dateText = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${
    WEEKDAYS[now.getDay()]
  }`
  return (
    <div className="hero">
      <div className="hero-title">大连东软信息学院 · 学生表达训练平台</div>
      <div className="hero-sub">
        {dateText}
        {user && (
          <>
            {' · '}
            {isTeacher ? '教师端' : '学生端'} · {user.name}
            {user.studentNo ? `（${user.studentNo}）` : ''}
          </>
        )}
      </div>
    </div>
  )
}

function Nav() {
  const { user, logout, isTeacher } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // 手机端：链接收进抽屉，避免一行放不下时溢出压住下面的蓝色横幅
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <nav className={`nav${menuOpen ? ' nav-open' : ''}`}>
      <div className="nav-inner">
        <Link to="/" className="brand">
          面试镜 · 表达训练
        </Link>
        <button
          type="button"
          className="nav-toggle"
          aria-label={menuOpen ? '收起菜单' : '展开菜单'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="nav-links">
          {isTeacher && <NavLink to="/teacher" end>班级管理</NavLink>}
          {isTeacher && <NavLink to="/teacher/board">班级看板</NavLink>}
          {user && !isTeacher && <NavLink to="/drills">训练中心</NavLink>}
          {user && !isTeacher && <NavLink to="/classes" end>我的班级</NavLink>}
          {user && !isTeacher && <NavLink to="/progress" end>进步</NavLink>}
          {user && !isTeacher && <NavLink to="/history" end>历史</NavLink>}
        </div>
        <div className="nav-user">
          {user ? (
            <>
              <span className="muted nav-me">
                {user.name} <span className="badge">{ROLE_LABEL[user.role] ?? user.role}</span>
              </span>
              <button
                className="secondary"
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
              >
                退出登录
              </button>
            </>
          ) : (
            <>
              <Link to="/login">学生登录</Link>
              <Link to="/teacher/login">老师登录</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="container muted">加载中…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequireTeacher({ children }: { children: React.ReactElement }) {
  const { user, loading, isTeacher } = useAuth()
  if (loading) return <div className="container muted">加载中…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!isTeacher) return <Navigate to="/" replace />
  return children
}

// 首页分流：老师登录后直接进班级后台，不再看到「模拟面试」设置页。
function Home() {
  const { user, loading, isTeacher } = useAuth()
  if (loading) return <div className="container muted">加载中…</div>
  if (!user) return <Navigate to="/login" replace />
  if (isTeacher) return <Navigate to="/teacher" replace />
  return <SessionSetup />
}

export default function App() {
  return (
    <>
      <Nav />
      <CompatBanner />
      <Hero />
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage variant="student" />} />
        <Route path="/register" element={<RegisterPage variant="student" />} />
        <Route path="/teacher/login" element={<LoginPage variant="teacher" />} />
        <Route path="/teacher/register" element={<RegisterPage variant="teacher" />} />
        <Route path="/" element={<Home />} />
        <Route
          path="/session/:id"
          element={
            <RequireAuth>
              <LiveSession />
            </RequireAuth>
          }
        />
        <Route
          path="/session/:id/report"
          element={
            <RequireAuth>
              <ReportPage />
            </RequireAuth>
          }
        />
        <Route
          path="/session/:id/spectate"
          element={<Navigate to="/drills" replace />}
        />
        <Route
          path="/drills"
          element={
            <RequireAuth>
              <TrainingHome />
            </RequireAuth>
          }
        />
        <Route
          path="/drills/gaze"
          element={
            <RequireAuth>
              <GazeDrill />
            </RequireAuth>
          }
        />
        <Route
          path="/drills/pace"
          element={
            <RequireAuth>
              <PaceDrill />
            </RequireAuth>
          }
        />
        <Route
          path="/drills/filler"
          element={
            <RequireAuth>
              <FillerDrill />
            </RequireAuth>
          }
        />
        <Route
          path="/drills/posture"
          element={
            <RequireAuth>
              <PostureDrill />
            </RequireAuth>
          }
        />
        <Route
          path="/drills/intro"
          element={
            <RequireAuth>
              <IntroDrill />
            </RequireAuth>
          }
        />
        <Route
          path="/progress"
          element={
            <RequireAuth>
              <ProgressPage />
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireAuth>
              <SessionHistory />
            </RequireAuth>
          }
        />
        <Route
          path="/classes"
          element={
            <RequireAuth>
              <MyClass />
            </RequireAuth>
          }
        />
        <Route
          path="/teacher"
          element={
            <RequireTeacher>
              <TeacherHome />
            </RequireTeacher>
          }
        />
        <Route
          path="/teacher/board"
          element={
            <RequireTeacher>
              <TeacherBoard />
            </RequireTeacher>
          }
        />
        <Route
          path="/teacher/:id"
          element={
            <RequireTeacher>
              <ClassRoom />
            </RequireTeacher>
          }
        />
        <Route
          path="/teacher/:id/students/:sid"
          element={
            <RequireTeacher>
              <StudentDetailPage />
            </RequireTeacher>
          }
        />
        <Route
          path="/invites"
          element={<Navigate to="/drills" replace />}
        />
        <Route
          path="/admin"
          element={<Navigate to="/drills" replace />}
        />
      </Routes>
      </Suspense>
    </>
  )
}
