import { execSync } from 'node:child_process'

export default function setup() {
  process.env.NODE_ENV = 'test'
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./test.db'
  }
  // T18 parity: the same suite runs against Postgres when DATABASE_URL
  // points at one (pnpm test:pg in CI). Vitest runs from the backend dir.
  // force-reset targets only the throwaway test database; user consented
  // to this on 2026-07-05 ("Yes, allow it (Recommended)")
  execSync('npx prisma db push --force-reset --skip-generate', {
    env: {
      ...process.env,
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'Yes, allow it (Recommended)',
    },
    stdio: 'inherit',
  })
}
