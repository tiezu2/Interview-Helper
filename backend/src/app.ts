import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import authPlugin from './plugins/auth.js'
import authRoutes from './routes/auth.js'
import sessionRoutes from './routes/sessions.js'
import metricsRoutes from './routes/metrics.js'
import reportRoutes from './routes/reports.js'
import progressRoutes from './routes/progress.js'
import drillRoutes from './routes/drills.js'
import classRoutes from './routes/classes.js'
import classStudentRoutes from './routes/classStudents.js'
import { config } from './config.js'

export interface BuildAppOptions {
  https?: { cert: string | Buffer; key: string | Buffer }
}

export async function buildApp(opts: BuildAppOptions = {}) {
  // TLS 必须在创建 Fastify 实例时传入（listen 里传无效）
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    ...(opts.https ? { https: opts.https } : {}),
  })

  await app.register(cors, { origin: true })
  await app.register(websocket)
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } })
  await app.register(authPlugin)

  await app.register(authRoutes)
  await app.register(sessionRoutes)
  await app.register(metricsRoutes)
  await app.register(reportRoutes)
  await app.register(progressRoutes)
  await app.register(drillRoutes)
  await app.register(classRoutes)
  await app.register(classStudentRoutes)

  app.get('/api/health', async () => ({ ok: true }))

  // 单端口部署：如果存在前端构建产物，就由后端一起托管（前端资源 + /api）
  const staticDir = resolve(process.cwd(), config.staticDir)
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      // 模型/wasm 之类的大文件允许缓存
      cacheControl: true,
      maxAge: '1h',
      // 入口 HTML 不能缓存：前端重新构建后资源文件名带 hash，
      // 手机浏览器若拿着旧的 index.html 会去请求已不存在的旧资源（白屏）。
      setHeaders(res, filePath) {
        if (!filePath.endsWith('index.html')) return
        const target = res as unknown as {
          header?: (name: string, value: string) => unknown
          setHeader?: (name: string, value: string) => unknown
        }
        const cacheControl = 'no-cache, no-store, must-revalidate'
        target.header?.('Cache-Control', cacheControl)
        target.setHeader?.('Cache-Control', cacheControl)
      },
    })
    // SPA 回退：非 /api 且非静态文件的请求，一律返回 index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) {
        return reply.code(404).send({ error: 'Not found' })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.log.warn(`前端构建产物不存在：${staticDir}（仅提供 API）`)
  }

  return app
}
