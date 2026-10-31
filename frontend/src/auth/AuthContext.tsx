import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from '../api.js'

export type Role = 'teacher' | 'student' | 'admin' | 'assessor' | 'candidate'

export interface User {
  id: string
  name: string
  role: Role
  studentNo?: string | null
  email?: string | null
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (account: string, password: string) => Promise<void>
  register: (
    account: string,
    password: string,
    name: string,
    role?: 'student' | 'teacher',
    email?: string,
  ) => Promise<void>
  guest: () => Promise<void>
  logout: () => void
  isTeacher: boolean
}

const AuthContext = createContext<AuthState>(null as any)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api<{ user: User }>('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (account: string, password: string) => {
    const d = await api<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { account, password },
    })
    setToken(d.token)
    setUser(d.user)
  }

  const register = async (
    account: string,
    password: string,
    name: string,
    role: 'student' | 'teacher' = 'student',
    email?: string,
  ) => {
    const d = await api<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: { account, password, name, role, email: email || undefined },
    })
    setToken(d.token)
    setUser(d.user)
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  // 体验模式：一键创建匿名学员账号（免注册），用于快速开始训练与演示
  const guest = async () => {
    const d = await api<{ token: string; user: User }>('/api/auth/guest', {
      method: 'POST',
      body: {},
    })
    setToken(d.token)
    setUser(d.user)
  }

  const isTeacher = user?.role === 'teacher' || user?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, loading, login, register, guest, logout, isTeacher }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
