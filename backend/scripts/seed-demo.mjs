/**
 * 一键生成演示数据：1 名老师 + 1 个班级 + 3 名不同状态的学生。
 *
 * 用法（在 backend 目录）：
 *   node scripts/seed-demo.mjs            # 追加/更新演示数据（幂等）
 *   node scripts/seed-demo.mjs --clean    # 先删除演示账号再生成
 *
 * 演示账号（密码统一 12345678）：
 *   老师 T9001 王老师
 *   学生 S2025011 张明（高分，5 次练习，趋势上升）
 *        S2025012 李婷（中等，3 次练习）
 *        S2025013 王浩（未练习，触发预警）
 * 班级：计算机专升本一班  加入码 DEMO01
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const PASSWORD = '12345678'
const JOIN_CODE = 'DEMO01'

const QUESTIONS = [
  '请先做一个一分钟的自我介绍，说说你的专业背景和求职方向。',
  '讲一个你最有成就感的项目，你在里面具体做了什么？',
  '说一次你和别人意见不一致的情况，你是怎么处理的？',
  '你遇到过最棘手的技术问题是什么？怎么定位和解决的？',
  '你为什么想应聘这个岗位？你觉得自己的优势在哪里？',
  '如果入职后接手一个没人维护的老系统，你会从哪里开始？',
  '说说你未来三年的职业规划。',
]

const DIMS = ['expression', 'eyeContact', 'stillness', 'voice', 'speech']

/** 生成一次会话的五维分数：level 是这次练习的整体水平（0-100） */
function makeScores(level, jitter = 0) {
  const s = {}
  DIMS.forEach((d, i) => {
    const off = ((i * 7 + Math.round(jitter)) % 9) - 4 // -4..4 的稳定偏移
    s[d] = Math.max(35, Math.min(97, Math.round(level + off)))
  })
  s.overall = Math.round(DIMS.reduce((a, d) => a + s[d], 0) / DIMS.length)
  s.details = {
    eyeContactPct: Math.round(s.eyeContact * 0.95),
    blinkRatePerMin: 12 + (Math.round(jitter) % 8),
    avgWpm: 118 + (Math.round(jitter) % 30),
    fillerCount: Math.max(0, 8 - Math.round(level / 12)),
    fillerPer100Words: Math.max(0, Math.round((8 - level / 12) * 10) / 10),
    avgPosture: Math.round((s.stillness / 100) * 100) / 100,
    energy: Math.round((s.voice / 100) * 100) / 100,
  }
  return s
}

/** 一次会话的逐题分析 */
function makeAnswers(level) {
  return QUESTIONS.slice(0, 5).map((q, i) => {
    const words = 120 + i * 18 + (level % 20)
    return {
      order: i + 1,
      question: q,
      transcript:
        '当时是在课程项目里负责后端接口，我先梳理了现有代码的问题，然后把慢查询单独抽出来做了索引优化，' +
        '最后接口平均响应从 800 毫秒降到 120 毫秒左右。',
      words,
      fillers: Math.max(1, 6 - Math.round(level / 20)),
      durationSec: 55 + i * 6,
      avgNervousness: Math.round((1 - level / 100) * 100) / 100,
      dominantMood: { state: level >= 80 ? 'confident' : level >= 65 ? 'positive' : 'tense', emoji: '' },
      structure: {
        hasSituation: level >= 55,
        hasAction: level >= 65,
        hasResult: level >= 75,
        structureScore: Math.min(100, Math.round(level * 0.9)),
        lengthAssessment: words >= 100 && words <= 220 ? '时长合适' : words < 100 ? '偏短，可再展开' : '偏长，注意收束',
      },
      coaching:
        level >= 75
          ? '结构完整，建议把结果部分用数字再具体一点。'
          : '先用一句话交代背景，再讲你做了什么，最后一定要给出结果。',
    }
  })
}

function makeFeedback(level, name) {
  const tone = level >= 80 ? '整体表现扎实' : level >= 65 ? '基本达标，还有提升空间' : '需要重点加强'
  return `## 总体评价

${name} 本次练习 ${tone}，综合得分 ${level} 分。

## 做得好的地方

- 回答有结构意识，能按「背景—行动—结果」展开。
- 语速稳定，停顿控制得当。

## 建议优先改进

1. **眼神交流**：保持看向镜头，而不是屏幕上的自己。
2. **口头禅**：减少「那个」「然后」的使用频次。
3. **结果量化**：把"提升了很多"换成具体数字。

> 以上为练习建议，不构成任何录用判断。`
}

/** 创建一次完整会话（题目 + 报告 + 每秒指标） */
async function createSession(studentId, { level, daysAgo, roleField }) {
  const startedAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000)
  const endedAt = new Date(startedAt.getTime() + 9 * 60 * 1000)

  const session = await prisma.session.create({
    data: {
      candidateId: studentId,
      roleField,
      status: 'reported',
      consentAt: startedAt,
      startedAt,
      endedAt,
      createdAt: startedAt,
    },
  })

  const qs = QUESTIONS.slice(0, 5)
  await prisma.question.createMany({
    data: qs.map((text, i) => ({
      sessionId: session.id,
      order: i + 1,
      text,
      askedAt: new Date(startedAt.getTime() + i * 100 * 1000),
    })),
  })

  // 每秒指标窗口（报告页时间轴用）
  const windows = []
  for (let t = 0; t < 60; t++) {
    const w = t / 59
    windows.push({
      sessionId: session.id,
      ts: new Date(startedAt.getTime() + t * 1000),
      signals: JSON.stringify({
        gaze: { eyeContact: +0.6 + 0.3 * Math.sin(w * 6), blink: 0.15 },
        expression: { tension: +(0.5 - w * 0.2).toFixed(2), smile: +(0.2 + w * 0.2).toFixed(2) },
        movement: { fidget: +(0.4 - w * 0.15).toFixed(2), posture: 0.72 },
        voice: { wpm: 120 + Math.round(Math.sin(w * 4) * 15), volume: 0.5, speaking: 1 },
        questionOrder: Math.min(5, Math.floor(t / 12) + 1),
        mood: { state: level >= 75 ? 'confident' : 'positive', emoji: '', nervousness: 0.35 },
      }),
    })
  }
  await prisma.metricWindow.createMany({ data: windows })

  const scores = makeScores(level, daysAgo * 3)
  await prisma.report.create({
    data: {
      sessionId: session.id,
      scores: JSON.stringify({ ...scores, answers: makeAnswers(level) }),
      feedbackMd: makeFeedback(level, '本次练习'),
      transcript: qs.map((q, i) => `Q${i + 1}: ${q}\nA${i + 1}: 当时是在课程项目里负责后端接口……`).join('\n\n'),
      createdAt: endedAt,
    },
  })

  return session
}

const DRILL_META = {
  gaze: { name: '眼神锁定', mk: (s) => ({ contactPct: s, longestSec: +((s / 100) * 25).toFixed(1), breaks: Math.max(1, 6 - Math.round(s / 20)) }) },
  pace: { name: '语速控制', mk: (s) => ({ wpm: 100 + Math.round(s / 5), inRangePct: s, stability: s - 5 }) },
  filler: { name: '口头禅清除', mk: (s) => ({ fillers: Math.max(1, 10 - Math.round(s / 12)), words: 150, density: Math.max(1, 9 - Math.round(s / 12)) }) },
  posture: { name: '姿态矫正', mk: (s) => ({ uprightPct: s, samples: 40 }) },
  intro: { name: '自我介绍', mk: (s) => ({ structureScore: s, timingScore: s - 4, speakingScore: s + 2 }) },
}

async function createDrills(studentId, baseLevel, count = 3) {
  const rows = []
  const kinds = Object.keys(DRILL_META)
  for (const kind of kinds) {
    for (let i = 0; i < count; i++) {
      const score = Math.max(40, Math.min(98, baseLevel + i * 3 - 6 + ((kind.length * 5) % 7)))
      rows.push({
        userId: studentId,
        kind,
        score,
        durationSec: kind === 'intro' ? 45 : kind === 'gaze' ? 30 : 60,
        metrics: JSON.stringify(DRILL_META[kind].mk(score)),
        createdAt: new Date(Date.now() - (count - i) * 2 * 24 * 3600 * 1000),
      })
    }
  }
  await prisma.drillRun.createMany({ data: rows })
  return rows.length
}

async function main() {
  const clean = process.argv.includes('--clean')
  const hash = await bcrypt.hash(PASSWORD, 10)

  const demoNos = ['T9001', 'S2025011', 'S2025012', 'S2025013']

  if (clean) {
    await prisma.classroom.deleteMany({ where: { joinCode: JOIN_CODE } })
    await prisma.user.deleteMany({ where: { studentNo: { in: demoNos } } })
    console.log('已清理旧的演示数据')
  }

  // 账号（upsert，可重复执行）
  const teacher = await prisma.user.upsert({
    where: { studentNo: 'T9001' },
    update: { name: '王老师', role: 'teacher' },
    create: { studentNo: 'T9001', name: '王老师', role: 'teacher', passwordHash: hash },
  })

  const students = []
  for (const s of [
    { no: 'S2025011', name: '张明' },
    { no: 'S2025012', name: '李婷' },
    { no: 'S2025013', name: '王浩' },
  ]) {
    const u = await prisma.user.upsert({
      where: { studentNo: s.no },
      update: { name: s.name, role: 'student' },
      create: { studentNo: s.no, name: s.name, role: 'student', passwordHash: hash },
    })
    students.push(u)
  }

  // 班级
  let classroom = await prisma.classroom.findUnique({ where: { joinCode: JOIN_CODE } })
  if (!classroom) {
    classroom = await prisma.classroom.create({
      data: { name: '计算机专升本一班', joinCode: JOIN_CODE, teacherId: teacher.id },
    })
  }
  for (const u of students) {
    await prisma.classMembership.upsert({
      where: { classroomId_studentId: { classroomId: classroom.id, studentId: u.id } },
      update: {},
      create: { classroomId: classroom.id, studentId: u.id },
    })
  }

  // 清掉演示学生已有的练习，保证可重复执行
  for (const u of students) {
    const sessions = await prisma.session.findMany({ where: { candidateId: u.id }, select: { id: true } })
    if (sessions.length) {
      const ids = sessions.map((x) => x.id)
      await prisma.report.deleteMany({ where: { sessionId: { in: ids } } })
      await prisma.metricWindow.deleteMany({ where: { sessionId: { in: ids } } })
      await prisma.question.deleteMany({ where: { sessionId: { in: ids } } })
      await prisma.session.deleteMany({ where: { id: { in: ids } } })
    }
    await prisma.drillRun.deleteMany({ where: { userId: u.id } })
  }

  // 张明：5 次练习，分数从 72 → 88 逐步上升
  for (let i = 0; i < 5; i++) {
    await createSession(students[0].id, {
      level: 72 + i * 4,
      daysAgo: (5 - i) * 3,
      roleField: '软件开发工程师',
    })
  }
  await createDrills(students[0].id, 82, 3)

  // 李婷：3 次练习，60 → 68
  for (let i = 0; i < 3; i++) {
    await createSession(students[1].id, {
      level: 60 + i * 4,
      daysAgo: (3 - i) * 4,
      roleField: '软件测试工程师',
    })
  }
  await createDrills(students[1].id, 66, 2)

  // 王浩：不做面试，只做 1 次训练 → 班级看板会出现「未练习预警」
  await createDrills(students[2].id, 52, 1)

  const summary = await prisma.user.findMany({
    where: { studentNo: { in: demoNos } },
    select: {
      studentNo: true,
      name: true,
      role: true,
      _count: { select: { sessions: true, drills: true } },
    },
    orderBy: { studentNo: 'asc' },
  })

  const reportCount = await prisma.report.count({
    where: { session: { candidateId: { in: students.map((s) => s.id) } } },
  })

  console.log('\n================ 演示数据已就绪 ================')
  console.log(`班级：${classroom.name}    加入码：${JOIN_CODE}`)
  console.log(`老师账号：T9001    密码：${PASSWORD}`)
  console.log('\n学生账号（密码同上）：')
  for (const u of summary.filter((x) => x.role === 'student')) {
    console.log(`  ${u.studentNo}  ${u.name}   面试 ${u._count.sessions} 次 / 训练 ${u._count.drills} 次`)
  }
  console.log(`\n报告总数：${reportCount}`)
  console.log('登录地址：老师 /teacher/login     学生 /login')
  console.log('================================================\n')
}

main()
  .catch((e) => {
    console.error('生成失败：', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
