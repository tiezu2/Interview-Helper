import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'
import { buildApp } from './app.js'
import { config } from './config.js'

// 非 localhost 的 http 页面会被浏览器禁用摄像头/麦克风，
// 所以局域网访问需要 HTTPS。这里支持用户提供证书，或自动生成自签证书。
async function resolveHttps() {
  if (!config.useHttps) return undefined

  if (config.httpsCert && config.httpsKey) {
    return { cert: readFileSync(config.httpsCert), key: readFileSync(config.httpsKey) }
  }

  const dir = resolve(process.cwd(), config.certDir)
  const certPath = join(dir, 'cert.pem')
  const keyPath = join(dir, 'key.pem')
  const metaPath = join(dir, 'meta.json')

  // 当前机器所有局域网 IP（写进证书 SAN，并在 IP 变化时重建证书）
  const currentIps = Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
    .filter((ip) => !ip.startsWith('169.254.'))

  if (existsSync(certPath) && existsSync(keyPath)) {
    let stale = false
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      stale = JSON.stringify(meta.ips ?? []) !== JSON.stringify(currentIps)
    } catch {
      stale = true // 没有 meta.json（旧证书）→ 重建
    }
    if (!stale) {
      return { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    }
    console.log('[https] 本机 IP 已变化，重新生成证书')
  }

  // selfsigned v5 的类型定义与运行时不完全一致，这里按运行时用法调用
  const selfsigned: any = (await import('selfsigned')).default
  const pems: any = await selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '0.0.0.0' },
            ...currentIps.map((ip) => ({ type: 7 as const, ip })),
          ],
        },
      ],
    },
  )
  mkdirSync(dir, { recursive: true })
  writeFileSync(certPath, pems.cert)
  writeFileSync(keyPath, pems.private)
  writeFileSync(metaPath, JSON.stringify({ ips: currentIps, createdAt: new Date().toISOString() }, null, 2))
  console.log(`[https] 已生成自签证书: ${dir}（浏览器首次访问需点“继续访问”）`)
  return { cert: pems.cert, key: pems.private }
}

const https = await resolveHttps()
const app = await buildApp({ https })

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    const scheme = https ? 'https' : 'http'
    console.log(`[serve] 前端+API 已启动：${scheme}://localhost:${config.port}`)
    if (!https) {
      console.log('[serve] 提示：其他主机/手机通过 http 访问时，浏览器会禁用摄像头与麦克风；')
      console.log('        需要这些功能请用 USE_HTTPS=1 启动（自签证书）。')
    }
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
