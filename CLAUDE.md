# Live Interview Analyzer

Browser-based mock-interview coach: analyzes facial expression/mood, eye contact,
fidgeting, posture, voice tone, and speech LIVE through camera/mic — entirely
client-side — and produces a post-session coaching report. Training, not judging:
never outputs hire/reject, truthfulness, or any verdict about a person.

Planned via the project-pipeline skill; the source-of-truth plan lives in the NocoDB
`plans` table, row `plan_name = live-interview-analyzer` (execution_log has build history).

## Stack

pnpm monorepo: `backend/` (Fastify + TypeScript + Prisma; SQLite dev, Postgres prod),
`frontend/` (React + Vite + TS; MediaPipe tasks-vision, Web Audio, Web Speech),
`e2e/` (Playwright, fake media), `docker/` (prod profile: postgres + minio + api + web).
Signal formulas and weights: `docs/signals.md`. Architecture rule (CD3): the live loop
never leaves the browser — the server only receives 1-second metric summaries over
WebSocket. Do not move live video analysis server-side.

## How to run

```bash
pnpm install
cd backend && npx prisma db push   # creates dev.db (first time)
cd .. && pnpm dev                  # api :3001, web :5173
```

First registered account becomes admin. MediaPipe models are self-hosted: fetched into
`frontend/public/models` by `frontend/scripts/fetch-models.mjs` (runs on predev/prebuild;
gitignored). LLM features (question generation, coaching, follow-ups) fall back to
templates unless `LLM_PROVIDER` + API key are set in `backend/.env`.

## Safe commands

- `pnpm test` / `pnpm -r test`, `npx tsc --noEmit`, `npx vite build`, `pnpm dev`
- Backend tests reset the throwaway `backend/test.db` via `prisma db push --force-reset`
  (consented; wired into `backend/tests/global-setup.ts`)

## Approval required

- Anything touching `backend/dev.db` destructively (it holds real local accounts/sessions)
- NocoDB writes (updating the plans row) — per-session approval per global MCP policy
- git push / repo creation (Phase 5 of the pipeline — not done yet)
- Adding paid API keys or changing `.env`

## Forbidden

- Emitting verdict language in any coaching path (enforced by `containsVerdictLanguage`
  + tests; keep new LLM prompts behind that check)
- Streaming live camera/mic media to the server (CD3; recordings upload only AFTER the
  session, admin-only access, 30-day retention)
- Weakening role checks: candidates see only their own data; assessors only invited
  candidates' reports; recordings admin-only (R8/R12 tests cover this)
