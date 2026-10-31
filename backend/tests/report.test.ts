import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { freshApp, resetDb, registerUser, createSession } from './helpers.js'
import { prisma } from '../src/db.js'
import { aggregateScores } from '../src/services/report/scores.js'
import { containsVerdictLanguage, BANNED_VERDICT_TERMS } from '../src/services/llm/index.js'
import { templateCoaching } from '../src/services/llm/templates.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await freshApp()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await resetDb()
})

describe('score aggregation (T5, T7, T8)', () => {
  it('T5: gaze-averted windows produce low eye-contact score', async () => {
    const windows = Array.from({ length: 30 }, () => ({
      gaze: { eyeContact: false, blink: false },
    }))
    const scores = aggregateScores(windows, 30)
    expect(scores.eyeContact).toBeLessThan(20)
    expect(scores.details.eyeContactPct).toBe(0)
  })

  it('T7: fast speech produces below-ideal voice pace score', async () => {
    const fast = Array.from({ length: 30 }, () => ({
      voice: { wpm: 220, pitchVar: 0.2, volume: 0.5, speaking: true },
    }))
    const ideal = Array.from({ length: 30 }, () => ({
      voice: { wpm: 135, pitchVar: 0.2, volume: 0.5, speaking: true },
    }))
    const fastScore = aggregateScores(fast, 30)
    const idealScore = aggregateScores(ideal, 30)
    expect(fastScore.details.avgWpm).toBe(220)
    expect(fastScore.voice).toBeLessThan(idealScore.voice)
  })

  it('T8: filler counts sum exactly across windows', async () => {
    const windows = [
      { speech: { fillers: 2, words: 40 } },
      { speech: { fillers: 3, words: 50 } },
      { speech: { fillers: 0, words: 30 } },
    ]
    const scores = aggregateScores(windows, 3)
    expect(scores.details.fillerCount).toBe(5)
  })

  it('empty session still yields a valid score object', async () => {
    const scores = aggregateScores([], 0)
    expect(scores.overall).toBeGreaterThanOrEqual(0)
    expect(scores.overall).toBeLessThanOrEqual(100)
  })
})

describe('report pipeline (R7, T10)', () => {
  async function endWithMetrics(candToken: string, sessionId: string) {
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/start`,
      headers: { authorization: `Bearer ${candToken}` },
    })
    for (let i = 0; i < 5; i++) {
      await prisma.metricWindow.create({
        data: {
          sessionId,
          ts: new Date(Date.now() + i * 1000),
          signals: JSON.stringify({
            expression: { tension: 0.3 },
            gaze: { eyeContact: i % 2 === 0, blink: false },
            movement: { fidget: 0.2 },
            voice: { wpm: 140, pitchVar: 0.25, volume: 0.6, speaking: true },
            speech: { fillers: 1, words: 20 },
            transcriptDelta: `answer part ${i} um like`,
          }),
        },
      })
    }
    return app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/end`,
      headers: { authorization: `Bearer ${candToken}` },
    })
  }

  it('T10: report generated with scores, timeline, transcript, and no verdict language', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const session = await createSession(app, cand.token)

    const started = Date.now()
    const end = await endWithMetrics(cand.token, session.id)
    expect(end.statusCode).toBe(200)
    expect(Date.now() - started).toBeLessThan(30000) // <30s acceptance

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/report`,
      headers: { authorization: `Bearer ${cand.token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.report.scores.overall).toBeGreaterThanOrEqual(0)
    expect(body.report.transcript).toContain('answer part')
    expect(body.timeline.length).toBe(5)
    expect(body.questions.length).toBeGreaterThanOrEqual(5)

    // Automated banned-verdict-language check
    expect(containsVerdictLanguage(body.report.feedbackMd)).toBeNull()
  })

  it('ending twice does not duplicate the report', async () => {
    await registerUser(app)
    const cand = await registerUser(app)
    const session = await createSession(app, cand.token)
    await endWithMetrics(cand.token, session.id)
    const second = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/end`,
      headers: { authorization: `Bearer ${cand.token}` },
    })
    expect(second.statusCode).toBe(200)
    expect(await prisma.report.count()).toBe(1)
  })
})

describe('verdict language guard (T10)', () => {
  it('detects every banned term as a whole word', () => {
    for (const term of BANNED_VERDICT_TERMS) {
      expect(containsVerdictLanguage(`we recommend you ${term} this candidate`)).toBe(term)
    }
  })

  it('does not flag banned terms inside larger words', () => {
    expect(containsVerdictLanguage('your passion for the compassionate rejection of filler words')).toBeNull()
  })

  it('template coaching never contains verdict language', () => {
    const md = templateCoaching({
      expression: 40, eyeContact: 30, stillness: 80, voice: 60, speech: 90, overall: 55,
      details: { eyeContactPct: 30, blinkRatePerMin: 12, avgWpm: 150, fillerCount: 9, fillerPer100Words: 4.5, avgTension: 0.6, avgFidget: 0.2 },
    })
    expect(containsVerdictLanguage(md)).toBeNull()
  })
})
