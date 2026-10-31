import { defineConfig } from '@playwright/test'

// Chromium fake-media flags make camera/mic scenarios repeatable (T1/T2).
// webServer boots both backend (fresh e2e SQLite db) and frontend.
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
    permissions: ['camera', 'microphone'],
  },
  webServer: [
    {
      command: 'pnpm --filter backend dev',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: true,
      cwd: '..',
      env: { DATABASE_URL: 'file:./e2e.db', NODE_ENV: 'development' },
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter frontend dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 60_000,
    },
  ],
})
