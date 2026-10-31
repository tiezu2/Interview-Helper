import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 覆盖主流内核：Chromium / Gecko / WebKit
  build: {
    target: ['chrome87', 'edge88', 'firefox78', 'safari14', 'es2020'],
  },
  server: {
    // 监听所有网卡，便于同一局域网的其他设备/手机访问
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any)
