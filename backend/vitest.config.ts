import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts',
    environment: 'node',
    fileParallelism: false, // tests share one database
    testTimeout: 20000,
  },
})
