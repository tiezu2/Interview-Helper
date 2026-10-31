# Live Interview Analyzer

A browser-based platform that watches and listens live through camera and mic, and
coaches a person on how they actually come across in an interview.

**Training, not judging.** The platform reports observable behavioral signals and
coaching feedback. It never outputs hire/reject, truthful/lying, or any automated
verdict about a person.

> **Why this exists, what it does, and the payoff:** see [SHOWCASE.md](SHOWCASE.md).

## What it does

- AI-conducted mock interview: pick a job role, get 5 role-relevant questions
- Live analysis of 5 signals, entirely **in your browser** (nothing streams to a server):
  1. Facial expression + tension composite
  2. Eye contact, gaze, blink rate
  3. Movement & fidgeting
  4. Voice tone (pace, pitch variation, volume, pauses)
  5. Speech content (live transcript, filler words)
- Real-time meters + supportive nudges (max 1 per 20s)
- Post-session report: per-signal scores, timeline, transcript, LLM coaching feedback
- Roles: admin / assessor / candidate — assessors invite candidates and see their
  reports after the session
- Sessions recorded for internal AI-quality review only (admin-only access,
  auto-deleted after 30 days)

## Architecture

Edge-first: the live loop never leaves the browser (MediaPipe FaceLandmarker + Web
Audio + Web Speech). The server receives only 1-second metric summaries over
WebSocket, orchestrates auth/sessions, generates questions and coaching via
LangChain.js (with deterministic template fallback), and stores reports.

| Layer | Tech |
|---|---|
| Frontend | React + Vite + TypeScript, @mediapipe/tasks-vision |
| Backend | Node.js + Fastify + TypeScript, LangChain.js, Prisma |
| DB | SQLite (dev) / Postgres (prod) — portable Prisma schema |
| Storage | Local disk (dev) / MinIO-S3 (prod) behind a driver interface |
| Auth | JWT with role claims |

## Quick start (dev — no Docker needed)

```bash
pnpm install
cp .env.example backend/.env          # defaults work out of the box
cd backend && npx prisma db push      # creates dev.db
cd .. && pnpm dev                     # backend :3001 + frontend :5173
```

Open http://localhost:5173 — the **first registered account becomes admin**.

Camera analysis needs Chrome/Edge desktop or Android Chrome. Live transcription is
unavailable on iOS Safari (report still works, minus the transcript).

### LAN access (phone / another computer)

Browsers only expose camera + mic on `https` (or `localhost`), so LAN use goes through
the single-port HTTPS server that also hosts the built frontend:

```bash
pnpm lan          # https://<LAN-IP>:8443 — camera/mic work on other devices
pnpm lan:http     # http://<LAN-IP>:8080 — UI only, getUserMedia is blocked
```

`scripts/lan.mjs` builds the frontend, starts the backend on `0.0.0.0`, waits for
`/api/health`, then prints the reachable URLs and a QR code. It ranks real adapters
first, so VMware/Hyper-V/WSL/VPN addresses (unreachable from other devices) are not
offered as the QR target.

- TLS: a self-signed cert is generated into `backend/certs` with every LAN IP in its
  SAN and is regenerated when the IP changes. On the other device accept the warning
  once (高级 → 继续前往).
- Both devices must be on the same subnet; router AP isolation / guest Wi-Fi blocks it.
- With the Windows firewall enabled, allow the port once:
  `New-NetFirewallRule -DisplayName "面试镜 8443" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow`

### LLM questions & coaching (optional)

Template fallback works with no key. For LLM-generated content set in `backend/.env`:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

## Tests

```bash
pnpm test          # backend integration (SQLite) + frontend signal-math unit tests
pnpm test:pg       # same backend suite against Postgres (needs docker compose postgres)
pnpm e2e           # Playwright with Chromium fake camera/mic
```

## Prod-like run

```bash
docker compose -f docker/compose.yml up -d   # postgres + minio + api + web on :8080
```

## Repo layout

```
frontend/src/analysis/   signal math + MediaPipe/WebAudio wrappers (unit tested)
frontend/src/session/    consent, live session, meters
frontend/src/report/     report + history pages
backend/src/routes/      auth, invites, sessions, metrics WS, reports, recordings, admin
backend/src/services/    llm (LangChain + templates), report pipeline, storage drivers, retention
e2e/                     Playwright specs (fake media)
docker/                  prod-profile compose + Dockerfiles
docs/signals.md          exact signal formulas and weights
```
