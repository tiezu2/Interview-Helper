import { api } from '../api.js'

export interface ClassRow {
  id: string
  name: string
  joinCode: string
  createdAt: string
  memberCount: number
  reportCount: number
  classAvg: number | null
}

export interface StudentRow {
  id: string
  name: string
  studentNo: string | null
  email: string | null
  joinedAt: string
  sessionCount: number
  latest: {
    overall: number | null
    expression: number | null
    eyeContact: number | null
    stillness: number | null
    voice: number | null
    speech: number | null
    at: string
  } | null
  bestOverall: number | null
  avgOverall: number | null
  trend: Array<{ at: string; score: number | null }>
  drillCount: number
  drillAvg: number | null
  lastActivity: string | null
}

export interface ClassDetail {
  classroom: { id: string; name: string; joinCode: string; createdAt: string }
  students: StudentRow[]
  stats: {
    memberCount: number
    practiced: number
    classAvg: number | null
    dimAvg: Record<string, number | null>
  }
}

export function listClasses() {
  return api<{ classes: ClassRow[] }>('/api/classes')
}

export function createClass(name: string) {
  return api<{ classroom: { id: string; name: string; joinCode: string } }>('/api/classes', {
    method: 'POST',
    body: { name },
  })
}

export function getClassDetail(id: string) {
  return api<ClassDetail>(`/api/classes/${id}`)
}

export function joinClass(joinCode: string) {
  return api<{ classroom: { id: string; name: string }; already?: boolean }>('/api/classes/join', {
    method: 'POST',
    body: { joinCode },
  })
}

export function myClasses() {
  return api<{ classes: Array<{ id: string; name: string; teacherName: string; joinedAt: string }> }>(
    '/api/my-classes',
  )
}

export const DIM_LABEL: Record<string, string> = {
  expression: '表情从容',
  eyeContact: '眼神接触',
  stillness: '身体稳定',
  voice: '声音表现',
  speech: '语言表达',
}

export interface ClassmateRow {
  id: string
  name: string
  studentNoMasked: string
  isMe: boolean
  sessionCount: number
  latestOverall: number | null
  bestOverall: number | null
  avgOverall: number | null
  lastAt: string | null
  rank: number | null
}

export interface ClassmatesResponse {
  classroom: { id: string; name: string; teacherName: string }
  me: ClassmateRow | null
  rankTotal: number
  classAvg: number | null
  classmates: ClassmateRow[]
}

// 同班同学排行（只有分数，没有视频/录音/文字稿）
export function fetchClassmates(id: string) {
  return api<ClassmatesResponse>(`/api/my-classes/${id}/classmates`)
}

// ---------- 老师端：学生详情 / 移除 / 批量导入 ----------
export interface StudentReportRow {
  sessionId: string
  roleField: string
  createdAt: string
  overall: number | null
  expression: number | null
  eyeContact: number | null
  stillness: number | null
  voice: number | null
  speech: number | null
  answers: number
}

export interface StudentDrillRow {
  kind: string
  label: string
  runs: number
  latest: number | null
  best: number | null
  avg3: number | null
  trend: Array<{ at: string; score: number }>
}

export interface StudentDetail {
  student: { id: string; name: string; studentNo: string | null; joinedAt: string }
  reports: StudentReportRow[]
  stats: {
    sessions: number
    reported: number
    latestOverall: number | null
    avgOverall: number | null
    bestOverall: number | null
    trend: Array<{ at: string; score: number | null }>
    drillRuns: number
  }
  drills: StudentDrillRow[]
  suggestions: Array<{ dimLabel: string; dimScore: number | null; drillKind: string; drillLabel: string }>
}

export function fetchStudentDetail(classId: string, studentId: string) {
  return api<StudentDetail>(`/api/classes/${classId}/students/${studentId}`)
}

export function removeStudent(classId: string, studentId: string) {
  return api<{ ok: true }>(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' })
}

export interface ImportResult {
  ok: true
  defaultPassword: string
  summary: { created: number; added: number; skipped: number }
  created: Array<{ studentNo: string; name: string; password: string }>
  added: Array<{ studentNo: string; name: string }>
  skipped: Array<{ line: string; reason: string }>
}

export function importStudents(classId: string, text: string, defaultPassword?: string) {
  return api<ImportResult>(`/api/classes/${classId}/import`, {
    method: 'POST',
    body: { text, defaultPassword: defaultPassword || undefined },
  })
}
