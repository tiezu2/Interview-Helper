import type { SignalScores } from '../report/scores.js'

// 中文题库（B 路线：面向计算机类专升本/高职学生的求职面试）。
// 所有岗位方向共用同一组结构化问题骨架，只把 {role} 替换成具体方向，
// 这样报告里的逐题分析可以横向累积、纵向对比。
const GENERIC_QUESTIONS = [
  '请先做一个 1 分钟的自我介绍：你是谁、你做过什么、为什么适合{role}这个岗位？',
  '请讲一个你在{role}相关项目或实习中遇到的最大困难，你是怎么定位并解决它的？',
  '在{role}方向上，你认为自己最强的一项能力是什么？请举一个具体例子说明。',
  '讲一次你和同学/同事意见不一致的经历，最后是怎么推进下去的？',
  '如果要在一个月内上手一项全新的{role}技术，你会怎么安排学习？',
  '你怎么理解{role}这个岗位每天真正在做的事？',
  '你有什么想问我们的？',
]

export function templateQuestions(roleField: string, count: number): string[] {
  return GENERIC_QUESTIONS.slice(0, count).map((q) => q.replaceAll('{role}', roleField))
}

function band(score: number): 'strong' | 'okay' | 'weak' {
  if (score >= 75) return 'strong'
  if (score >= 50) return 'okay'
  return 'weak'
}

const BAND_TEXT: Record<'strong' | 'okay' | 'weak', string> = {
  strong: '继续保持',
  okay: '基本达标，还有打磨空间',
  weak: '建议作为下一阶段的训练重点',
}

export function templateCoaching(scores: SignalScores): string {
  // 没有数据的维度（如本次没有语音）不参与好坏评价，只做说明
  const rows: Array<[string, number]> = [
    ['表情与从容度', scores.expression],
    ['眼神接触', scores.eyeContact],
    ['身体稳定度（少小动作）', scores.stillness],
    ['声音表现', scores.voice],
  ]
  if (scores.speech !== null) rows.push(['语言表达（少口头禅）', scores.speech])

  const strengths = rows.filter(([, s]) => band(s) === 'strong')
  const improve = rows.filter(([, s]) => band(s) !== 'strong')
  const missing =
    scores.speech === null
      ? '\n> 本次没有采集到可识别的语音，语言表达（口头禅）暂不计分，建议检查麦克风后重练一次。\n'
      : ''

  return [
    '## 做得好的地方',
    strengths.length
      ? strengths.map(([n, s]) => `- **${n}**（${s} 分）——${BAND_TEXT.strong}。`).join('\n')
      : '- 你完整走完了一次模拟面试，这本身就是可以继续累积的起点。',
    '',
    missing,
    '## 可以改进的地方',
    improve.length
      ? improve.map(([n, s]) => `- **${n}**（${s} 分）——${BAND_TEXT[band(s)]}。`).join('\n')
      : '- 五项信号都不错，可以换更难的题目再试一次。',
    '',
    '## 下次练习可以这样做',
    '- 回答时看镜头，不要看屏幕上的自己，眼神接触会明显提升。',
    '- 每段回答控制在 40—90 秒；语速目标 120—150 字/分钟。',
    '- 想用「那个、然后」的时候，先停半秒再开口，比带口头禅更显从容。',
    '- 开口前先坐正、手放到桌面上，再开始说第一句。',
    '',
    '_本报告是训练工具，只评估表达表现，不构成任何录用判断或对你的评价。_',
  ].join('\n')
}
