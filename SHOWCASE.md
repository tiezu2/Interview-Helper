# Showcase — Live Interview Analyzer

## Problem

Interview performance is a skill almost nobody gets feedback on. Candidates rehearse
answers in their head, but the things that actually sink interviews — poor eye contact,
visible nervousness, fidgeting, monotone delivery, filler words, rambling unstructured
answers — are invisible to the person doing them. Human mock interviews are expensive,
hard to schedule, and the feedback is subjective and unrepeatable. Existing AI tools
either analyze a recording after the fact (no live coaching) or stream your camera to a
cloud service (a privacy non-starter for something as personal as practicing under
pressure).

## Solution

A browser-based mock-interview coach that watches and listens **live** — and never sends
video or audio off the device.

- An AI interviewer asks 5 role-relevant questions (spoken via TTS, with LLM follow-ups)
  while the app analyzes six signal groups in real time: facial expression/mood (9-state
  classifier + nervousness index), eye contact/gaze/blink, fidgeting, posture, voice tone
  (pace, pitch variation, volume, pauses), and speech content (live transcript, filler
  words, STAR answer structure).
- **Edge-first architecture**: MediaPipe FaceLandmarker/PoseLandmarker + Web Audio + Web
  Speech run entirely client-side. The server only ever receives 1-second numeric metric
  summaries over WebSocket — the live loop never leaves the browser.
- During the session: live meters, a face-mesh HUD, framing guidance, and supportive
  nudges (max one per 20 seconds). After: a per-signal scored report with timeline,
  transcript, benchmarks, and LLM coaching feedback (deterministic template fallback when
  no API key is configured).
- Multi-role platform: assessors invite candidates and can spectate live over a WebSocket
  relay; candidates get drills and a progress dashboard across sessions.
- **Training, not judging**: the system never outputs hire/reject, truthfulness, or any
  verdict about a person — enforced in code and covered by tests.

Stack: pnpm monorepo — React + Vite + TypeScript frontend, Fastify + Prisma backend
(SQLite dev / Postgres prod), Playwright e2e, Docker prod profile (Postgres + MinIO).
96 automated tests across backend and frontend.

## ROI / Impact

- **Replaces paid human mock interviews** (~$50–150/session with a coach) with unlimited
  free practice that gives objective, repeatable, per-signal feedback.
- **Feedback humans can't give**: blink rate, pitch variation, nervousness trends, and
  filler-word counts are measured, not guessed — and tracked across sessions so
  improvement is visible on a dashboard.
- **Privacy as a capability**: because analysis is fully client-side, it's usable for
  practice sessions people would never record to someone else's cloud — and the same
  edge-first pattern (heavy ML in-browser, thin metric stream to server) is reusable for
  any real-time-video product.
- **Zero marginal cost per session**: no video storage, no GPU inference bill; the server
  handles only auth, question generation, and small JSON reports.
