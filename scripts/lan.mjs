#!/usr/bin/env node
/**
 * 局域网一键启动：构建前端 → 启动后端（同时托管前端与 API）→ 打印可访问地址 + 二维码。
 *
 *   node scripts/lan.mjs               # https://<局域网IP>:8443（默认，摄像头/麦克风可用）
 *   node scripts/lan.mjs --http        # http://<局域网IP>:8080（只有界面，浏览器会禁用摄像头）
 *   node scripts/lan.mjs --skip-build  # 跳过构建（前端没改动时更快）
 *   node scripts/lan.mjs --port 9443   # 改用其它端口
 *
 * 说明：非 localhost 的页面只有在 https 下才能拿到 getUserMedia（摄像头/麦克风），
 * 所以做模拟面试必须用 https 模式；自签证书首次访问需要点一次「继续前往」。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import qrcode from 'qrcode-terminal'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const useHttps = !args.includes('--http')
const skipBuild = args.includes('--skip-build')

function argValue(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const port = Number(argValue('--port', useHttps ? 8443 : 8080))
const scheme = useHttps ? 'https' : 'http'

// 虚拟网卡（VMware / VirtualBox / Hyper-V / WSL / Docker / VPN）的 IP 对其他设备不可达，
// 但 os.networkInterfaces() 里往往排在真实网卡前面，直接取第一项会让二维码指向打不开的地址。
const VIRTUAL_NIC = /vmware|virtualbox|vbox|hyper-?v|vethernet|wsl|docker|loopback|virtual|tun\b|tap\b|tailscale|zerotier|npcap|bluetooth|teredo|isatap|pseudo/i

function nicScore(name, ip) {
  if (VIRTUAL_NIC.test(name)) return -100
  if (ip.startsWith('169.254.')) return -50 // APIPA：没拿到 DHCP
  if (ip.startsWith('192.168.')) return 30
  if (ip.startsWith('10.')) return 20
  const m = /^172\.(\d+)\./.exec(ip)
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 20
  return 0
}

/** 真实局域网 IPv4，按「更可能是路由器下发的地址」排序 */
function lanIps() {
  const all = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      all.push({ name, ip: i.address, score: nicScore(name, i.address) })
    }
  }
  return all.sort((a, b) => b.score - a.score)
}

const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`
const banner = (line = '') => console.log(c(36, line))

function run(cmd, cmdArgs) {
  return new Promise((resolveRun, reject) => {
    const p = spawn(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
    p.on('exit', (code) => (code === 0 ? resolveRun() : reject(new Error(`${cmd} 退出码 ${code}`))))
    p.on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 轮询 /api/health，确认服务真的起来了（比 sleep 固定 4 秒可靠） */
function healthOnce(host) {
  return new Promise((resolveOnce) => {
    const req = (useHttps ? httpsRequest : httpRequest)(
      {
        host,
        port,
        path: '/api/health',
        method: 'GET',
        timeout: 1500,
        ...(useHttps ? { rejectUnauthorized: false } : {}),
        ...(useHttps && host !== '127.0.0.1' ? { servername: host } : {}),
      },
      (res) => {
        res.resume()
        resolveOnce(res.statusCode === 200)
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolveOnce(false))
    req.end()
  })
}

async function waitForServer(child) {
  let exited = false
  child.on('exit', () => {
    exited = true
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (exited) return false
    if (await healthOnce('127.0.0.1')) return true
    await sleep(500)
  }
  return false
}

async function main() {
  const dist = resolve(root, 'frontend', 'dist', 'index.html')
  if (!skipBuild || !existsSync(dist)) {
    banner('\n[1/3] 构建前端…')
    await run('pnpm', ['--filter', 'frontend', 'build'])
  } else {
    banner('\n[1/3] 跳过构建（--skip-build）')
  }

  const nics = lanIps()
  const primary = nics[0]
  const display = primary ? primary.ip : '127.0.0.1'

  banner(`\n[2/3] 启动服务（前端 + API 同端口 :${port}${useHttps ? '，HTTPS' : ''}）…`)
  const env = { ...process.env, PORT: String(port), USE_HTTPS: useHttps ? '1' : '0' }
  const child = spawn('pnpm', ['--filter', 'backend', 'serve'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  })

  const up = await waitForServer(child)
  if (!up) {
    console.error(c(31, `\n服务没有起来（端口 ${port} 可能已被占用）。请先结束占用 ${port} 的进程后重试。`))
    process.exit(1)
  }

  banner('\n[3/3] 可以访问了\n')
  console.log('  本机：    ' + `${scheme}://localhost:${port}`)
  for (const nic of nics) {
    const tag = nic.score < 0 ? c(90, '  （虚拟网卡，其他设备通常访问不到）') : ''
    console.log(`  局域网：  ${scheme}://${nic.ip}:${port}${tag}    [${nic.name}]`)
  }

  if (primary && primary.score > 0) {
    console.log('\n  手机扫码（连同一个 Wi-Fi）：')
    qrcode.generate(`${scheme}://${primary.ip}:${port}`, { small: true }, (qr) => console.log(qr))
  } else if (nics.length) {
    console.log(c(33, '\n  没有找到可用的局域网地址，只能本机访问。请检查 Wi-Fi / 网线是否已连接。'))
  }

  if (!useHttps) {
    console.log(
      c(33, '\n  当前是 http：其他设备打开后浏览器会禁用摄像头与麦克风（只能看界面/老师端）。') +
        c(33, '\n  正常做模拟面试请用默认的 https 模式。'),
    )
  } else {
    console.log(c(33, '\n  自签证书：每台设备首次打开会提示不安全，点「高级 / 更多」→「继续前往」即可。'))
    console.log(c(33, '  换 Wi-Fi 导致 IP 变化后，证书会自动重建（本机 IP 已写入证书）。'))
  }

  console.log('\n  若其他电脑/手机打不开：')
  console.log('   1) 确认两台设备在同一个 Wi-Fi / 同一网段（本机 ' + display + '）')
  console.log('   2) 路由器若开了「AP 隔离 / 访客网络」，设备之间互访会被拦，需关闭')
  console.log('   3) 放行防火墙（管理员 PowerShell 执行一次）：')
  console.log(
    `      New-NetFirewallRule -DisplayName "面试镜 ${port}" -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow`,
  )
  console.log('\n  按 Ctrl + C 结束服务。\n')

  child.on('exit', (code) => process.exit(code ?? 0))
}

main().catch((e) => {
  console.error(c(31, '启动失败：' + e.message))
  process.exit(1)
})
